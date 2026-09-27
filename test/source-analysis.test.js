import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { spawnSync } from 'node:child_process';
import './_setup.js';
import { BoardImpl } from 'bw-board/board.js';
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

    const noExcitation = runSourceAnalyses(imported(`missing AC source
V1 1 0 DC 1
R1 1 0 1k
.ac dec 1 10 100
.end
`), { format: 'spice' })[0];
    assert.deepEqual([noExcitation.status, noExcitation.classification, noExcitation.code],
      ['refused', 'source-condition', 'missing-ac-source']);

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

  it('superposes authored independent voltage and current AC excitations', () => {
    const run = runSourceAnalyses(imported(`two excitations
V1 in 0 DC 0 AC 1
I1 out 0 DC 0 AC 2m
R1 in out 1k
R2 out 0 1k
.ac dec 1 10 100
.end
`), { format: 'spice' })[0];
    assert.equal(run.status, 'pass');
    assert.deepEqual(run.conditions.sources, [
      { id: 's0', kind: 'voltage', amplitude: 1, phaseDeg: 0 },
      { id: 's1', kind: 'current', amplitude: 0.002, phaseDeg: 0 },
    ]);
    const input = run.observables.nodes.find(node => node.id === 'n0');
    const output = run.observables.nodes.find(node => node.id === 'n1');
    assert.ok(input.magnitude.every(value => Math.abs(value - 1) < 1e-9));
    assert.ok(input.phaseDeg.every(value => Math.abs(value) < 1e-9));
    assert.ok(output.magnitude.every(value => Math.abs(value - 0.5) < 1e-9));
    assert.ok(output.phaseDeg.every(value => Math.abs(Math.abs(value) - 180) < 1e-9));
  });

  it('keeps a small ideal inductor accurate through the installed Board package', () => {
    // The former inductor admittance stamp put about j1.6e8 beside j6.3e-7
    // here and lost 3.43e-5 V. This enters through the real SPICE adapter so a
    // pin/provenance-only bump cannot claim the Board repair without using it.
    const resistance = 2700;
    const henrys = 1e-9;
    const farads = 1e-7;
    const run = runSourceAnalyses(imported(`small ideal inductor
V1 in 0 DC 0 AC 1
R1 in n_rl ${resistance}
L1 n_rl n_lc ${henrys}
C1 n_lc 0 ${farads}
.ac dec 100 1 ${Math.pow(10, 0.01)}
.end
`), { format: 'spice', maxPoints: 4 })[0];
    assert.equal(run.status, 'pass');
    assert.deepEqual(run.observables.axis.values, [1, Math.pow(10, 0.01)]);
    const nodes = new Map(run.observables.nodes.map(node => [node.id, node]));
    for (const [index, hz] of run.observables.axis.values.entries()) {
      const omega = 2 * Math.PI * hz;
      const zCapImaginary = -1 / (omega * farads);
      const zLoadImaginary = omega * henrys + zCapImaginary;
      const denominator = resistance ** 2 + zLoadImaginary ** 2;
      const currentReal = resistance / denominator;
      const currentImaginary = -zLoadImaginary / denominator;
      for (const [nodeId, loadImaginary] of [
        ['n1', zLoadImaginary], ['n2', zCapImaginary],
      ]) {
        const expectedReal = -currentImaginary * loadImaginary;
        const expectedImaginary = currentReal * loadImaginary;
        const node = nodes.get(nodeId);
        const angle = node.phaseDeg[index] * Math.PI / 180;
        const actualReal = node.magnitude[index] * Math.cos(angle);
        const actualImaginary = node.magnitude[index] * Math.sin(angle);
        assert.ok(Math.abs(actualReal - expectedReal) < 1e-12,
          `${nodeId} real at ${hz} Hz: ${actualReal} vs ${expectedReal}`);
        assert.ok(Math.abs(actualImaginary - expectedImaginary) < 1e-12,
          `${nodeId} imaginary at ${hz} Hz: ${actualImaginary} vs ${expectedImaginary}`);
      }
    }
  });

  it('matches ngspice for signed voltage/current phasor superposition on the exact LIN grid', {
    skip: spawnSync('ngspice', ['--version'], { encoding: 'utf8' }).status !== 0,
  }, () => {
    const deck = `independent AC superposition
V1 in 0 DC 0 AC 2 30
I1 out 0 DC 0 AC 3m -90
R1 in out 1k
R2 out 0 2k
.ac lin 3 10 20
.end
`;
    const native = runSourceAnalyses(imported(deck), { format: 'spice' })[0];
    assert.equal(native.status, 'pass');
    const oracleDeck = deck.replace('.end', '.print ac vr(out) vi(out)\n.end');
    const oracle = spawnSync('ngspice', ['-b'], { input: oracleDeck, encoding: 'utf8' });
    assert.equal(oracle.status, 0, oracle.stderr);
    const rows = oracle.stdout.split('\n').flatMap(line => {
      const match = /^\s*\d+\s+(\S+)\s+(\S+)\s+(\S+)\s*$/.exec(line);
      return match ? [{ hz: Number(match[1]), real: Number(match[2]), imaginary: Number(match[3]) }] : [];
    });
    assert.deepEqual(rows.map(row => row.hz), native.observables.axis.values);
    const output = native.observables.nodes.find(node => node.id === 'n1');
    const real = output.magnitude.map((magnitude, index) =>
      magnitude * Math.cos(output.phaseDeg[index] * Math.PI / 180));
    const imaginary = output.magnitude.map((magnitude, index) =>
      magnitude * Math.sin(output.phaseDeg[index] * Math.PI / 180));
    rows.forEach((row, index) => {
      assert.ok(Math.abs(real[index] - row.real) < 1e-5);
      assert.ok(Math.abs(imaginary[index] - row.imaginary) < 1e-5);
    });
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

  it('keeps TSTEP, TSTART, TMAX, integration, and observation semantics separate', () => {
    const fourField = runSourceAnalyses(imported(`four-field transient
V1 in 0 2
R1 in 0 1k
C1 in 0 1n
.tran 0 30u 10u 10u UIC
.end
`), { format: 'spice', transientProfile: 'precision-v1' })[0];
    assert.equal(fourField.status, 'pass');
    assert.equal(fourField.evidence, 'original-adapted');
    assert.deepEqual(fourField.conditions.sourceArguments, {
      source: '.tran 0 30u 10u 10u UIC', normalized: '.tran 0 30u 10u 10u uic',
      tstepSec: 0, tstopSec: 30e-6, tstartSec: 10e-6, tmaxSec: 10e-6,
      uic: true, startup: false,
    });
    assert.deepEqual(fourField.conditions.integrationWindow, { startSec: 0, stopSec: 30e-6 });
    assert.deepEqual(fourField.conditions.outputWindow, { startSec: 10e-6, stopSec: 30e-6 });
    assert.equal(fourField.observables.axis.values[0], 10e-6);
    assert.equal(fourField.observables.axis.values.at(-1), 30e-6);
    assert.match(fourField.adapted[0], /TSTEP is zero.*integration.*unchanged/i);

    const nonDivisible = runSourceAnalyses(imported(`endpoint inclusion
V1 in 0 2
R1 in 0 1k
C1 in 0 1n
.tran 7n 20n UIC
.end
`), { format: 'spice', transientProfile: 'precision-v1' })[0];
    assert.equal(nonDivisible.status, 'pass');
    assert.deepEqual(nonDivisible.observables.axis.values, [0, 7e-9, 14e-9, 20e-9]);
    assert.equal(nonDivisible.conditions.samplingProfile.endpointPolicy, 'include-tstop');
  });

  it('makes over-budget observation adaptation explicit and opt-in', () => {
    const input = imported(`dense output request
V1 in 0 2
R1 in 0 1k
C1 in 0 1n
.tran 1n 3u UIC
.end
`);
    const [exact] = runSourceAnalyses(input, { format: 'spice', transientProfile: 'precision-v1' });
    assert.deepEqual([exact.status, exact.classification, exact.code],
      ['not-run', 'integration-gap', 'analysis-budget-exceeded']);
    assert.equal(exact.requestedObservationProfile, 'source-declared-v1');

    const [adapted] = runSourceAnalyses(input, { format: 'spice', transientProfile: 'precision-v1',
      observationProfile: 'bounded-research-v1' });
    assert.equal(adapted.status, 'pass');
    assert.equal(adapted.requestedObservationProfile, 'bounded-research-v1');
    assert.equal(adapted.evidence, 'original-adapted');
    assert.equal(adapted.conditions.samplingProfile.requestedPoints, 3001);
    assert.equal(adapted.observables.axis.values.length, 101);
    assert.match(adapted.adapted[0], /replaced the requested 3001-point.*101 bounded observations/i);
  });

  it('does not round fractional source edges and refuses an unenforced TMAX', () => {
    const fractional = runSourceAnalyses(imported(`fractional source corner
V1 in 0 PWL(0 0 .5n 1 2n 2)
R1 in 0 1k
.tran 1n 3n UIC
.end
`), { format: 'spice', transientProfile: 'precision-v1' })[0];
    assert.equal(fractional.status, 'pass');
    assert.deepEqual(fractional.conditions.sourceBreakpoints.exactSeconds, [0, 0.5e-9, 2e-9]);
    assert.equal(fractional.conditions.sourceBreakpoints.fractionalNotRounded, 1);
    assert.equal(fractional.conditions.sourceBreakpoints.integration,
      'native-engine-source-edge-barriers');
    assert.equal(fractional.conditions.sourceBreakpoints.addedToObservationGrid, false);
    assert.ok(!fractional.conditions.sourceBreakpoints.publiclyRepresentableNanoseconds.includes(1),
      'a 0.5 ns corner must not become a fabricated 1 ns observation');

    const tooFine = runSourceAnalyses(imported(`tmax is an integration constraint
V1 in 0 1
R1 in 0 1k
C1 in 0 1n
.tran 1n 10n 0 1n UIC
.end
`), { format: 'spice', transientProfile: 'precision-v1' })[0];
    assert.deepEqual([tooFine.status, tooFine.classification, tooFine.code],
      ['not-run', 'integration-gap', 'tran-tmax-not-honored']);
  });

  it('runs source-declared single and nested DC sweeps as fresh static operating points', () => {
    const single = runSourceAnalyses(imported(`single DC
Vs in 0 0
R1 in out 1k
R2 out 0 1k
.dc Vs 0V 1V .5V
.end
`), { format: 'spice' })[0];
    assert.equal(single.status, 'pass');
    assert.equal(single.classification, 'native-original');
    assert.equal(single.evidence, 'original-direct');
    assert.deepEqual(single.conditions.sourceArguments,
      { source: '.dc Vs 0V 1V .5V', normalized: '.dc vs 0v 1v .5v' });
    assert.deepEqual(single.observables.axis, {
      quantity: 'dc-source',
      dimensions: [{ sourceId: 's0', unit: 'V', values: [0, 0.5, 1] }],
      order: 'single-source', coordinates: [[0], [0.5], [1]],
    });
    assert.ok(single.observables.nodes.find(node => node.id === 'n1').voltage
      .every((value, index) => Math.abs(value - [0, 0.25, 0.5][index]) < 1e-9));
    assert.equal(single.convergence.pointCount, 3);

    const nested = runSourceAnalyses(imported(`nested DC
Vx1 a 0 0
Vx2 b 0 0
R1 a b 1k
.dc Vx1 0 1 1 Vx2 -1 1 2
.end
`), { format: 'spice' })[0];
    assert.equal(nested.status, 'pass');
    assert.equal(nested.conditions.order, 'last-source-outer-first-source-fastest');
    assert.deepEqual(nested.observables.axis.coordinates,
      [[0, -1], [1, -1], [0, 1], [1, 1]]);
    assert.deepEqual(nested.observables.axis.dimensions.map(dimension => dimension.values),
      [[0, 1], [-1, 1]]);
  });

  it('accepts a one-point DC sweep and refuses unsafe DC grids and source kinds', () => {
    const one = runSourceAnalyses(imported(`one point
V1 a 0 0
R1 a 0 1k
.dc V1 70 70 1
.end
`), { format: 'spice' })[0];
    assert.equal(one.status, 'pass');
    assert.deepEqual(one.observables.axis.coordinates, [[70]]);

    const tooMany = runSourceAnalyses(imported(`dense DC
V1 a 0 0
R1 a 0 1k
.dc V1 0 10 .1
.end
`), { format: 'spice', maxPoints: 50 })[0];
    assert.deepEqual([tooMany.status, tooMany.code], ['not-run', 'analysis-budget-exceeded']);
    assert.equal(tooMany.conditions.points, 101);

    const current = runSourceAnalyses(imported(`current sweep
I1 0 a 0
R1 a 0 1k
.dc I1 0 1m .5m
.end
`), { format: 'spice' })[0];
    assert.deepEqual([current.status, current.code], ['not-run', 'dc-source-kind-not-implemented']);
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
        { id: 'bounded-uniform-observation-v1', sourceDeclared: false, adapted: true,
          targetIntervals: 100, reason: 'source declares no TSTEP' });
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
      assert.ok(result.losses.some(loss => /initial|instance|waveform/i.test(`${loss.kind} ${loss.reason}`)));
      const run = runSourceAnalyses(result, { format: 'spice' })[0];
      assert.deepEqual([run.status, run.classification, run.code],
        ['refused', 'import-fidelity', 'semantic-import-blocker']);
    }
  });

  it('preserves authored non-integral DEC, OCT, and LIN AC frequency axes', () => {
    const runs = runSourceAnalyses(imported(`three authored grids
V1 in 0 DC 0 AC 1
R1 in out 1k
C1 out 0 1u
.ac dec 3 10 700
.ac oct 3 10 100
.ac lin 4 10 100
.end
`), { format: 'spice', maxPoints: 32 });

    assert.deepEqual(runs.map(run => run.status), ['pass', 'pass', 'pass']);
    assert.deepEqual(runs[0].observables.axis.values,
      Array.from({ length: 6 }, (_, index) => index === 5
        ? 700 : (index === 0 ? 10
          : Math.exp(Math.log(10) + (Math.log(700) - Math.log(10)) * index / 5))));
    assert.deepEqual(runs[1].observables.axis.values,
      Array.from({ length: 10 }, (_, index) => Math.exp(Math.log(10) + index * Math.LN2 / 3)));
    assert.deepEqual(runs[2].observables.axis.values, [10, 40, 70, 100]);
    assert.equal(runs[0].conditions.endpointPolicy, 'include-fstart-and-fstop');
    assert.equal(runs[1].conditions.endpointPolicy,
      'last-authored-ratio-point-at-or-below-fstop');
    for (const run of runs) {
      assert.deepEqual(run.conditions.solverProfile, {
        id: 'source-analysis-v1', nodeRegularizationSiemens: 0,
        sourceBiasPolicy: 'authored-dc-value-no-interactive-source-controls',
      });
    }
  });

  it('reports ambiguous one-point DEC and ngspice-42 LIN-2 grids instead of changing them', () => {
    for (const card of ['.ac dec 3 10 12', '.ac lin 2 10 20']) {
      const run = runSourceAnalyses(imported(`ambiguous grid
V1 in 0 AC 1
R1 in 0 1k
${card}
.end
`), { format: 'spice' })[0];
      assert.deepEqual([run.status, run.classification, run.code],
        ['not-run', 'integration-gap', 'ac-grid-not-representable']);
    }
    const overBudget = runSourceAnalyses(imported(`bounded grid allocation
V1 in 0 AC 1
R1 in 0 1k
.ac lin 9007199254740991 10 20
.end
`), { format: 'spice', maxPoints: 32 })[0];
    assert.deepEqual([overBudget.status, overBudget.code],
      ['not-run', 'analysis-budget-exceeded']);
  });

  it('runs AC only for importer-qualified exact Ebers-Moll NPN models', () => {
    const exact = `exact Ebers-Moll NPN AC
VCC vcc 0 12
VIN base 0 DC .75 AC 1
RC vcc collector 3k
RE emitter 0 1k
Q1 collector base emitter QMOD
.model QMOD NPN(IS=3n BF=200 VAF=130 RB=10)
.ac lin 3 1k 3k
.end`;
    const pass = runSourceAnalyses(imported(exact), { format: 'spice' })[0];
    assert.equal(pass.status, 'pass', JSON.stringify(pass));
    assert.deepEqual(pass.observables.axis.values, [1000, 2000, 3000]);
    assert.ok(pass.observables.nodes.some(node =>
      node.magnitude.some(value => Number.isFinite(value) && value > 0)));

    const richer = exact.replace('RB=10)',
      'RB=10 RC=100 IKF=10m CJE=20p CJC=10p TF=.5n)');
    const richerRun = runSourceAnalyses(imported(richer), { format: 'spice' })[0];
    assert.equal(richerRun.status, 'pass', JSON.stringify(richerRun));

    const highFrequency = richer.replace('.ac lin 3 1k 3k', '.ac lin 3 1Meg 1000002');
    const chargeRun = runSourceAnalyses(imported(highFrequency), { format: 'spice' })[0];
    assert.equal(chargeRun.status, 'pass', JSON.stringify(chargeRun));
    const rectangular = id => {
      const node = chargeRun.observables.nodes.find(row => row.id === id);
      const angle = node.phaseDeg[0] * Math.PI / 180;
      return { re: node.magnitude[0] * Math.cos(angle),
        im: node.magnitude[0] * Math.sin(angle) };
    };
    // Independent ngspice 42 values for the imported RC/IKF/CJE/CJC/TF card.
    const collector = rectangular('n2');
    const emitter = rectangular('n3');
    assert.ok(Math.abs(collector.re - (-2.7836164880391721)) < 2e-8, collector.re);
    assert.ok(Math.abs(collector.im - 0.3401614479609181) < 2e-8, collector.im);
    assert.ok(Math.abs(emitter.re - 0.9420364784804977) < 2e-8, emitter.re);
    assert.ok(Math.abs(emitter.im - (-0.0003402408658239708)) < 2e-8, emitter.im);

    const unsupported = richer.replace('TF=.5n)', 'TF=.5n IKR=1m)');
    const refused = runSourceAnalyses(imported(unsupported), { format: 'spice' })[0];
    assert.deepEqual([refused.status, refused.classification, refused.code],
      ['not-run', 'integration-gap', 'ac-linearization-model-unqualified']);
    assert.match(refused.detail, /Q1:npn/);
  });

  it('runs AC only for importer-qualified exact Level-1 NMOS models', () => {
    const exact = `exact Level-1 NMOS AC
VDD vdd 0 10
VIN gate 0 DC 2 AC 1
RD vdd drain 1k
M1 drain gate 0 0 NM W=100u L=1u
.model NM NMOS(LEVEL=1 VTO=1 KP=50u LAMBDA=.01)
.ac lin 3 1k 3k
.end`;
    const pass = runSourceAnalyses(imported(exact), { format: 'spice' })[0];
    assert.equal(pass.status, 'pass', JSON.stringify(pass));
    assert.deepEqual(pass.observables.axis.values, [1000, 2000, 3000]);
    assert.ok(pass.observables.nodes.some(node =>
      node.magnitude.some(value => Number.isFinite(value) && value > 0)));

    const richer = exact.replace('LAMBDA=.01)', 'LAMBDA=.01 GAMMA=.5 PHI=.6)');
    const bodyEffect = runSourceAnalyses(imported(richer), { format: 'spice' })[0];
    assert.equal(bodyEffect.status, 'pass', JSON.stringify(bodyEffect));
    assert.deepEqual(bodyEffect.observables.axis.values, [1000, 2000, 3000]);

    const wider = richer.replace('PHI=.6)', 'PHI=.6 TOX=10n)');
    const refused = runSourceAnalyses(imported(wider), { format: 'spice' })[0];
    assert.deepEqual([refused.status, refused.classification, refused.code],
      ['not-run', 'integration-gap', 'ac-linearization-model-unqualified']);
    assert.match(refused.detail, /M1:nmos/);
  });

  it('refuses a Board result that does not prove the strict AC execution profile', () => {
    const original = BoardImpl.prototype.runAc;
    BoardImpl.prototype.runAc = function mismatchedProfile(options) {
      return original.call(this, options).map(row => ({
        ...row, profile: { ...row.profile, id: 'interactive-v1' },
      }));
    };
    try {
      const run = runSourceAnalyses(imported(`wrong profile
V1 in 0 AC 1
R1 in 0 1k
.ac lin 3 10 20
.end
`), { format: 'spice' })[0];
      assert.deepEqual([run.status, run.classification, run.code],
        ['not-run', 'integration-gap', 'native-ac-profile-mismatch']);
    } finally {
      BoardImpl.prototype.runAc = original;
    }
  });
});
