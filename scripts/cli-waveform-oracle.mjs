/** Independent transient waveform check for the shipping `bwc measure` path. */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const CLI = join(ROOT, 'bin', 'bwc.mjs');
const FIXTURE = join(ROOT, 'test', 'fixtures', 'cli-measure-sine.cir');

function fail(message, detail = '') {
  return { ok: false, lines: [`  ${message}`, ...(detail ? [`  ${detail}`] : [])] };
}

export function runCliWaveformOracle(ngspice = 'ngspice') {
  const dir = mkdtempSync(join(tmpdir(), 'bw-cli-waveform-oracle-'));
  const original = readFileSync(FIXTURE, 'utf8');
  const circuitCards = original.split(/\r?\n/)
    .filter(line => !/^\s*\.tran\b/i.test(line) && !/^\s*\.end\b/i.test(line)).join('\n');
  const deck = `${circuitCards}\n`
    + '.options reltol=1e-10 abstol=1e-14 vntol=1e-10 trtol=1\n'
    + '.control\nset wr_vecnames\nset wr_singlescale\n'
    + 'tran 10u 500u 0 100n\nlinearize v(signal)\n'
    + 'wrdata reference.csv time v(signal)\n.endc\n.end\n';
  writeFileSync(join(dir, 'oracle.cir'), deck);
  const oracle = spawnSync(ngspice, ['-b', 'oracle.cir'], {
    cwd: dir, encoding: 'utf8', timeout: 60_000, maxBuffer: 4 * 1024 * 1024,
  });
  if (oracle.status !== 0) return fail('ngspice transient execution failed',
    String(oracle.stderr || oracle.stdout).slice(0, 400));

  const rows = readFileSync(join(dir, 'reference.csv'), 'utf8').trim().split('\n').slice(1)
    .map(line => line.trim().split(/\s+/).map(Number))
    .map(fields => ({ timeSeconds: fields[0], volts: fields.at(-1) }))
    .filter(row => row.timeSeconds > 0);
  if (rows.length !== 50 || rows.some(row => !Number.isFinite(row.timeSeconds) || !Number.isFinite(row.volts))) {
    return fail(`ngspice reference grid is not the required 50 finite points (got ${rows.length})`);
  }
  const version = spawnSync(ngspice, ['--version'], { encoding: 'utf8' });
  const versionLine = String(version.stdout || version.stderr).split('\n').find(line => /ngspice-/i.test(line))?.trim() || 'ngspice';
  const expected = { schemaVersion: 1,
    provenance: { kind: 'ngspice', version: versionLine,
      analysis: 'tran 10u 500u 0 100n; linearized onto the authored 10 us output grid',
      numericalProfile: 'reltol=1e-10 abstol=1e-14 vntol=1e-10 trtol=1' },
    traces: [{ tip: 'V1.pos', reference: 'V1.neg', samples: rows }] };
  const expectedPath = join(dir, 'expected.json');
  writeFileSync(expectedPath, JSON.stringify(expected));

  const args = [CLI, 'measure', FIXTURE, '--scope', 'V1.pos,V1.neg',
    '--duration', '500us', '--rate', '100kHz', '--expect', expectedPath, '--json'];
  const measured = spawnSync(process.execPath, args, {
    encoding: 'utf8', timeout: 60_000, maxBuffer: 4 * 1024 * 1024,
  });
  if (measured.status !== 0) return fail('bwc measure rejected the ngspice waveform',
    String(measured.stderr || measured.stdout).slice(0, 400));
  let report;
  try { report = JSON.parse(measured.stdout); } catch (error) {
    return fail('bwc measure did not return JSON', error.message);
  }
  if (report.comparison?.status !== 'pass' || report.comparison?.counts?.compared !== 50
      || report.comparison?.counts?.passed !== 50) {
    return fail('bwc/ngspice waveform denominator is not 50/50', JSON.stringify(report.comparison));
  }
  if (report.claims?.independentOracle !== false || report.comparison?.provenance?.kind !== 'ngspice') {
    return fail('CLI must report caller provenance without trusting it as an independent-oracle claim');
  }

  // Load-bearing proof: one changed oracle voltage must make this exact command red.
  expected.traces[0].samples[17].volts += 0.1;
  writeFileSync(expectedPath, JSON.stringify(expected));
  const mutant = spawnSync(process.execPath, args, {
    encoding: 'utf8', timeout: 60_000, maxBuffer: 4 * 1024 * 1024,
  });
  let mutantReport = null;
  try { mutantReport = JSON.parse(mutant.stdout); } catch { /* diagnosed below */ }
  if (mutant.status !== 1 || mutantReport?.comparison?.counts?.failed !== 1) {
    return fail('changed ngspice sample did not make exactly one comparison red');
  }
  return { ok: true, lines: [
    `  ${versionLine}`,
    '  50/50 time-aligned voltage samples pass at 1 microvolt/1 ppm defaults',
    `  worst absolute voltage difference ${report.comparison.worstVolts.toExponential(6)} V`,
    '  one-sample +0.1 V mutation: rejected',
  ] };
}

if (process.argv[1]?.endsWith('cli-waveform-oracle.mjs')) {
  const result = runCliWaveformOracle();
  console.log(`${result.ok ? 'PASS' : 'FAIL'} CLI transient waveform`);
  for (const line of result.lines) console.log(line);
  if (!result.ok) process.exitCode = 1;
}
