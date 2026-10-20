import './_setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Circuit, resetIds } from '../src/model/circuit.js';
import { getEngine, setEngine } from '../src/engine.js';
import { resolveTerminal } from '../src/model/terminal-aliases.js';
import { wireEndpoint } from '../src/model/wire-endpoints.js';
import { FOOTPRINTS, computeLeadMap } from '../src/model/footprints.js';
import { breadboardFootprintForPart } from '../src/model/carriers.js';

const fixtures = new URL('./fixtures/seated-wire-supplier5a/', import.meta.url);
const provenance = JSON.parse(readFileSync(new URL('provenance.json', fixtures), 'utf8'));
assert.deepEqual(provenance.files.map(row => row.sourcePath), [
  'examples/79-a2-sampler/circuit.stc15f2k60s2.json',
  'examples/80-a2-lcd-moving-text/circuit.stc15f2k60s2.json',
  'examples/81-8051-lcd1602-parallel/circuit.stc15f2k60s2.json',
  'examples/82-a2-led-row/circuit.stc15f2k60s2.json',
], 'the complete original four-case cohort is required');
const clone = value => JSON.parse(JSON.stringify(value));

// The existing app passes stc_mcu through the generic MCU boundary. Other
// models still come from the actual injected registry, never a test model.
function withAppEngine(run) {
  const original = getEngine();
  setEngine({ ...original, getDevice: kind => kind === 'stc_mcu' ? null : original.getDevice(kind) });
  try { return run(); } finally { setEngine(original); }
}

for (const [index, row] of provenance.files.entries()) {
  test(`first-load seated wire fixed point: exact supplier ${row.sourcePath}`, () => withAppEngine(() => {
    assert.equal(provenance.sourceCommit, '5a3977fb6333cf690f675ee1b5a7a3492f5195a8');
    const bytes = readFileSync(new URL(row.file, fixtures));
    assert.equal(bytes.length, row.bytes);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), row.sha256);
    const input = JSON.parse(bytes), original = clone(input);
    const first = Circuit.fromJSON(input), once = first.toJSON();
    assert.equal(first.netlistError, null, 'the actual engine accepts the first load');
    assert.deepEqual(input, original, 'the original input remains unchanged');
    const mcu = once.parts.find(part => part.id === 'MCU');
    assert.equal(mcu.kind, 'stc15_mcu');
    assert.ok(mcu.seat, 'the valid physical seat survives');
    assert.equal(mcu.terminals.length, 40, 'all real seated legs are declared on the first load');
    let changed = 0;
    for (const [wireIndex, wire] of original.wires.entries()) {
      const expected = { from: wireEndpoint(wire, 'from'), to: wireEndpoint(wire, 'to') };
      for (const side of ['from', 'to']) {
        const endpoint = expected[side];
        if (endpoint?.part === 'MCU' && /^p\d\.\d$/.test(endpoint.terminal)) {
          endpoint.terminal = `P${endpoint.terminal.slice(1)}`;
          assert.ok(mcu.terminals.includes(endpoint.terminal), 'the accepted seat actually declares the canonical pin');
          changed++;
        }
        assert.deepEqual(once.wires[wireIndex][side], endpoint, 'the original legacy endpoint resolves on the first load');
      }
      for (const [key, value] of Object.entries(wire))
        if (key !== 'from' && key !== 'to') assert.deepEqual(once.wires[wireIndex][key], value, 'all supplied wire metadata survives in the original order');
      assert.equal(typeof once.wires[wireIndex].id, 'string', 'a legacy wire receives its stable stored identity');
      assert.equal(typeof once.wires[wireIndex].netId, 'string', 'the actual legacy grouping produces a stored net identity');
    }
    assert.equal(changed, [19, 7, 6, 8][index], 'every original lower-case endpoint is exercised');
    const beforeReload = clone(once);
    const second = Circuit.fromJSON(once), twice = second.toJSON();
    assert.equal(second.netlistError, null);
    assert.deepEqual(once, beforeReload, 'the actual second input object is not mutated');
    assert.deepEqual(twice, once, 'the first save is already a complete load/save fixed point');
    assert.deepEqual(Circuit.fromJSON(twice).toJSON(), twice, 'a further reload remains stable');
    assert.deepEqual(once.parts.map(part => part.id), original.parts.map(part => part.id), 'part order and identities survive');
  }));
}

