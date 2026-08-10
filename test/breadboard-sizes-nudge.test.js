// Breadboard sizes (full/half/mini) and the arrow-key seated nudge.
import './_setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Circuit, resetIds } from '../src/model/circuit.js';
import { BreadboardModel } from '../src/model/breadboard.js';
import { FOOTPRINTS, computeLeadMap } from '../src/model/footprints.js';
import { bbSpec, bbRows } from '../src/interaction/breadboard-snap.js';

test('mini board: 17 columns, no rails — a rail hole is simply not a hole', () => {
  const bb = new BreadboardModel({ size: 'mini' });
  assert.equal(bb.cols, 17);
  assert.equal(bb.hasRails, false);
  assert.ok(bb.isValidHole('a1'));
  assert.ok(bb.isValidHole('j17'));
  assert.ok(!bb.isValidHole('a18'), 'column 18 does not exist');
  assert.ok(!bb.isValidHole('t+3'), 'mini has no power rails');
});

test('snap geometry follows the size param', () => {
  const mini = { kind: 'breadboard', x: 0, y: 0, params: { size: 'mini' } };
  const full = { kind: 'breadboard', x: 0, y: 0, params: {} };
  assert.deepEqual(bbSpec(mini), { cols: 17, hasRails: false });
  assert.deepEqual(bbSpec(full), { cols: 63, hasRails: true });
  const miniRows = bbRows(mini).map(r => r.name);
  assert.ok(!miniRows.includes('t+') && !miniRows.includes('b-'), 'no rail rows on mini');
  assert.equal(miniRows.length, 10);
  assert.equal(bbRows(full).length, 14);
});

test('a part seats on a mini board and the strips conduct', () => {
  resetIds();
  const c = new Circuit(5);
  const bb = c.addPart('breadboard', { size: 'mini' }, 0, 0);
  const r1 = c.addPart('resistor', { ohms: 1000 }, 0, 0);
  assert.ok(c.seatPart(r1.id, bb.id, computeLeadMap(FOOTPRINTS.resistor, 'b3')));
  assert.ok(!c.seatPart(r1.id, bb.id, { a: 't+1', b: 't+5' }), 'rails do not exist to seat on');
});

test('nudgeSeated moves by holes, atomically', () => {
  resetIds();
  const c = new Circuit(5);
  const bb = c.addPart('breadboard', {}, 0, 0);
  const r1 = c.addPart('resistor', { ohms: 1000 }, 0, 0);
  c.seatPart(r1.id, bb.id, computeLeadMap(FOOTPRINTS.resistor, 'b5'));
  const before = { ...r1.seat.leadMap };
  assert.ok(c.nudgeSeated(r1.id, 1, 0), 'one column right');
  for (const [t, h] of Object.entries(r1.seat.leadMap)) {
    const was = before[t];
    assert.equal(h, `${was[0]}${Number(was.slice(1)) + 1}`);
  }
  assert.ok(c.nudgeSeated(r1.id, 0, 1), 'one row down within the block');
});

test('nudgeSeated refuses the edge and occupied holes — part stays put', () => {
  resetIds();
  const c = new Circuit(5);
  const bb = c.addPart('breadboard', {}, 0, 0);
  const r1 = c.addPart('resistor', { ohms: 1000 }, 0, 0);
  c.seatPart(r1.id, bb.id, computeLeadMap(FOOTPRINTS.resistor, 'b1'));
  const before = { ...r1.seat.leadMap };
  assert.ok(!c.nudgeSeated(r1.id, -1, 0), 'off the left edge');
  assert.deepEqual(r1.seat.leadMap, before, 'unmoved after refused nudge');
  // Occupied: seat a second part one column right of r1's far lead
  const cols = Object.values(before).map(h => Number(h.slice(1)));
  const blocker = c.addPart('led', { color: 'red' }, 0, 0);
  c.seatPart(blocker.id, bb.id, { anode: `b${Math.max(...cols) + 1}`, cathode: `c${Math.max(...cols) + 1}` });
  assert.ok(!c.nudgeSeated(r1.id, 1, 0), 'blocked by the LED');
  assert.deepEqual(r1.seat.leadMap, before, 'still seated where it was');
  assert.ok(r1.seat, 'refused nudge must not leave the part unseated');
});

test('gutter is a wall: row e cannot nudge into row f', () => {
  resetIds();
  const c = new Circuit(5);
  const bb = c.addPart('breadboard', {}, 0, 0);
  const led = c.addPart('led', { color: 'red' }, 0, 0);
  c.seatPart(led.id, bb.id, { anode: 'e5', cathode: 'e6' });
  assert.ok(!c.nudgeSeated(led.id, 0, 1), 'e -> f crosses the gutter');
  assert.equal(led.seat.leadMap.anode, 'e5');
});
