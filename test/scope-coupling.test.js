// Frozen before the implementation was written or observed. The oracles below
// are independent closed forms of a first-order RC high-pass; no production
// recurrence is imported or re-derived here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createScopeCoupling, coupleScopeCapture } from '../src/model/scope-coupling.js';

const CLI = join(import.meta.dirname, '..', 'bin', 'bwc.mjs');

// Synthetic, fully-retained point ring: samples[t_k] = x(k*h).
function ring(values, intervalNs) {
  const samples = [];
  for (const v of values) samples.push(v, v);
  return { capture: 'sample', channelType: 'voltage', startTNs: 0n, sampleIntervalNs: BigInt(intervalNs),
    count: values.length, writeIndex: 0, samples };
}
const outputs = data => Array.from({ length: data.samples.length / 2 }, (_, k) => data.samples[2 * k]);

// Closed-form response of y' = x' - y/tau to x(t) = D + A sin(w t), with the
// capacitor uncharged (y(0) = x(0)) or settled to the initial input (y(0) = 0).
function closedForm(t, { D = 0, A = 0, w = 0, tau, initial }) {
  const wt = w * tau, r = A ? A * wt / Math.hypot(1, wt) : 0, phi = Math.atan2(1, wt);
  const sinePart = A ? r * (Math.sin(w * t + phi) - Math.sin(phi) * Math.exp(-t / tau)) : 0;
  const dcPart = initial === 'uncharged' ? D * Math.exp(-t / tau) : 0;
  return dcPart + sinePart;
}

function run({ D = 0, A = 0, f = 0, cornerHz, initial, samplesPerPeriod = 4000, seconds }) {
  const tau = 1 / (2 * Math.PI * cornerHz), w = 2 * Math.PI * f;
  const intervalNs = Math.round(1e9 / ((f || cornerHz) * samplesPerPeriod));
  const h = intervalNs / 1e9, n = Math.ceil(seconds / h) + 1;
  const xs = Array.from({ length: n }, (_, k) => D + A * Math.sin(w * k * h));
  const model = createScopeCoupling({ cornerHz, initial });
  const coupled = coupleScopeCapture(ring(xs, intervalNs), model);
  return { tau, w, h, xs, ys: outputs(coupled), coupled, model };
}
const maxError = (ys, h, p) => ys.reduce((m, y, k) => Math.max(m, Math.abs(y - closedForm(k * h, p))), 0);

// Steady-state amplitude/phase by least squares over whole periods.
function fitSine(ys, h, w, fromIndex) {
  let s = 0, c = 0, n = 0;
  for (let k = fromIndex; k < ys.length; k++) { s += ys[k] * Math.sin(w * k * h); c += ys[k] * Math.cos(w * k * h); n++; }
  return { amplitude: 2 * Math.hypot(s, c) / n, phase: Math.atan2(c, s) };
}

test('step at capture start: uncharged capacitor gives exactly V e^{-t/tau}', () => {
  const tau = 1e-3, model = createScopeCoupling({ tauSeconds: tau, initial: 'uncharged' });
  const coupled = coupleScopeCapture(ring(Array(5001).fill(2), 1000), model);
  const ys = outputs(coupled);
  for (let k = 0; k < ys.length; k++) assert(Math.abs(ys[k] - 2 * Math.exp(-k * 1e-6 / tau)) < 1e-12, `k=${k}`);
  // Non-vacuous: wrong sign and wrong tau oracles are rejected by the same data.
  assert(ys.some((y, k) => Math.abs(y - (-2 * Math.exp(-k * 1e-6 / tau))) > 1));
  assert(ys.some((y, k) => Math.abs(y - 2 * Math.exp(-k * 1e-6 / (1.1 * tau))) > 1e-2));
  assert(ys.some((y, k) => Math.abs(y - 2 * Math.exp(-k * 1e-6 / (0.9 * tau))) > 1e-2));
  // Settled-to-DC capacitor: constant input is removed from the first sample.
  const settled = outputs(coupleScopeCapture(ring(Array(100).fill(2), 1000),
    createScopeCoupling({ tauSeconds: tau, initial: 'settled' })));
  assert(settled.every(y => Math.abs(y) < 1e-15));
});

test('PWL ramp is integrated exactly (closed form for linear input from rest)', () => {
  // x = s t, uncharged (y0 = x0 = 0): y = s tau (1 - e^{-t/tau}).
  const tau = 2e-4, s = 300, h = 1e-6;
  const xs = Array.from({ length: 2001 }, (_, k) => s * k * h);
  const ys = outputs(coupleScopeCapture(ring(xs, 1000), createScopeCoupling({ tauSeconds: tau, initial: 'uncharged' })));
  ys.forEach((y, k) => assert(Math.abs(y - s * tau * (1 - Math.exp(-k * h / tau))) < 1e-12));
});

