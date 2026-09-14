import './_setup.js';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { importCircuit } from '../src/importers/index.js';
import { Circuit } from '../src/model/circuit.js';
import { extractNetlist } from '../src/model/netlist.js';
import { toSpice } from '../src/model/exporters/spice.js';
import { runSourceAnalyses } from '../src/model/source-analysis.js';
import { runPrecisionSourceAnalysis } from '../src/model/source-analysis-view.js';

const root = join(import.meta.dirname, '..');
const fixture = join(root, 'test', 'fixtures', 'spice-precision-analysis.cir');
const source = readFileSync(fixture, 'utf8');

function imported() { return importCircuit('spice', source); }

function persistedCircuit() {
  const input = imported();
  return Circuit.fromJSON({
    parts: input.parts, wires: input.wires,
    sourceAnalysis: { version: 1, format: 'spice', sourceName: 'spice-precision-analysis.cir',
      analyses: input.analyses, netNames: input.netNames },
  });
}

describe('precision-v1 source-analysis product entrypoints', () => {
  it('runs the GUI action on a fresh precision circuit without changing the live profile', () => {
    const circuit = persistedCircuit();
    assert.equal(circuit.transientAnalysisStatus().profile.id, 'interactive-v1');
    const before = circuit.board.snapshot();
    const [result] = runPrecisionSourceAnalysis(circuit);
    assert.equal(result.status, 'pass');
    assert.equal(result.executionProfile.configured.id, 'precision-v1');
    assert.equal(result.executionProfile.qualification.accuracyMet, true);
    assert.equal(result.executionProfile.qualification.globalOutputAccuracy, false);
    assert.equal(result.executionProfile.qualification.oracleComparison, 'not-performed');
    assert.ok(result.executionProfile.work.attempts > 0);
    assert.ok(result.executionProfile.work.solves > 0);
    assert.equal(result.evidence, 'original-adapted');
    assert.ok(result.adapted.some(item => /source corners/.test(item)));
    assert.match(result.thermal, /native-fixed.*no oracle/i);
    assert.equal(circuit.transientAnalysisStatus().profile.id, 'interactive-v1');
    assert.deepEqual(circuit.board.snapshot(), before, 'independent source analysis must not mutate live GUI state');
  });

  it('persists directives and source-node identities through Circuit JSON', () => {
    const circuit = persistedCircuit();
    const copy = Circuit.fromJSON(circuit.toJSON());
    assert.deepEqual(copy.sourceAnalysis, circuit.sourceAnalysis);
    assert.notEqual(copy.sourceAnalysis, circuit.sourceAnalysis);
    assert.equal(runPrecisionSourceAnalysis(copy)[0].status, 'pass');
  });

  it('retains PWL, EXP, delayed SINE, current waves, DC bias, and AC descriptors', () => {
    const input = importCircuit('spice', `wave descriptors
V1 a 0 DC 7 PWL(0 1 1u 3 2u -1) AC 2 30
I1 0 a EXP(1m 4m 1u 2u 5u 3u)
V2 b 0 SINE(2 3 1meg 1u 200 30)
R1 a 0 1k
R2 b 0 1k
.tran 100n 2u UIC
.end
`);
    assert.deepEqual(input.losses, []);
    assert.deepEqual(input.parts.find(part => part.id === 'V1').params, {
      volts: 1, wave: 'spice-pwl', points: [[0, 1], [1e-6, 3], [2e-6, -1]],
      dcValue: 7, dcBiasOrigin: 'explicit-dc', acMagnitude: 2, acPhase: 30,
    });
    assert.deepEqual(input.parts.find(part => part.id === 'I1').params, {
      amps: 1e-3, volts: 1e-3, wave: 'spice-exp', v1: 1e-3, v2: 4e-3,
      td1: 1e-6, tau1: 2e-6, td2: 5e-6, tau2: 3e-6,
      dcValue: 1e-3, dcBiasOrigin: 'waveform-initial-default',
    });
    assert.equal(input.parts.find(part => part.id === 'V2').params.wave, 'spice-sine');
    const exported = toSpice(extractNetlist(Circuit.fromJSON({
      parts: input.parts, wires: input.wires,
    })));
    assert.deepEqual(exported.skipped, []);
    assert.match(exported.text, /^V1\s+\S+\s+0\s+DC 7 PWL\(0 1 1u 3 2u -1\) AC 2 30$/m);
    assert.match(exported.text, /^I1\s+0\s+\S+\s+EXP\(1m 4m 1u 2u 5u 3u\)$/m);
    const back = importCircuit('spice', exported.text);
    for (const id of ['V1', 'I1', 'V2']) {
      assert.deepEqual(back.parts.find(part => part.id === id).params,
        input.parts.find(part => part.id === id).params);
    }
  });

  it('preflights and accounts deterministic total work instead of timing out', () => {
    const input = importCircuit('spice', `bounded precision\nV1 in 0 SINE(0 1 1)\nR1 in 0 1k\n.tran 2\n.end\n`);
    const [preflight] = runSourceAnalyses(input, { format: 'spice', transientProfile: 'precision-v1' });
    assert.deepEqual([preflight.status, preflight.classification, preflight.code],
      ['not-run', 'integration-gap', 'analysis-work-budget-exceeded']);
    assert.equal(preflight.conditions.executionProfile.work.attempts, 0);

    const [accounted] = runSourceAnalyses(imported(), { format: 'spice',
      transientProfile: 'precision-v1', maxTotalAttempts: 10 });
    assert.deepEqual([accounted.status, accounted.classification, accounted.code],
      ['not-run', 'integration-gap', 'analysis-work-budget-exceeded']);
    assert.ok(accounted.conditions.executionProfile.work.attempts > 10);
  });

  it('refuses unsupported profiles and never labels an unqualified solve as pass', () => {
    const [invalid] = runSourceAnalyses(imported(), { format: 'spice', transientProfile: 'precision-v2' });
    assert.deepEqual([invalid.status, invalid.code], ['not-run', 'transient-profile-not-allowed']);

    const conflict = importCircuit('spice', `conflict\nV1 n 0 SINE(0 1 1meg)\nV2 n 0 2\n.tran 100n 1u UIC\n.end\n`);
    const [result] = runSourceAnalyses(conflict, { format: 'spice', transientProfile: 'precision-v1' });
    assert.equal(result.status, 'refused');
    assert.equal(result.code, 'transient-accuracy-unmet');
    assert.equal(result.conditions.executionProfile.qualification.accuracyMet, false);
  });

  it('ships profile provenance in the rendered GUI and the real CLI command', () => {
    const panel = readFileSync(join(root, 'src', 'components', 'SourceAnalysisPanel.jsx'), 'utf8');
    assert.match(panel, /Live simulation/);
    assert.match(panel, /Run source analyses at/);
    assert.match(panel, /runPrecisionSourceAnalysis\(circuit\)/);
    const designer = readFileSync(join(root, 'src', 'components', 'CircuitDesigner.jsx'), 'utf8');
    assert.match(designer, /<SourceAnalysisPanel circuit=\{circuit\}/);

    const noOptIn = spawnSync(process.execPath, ['bin/bwc.mjs', 'analyze', fixture],
      { cwd: root, encoding: 'utf8' });
    assert.equal(noOptIn.status, 2);
    assert.match(noOptIn.stderr, /select --profile precision-v1/);
    const cli = spawnSync(process.execPath,
      ['bin/bwc.mjs', 'analyze', fixture, '--profile', 'precision-v1', '--json'],
      { cwd: root, encoding: 'utf8', timeout: 20_000 });
    assert.equal(cli.status, 0, cli.stderr || cli.stdout);
    const report = JSON.parse(cli.stdout);
    assert.equal(report.liveGUIProfile, 'interactive-v1');
    assert.equal(report.requestedTransientProfile, 'precision-v1');
    assert.equal(report.results[0].status, 'pass');
    assert.equal(report.results[0].executionProfile.configured.id, 'precision-v1');
    assert.equal(report.results[0].executionProfile.qualification.oracleComparison, 'not-performed');
  });
});
