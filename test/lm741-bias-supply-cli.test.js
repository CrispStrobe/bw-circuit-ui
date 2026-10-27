// Opt-in nominal 25 C LM741 bias/supply domain through the installed CLI.
// Expectations are TI SNOSC25D TYPICAL values (Ib 80 nA, Ios 20 nA,
// Is 1.7 mA at 25 C, ±15 V), written before observing; not guaranteed limits.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { validatePrecisionCaptureInput, precisionCaptureBudget, lm741BiasSupplyRequested,
  LM741_BIAS_SUPPLY_DOMAIN } from '../src/model/instrument-report.js';
import { measurementSampleClock } from '../src/model/instrument-report.js';

const CLI = join(import.meta.dirname, '..', 'bin', 'bwc.mjs');
const IB = 80e-9, IOS = 20e-9, IQ = 1.7e-3;

function follower({ sign = 1, domain = true, rl = 10000 } = {}) {
  const wire = (from, fromTerminal, to, toTerminal) => ({ from, fromTerminal, to, toTerminal });
  return { vcc: 5, parts: [
    { id: 'VP', kind: 'vsource', params: { volts: 15 } },
    { id: 'VN', kind: 'vsource', params: { volts: 15 } },
    { id: 'VIN', kind: 'vsource', params: { volts: 0 } },
    { id: 'G', kind: 'gnd', params: {} },
    { id: 'U', kind: 'lm741', params: { transientModel: 'linear-pole', inputOffsetV: 0,
      supplyPositiveV: 15, supplyNegativeV: -15,
      ...(domain ? { biasSupplyDomain: LM741_BIAS_SUPPLY_DOMAIN, inputOffsetCurrentSign: sign } : {}) } },
    { id: 'RL', kind: 'resistor', params: { ohms: rl } },
  ], wires: [wire('VP', 'neg', 'G', 'gnd'), wire('VN', 'pos', 'G', 'gnd'), wire('VIN', 'neg', 'G', 'gnd'),
    wire('RL', 'b', 'G', 'gnd'), wire('VP', 'pos', 'U', 'vpos'), wire('VN', 'neg', 'U', 'vneg'),
    wire('VIN', 'pos', 'U', 'inp'), wire('U', 'out', 'U', 'inn'), wire('U', 'out', 'RL', 'a')] };
}

test('LM741 bias/supply admission is opt-in, exact and refuses unsupported domains', () => {
  const clock = measurementSampleClock(20e-6, 2e6), profile = { id: 'precision-v1', maxAttempts: 20000, maxStepSec: 1e-5 };
  const on = follower().parts, off = follower({ domain: false }).parts;
  assert.equal(lm741BiasSupplyRequested(on), true);
  assert.equal(lm741BiasSupplyRequested(off), false);
  assert.equal(validatePrecisionCaptureInput(on, 1, ['current']), 'lm741-linear-pole');
  const plain = precisionCaptureBudget(clock, profile, 5, 'lm741-linear-pole');
  assert.deepEqual(plain.hiddenSolverExpansion, { parts: 5, nets: 2 });
  assert.match(plain.admission, /bias-not-adopted$/, 'default label unchanged');
  const biased = precisionCaptureBudget(clock, profile, 5, 'lm741-linear-pole', { biasSupply: true });
  assert.deepEqual(biased.hiddenSolverExpansion, { parts: 6, nets: 2 });
  assert.match(biased.admission, /nominal-typical-25c-bias-supply$/);
  assert.throws(() => precisionCaptureBudget(clock, profile, 5, 'passive-source', { biasSupply: true }), /linear-pole/);
  for (const edit of [p => { p.biasSupplyDomain = 'ti-snosc25d-typical-70c'; },
    p => { delete p.inputOffsetCurrentSign; }, p => { p.inputOffsetCurrentSign = 0; },
    p => { p.supplyPositiveV = 12; p.supplyNegativeV = -12; },
    p => { delete p.transientModel; }]) {
    const changed = structuredClone(on); edit(changed[4].params);
    assert.throws(() => validatePrecisionCaptureInput(changed, 1, []), /precision LM741/);
  }
  const full = structuredClone(on);
  while (full.length < 26) full.push({ id: `R${full.length}`, kind: 'resistor', params: { ohms: 1000 } });
  assert.equal(validatePrecisionCaptureInput(full, 1, []), 'lm741-linear-pole');
  full.push({ id: 'R26', kind: 'resistor', params: { ohms: 1000 } });
  assert.throws(() => validatePrecisionCaptureInput(full, 1, []), /26/);
});

test('installed CLI meters typical rail and bias currents for both offset signs; off stays unrepresented', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bwc-lm741-bias-'));
  const env = { ...process.env }; delete env.BW_BOARD;
  try {
    const file = join(dir, 'follower.json');
    const run = () => spawnSync(process.execPath, [CLI, 'measure', file, '--profile', 'precision-v1',
      '--initial', 'zero-state', '--scope', 'U.out,G.gnd', '--meter', 'current:U.vpos', '--meter', 'current:U.vneg',
      '--meter', 'current:VP.pos', '--meter', 'current:U.inp',
      '--duration', '20us', '--rate', '2MHz', '--json'], { encoding: 'utf8', env, timeout: 60000 });
    for (const sign of [1, -1]) {
      writeFileSync(file, JSON.stringify(follower({ sign })));
      const r = run(); assert.equal(r.status, 0, r.stderr);
      const report = JSON.parse(r.stdout);
      assert.match(report.precisionCapture.admission, /nominal-typical-25c-bias-supply$/);
      assert.deepEqual(report.precisionCapture.hiddenSolverExpansion, { parts: 6, nets: 2 });
      const [vpos, vneg, vp, inp] = report.meters.map(m => { assert.equal(m.reading.note, null); return m.reading.siValue; });
      const ibp = IB + sign * IOS / 2, ibn = IB - sign * IOS / 2;
      // VIN = 0: output current ≈ Ibn (inn bias supplied by the output), sourced from V+.
      const tol = 1e-10;
      assert.ok(Math.abs(-vpos - (IQ + ibn)) <= tol, `V+ ${sign}: ${vpos}`);
      assert.ok(Math.abs(vneg - (IQ + ibp + ibn)) <= tol, `V- ${sign}: ${vneg}`);
      assert.ok(Math.abs(vp + vpos) <= 1e-12, 'rail source carries the package V+ current');
      assert.ok(Math.abs(-inp - ibp) <= tol, `inp bias ${sign}: ${inp}`);
    }
    writeFileSync(file, JSON.stringify(follower({ domain: false })));
    const off = run();
    if (off.status === 0) {
      const meter = JSON.parse(off.stdout).meters[0];
      assert.notEqual(meter.reading.note, null, 'domain off: supply pin current remains unrepresented');
    } else assert.match(off.stderr + off.stdout, /current|branch/i);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
