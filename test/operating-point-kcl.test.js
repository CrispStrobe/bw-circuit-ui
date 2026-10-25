import assert from 'node:assert/strict';
import {test} from 'node:test';
import './_setup.js';
import {importCircuit} from '../src/importers/index.js';
import {Circuit} from '../src/model/circuit.js';
import {auditOperatingPointKcl} from '../src/model/operating-point-kcl.js';

function fixture(cards = 'V1 in 0 6\nR1 in out 1k\nR2 out 0 2k') {
  const imported = importCircuit('spice', `authored static KCL control\n${cards}\n.op\n.end\n`);
  const circuit = Circuit.fromJSON({parts: imported.parts, wires: imported.wires});
  circuit.setPower(true);
  const point = circuit.operatingPoint({waveformBias: 'dc-value'});
  return {circuit, point};
}
const inspect = ({circuit, point}) => auditOperatingPointKcl(circuit, point);

test('real static OP audits every net, part and signed terminal without altering the solution', () => {
  const value = fixture();
  const before = [...value.point.branchCurrents].map(([id, map]) => [id, [...map]]);
  const result = inspect(value);
  assert.equal(result.status, 'pass');
  assert.deepEqual(result.counts, {nets: 3, parts: 3, terminals: 6, checked: 6, passed: 6, failed: 0, unavailable: 0});
  assert.equal(value.point.branchCurrents.get('V1').get('pos'), -0.002);
  assert.equal(value.point.branchCurrents.get('R1').get('a'), 0.002);
  assert.equal(result.worstResidualAmps, 0);
  assert.equal(result.claims.independentOracle, false);
  assert.equal(result.claims.transientConservation, false);
  assert.deepEqual([...value.point.branchCurrents].map(([id, map]) => [id, [...map]]), before);
});

test('signed I sources, controlled ports, static storage and reversed supply conserve current', () => {
  for (const cards of ['I1 0 in 2m\nR1 in 0 1k',
    'V1 ctl 0 1\nG1 out 0 ctl 0 2m\nR1 out 0 1k',
    'V1 ctl 0 1\nE1 out 0 ctl 0 -2\nR1 out 0 1k',
    'V1 in 0 6\nR1 in out 1k\nL1 out 0 1m\nC1 in 0 1u',
    'V1 in 0 -6\nR1 in out 1k\nR2 out 0 2k']) {
    const result = inspect(fixture(cards));
    assert.equal(result.status, 'pass', JSON.stringify(result));
    assert.ok(result.counts.terminals >= 4);
    assert.ok(result.worstResidualAmps <= 2e-12);
  }
});

test('missing, nonnumeric, indeterminate or unrecognized current authority refuses, never fills zero', () => {
  for (const change of [
    ({point}) => { point.converged = false; },
    ({point}) => { point.analysis.currentConvention = 'positive-out-of-part-terminal'; },
    ({point}) => { point.indeterminateBranchCurrents.add('V1'); },
    ({point}) => { point.indeterminateBranchCurrents = undefined; },
    ({point}) => { point.railConflicts = ['inconsistent source']; },
    ({point}) => { point.branchCurrents.get('V1').delete('pos'); },
    ({point}) => { point.branchCurrents.delete('R1'); },
    ({point}) => { point.branchCurrents.get('V1').set('pos', '0'); },
    ({point}) => { point.branchCurrents.get('V1').set('pos', NaN); },
    ({point}) => { point.branchCurrents.get('V1').set('pos', Infinity); },
    ({point}) => { point.branchCurrents.get('V1').set('implicit-ground', 0); },
    ({point}) => { point.branchCurrents.set('unmapped', new Map([['a', 0]])); },
    ({point}) => { point.nodeVoltages.clear(); },
  ]) {
    const value = fixture(); change(value);
    const result = inspect(value);
    assert.equal(result.status, 'refused');
    assert.ok(result.counts.unavailable > 0);
    assert.equal(result.counts.checked, 0);
    assert.equal(result.counts.passed, 0);
    assert.equal(result.worstResidualAmps, null);
  }
});

