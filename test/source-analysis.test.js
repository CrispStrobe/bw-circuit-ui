import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import './_setup.js';
import { importCircuit } from '../src/importers/index.js';
import { runSourceAnalyses, sourceAnalysisDescriptors } from '../src/model/source-analysis.js';

const imported = text => importCircuit('spice', text);

describe('source-declared analysis adapter', () => {
  it('runs OP independently while retaining two distinct AC requests', () => {
    const result = imported(`analysis ids
V1 in 0 DC 6 AC 1
R1 in out 1k
R2 out 0 2k
.ac dec 2 10 1k
.op
.ac dec 1 10 100
.end
`);
    const runs = runSourceAnalyses(result, { format: 'spice', maxPoints: 20 });
    assert.deepEqual(runs.map(run => run.analysisId), ['0:ac', '1:op', '2:ac']);
    assert.deepEqual(runs.map(run => run.status), ['pass', 'pass', 'pass']);
    const op = runs[1];
    assert.deepEqual(op.observables.nodes.map(node => node.id), ['n0', 'n1']);
    assert.ok(Math.abs(op.observables.nodes[1].voltage - 4) < 1e-8);
    assert.deepEqual(op.observables.sourceCurrents.map(row => row.id), ['s0']);
    assert.ok(Math.abs(op.observables.sourceCurrents[0].current + 0.002) < 1e-8);
    assert.deepEqual(op.topology, [
      { kind: 'V', nodes: ['n0', 'gnd'], sourceId: 's0' },
      { kind: 'R', nodes: ['n0', 'n1'] },
      { kind: 'R', nodes: ['n1', 'gnd'] },
    ]);
    assert.equal(runs[0].conditions.points, 5);
    assert.equal(runs[2].conditions.points, 2);
  });

  it('does not deduplicate repeated analysis kinds', () => {
    const descriptors = sourceAnalysisDescriptors(['.ac dec 2 1 10', '.AC DEC 2 10 100']);
    assert.deepEqual(descriptors.map(value => value.id), ['0:ac', '1:ac']);
  });

  it('canonicalizes reference and node names while preserving G card polarity', () => {
    const first = runSourceAnalyses(imported(`controlled
VINPUT control 0 1
GLOAD output 0 control 0 2m
RLOAD output 0 1k
.op
.end
`), { format: 'spice' })[0];
    const renamed = runSourceAnalyses(imported(`renamed
VA x 0 1
GX y 0 x 0 2m
RY y 0 1k
.op
.end
`), { format: 'spice' })[0];
    assert.equal(first.status, 'pass');
    assert.deepEqual(first.topology, renamed.topology);
    assert.deepEqual(first.topology, [
      { kind: 'V', nodes: ['n0', 'gnd'], sourceId: 's0' },
      { kind: 'G', nodes: ['n1', 'gnd', 'n0', 'gnd'], sourceId: 's1' },
      { kind: 'R', nodes: ['n1', 'gnd'] },
    ]);
    assert.deepEqual(first.observables.unavailableSourceCurrents, ['s1']);
    assert.ok(Math.abs(first.observables.nodes.find(node => node.id === 'n1').voltage + 2) < 1e-8);
  });

  it('separates integration gaps, source errors, importer loss, and solver refusal', () => {
    const startup = runSourceAnalyses(imported(`startup is distinct
V1 1 0 1
R1 1 0 1k
.tran 10u startup
.end
`), { format: 'spice' })[0];
    assert.deepEqual([startup.status, startup.classification, startup.code],
      ['not-run', 'integration-gap', 'tran-startup-not-implemented']);

    const invalid = runSourceAnalyses(imported(`bad ac
V1 1 0 DC 1 AC 1
R1 1 0 1k
.ac dec nope 1 1k
.end
`), { format: 'spice' })[0];
    assert.deepEqual([invalid.status, invalid.classification, invalid.code],
      ['refused', 'source-condition', 'invalid-ac-card']);

    const lossy = runSourceAnalyses(imported(`loss
X1 1 0 unknown
.op
.end
`), { format: 'spice' })[0];
    assert.deepEqual([lossy.status, lossy.classification, lossy.code],
      ['refused', 'import-fidelity', 'semantic-import-blocker']);

    const solver = runSourceAnalyses(imported(`floating
I1 1 0 1m
R1 1 2 1k
.op
.end
`), { format: 'spice' })[0];
    assert.deepEqual([solver.status, solver.classification, solver.code],
      ['refused', 'solver-refusal', 'native-analysis-refused']);

    const badMapping = imported(`mapping gap
V1 1 0 1
R1 1 0 1k
.op
.end
`);
    badMapping.netNames[0].terminals[0].terminal = 'not-a-terminal';
    const mapping = runSourceAnalyses(badMapping, { format: 'spice' })[0];
    assert.deepEqual([mapping.status, mapping.classification, mapping.code],
      ['not-run', 'integration-gap', 'canonical-topology-unavailable']);
  });

  it('refuses an authored AC current excitation instead of silently dropping it', () => {
    const run = runSourceAnalyses(imported(`two excitations
V1 in 0 DC 0 AC 1
I1 out 0 DC 0 AC 2m
R1 in out 1k
R2 out 0 1k
.ac dec 1 10 100
.end
`), { format: 'spice' })[0];
    assert.deepEqual([run.status, run.classification, run.code],
      ['not-run', 'integration-gap', 'ac-source-set-not-implemented']);
    assert.match(run.detail, /vsource, isource/);
  });

  it('runs only an exact integer-nanosecond UIC transient grid', () => {
    const exact = runSourceAnalyses(imported(`transient
V1 in 0 PULSE(0 2 1u 1u 1u 2u 6u)
R1 in out 1k
R2 out 0 1k
.tran 1u 8u UIC
.end
`), { format: 'spice', maxPoints: 20 })[0];
    assert.equal(exact.status, 'pass');
    assert.deepEqual(exact.observables.axis.values, [0, 1e-6, 2e-6, 3e-6, 4e-6, 5e-6, 6e-6, 7e-6, 8e-6]);
    assert.ok(Math.abs(exact.observables.nodes.find(node => node.id === 'n1').voltage[3] - 1) < 1e-8);

    const subNs = runSourceAnalyses(imported(`sub ns
V1 1 0 1
R1 1 0 1k
.tran .1n 1n UIC
.end
`), { format: 'spice' })[0];
    assert.deepEqual([subNs.status, subNs.code], ['not-run', 'tran-grid-not-representable']);
  });

  it('starts each UIC RC transient from a fresh uncharged capacitor state', () => {
    const source = `fresh uic
V1 in 0 5
R1 in out 1k
C1 out 0 1u
.tran 1u 3u UIC
.end
`;
    const first = runSourceAnalyses(imported(source), { format: 'spice' })[0];
    const second = runSourceAnalyses(imported(source), { format: 'spice' })[0];
    assert.equal(first.status, 'pass');
    assert.deepEqual(first.convergence,
      { verified: true, converged: true, api: 'deviceCompanions' });
    const output = first.observables.nodes.find(node => node.id === 'n1').voltage;
    assert.ok(Math.abs(output[0]) < 1e-6, `expected an uncharged t=0 state, got ${output[0]} V`);
    assert.ok(output[1] > output[0]);
    assert.deepEqual(second.observables, first.observables);
  });

  it('runs ordinary non-UIC RCL transients from source-declared DC bias', () => {
    for (const volts of [-4, 4]) {
      const run = runSourceAnalyses(imported(`non-uic rcl
V1 in 0 ${volts}
R1 in mid 1k
C1 mid 0 1u
R2 mid coil 2k
L1 coil 0 3m
.tran 100u
.end
`), { format: 'spice', maxPoints: 11 })[0];
      assert.equal(run.status, 'pass');
      assert.equal(run.classification, 'native-original-adapted-observation-grid');
      assert.deepEqual(run.observables.axis.values,
        [0, 10e-6, 20e-6, 30e-6, 40e-6, 50e-6, 60e-6, 70e-6, 80e-6, 90e-6, 100e-6]);
      assert.equal(run.conditions.initialization, 'source-declared-dc-operating-point');
      assert.deepEqual(run.conditions.samplingProfile,
        { id: 'bounded-uniform-observation-v1', sourceDeclared: false, adapted: true, targetIntervals: 100 });
      assert.equal(run.initialization.initialization, 'source-declared-dc-operating-point');
      const mid = run.observables.nodes.find(node => node.id === 'n1').voltage;
      assert.equal(Math.sign(mid[0]), Math.sign(volts));
      assert.ok(mid.every(value => Math.abs(value - mid[0]) < 1e-8));
    }
  });

  it('refuses startup and explicit initial-state semantics instead of silently changing initialization', () => {
    const decks = [
      `element IC\nV1 in 0 1\nR1 in out 1k\nC1 out 0 1u IC=0.5\n.tran 10u\n.end\n`,
      `dot IC\nV1 in 0 1\nR1 in out 1k\nC1 out 0 1u\n.ic v(out)=0.5\n.tran 10u\n.end\n`,
      `nodeset\nV1 in 0 1\nR1 in out 1k\nC1 out 0 1u\n.nodeset v(out)=0.5\n.tran 10u\n.end\n`,
    ];
    for (const deck of decks) {
      const result = imported(deck);
      assert.ok(result.losses.some(loss => /initial|instance/i.test(`${loss.kind} ${loss.reason}`)));
      const run = runSourceAnalyses(result, { format: 'spice' })[0];
      assert.deepEqual([run.status, run.classification, run.code],
        ['refused', 'import-fidelity', 'semantic-import-blocker']);
    }
  });
});
