import './_setup.js';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { importCircuit } from '../src/importers/index.js';
import { Circuit } from '../src/model/circuit.js';
import { extractNetlist } from '../src/model/netlist.js';
import { toSpice } from '../src/model/exporters/spice.js';
import { runSourceAnalyses } from '../src/model/source-analysis.js';
import { runPrecisionSourceAnalysis } from '../src/model/source-analysis-view.js';
import { resolveEndpointNet, timedScopeSeries } from '../src/model/instrument-report.js';
import { scopeProbeOptions } from '../src/model/scope-probes.js';

const root = join(import.meta.dirname, '..');
const fixture = join(root, 'test', 'fixtures', 'spice-precision-analysis.cir');
const boundedFixture = join(root, 'test', 'fixtures', 'spice-bounded-observation.cir');
const dcFixture = join(root, 'test', 'fixtures', 'spice-dc-analysis.cir');
const outputOnlyFixture = join(root, 'test', 'fixtures', 'spice-output-only.cir');
const source = readFileSync(fixture, 'utf8');

function imported() { return importCircuit('spice', source); }

// Independently authored zero-biased divider, not a private corpus payload.
const probeDeck = '* Authored dynamic probe divider\nV1 signal 0 PULSE(0 1 10u 20u 20u 50u 200u)\n'
  + 'R1 signal sense 100k\nR2 sense 0 1meg\n.tran 500n 200u\n.end\n';
function probeResponse(time, ohms, farads) {
  const parallel = 1 / (1 / 1e6 + 1 / ohms);
  const gain = parallel / (100000 + parallel), tau = 100000 * gain * farads;
  return gain * [[10e-6,50000],[30e-6,-50000],[80e-6,-50000],[100e-6,50000]]
    .reduce((sum,[start,slope]) => {
      const dt = Math.max(0,time-start);
      return sum + slope * (dt + tau * Math.expm1(-dt/tau));
    },0);
}