function seatedInput(kind = 'stc15_mcu', stored = []) {
  resetIds();
  const circuit = new Circuit(5);
  const bb = circuit.addPart('breadboard', { size: 'full' }, 400, 300);
  const mcu = circuit.addPart(kind, {}, 0, 0);
  const footprint = breadboardFootprintForPart(mcu, FOOTPRINTS);
  assert.ok(footprint, 'a real physical footprint is required');
  assert.ok(circuit.seatPart(mcu.id, bb.id, computeLeadMap(footprint, 'e3')), 'the actual seat is accepted');
  const one = circuit.addPart('resistor', { ohms: 1000 }, 0, 0);
  const two = circuit.addPart('resistor', { ohms: 2000 }, 0, 0);
  const input = clone(circuit.toJSON());
  input.parts.find(part => part.id === mcu.id).terminals = [...stored];
  input.wires = [
    { id: 'first', from: { part: mcu.id, terminal: 'p1.0' }, to: { part: one.id, terminal: 'a' } },
    { id: 'second', from: { part: two.id, terminal: 'a' }, to: { part: mcu.id, terminal: 'P1.0' } },
    { id: 'separate', from: { part: mcu.id, terminal: 'p1.1' }, to: { part: two.id, terminal: 'b' } },
  ];
  return { input, mcuId: mcu.id, bbId: bb.id };
}

test('final seat names normalize both endpoint sides before legacy net grouping', () => withAppEngine(() => {
  const { input, mcuId } = seatedInput();
  const original = clone(input), circuit = Circuit.fromJSON(input);
  const [first, second, separate] = circuit.wires;
  assert.equal(first.from.terminal, 'P1.0');
  assert.equal(second.to.terminal, 'P1.0');
  assert.equal(separate.from.terminal, 'P1.1');
  assert.equal(first.netId, second.netId, 'mixed-case references to the same physical pin form one legacy net');
  assert.notEqual(first.netId, separate.netId, 'a different pin stays on a different net');
  assert.deepEqual(circuit.wires.map(wire => wire.id), ['first', 'second', 'separate']);
  const net = circuit.resolvedNets.find(net => net.terminals.some(term => term.part === mcuId && term.terminal === 'P1.0'));
  assert.ok(net, 'the actual resolved engine net contains the canonical pin');
  assert.equal(net.terminals.filter(term => term.part === mcuId && term.terminal.toLowerCase() === 'p1.0').length, 1);
  assert.deepEqual(input, original);
  const saved = circuit.toJSON();
  assert.deepEqual(Circuit.fromJSON(saved).toJSON(), saved);
}));

test('stored terminal order and the app stc_mcu passthrough survive accepted seat completion', () => withAppEngine(() => {
  const { input, mcuId } = seatedInput('stc_mcu', ['P3.7', 'P1.0']);
  assert.equal(getEngine().getDevice('stc_mcu'), null, 'the genuine app exemption is active');
  const original = clone(input), circuit = Circuit.fromJSON(input);
  assert.equal(circuit.parts.find(part => part.id === mcuId).kind, 'stc_mcu');
  assert.deepEqual(circuit.parts.find(part => part.id === mcuId).terminals.slice(0, 2), ['P3.7', 'P1.0']);
  assert.equal(circuit.wires[2].from.terminal, 'P1.1');
  assert.deepEqual(input, original);
  const saved = circuit.toJSON();
  assert.deepEqual(Circuit.fromJSON(saved).toJSON(), saved);
}));

test('unknown, ambiguous and breadboard-hole endpoints are not guessed', () => {
  assert.equal(resolveTerminal('mcu', 'fOo', ['Foo', 'FOO']), 'fOo', 'ambiguous casing has no unique alias');
  assert.equal(resolveTerminal('mcu', 'missing', ['P1.0']), 'missing');
  const { input, mcuId, bbId } = seatedInput();
  input.wires = [
    { id: 'hole', netId: 'kept-hole', from: { board: bbId, hole: 'a1' }, to: { part: mcuId, terminal: 'p1.0' } },
    { id: 'unknown', netId: 'kept-unknown', from: { part: mcuId, terminal: 'missing' }, to: { part: 'absent', terminal: 'fOo' } },
  ];
  const original = clone(input), circuit = Circuit.fromJSON(input);
  assert.deepEqual(circuit.wires[0].from, original.wires[0].from, 'hole endpoints do not enter terminal resolution');
  assert.equal(circuit.wires[1].from.terminal, 'missing');
  assert.equal(circuit.wires[1].to.terminal, 'fOo');
  assert.deepEqual(circuit.wires.map(wire => wire.netId), ['kept-hole', 'kept-unknown']);
  assert.deepEqual(input, original);
});

test('a rejected seat contributes no new terminal authority', () => {
  const { input, mcuId } = seatedInput();
  input.parts.find(part => part.id === mcuId).seat.boardId = 'absent-board';
  const circuit = Circuit.fromJSON(input), mcu = circuit.parts.find(part => part.id === mcuId);
  assert.equal(mcu.seat, undefined, 'the invalid seat is rejected');
  assert.deepEqual(mcu.terminals, [], 'no unaccepted legs are added');
  assert.equal(circuit.wires[0].from.terminal, 'p1.0', 'a non-existent seat cannot justify a rename');
});