test('topology omissions and duplicate identities cannot manufacture conservation', () => {
  const {circuit, point} = fixture();
  const topology = {parts: circuit.parts, resolvedNets: circuit.resolvedNets};
  for (const bad of [null, {...topology, parts: []}, {...topology, resolvedNets: []},
    {...topology, parts: [...topology.parts, topology.parts[0]]},
    {...topology, parts: [...topology.parts, null]},
    {...topology, parts: topology.parts.map(part => part.id === 'V1' ? {...part, kind: 'gnd'} : part)},
    {...topology, resolvedNets: [...topology.resolvedNets, topology.resolvedNets[0]]},
    {...topology, resolvedNets: [...topology.resolvedNets, null]},
    {...topology, resolvedNets: [...topology.resolvedNets, {id: 'empty', terminals: []}]},
    {...topology, resolvedNets: topology.resolvedNets.map((net, i) => i ? net : {...net,
      terminals: [...net.terminals, null]})},
    {...topology, resolvedNets: topology.resolvedNets.map((net, i) => i ? net : {...net,
      terminals: [...net.terminals, net.terminals[0]]})},
    {...topology, resolvedNets: topology.resolvedNets.map(net => ({...net,
      terminals: net.terminals.filter(terminal => terminal.part !== 'R1')}))}]) {
    assert.equal(auditOperatingPointKcl(bad, point).status, 'refused');
  }
});

test('wrong signed currents fail actual net and part equations; numerical overflow refuses', () => {
  const reversed = fixture();
  const source = reversed.point.branchCurrents.get('V1');
  for (const [terminal, value] of source) source.set(terminal, -value);
  const result = inspect(reversed);
  assert.equal(result.status, 'fail');
  assert.equal(result.counts.failed, 2);
  assert.ok(result.nets.some(row => Math.abs(row.residualAmps) === 0.004));
  assert.ok(result.parts.every(row => row.status === 'pass'), 'net failure must not be hidden by whole-part cancellation');
  const one = fixture(); one.point.branchCurrents.get('R1').set('b', 0);
  const unbalanced = inspect(one);
  assert.equal(unbalanced.status, 'fail');
  assert.ok(unbalanced.parts.some(row => row.id === 'R1' && row.status === 'fail'));
  const overflow = fixture();
  for (const currents of overflow.point.branchCurrents.values()) {
    for (const terminal of currents.keys()) currents.set(terminal, Number.MAX_VALUE);
  }
  const refusal = inspect(overflow);
  assert.equal(refusal.status, 'refused');
  assert.equal(refusal.counts.passed, 0);
  assert.ok(refusal.unavailable.some(row => row.code === 'current-accumulation-overflow'));
});

function groundedBulkFixture() {
  // The source/body diode is forward biased, so dropping its real current
  // cannot hide beneath the KCL allowance as an unloaded cutoff example can.
  return fixture('VD drain 0 0\nVG gate 0 -1\nVS source 0 -0.5\n'
    + 'M1 drain gate source 0 NM W=5u L=2u\n'
    + '.model NM NMOS(LEVEL=1 VTO=1 KP=100u LAMBDA=0.02)');
}

