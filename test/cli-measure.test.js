import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  compareExpectedWaveforms, parseExpectedWaveforms, parseMeterSpec, parseScaledNumber,
  parseScopeSpec, resolveEndpointNet, summarizeScope,
} from '../src/model/instrument-report.js';

const ROOT = join(import.meta.dirname, '..');
const CLI = join(ROOT, 'bin', 'bwc.mjs');
const FIXTURE = join(import.meta.dirname, 'fixtures', 'cli-measure-divider.json');
const SINE_FIXTURE = join(import.meta.dirname, 'fixtures', 'cli-measure-sine.cir');

test('measurement arguments are bounded and unambiguous', () => {
  assert.equal(parseScaledNumber('2.5ms', 'duration'), 0.0025);
  assert.equal(parseScaledNumber('20kHz', 'rate'), 20_000);
  assert.deepEqual(parseScopeSpec('RT.b,GND.gnd'), { tip: 'RT.b', reference: 'GND.gnd' });
  assert.deepEqual(parseMeterSpec('voltage:RT.b,GND.gnd'), { mode: 'voltage', probes: ['RT.b', 'GND.gnd'] });
  assert.throws(() => parseMeterSpec('current:RT.a,RT.b'), /needs 1 endpoint/);
  assert.throws(() => parseScaledNumber('-1ms', 'duration'), /invalid duration/);
});

test('endpoint resolution accepts explicit nets and part terminals but refuses guesses', () => {
  const nets = [
    { id: 'rail', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'RT', terminal: 'a' }] },
    { id: 'mid', terminals: [{ part: 'RT', terminal: 'b' }, { part: 'RB', terminal: 'a' }] },
  ];
  assert.equal(resolveEndpointNet(nets, 'RT.b'), 'mid');
  assert.equal(resolveEndpointNet(nets, 'net:rail'), 'rail');
  assert.throws(() => resolveEndpointNet(nets, 'RB.b'), /resolves to 0 nets/);
});

test('scope summary reads the chronological ring rather than backing storage order', () => {
  const data = { samples: new Float64Array([3, 3, 4, 4, 1, 1, 2, 2]), count: 4, writeIndex: 2 };
  assert.deepEqual(summarizeScope(data), {
    samples: 4, minVolts: 1, maxVolts: 4, meanVolts: 2.5,
    rmsVolts: Math.sqrt(7.5), lastVolts: 4,
  });
});

test('bwc measure returns real scope and multimeter readings as JSON', () => {
  const text = execFileSync(process.execPath, [CLI, 'measure', FIXTURE,
    '--scope', 'RT.b,GND.gnd', '--probe', '10x', '--duration', '1ms', '--rate', '10kHz',
    '--meter', 'voltage:RT.b,GND.gnd', '--meter', 'current:RT.a', '--json'],
  { encoding: 'utf8', env: { ...process.env } });
  const report = JSON.parse(text);
  assert.equal(report.scope.length, 1);
  assert.equal(report.scope[0].probe, '10x');
  assert.equal(report.scope[0].summary.samples, 10);
  assert.ok(Math.abs(report.scope[0].summary.lastVolts - (5 / 3)) < 1e-4);
  assert.equal(report.meters[0].mode, 'voltage');
  assert.equal(report.meters[0].reading.value, '1.667');
  assert.equal(report.meters[0].reading.unit, 'V');
  assert.ok(Math.abs(report.meters[0].reading.siValue - (5 / 3)) < 1e-4);
  assert.equal(report.meters[0].reading.siUnit, 'V');
  assert.equal(report.meters[1].mode, 'current');
  assert.equal(report.meters[1].reading.unit, 'nA');
  assert.ok(Math.abs(Math.abs(report.meters[1].reading.siValue) - (1 / 3_000_000)) < 1e-10);
  assert.equal(report.meters[1].reading.siUnit, 'A');
});

