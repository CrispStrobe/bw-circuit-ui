import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  parseMeterSpec, parseScaledNumber, parseScopeSpec, resolveEndpointNet, summarizeScope,
} from '../src/model/instrument-report.js';

const ROOT = join(import.meta.dirname, '..');
const CLI = join(ROOT, 'bin', 'bwc.mjs');
const FIXTURE = join(import.meta.dirname, 'fixtures', 'cli-measure-divider.json');

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
  assert.equal(report.meters[1].mode, 'current');
  assert.equal(report.meters[1].reading.unit, 'mA');
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
  assert.match(readFileSync(csv, 'utf8'), /capture=sample sampleIntervalNs=100000 points=10/);
  assert.match(readFileSync(csv, 'utf8'), /elapsed_seconds,volts/);
});

test('invalid requested meter endpoints fail instead of printing a placeholder', () => {
  const refused = spawnSync(process.execPath, [CLI, 'measure', FIXTURE,
    '--meter', 'current:NO_SUCH_PART.a'], { encoding: 'utf8' });
  assert.equal(refused.status, 2);
  assert.match(refused.stderr, /resolves to 0 nets/);
});