test('strict grounded-bulk NMOS includes its nonzero implicit current in net and part conservation', () => {
  const value = groundedBulkFixture();
  const before = [...value.point.branchCurrents].map(([id, map]) => [id, [...map]]);
  const bulk = value.point.branchCurrents.get('M1').get('bulk');
  assert.ok(Math.abs(bulk) > 1e-6, 'body-current witness must exceed the KCL allowance');
  const result = inspect(value);
  assert.equal(result.status, 'pass', JSON.stringify(result));
  const observation = result.observations.find(row => row.part === 'M1' && row.terminal === 'bulk');
  assert.equal(observation.origin, 'implicit-grounded-bulk');
  assert.equal(observation.currentAmps, bulk);
  const groundParts = new Set(value.circuit.parts.filter(part => part.kind === 'gnd').map(part => part.id));
  const ground = value.circuit.resolvedNets.find(net => net.terminals.some(t => groundParts.has(t.part)));
  assert.equal(observation.net, ground.id);
  assert.equal(result.counts.terminals, 10);
  assert.equal(result.observations.filter(row => row.origin === 'physical-terminal').length, 9);
  assert.ok(result.nets.some(row => row.id === ground.id && row.status === 'pass'));
  assert.ok(result.parts.some(row => row.id === 'M1' && row.status === 'pass'));
  assert.deepEqual([...value.point.branchCurrents].map(([id, map]) => [id, [...map]]), before);

  const renamed = {parts: value.circuit.parts, resolvedNets: value.circuit.resolvedNets.map(net =>
    net.id === ground.id ? {...net, id: 'reference-with-an-arbitrary-name'} : net)};
  const point = {...value.point, nodeVoltages: new Map(value.point.nodeVoltages)};
  point.nodeVoltages.set('reference-with-an-arbitrary-name', point.nodeVoltages.get(ground.id));
  point.nodeVoltages.delete(ground.id);
  assert.equal(auditOperatingPointKcl(renamed, point).status, 'pass');
});

test('nonzero implicit bulk on the wrong zero-volt net or omitted from the device fails conservation', () => {
  const value = groundedBulkFixture();
  const groundParts = new Set(value.circuit.parts.filter(part => part.kind === 'gnd').map(part => part.id));
  const ground = value.circuit.resolvedNets.find(net => net.terminals.some(t => groundParts.has(t.part)));
  const drain = value.circuit.resolvedNets.find(net => net.terminals.some(t => t.part === 'M1' && t.terminal === 'drain'));
  assert.equal(value.point.nodeVoltages.get(drain.id), 0, 'wrong-net control also reads zero volts');
  const labels = ground.terminals.filter(t => groundParts.has(t.part));
  const wrong = {parts: value.circuit.parts, resolvedNets: value.circuit.resolvedNets.map(net => ({...net,
    terminals: net.id === ground.id ? net.terminals.filter(t => !groundParts.has(t.part))
      : net.id === drain.id ? [...net.terminals, ...labels] : net.terminals}))};
  const misplaced = auditOperatingPointKcl(wrong, value.point);
  assert.equal(misplaced.status, 'fail');
  assert.ok(misplaced.nets.filter(row => row.status === 'fail').length >= 2);
  value.point.branchCurrents.get('M1').delete('bulk');
  const omitted = inspect(value);
  assert.equal(omitted.status, 'fail');
  assert.ok(omitted.parts.some(row => row.id === 'M1' && row.status === 'fail'));
});

test('implicit bulk mapping refuses absent or ambiguous reference topology and broader current authority', () => {
  for (const mutate of [
    value => { value.circuit.parts.find(part => part.kind === 'gnd').kind = 'unproven-reference'; },
    value => {
      value.circuit.parts.push({id: 'OTHER_GROUND', kind: 'gnd'});
      value.circuit.resolvedNets.find(net => net.terminals.some(t => t.part === 'M1' && t.terminal === 'drain'))
        .terminals.push({part: 'OTHER_GROUND', terminal: 'gnd'});
    },
    value => { value.circuit.parts.find(part => part.id === 'M1').kind = 'pmos'; },
    value => { value.circuit.parts.find(part => part.id === 'M1').params.model = 'unqualified'; },
    value => { value.circuit.parts.find(part => part.id === 'M1').params.bulkAtGround = false; },
    value => { value.circuit.parts.find(part => part.id === 'M1').params.bulkOnSource = true; },
    value => { value.circuit.parts.find(part => part.id === 'M1').params.bulkUnplaced = true; },
    value => { value.point.branchCurrents.get('M1').set('bulk', NaN); },
    value => { value.point.branchCurrents.get('M1').set('unknown-reference', 0); },
  ]) {
    const value = groundedBulkFixture(); mutate(value);
    assert.equal(inspect(value).status, 'refused');
  }
});
