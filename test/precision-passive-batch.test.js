import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  measurementSampleClock, precisionCaptureBudget, precisionStreamBudget,
  precisionBatchResources, validatePrecisionBatchOutput,
  PRECISION_BATCH_MAX_RING_ENTRIES, PRECISION_BATCH_MAX_OUTPUT_BYTES,
} from '../src/model/instrument-report.js';

const CLI = join(import.meta.dirname, '..', 'bin', 'bwc.mjs');
const PROFILE = { id: 'precision-v1', maxAttempts: 20000, maxStepSec: 1e-5 };
// Independent RC: 1 V step into R=1k, C=1u (tau = 1 ms), explicit zero state.
const R = 1e3, C = 1e-6, TAU = R * C;
const DECK = 'Passive RC 5 ms capture\nV1 in 0 1\nR1 in out 1k\nC1 out 0 1u\n.tran 1u 5m UIC\n.end\n';
const run = args => spawnSync(process.execPath, [CLI, 'measure', ...args], { encoding: 'utf8', timeout: 120000 });

test('whole-capture resource preflight: 5 ms / 1 MHz passive batch fits one budget', () => {
  const clock = measurementSampleClock(5e-3, 1e6);
  assert.equal(clock.captureSamples, 5000);
  const budget = precisionCaptureBudget(clock, PROFILE, 3);
  assert.equal(budget.maxAdvances, 1);
  assert.equal(budget.minimumAdaptiveAttempts, 5000);
  const res = precisionBatchResources(clock, budget, { scopeCount: 1, meterCount: 2, csv: true });
  assert.equal(res.ringDepth, 5002);
  assert.equal(res.ringEntries, 5002);
  assert.equal(res.meterHistoryEntriesPerMeter, 60001);
  assert.equal(res.outputBytesBound, 4096 + 5000 * 128);
  assert.equal(res.renewal, 'none-whole-capture');
  assert.equal(precisionBatchResources(clock, budget, { scopeCount: 1 }).outputBytesBound, 0);
});

test('resource and budget refusals are negatives, not truncations', () => {
  const big = measurementSampleClock(0.1, 2e6); // 200000 samples
  const budget = { ...precisionCaptureBudget(measurementSampleClock(5e-3, 1e6), PROFILE, 3) };
  assert.throws(() => precisionBatchResources(big, budget, { scopeCount: 6 }),
    new RegExp(`scope ring entries; limit is ${PRECISION_BATCH_MAX_RING_ENTRIES}`));
  assert.throws(() => precisionBatchResources(big, budget, { scopeCount: 2, csv: true }),
    new RegExp(`exceeds ${PRECISION_BATCH_MAX_OUTPUT_BYTES}`));
  assert.throws(() => precisionBatchResources(big, { ...budget, stream: {} }, { scopeCount: 1 }), /non-stream/);
  assert.throws(() => precisionBatchResources(big, budget, { scopeCount: -1 }), /non-negative/);
  const res = precisionBatchResources(measurementSampleClock(5e-3, 1e6), budget, { scopeCount: 1, csv: true });
  validatePrecisionBatchOutput(res.outputBytesBound, res);
  assert.throws(() => validatePrecisionBatchOutput(res.outputBytesBound + 1, res), /preflight bound/);
  // Work budget: an authored 50 ns step needs 100000 attempts > 20000.
  assert.throws(() => precisionCaptureBudget(measurementSampleClock(5e-3, 1e6),
    { ...PROFILE, authoredMaxStepSec: 50e-9 }, 3), /needs 100000 adaptive attempts; limit is 20000/);
  // Preserved negative control: passive precision watch stays unsupported, and
  // active watches stay capped at 200 observations (no renaming 200 as 5000).
  assert.throws(() => precisionStreamBudget(measurementSampleClock(5e-3, 1e6), budget, 'passive-source'),
    /precision watch requires the bounded ADP7118/);
  assert.throws(() => precisionStreamBudget(measurementSampleClock(1e-3, 1e6), budget, 'adp7118-current-limited'),
    /200 observations/);
});

test('5 ms / 1 MHz passive RC batch: closed form at every sample and meter integrals', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bwc-passive-batch-'));
  try {
    const file = join(dir, 'rc.cir'), csv = join(dir, 'capture.csv');
    writeFileSync(file, DECK);
    const r = run([file, '--scope', 'C1.a,V1.neg', '--meter', 'voltage:C1.a,V1.neg', '--meter', 'current:R1.a',
      '--profile', 'precision-v1', '--initial', 'zero-state', '--duration', '5ms', '--rate', '1MHz',
      '--json', '--csv', csv]);
    assert.equal(r.status, 0, r.stderr);
    const report = JSON.parse(r.stdout);
    assert.equal(report.transient.accuracyMet, true);
    const work = report.transient.work;
    assert.equal(work.advances, 1, 'one whole-capture advance, no per-chunk renewal');
    assert.ok(work.attempts <= 20000 && work.solves <= 60001);
    assert.equal(report.precisionResources.ringEntries, 5002);
    const bytes = statSync(csv).size;
    assert.ok(bytes <= report.precisionResources.outputBytesBound, `${bytes} within preflight bound`);
    const rows = readFileSync(csv, 'utf8').trim().split('\n').slice(2).map(row => row.split(',').map(Number));
    assert.equal(rows.length, report.scope[0].summary.samples);
    assert.ok(rows.length >= 5000, `all requested raw points retained (${rows.length})`);
    let worst = 0;
    for (const [elapsed, volts] of rows) {
      const t = elapsed + report.scope[0].startTimeSeconds;
      worst = Math.max(worst, Math.abs(volts - (1 - Math.exp(-t / TAU))));
    }
    assert.ok(worst <= 1e-6, `closed-form RC at every sample: worst ${worst}`);
    // Meters integrate 0..T (5 ms < 100 ms window): time means, not sample means.
    const T = 5e-3, meanV = 1 - (TAU / T) * (1 - Math.exp(-T / TAU));
    const [vMeter, iMeter] = report.meters.map(m => m.reading.siValue);
    assert.ok(Math.abs(vMeter - meanV) <= 1e-6, `voltage mean ${vMeter} vs ${meanV}`);
    const meanI = (1 - meanV) / R;
    assert.ok(Math.abs(Math.abs(iMeter) - meanI) <= 1e-9, `|current mean| ${iMeter} vs ${meanI}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('CLI negatives: passive watch and 50 ns step refuse before any artifact', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bwc-passive-batch-neg-'));
  try {
    const file = join(dir, 'rc.cir'), csv = join(dir, 'capture.csv');
    writeFileSync(file, DECK);
    const base = [file, '--scope', 'C1.a,V1.neg', '--profile', 'precision-v1', '--initial', 'zero-state',
      '--duration', '5ms', '--rate', '1MHz'];
    const watch = run([...base, '--watch', '--csv', csv]);
    assert.notEqual(watch.status, 0);
    assert.match(watch.stderr, /precision watch requires the bounded ADP7118/);
    const step = run([...base, '--max-step', '50ns', '--json', '--csv', csv]);
    assert.notEqual(step.status, 0);
    assert.match(step.stderr, /needs 100000 adaptive attempts; limit is 20000/);
    assert.throws(() => statSync(csv), /ENOENT/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