test('finite probes require a reference and CSV is an explicit file', () => {
  const refused = spawnSync(process.execPath, [CLI, 'measure', FIXTURE,
    '--scope', 'RT.b', '--probe', '10x'], { encoding: 'utf8' });
  assert.equal(refused.status, 2);
  assert.match(refused.stderr, /requires an explicit reference net/);

  const dir = mkdtempSync(join(tmpdir(), 'bwc-measure-'));
  const csv = join(dir, 'trace.csv');
  const output = execFileSync(process.execPath, [CLI, 'measure', FIXTURE,
    '--scope', 'RT.b', '--duration', '1ms', '--rate', '10kHz',
    '--meter', 'resistance:RT.a,RT.b', '--csv', csv],
  { encoding: 'utf8', env: { ...process.env } });
  assert.match(output, /meter resistance/);
  assert.doesNotMatch(output, /Turn power OFF/);
  assert.match(readFileSync(csv, 'utf8'), /capture=sample startTimeNs=100000 sampleIntervalNs=100000 points=10/);
  assert.match(readFileSync(csv, 'utf8'), /elapsed_seconds,volts/);
});

test('imported SINE is measured on its real simulation clock with analytical values', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bwc-measure-sine-'));
  const csv = join(dir, 'trace.csv');
  const text = execFileSync(process.execPath, [CLI, 'measure', SINE_FIXTURE,
    '--scope', 'V1.pos,V1.neg', '--meter', 'voltage:V1.pos,V1.neg',
    '--meter', 'current:R1.a', '--duration', '500us', '--rate', '100kHz',
    '--csv', csv, '--json'], { encoding: 'utf8', env: { ...process.env } });
  const report = JSON.parse(text);
  const scope = report.scope[0];
  assert.equal(scope.summary.samples, 50);
  assert.equal(scope.startTimeSeconds, 10e-6);
  assert.equal(scope.sampleIntervalSeconds, 10e-6);
  assert.ok(Math.abs(scope.summary.meanVolts - 1.25) < 1e-12);
  assert.ok(Math.abs(scope.summary.rmsVolts - Math.sqrt(1.25 ** 2 + (2 ** 2) / 2)) < 1e-12);
  assert.ok(Math.abs(report.meters[0].reading.siValue - 1.25) < 1e-12);
  assert.ok(Math.abs(report.meters[1].reading.siValue + 0.00125) < 1e-12,
    'current is signed positive out of the selected resistor terminal');
  const rows = readFileSync(csv, 'utf8').trim().split('\n');
  assert.match(rows[0], /startTimeNs=10000 sampleIntervalNs=10000 points=50/);
  const [elapsed, firstVolts] = rows[2].split(',').map(Number);
  assert.equal(elapsed, 0);
  assert.ok(Math.abs(firstVolts - (1.25 - 2 * Math.sin(2 * Math.PI * 2000 * 10e-6))) < 1e-12);
});

test('invalid requested meter endpoints fail instead of printing a placeholder', () => {
  const refused = spawnSync(process.execPath, [CLI, 'measure', FIXTURE,
    '--meter', 'current:NO_SUCH_PART.a'], { encoding: 'utf8' });
  assert.equal(refused.status, 2);
  assert.match(refused.stderr, /resolves to 0 nets/);
});

test('watch streams monotonic true samples and agrees exactly with batch capture', () => {
  const args = ['measure', SINE_FIXTURE, '--scope', 'V1.pos,V1.neg',
    '--meter', 'voltage:V1.pos,V1.neg', '--meter', 'current:R1.a',
    '--duration', '50us', '--rate', '100kHz'];
  const watched = execFileSync(process.execPath, [CLI, ...args, '--watch'], { encoding: 'utf8' })
    .trim().split('\n').map(JSON.parse);
  const samples = watched.filter(row => row.recordType === 'sample');
  const summary = watched.at(-1);
  assert.equal(samples.length, 5);
  assert.equal(summary.recordType, 'summary');
  assert.equal(summary.watchSamples, 5);
  for (let index = 0; index < samples.length; index++) {
    const row = samples[index];
    const time = (index + 1) * 10e-6;
    const expected = 1.25 - 2 * Math.sin(2 * Math.PI * 2000 * time);
    assert.equal(row.index, index);
    assert.ok(Math.abs(row.timeSeconds - time) < 1e-15);
    assert.ok(Math.abs(row.scope[0].volts - expected) < 1e-12);
    assert.equal(row.meters[0].reading.siValue, row.scope[0].volts);
    assert.ok(Math.abs(row.meters[1].reading.siValue + row.scope[0].volts / 1000) < 1e-15);
  }

  const dir = mkdtempSync(join(tmpdir(), 'bwc-measure-watch-'));
  const csv = join(dir, 'batch.csv');
  execFileSync(process.execPath, [CLI, ...args, '--csv', csv], { encoding: 'utf8' });
  const batch = readFileSync(csv, 'utf8').trim().split('\n').slice(2)
    .map(line => Number(line.split(',')[1]));
  batch.forEach((value, index) => assert.ok(
    Math.abs(value - samples[index].scope[0].volts) <= Number.EPSILON,
    `observing between advances changed sample ${index} beyond one binary64 ulp`,
  ));
});