describe('pinned Circuit fractional-time scope adoption', () => {
  for (const [probe,ohms,farads] of [['10x',1e7,15e-12],['1x',1e6,100e-12]]) {
    it(`${probe} imported precision probe agrees at all 400 analytical and live ngspice points`, {
      skip: spawnSync('ngspice',['--version'],{encoding:'utf8'}).status !== 0
        ? 'ngspice unavailable: no independent probe comparison ran' : false,
    }, () => {
      const input = importCircuit('spice',probeDeck);
      assert.deepEqual(input.unmapped || [],[]);
      assert.deepEqual(input.losses || [],[]);
      assert.deepEqual(input.analysisBlockers || [],[]);
      assert.ok(input.parts.some(part => part.id==='V1'),'source retained after SPICE title');
      const circuit = Circuit.fromJSON({parts:input.parts,wires:input.wires});
      assert.equal(circuit.netlistError,null);
      circuit.configureTransientAnalysis('precision-v1');
      circuit.setPower(true);
      const tip = resolveEndpointNet(circuit.resolvedNets,'R2.a');
      const reference = resolveEndpointNet(circuit.resolvedNets,'V1.neg');
      const handle = circuit.board.addScopeChannel({type:'voltage',netId:tip,
        sampleRateHz:2e6,depth:402,capture:'sample',...scopeProbeOptions(probe,reference)});
      circuit.advanceTo(200000n);
      const series = timedScopeSeries(circuit.board.getScopeData(handle));
      assert.equal(series.length,400,'no missing or overwritten acquisition points');
      const status = circuit.transientAnalysisStatus();
      assert.equal(status.profile.id,'precision-v1');
      assert.equal(status.accuracyMet,true);
      assert.ok(status.work.attempts>0 && status.work.attempts<status.profile.maxAttempts);
      const dir = mkdtempSync(join(tmpdir(),'cui-probe-oracle-'));
      try {
        writeFileSync(join(dir,'reference.cir'),'* Explicit independent probe reference\n'
          + probeDeck.replace('.tran 500n 200u\n.end\n',
            `RP sense 0 ${ohms}\nCP sense 0 ${farads}\n`
            + '.options reltol=1e-10 abstol=1e-14 vntol=1e-10 trtol=1\n'
            + '.control\nset wr_vecnames\nset wr_singlescale\ntran 500n 200u 0 1n\n'
            + 'linearize v(sense)\nwrdata reference.csv time v(sense)\n.endc\n.end\n'));
        const oracle = spawnSync('ngspice',['-b','reference.cir'],
          {cwd:dir,encoding:'utf8',timeout:60000});
        assert.equal(oracle.status,0,oracle.stderr || oracle.stdout);
        const rows = readFileSync(join(dir,'reference.csv'),'utf8').trim().split('\n').slice(1)
          .map(line => line.trim().split(/\s+/).map(Number));
        assert.ok(rows.every(row => row.length>=2 && row.every(Number.isFinite)));
        const referenceRows = rows.filter(row => row[0]>0);
        assert.equal(referenceRows.length,400);
        series.forEach((point,index) => {
          const [time] = referenceRows[index], volts = referenceRows[index].at(-1);
          assert.ok(Math.abs(point.timeSeconds-time)<=1e-12,`sample ${index} time alignment`);
          const expected = probeResponse(point.timeSeconds,ohms,farads);
          assert.ok(Math.abs(volts-expected)<=1e-6,`oracle analytical control ${index}`);
          const tolerance = 1e-6+1e-6*Math.max(Math.abs(point.volts),Math.abs(volts));
          assert.ok(Math.abs(point.volts-volts)<=tolerance,
            `${probe} sample ${index}: ${point.volts} vs ngspice ${volts}`);
          assert.ok(Math.abs(point.volts-expected)<=1e-6+1e-6*Math.abs(expected),
            `${probe} analytical sample ${index}`);
        });
      } finally { rmSync(dir,{recursive:true,force:true}); }
    });
  }
});

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
    assert.equal(result.evidence, 'original-direct');
    assert.deepEqual(result.adapted, []);
    assert.equal(result.conditions.sourceBreakpoints.integration,
      'native-engine-source-edge-barriers');
    assert.equal(result.conditions.sourceBreakpoints.addedToObservationGrid, false);
    assert.match(result.thermal, /native-fixed.*no oracle/i);
    assert.equal(circuit.transientAnalysisStatus().profile.id, 'interactive-v1');
    assert.deepEqual(circuit.board.snapshot(), before, 'independent source analysis must not mutate live GUI state');
  });

  it('selects and qualifies interactive-v1 separately on the same source grid', () => {
    const input = imported();
    const [defaulted] = runSourceAnalyses(input, { format: 'spice' });
    const [interactive] = runSourceAnalyses(input, { format: 'spice',
      transientProfile: 'interactive-v1' });
    const [precision] = runSourceAnalyses(input, { format: 'spice',
      transientProfile: 'precision-v1' });
    assert.equal(interactive.status, 'pass');
    assert.equal(interactive.executionProfile.configured.id, 'interactive-v1');
    assert.equal(defaulted.executionProfile.configured.id, 'interactive-v1');
    assert.deepEqual(defaulted.executionProfile.work, interactive.executionProfile.work);
    assert.equal(interactive.executionProfile.qualification.accuracyMet, true);
    assert.deepEqual(interactive.observables.axis, precision.observables.axis,
      'profile comparisons must use the same authored/adapted observation grid');
    assert.equal(precision.executionProfile.configured.id, 'precision-v1');
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

  it('names non-UIC waveform initialization by its declared time-zero bias semantics', () => {
    const input = importCircuit('spice', `waveform bias
V1 in 0 DC 2 PWL(0 0 1u 5)
R1 in out 1k
C1 out 0 1n
.tran 250n 2u
.end
`);
    const [result] = runSourceAnalyses(input, { format: 'spice', transientProfile: 'precision-v1' });
    assert.equal(result.status, 'pass');
    assert.equal(result.conditions.initialization,
      'source-declared-waveform-time-zero-operating-point');
    assert.equal(result.executionProfile.qualification.accuracyMet, true);
  });

  it('preflights and accounts deterministic total work instead of timing out', () => {
    const input = importCircuit('spice', `bounded precision\nV1 in 0 SINE(0 1 1)\nR1 in 0 1k\n.tran 2\n.end\n`);
    const [direct] = runSourceAnalyses(input, { format: 'spice', transientProfile: 'precision-v1' });
    assert.equal(direct.status, 'pass');
    assert.equal(direct.conditions.preflight.integrationMode, 'algebraic-direct');
    assert.equal(direct.conditions.preflight.basis, 'algebraic-direct-nonzero-observation-count');
    assert.ok(direct.executionProfile.work.solves <= direct.conditions.points);

    const reactive = importCircuit('spice', `bounded reactive precision\nV1 in 0 SINE(0 1 1)\nR1 in out 1k\nC1 out 0 1u\n.tran 2\n.end\n`);
    const [reactiveRun] = runSourceAnalyses(reactive, {
      format: 'spice', transientProfile: 'precision-v1',
    });
    assert.equal(reactiveRun.status, 'pass');
    assert.equal(reactiveRun.conditions.preflight.integrationMode, 'adaptive');
    assert.equal(reactiveRun.conditions.preflight.minimumAttempts, 128);
    assert.equal(reactiveRun.conditions.preflight.minimumSolves, 382);
    assert.equal(reactiveRun.conditions.preflight.basis,
      'active-step-bound-be-seed-plus-three-solves-per-later-accepted-step');
    assert.equal(reactiveRun.executionProfile.qualification.accuracyMet, true);
    assert.ok(reactiveRun.executionProfile.work.attempts > 0);
    assert.ok(reactiveRun.executionProfile.work.attempts < 20_000);

    const fastReactive = importCircuit('spice', `bounded fast reactive precision\nV1 in 0 SINE(0 1 16k)\nR1 in out 1k\nC1 out 0 1u\n.tran 2\n.end\n`);
    const [preflight] = runSourceAnalyses(fastReactive, {
      format: 'spice', transientProfile: 'precision-v1',
    });
    assert.deepEqual([preflight.status, preflight.classification, preflight.code],
      ['not-run', 'integration-gap', 'analysis-work-budget-exceeded']);
    assert.equal(preflight.conditions.preflight.integrationMode, 'adaptive');
    assert.equal(preflight.conditions.preflight.minimumAttempts, 200000);
    assert.equal(preflight.conditions.preflight.minimumSolves, 599998);
    assert.equal(preflight.conditions.executionProfile.work.attempts, 0);

    const [accounted] = runSourceAnalyses(imported(), { format: 'spice',
      transientProfile: 'precision-v1', maxTotalAttempts: 10 });
    assert.deepEqual([accounted.status, accounted.classification, accounted.code],
      ['not-run', 'integration-gap', 'analysis-work-budget-exceeded']);
    assert.ok(accounted.conditions.executionProfile.work.attempts > 10);
  });

  it('runs ADI row 5114 through the public adapter and matches ngspice', {
    skip: spawnSync('ngspice', ['--version'], { encoding: 'utf8' }).status !== 0,
  }, () => {
    const samples = [0.1, 2.5, 4.9, 5.1, 7.5, 9.9];
    const measures = samples.map((time, index) =>
      `.meas tran out${index} FIND v(out) AT=${time}`).join('\n');
    const deck = `ADI row 5114 zero-width PULSE
V1 N001 0 5
I1 N001 out PULSE(20u 200u 0 4 1 0 5)
R1 out 0 24k
R4 out 0 1Meg
C2 out 0 14p
.tran 0.01 10 0 0.01
.end
`;
    const [result] = runSourceAnalyses(importCircuit('spice', deck), {
      format: 'spice', transientProfile: 'precision-v1',
    });
    assert.equal(result.status, 'pass');
    assert.equal(result.executionProfile.qualification.accuracyMet, true);
    assert.equal(result.conditions.points, 1001);
    assert.ok(result.executionProfile.work.attempts < 5000);

    const ng = spawnSync('ngspice', ['-b'], {
      input: deck.replace('.end', `${measures}\n.end`), encoding: 'utf8',
    });
    assert.equal(ng.status, 0, ng.stderr || ng.stdout);
    const measured = new Map();
    for (const match of ng.stdout.matchAll(/^\s*out(\d+)\s*=\s*([-+0-9.e]+)/gmi)) {
      measured.set(Number(match[1]), Number(match[2]));
    }
    assert.equal(measured.size, samples.length);
    const output = result.observables.nodes.find(node => node.id === 'n1');
    samples.forEach((time, index) => {
      const sampleIndex = result.observables.axis.values.findIndex(value =>
        Math.abs(value - time) < 1e-10);
      assert.notEqual(sampleIndex, -1, `public result includes ${time}s`);
      assert.ok(Math.abs(output.voltage[sampleIndex] - measured.get(index)) < 2e-4,
        `${time}s: public adapter ${output.voltage[sampleIndex]} vs ngspice ${measured.get(index)}`);
    });
  });

  it('runs ADI row 5158 through its exact constraint and matches ngspice', {
    skip: spawnSync('ngspice', ['--version'], { encoding: 'utf8' }).status !== 0,
  }, () => {
    const samples = [0.24, 0.51, 0.99, 1.5, 2.25, 3];
    const measures = samples.map((time, index) =>
      `.meas tran out${index} FIND v(1) AT=${time}`).join('\n');
    const deck = `ADI row 5158 source-constrained ideal inductor
L1 1 0 1
I1 0 1 SINE(0 1 1 0)
.tran 3
.OPTIONS plotwinsize=0
.end
`;
    const [result] = runSourceAnalyses(importCircuit('spice', deck), {
      format: 'spice', transientProfile: 'precision-v1',
    });
    assert.equal(result.status, 'pass');
    assert.equal(result.executionProfile.integrationMode,
      'source-constrained-inductor-direct');
    assert.deepEqual(result.executionProfile.work,
      { attempts: 100, solves: 0, advances: 100 });
    assert.equal(result.executionProfile.qualification.basis,
      'ideal-current-source-constrains-inductor-current-and-voltage-derivative');
    assert.deepEqual(result.conditions.preflight, {
      minimumAttempts: 100,
      minimumSolves: 0,
      basis: 'source-constrained-inductor-analytic-endpoint-count',
      acceptedStepLowerBound: 0,
      integrationMode: 'source-constrained-inductor-direct',
    });

    // ngspice does not accept LTspice's one-argument `.tran TSTOP`, so spell
    // the same three-second interval with a deliberately fine independent
    // integration ceiling before asking for the six authored observations.
    const oracleDeck = deck.replace('.tran 3', '.tran .001 3 0 .0001')
      .replace('.end', `${measures}\n.end`);
    const ng = spawnSync('ngspice', ['-b'], { input: oracleDeck, encoding: 'utf8' });
    assert.equal(ng.status, 0, ng.stderr || ng.stdout);
    const measured = new Map();
    for (const match of ng.stdout.matchAll(/^\s*out(\d+)\s*=\s*([-+0-9.e]+)/gmi)) {
      measured.set(Number(match[1]), Number(match[2]));
    }
    assert.equal(measured.size, samples.length);
    const output = result.observables.nodes[0].voltage;
    samples.forEach((time, index) => {
      const sampleIndex = result.observables.axis.values.findIndex(value =>
        Math.abs(value - time) < 1e-10);
      assert.notEqual(sampleIndex, -1);
      assert.ok(Math.abs(output[sampleIndex] - measured.get(index)) < 1e-6,
        `${time}s: public adapter ${output[sampleIndex]} vs ngspice ${measured.get(index)}`);
    });
  });

  it('emits the certified-quiescent Si7li row 3835 series with zero work and ngspice agreement', {
    skip: spawnSync('ngspice', ['--version'], { encoding: 'utf8' }).status !== 0,
  }, () => {
    const deck = `Si7li train row 3835
C1 N001 0 5e-5
L1 N002 0 100
R1 V2 N001 1k
R2 V2 N002 1k
.tran 5
.end
`;
    const [result] = runSourceAnalyses(importCircuit('spice', deck), {
      format: 'spice', transientProfile: 'precision-v1',
    });
    assert.equal(result.status, 'pass');
    assert.equal(result.conditions.points, 101);
    assert.equal(result.conditions.samplingProfile.sourceDeclared, false);
    assert.equal(result.conditions.samplingProfile.reason, 'source declares no TSTEP');
    assert.equal(result.evidence, 'original-adapted');
    assert.equal(result.conditions.preflight.basis, 'board-certified-invariant-zero-state');
    assert.deepEqual(result.executionProfile.work, { attempts: 0, solves: 0, advances: 0 });
    assert.equal(result.executionProfile.qualification.accuracyMet, null,
      'an invariant-state certificate is not relabelled as adaptive-step accuracy');
    assert.equal(result.executionProfile.qualification.certifiedQuiescent, true);
    assert.equal(result.initialization.initialization, 'source-declared-quiescent-zero-state');
    assert.ok(result.observables.nodes.every(node =>
      node.voltage.length === 101 && node.voltage.every(value => value === 0)));

    // ngspice does not implement LTspice's one-argument `.tran TSTOP`
    // extension, so make the same already-disclosed 100-interval observation
    // adaptation explicit on the independent side.
    const oracleDeck = deck.replace('.tran 5', '.tran 0.05 5');
    const oracle = spawnSync('ngspice', ['-n', '-b'], {
      input: oracleDeck.replace('.end', '.print tran v(N001) v(N002) v(V2)\n.end'),
      encoding: 'utf8', env: { PATH: process.env.PATH, HOME: process.env.HOME },
    });
    assert.equal(oracle.status, 0, oracle.stderr || oracle.stdout);
    const rows = oracle.stdout.split(/\r?\n/).map(line => line.trim().split(/\s+/))
      .filter(fields => fields.length === 5 && /^\d+$/.test(fields[0]));
    assert.ok(rows.length >= 101, 'ngspice emitted the complete five-second transient');
    assert.ok(rows.every(fields => fields.slice(2).every(value => Number(value) === 0)),
      'the independent oracle also reports an invariant zero series');

    const [uic] = runSourceAnalyses(importCircuit('spice', deck.replace('.tran 5',
      '.tran 5 UIC')), { format: 'spice', transientProfile: 'precision-v1' });
    assert.deepEqual([uic.status, uic.code], ['refused', 'transient-accuracy-unmet'],
      'UIC executes normally and does not receive a non-UIC operating-point certificate');
    assert.equal(uic.conditions.executionProfile.qualification.certifiedQuiescent, false);

    const withDiode = deck.replace('R2 V2 N002 1k',
      'R2 V2 N002 1k\nD1 N001 0 D\n.model D D(IS=1e-12 N=1 RS=0)\n.temp 26.826793442075882\n.options tnom=26.826793442075882');
    const [unsupported] = runSourceAnalyses(importCircuit('spice', withDiode), {
      format: 'spice', transientProfile: 'precision-v1',
    });
    assert.equal(unsupported.status, 'pass');
    assert.equal(unsupported.executionProfile.qualification.certifiedQuiescent, false,
      'an exact-zero result outside the Board certificate topology cannot use the shortcut');
    assert.notEqual(unsupported.conditions.preflight.basis, 'board-certified-invariant-zero-state');
    assert.ok(unsupported.executionProfile.work.attempts > 0,
      'the unsupported topology follows ordinary bounded integration');
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
    assert.match(panel, /bw-source-analysis-observation-profile/);
    assert.match(panel, /bounded-research-v1/);
    assert.match(panel, /runPrecisionSourceAnalysis\(circuit, \{ observationProfile \}\)/);
    assert.match(panel, /No supported source analysis was requested/);
    const designer = readFileSync(join(root, 'src', 'components', 'CircuitDesigner.jsx'), 'utf8');
    assert.match(designer, /<SourceAnalysisPanel circuit=\{circuit\} liveBoard=\{activeBoard\}/);

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

    const exactDense = spawnSync(process.execPath,
      ['bin/bwc.mjs', 'analyze', boundedFixture, '--profile', 'precision-v1', '--json'],
      { cwd: root, encoding: 'utf8', timeout: 20_000 });
    assert.equal(exactDense.status, 1, exactDense.stderr || exactDense.stdout);
    const exactReport = JSON.parse(exactDense.stdout);
    assert.equal(exactReport.results[0].code, 'analysis-budget-exceeded');
    assert.equal(exactReport.results[0].requestedObservationProfile, 'source-declared-v1');

    const adaptedDense = spawnSync(process.execPath,
      ['bin/bwc.mjs', 'analyze', boundedFixture, '--profile', 'precision-v1',
        '--observations', 'bounded-research-v1', '--json'],
      { cwd: root, encoding: 'utf8', timeout: 20_000 });
    assert.equal(adaptedDense.status, 0, adaptedDense.stderr || adaptedDense.stdout);
    const adaptedReport = JSON.parse(adaptedDense.stdout);
    assert.equal(adaptedReport.requestedObservationProfile, 'bounded-research-v1');
    assert.equal(adaptedReport.results[0].status, 'pass');
    assert.equal(adaptedReport.results[0].evidence, 'original-adapted');
    assert.match(adaptedReport.results[0].adapted[0], /replaced the requested 3001-point/);

    const dcCli = spawnSync(process.execPath,
      ['bin/bwc.mjs', 'analyze', dcFixture, '--profile', 'precision-v1', '--json'],
      { cwd: root, encoding: 'utf8', timeout: 20_000 });
    assert.equal(dcCli.status, 0, dcCli.stderr || dcCli.stdout);
    const dcReport = JSON.parse(dcCli.stdout);
    assert.equal(dcReport.results[0].kind, 'dc');
    assert.equal(dcReport.results[0].status, 'pass');
    assert.deepEqual(dcReport.results[0].observables.axis.coordinates, [[0], [0.5], [1]]);

    const outputOnly = spawnSync(process.execPath,
      ['bin/bwc.mjs', 'analyze', outputOnlyFixture, '--profile', 'precision-v1', '--json'],
      { cwd: root, encoding: 'utf8', timeout: 20_000 });
    assert.equal(outputOnly.status, 2, outputOnly.stderr || outputOnly.stdout);
    assert.match(outputOnly.stderr, /found 2 preserved output request.*not analyses/i);
  });
});