for (const ratio of [1, 10, 0.1]) {
  test(`sine at ${ratio} x corner: closed-form amplitude, phase and transient`, () => {
    const cornerHz = 10, f = ratio * cornerHz;
    const tau = 1 / (2 * Math.PI * cornerHz);
    const periods = 5, seconds = 20 * tau + periods / f;
    const r = run({ A: 1, f, cornerHz, initial: 'uncharged', seconds: Math.ceil(seconds * f) / f });
    const p = { A: 1, w: r.w, tau, initial: 'uncharged' };
    assert(maxError(r.ys, r.h, p) < 2e-5, `max error ${maxError(r.ys, r.h, p)}`);
    const startIndex = r.ys.length - 1 - Math.round(periods / f / r.h);
    const fit = fitSine(r.ys.slice(0, -1), r.h, r.w, startIndex);
    const expectAmp = ratio / Math.hypot(1, ratio), expectPhase = Math.atan2(1, ratio);
    assert(Math.abs(fit.amplitude - expectAmp) < 1e-4, `amp ${fit.amplitude} vs ${expectAmp}`);
    assert(Math.abs(fit.phase - expectPhase) < 1e-4, `phase ${fit.phase} vs ${expectPhase}`);
    if (ratio === 1) { assert(Math.abs(expectAmp - Math.SQRT1_2) < 1e-15); assert(Math.abs(expectPhase - Math.PI / 4) < 1e-15); }
    // Mutation controls: lag instead of lead (wrong sign) and a 10% wrong tau.
    assert(Math.abs(fit.phase + expectPhase) > 0.05);
    assert(maxError(r.ys, r.h, { ...p, tau: tau * 1.1 }) > 1e-3);
  });
}

test('DC offset is removed with the declared time constant (uncharged vs settled)', () => {
  const cornerHz = 10, tau = 1 / (2 * Math.PI * cornerHz);
  for (const initial of ['uncharged', 'settled']) {
    const r = run({ D: 2, A: 0.5, f: 100, cornerHz, initial, samplesPerPeriod: 2000, seconds: 8 * tau });
    const p = { D: 2, A: 0.5, w: r.w, tau, initial };
    assert(maxError(r.ys, r.h, p) < 2e-5, `${initial} max error ${maxError(r.ys, r.h, p)}`);
    // The residual offset at one tau is 2/e for uncharged and zero for settled.
    const k = Math.round(tau / r.h), y = r.ys[k] - closedForm(k * r.h, { A: 0.5, w: r.w, tau, initial });
    assert(Math.abs(y - (initial === 'uncharged' ? 2 * Math.exp(-k * r.h / tau) : 0)) < 2e-5);
    assert(maxError(r.ys, r.h, { ...p, tau: tau * 1.1 }) > 1e-4, `${initial} wrong-tau control`);
    // Wrong-sign DC transient (uncharged) or wrong initial condition (settled) must be rejected.
    assert(maxError(r.ys, r.h, initial === 'uncharged' ? { ...p, D: -2 } : { ...p, initial: 'uncharged' }) > 1);
  }
});

test('raw ring is not mutated and coupled view carries an honest descriptor', () => {
  const data = ring([1, 2, 3, 4], 1000), before = data.samples.slice();
  const coupled = coupleScopeCapture(data, createScopeCoupling({ cornerHz: 10, initial: 'uncharged' }));
  assert.deepEqual(data.samples, before);
  assert.deepEqual(Array.from(coupled.coupling.rawSamples), before);
  const d = coupled.coupling.descriptor;
  assert.equal(d.kind, 'first-order-rc-highpass'); assert.equal(d.physicalHardwareModel, false);
  assert.equal(d.initial, 'uncharged'); assert(Math.abs(d.tauSeconds - 1 / (20 * Math.PI)) < 1e-18);
  assert(Object.isFrozen(coupled) && Object.isFrozen(coupled.samples) && Object.isFrozen(d));
});

test('invalid parameters and captures refuse by name', () => {
  const bad = [[{}, /cornerHz or tauSeconds/], [{ cornerHz: 10, tauSeconds: 1 }, /exactly one/],
    [{ cornerHz: 0 }, /cornerHz/], [{ cornerHz: -1 }, /cornerHz/], [{ cornerHz: NaN }, /cornerHz/],
    [{ cornerHz: Infinity }, /cornerHz/], [{ tauSeconds: 0 }, /tauSeconds/], [{ tauSeconds: '1' }, /tauSeconds/],
    [{ cornerHz: 10, initial: 'charged' }, /initial/], [{ cornerHz: 10, extra: 1 }, /unknown.*extra/]];
  for (const [options, message] of bad) assert.throws(() => createScopeCoupling(options), message, JSON.stringify(options));
  const model = createScopeCoupling({ cornerHz: 10 });
  assert.equal(model.descriptor.initial, 'uncharged');
  assert.throws(() => coupleScopeCapture(ring([1, NaN, 2], 1000), model), /gap/);
  assert.throws(() => coupleScopeCapture({ ...ring([1, 2], 1000), capture: 'envelope' }, model), /sample/);
  assert.throws(() => coupleScopeCapture(ring([1, 2], 1000), { descriptor: model.descriptor }), /createScopeCoupling/);
});