test('expected waveform comparison checks every timestamp/value and makes a mutation red', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bwc-measure-expect-'));
  const expectedPath = join(dir, 'expected.json');
  const samples = Array.from({ length: 5 }, (_, index) => {
    const timeSeconds = (index + 1) * 10e-6;
    return { timeSeconds, volts: 1.25 - 2 * Math.sin(2 * Math.PI * 2000 * timeSeconds) };
  });
  const expected = { schemaVersion: 1, provenance: { kind: 'analytical-sine', model: 'V(t)=1.25-2*sin(2*pi*2000*t)' },
    traces: [{ tip: 'V1.pos', reference: 'V1.neg', samples }] };
  assert.equal(compareExpectedWaveforms(expected.traces, parseExpectedWaveforms(JSON.stringify(expected))).status, 'pass');
  writeFileSync(expectedPath, JSON.stringify(expected));
  const good = JSON.parse(execFileSync(process.execPath, [CLI, 'measure', SINE_FIXTURE,
    '--scope', 'V1.pos,V1.neg', '--duration', '50us', '--rate', '100kHz',
    '--expect', expectedPath, '--json'], { encoding: 'utf8' }));
  assert.equal(good.comparison.status, 'pass');
  assert.deepEqual(good.comparison.counts, { traces: 1, compared: 5, passed: 5, failed: 0, structuralFailures: 0 });
  assert.equal(good.claims.independentOracle, false, 'caller provenance is reported, not trusted as an oracle claim');

  expected.traces[0].samples[2].volts += 0.1;
  writeFileSync(expectedPath, JSON.stringify(expected));
  const bad = spawnSync(process.execPath, [CLI, 'measure', SINE_FIXTURE,
    '--scope', 'V1.pos,V1.neg', '--duration', '50us', '--rate', '100kHz',
    '--expect', expectedPath, '--json'], { encoding: 'utf8' });
  assert.equal(bad.status, 1);
  const report = JSON.parse(bad.stdout);
  assert.equal(report.comparison.status, 'fail');
  assert.equal(report.comparison.counts.failed, 1);
  assert.equal(report.comparison.mismatches[0].code, 'sample-voltage');

  const short = structuredClone(expected);
  short.traces[0].samples.pop();
  const missing = compareExpectedWaveforms([{ tip: 'V1.pos', reference: 'V1.neg', samples }], short);
  assert.equal(missing.status, 'fail');
  assert.equal(missing.counts.structuralFailures, 1);
  assert.equal(missing.mismatches[0].code, 'sample-count');
});

test('watch exposes PULSE edges on their actual simulation timestamps', () => {
  const fixture = join(import.meta.dirname, 'fixtures', 'spice-precision-analysis.cir');
  const rows = execFileSync(process.execPath, [CLI, 'measure', fixture,
    '--scope', 'V1.pos,V1.neg', '--meter', 'voltage:V1.pos,V1.neg',
    '--duration', '3us', '--rate', '2MHz', '--watch'], { encoding: 'utf8' })
    .trim().split('\n').map(JSON.parse).filter(row => row.recordType === 'sample');
  assert.deepEqual(rows.map(row => row.timeSeconds), [0.5e-6, 1e-6, 1.5e-6, 2e-6, 2.5e-6, 3e-6]);
  assert.deepEqual(rows.map(row => row.scope[0].volts), [0, 0, 5, 5, 5, 5]);
  assert.deepEqual(rows.map(row => row.meters[0].reading.siValue), [0, 0, 5, 5, 5, 5]);
});

test('watch refuses modes that cannot represent a powered time series', () => {
  const resistance = spawnSync(process.execPath, [CLI, 'measure', FIXTURE,
    '--meter', 'resistance:RT.a,RT.b', '--watch'], { encoding: 'utf8' });
  assert.equal(resistance.status, 2);
  assert.match(resistance.stderr, /resistance powers the circuit off/);
});
