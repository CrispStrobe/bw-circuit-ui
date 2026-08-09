// mergeNets: the mixed-mode correctness piece. The one scenario this exists
// for: a drawn wire touching a breadboard-seated terminal merges nets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeNets } from '../src/model/merge-nets.js';

const T = (part, terminal) => ({ part, terminal });

test('disjoint sources pass through unchanged', () => {
  const wires = [{ id: 'w1', terminals: [T('R1', 'a'), T('D1', 'anode')] }];
  const strips = [{ id: 'rail-t+', terminals: [T('V1', 'vcc'), T('R2', 'a')] }];
  const out = mergeNets(wires, strips);
  assert.equal(out.length, 2);
  assert.deepEqual(out.map(n => n.id).sort(), ['rail-t+', 'w1']);
});

test('a wire touching a seated terminal MERGES the strip and wire nets', () => {
  // Strip: D1.anode shares a column with C5.a. Wire: R1.b -> D1.anode.
  // Electrically that is ONE node holding R1.b, D1.anode, C5.a.
  const wires = [{ id: 'w1', terminals: [T('R1', 'b'), T('D1', 'anode')] }];
  const strips = [{ id: 'n-col-t10', terminals: [T('D1', 'anode'), T('C5', 'a')] }];
  const out = mergeNets(wires, strips);
  assert.equal(out.length, 1, JSON.stringify(out));
  assert.deepEqual(out[0].terminals,
    [T('C5', 'a'), T('D1', 'anode'), T('R1', 'b')]);
});

test('transitive chains merge across multiple hops and prefer rail names', () => {
  // wire w1: MCU.P1.0 -> R1.a ; strip col5: R1.a + D1.anode ;
  // strip rail-t-: D1.cathode + G1.gnd ; wire w2: D1.cathode -> C1.b
  // Two merged nets result; the rail-anchored one keeps the rail name.
  const wires = [
    { id: 'w1', terminals: [T('MCU', 'P1.0'), T('R1', 'a')] },
    { id: 'w2', terminals: [T('D1', 'cathode'), T('C1', 'b')] },
  ];
  const strips = [
    { id: 'n-col-t5', terminals: [T('R1', 'a'), T('D1', 'anode')] },
    { id: 'rail-t-', terminals: [T('D1', 'cathode'), T('G1', 'gnd')] },
  ];
  const out = mergeNets(wires, strips);
  assert.equal(out.length, 2, JSON.stringify(out));
  const rail = out.find(n => n.id === 'rail-t-');
  assert.ok(rail, 'rail name survives the merge');
  assert.deepEqual(rail.terminals, [T('C1', 'b'), T('D1', 'cathode'), T('G1', 'gnd')]);
  const other = out.find(n => n.id !== 'rail-t-');
  assert.deepEqual(other.terminals, [T('D1', 'anode'), T('MCU', 'P1.0'), T('R1', 'a')]);
});

test('deterministic output regardless of input order', () => {
  const wires = [{ id: 'w9', terminals: [T('A', 'x'), T('B', 'y')] }];
  const strips = [{ id: 'n-col-b3', terminals: [T('B', 'y'), T('C', 'z')] }];
  const a = JSON.stringify(mergeNets(wires, strips));
  const b = JSON.stringify(mergeNets(strips, wires));
  assert.equal(a, b);
});

test('empty and single-source inputs behave', () => {
  assert.deepEqual(mergeNets([], []), []);
  const only = [{ id: 'w1', terminals: [T('R1', 'a'), T('R1', 'b')] }];
  const out = mergeNets(only, []);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 'w1');
});