// ---- CLI: opt-in per channel, default bytes unchanged -----------------------
const measure = (file, extra) => spawnSync(process.execPath, [CLI, 'measure', file,
  '--scope', 'V1.pos,V1.neg', '--scope', 'V2.pos,V2.neg', '--duration', '20us', '--rate', '1MHz', ...extra],
{ encoding: 'utf8', timeout: 60000, maxBuffer: 8 * 1024 * 1024 });
const sections = csv => csv.trimEnd().split('\n\n');

test('CLI: AC coupling on one channel matches closed form; other channel and defaults are byte-identical', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bwc-ac-coupling-'));
  try {
    const input = join(dir, 'input.cir');
    writeFileSync(input, 'Authored AC coupling control\nV1 a 0 2\nR1 a 0 1k\nV2 b 0 1\nR2 b 0 1k\n.end\n');
    const rawCsv = join(dir, 'raw.csv'), rawCsv2 = join(dir, 'raw2.csv'), acCsv = join(dir, 'ac.csv');
    const base = measure(input, ['--csv', rawCsv, '--json']); assert.equal(base.status, 0, base.stderr);
    const base2 = measure(input, ['--csv', rawCsv2, '--json']); assert.equal(base2.status, 0, base2.stderr);
    assert.equal(readFileSync(rawCsv, 'utf8'), readFileSync(rawCsv2, 'utf8'));
    const raw = JSON.parse(base.stdout);
    assert.equal(Object.hasOwn(raw, 'scopeCoupling'), false); assert.equal(Object.hasOwn(raw.scope[0], 'coupling'), false);
    const tau = 5e-6;
    const ac = measure(input, ['--ac-couple', 'V1.pos,V1.neg', '--ac-rc', String(tau), '--csv', acCsv, '--json']);
    assert.equal(ac.status, 0, ac.stderr);
    const report = JSON.parse(ac.stdout);
    assert.equal(report.scope[0].coupling.descriptor.kind, 'first-order-rc-highpass');
    assert.equal(Object.hasOwn(report.scope[1], 'coupling'), false);
    assert.deepEqual(report.scope[0].summary, raw.scope[0].summary, 'raw summary keeps its meaning');
    const [acSection, otherSection] = sections(readFileSync(acCsv, 'utf8'));
    assert.equal(otherSection, sections(readFileSync(rawCsv, 'utf8'))[1]);
    const lines = acSection.split('\n');
    assert.match(lines[0], /coupling=\{/); assert.equal(lines[1], 'elapsed_seconds,input_volts,volts');
    const rows = lines.slice(2).map(line => line.split(',').map(Number));
    assert(rows.length >= 10);
    for (const [t, x, y] of rows) {
      assert.equal(x, 2);
      assert(Math.abs(y - 2 * Math.exp(-t / tau)) < 1e-12, `t=${t} y=${y}`);
    }
    assert(rows.some(([t, , y]) => Math.abs(y - 2 * Math.exp(-t / (1.1 * tau))) > 1e-2));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('CLI: invalid coupling options refuse by name before capture', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bwc-ac-refuse-'));
  try {
    const input = join(dir, 'input.cir');
    writeFileSync(input, 'Authored\nV1 a 0 2\nR1 a 0 1k\nV2 b 0 1\nR2 b 0 1k\n.end\n');
    const csv = join(dir, 'never.csv');
    for (const [flags, message] of [
      [['--ac-couple', 'V1.pos,V1.neg'], /--ac-corner-hz or --ac-rc/],
      [['--ac-couple', 'V1.pos,V1.neg', '--ac-corner-hz', '10', '--ac-rc', '1'], /exactly one/],
      [['--ac-couple', 'V1.pos,V1.neg', '--ac-corner-hz', '0'], /--ac-corner-hz/],
      [['--ac-couple', 'V1.pos,V1.neg', '--ac-corner-hz', 'abc'], /--ac-corner-hz/],
      [['--ac-couple', 'V1.pos,V1.neg', '--ac-rc', '-1'], /--ac-rc/],
      [['--ac-couple', 'V1.pos,V1.neg', '--ac-corner-hz', '10', '--ac-initial', 'charged'], /--ac-initial/],
      [['--ac-couple', 'R9.a', '--ac-corner-hz', '10'], /--ac-couple.*R9\.a/],
      [['--ac-corner-hz', '10'], /--ac-couple/],
      [['--ac-couple', 'V1.pos,V1.neg', '--ac-corner-hz', '10', '--watch'], /--watch/],
      [['--ac-couple', 'V1.pos,V1.neg', '--ac-corner-hz', '10', '--adc-bits', '2', '--adc-low', '0', '--adc-high', '3'], /ADC/],
      [['--ac-cupel', 'x'], /unknown.*--ac-cupel/],
    ]) {
      const r = measure(input, [...flags, '--csv', csv]);
      assert.equal(r.status, 2, `${flags.join(' ')}: ${r.stderr}`);
      assert.match(r.stderr, message, flags.join(' '));
      assert.throws(() => readFileSync(csv), /ENOENT/);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
