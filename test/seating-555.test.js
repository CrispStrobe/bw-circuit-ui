/**
 * Seating test for DIP packages that straddle the gutter.
 * The 555 timer is a real DIP-8: pins 1-4 on one side, 5-8 on the other.
 */
import './_setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Circuit, resetIds } from '../src/model/circuit.js';
import { FOOTPRINTS, computeLeadMap } from '../src/model/footprints.js';

test('555 DIP-8 straddles gutter correctly', () => {
  resetIds();
  const c = new Circuit(5.0);
  const bb = c.addPart('breadboard', {}, 500, 300);

  const timer = c.addPart('555', {}, 0, 0);
  // Place with GND (pin 1) at e10 — pins 1-4 on top, 5-8 on bottom
  const leadMap = computeLeadMap(FOOTPRINTS['555'], 'e10');

  // Verify the lead map straddles: top rows (e) and bottom rows (j)
  assert.equal(leadMap.gnd, 'e10');       // pin 1
  assert.equal(leadMap.trigger, 'e11');  // pin 2
  assert.equal(leadMap.output, 'e12');   // pin 3
  assert.equal(leadMap.reset, 'e13');    // pin 4
  assert.equal(leadMap.vcc, 'j10');      // pin 8
  assert.equal(leadMap.discharge, 'j11');// pin 7
  assert.equal(leadMap.threshold, 'j12');// pin 6
  assert.equal(leadMap.control, 'j13'); // pin 5

  assert.ok(c.seatPart(timer.id, bb.id, leadMap), 'should seat successfully');
  assert.equal(timer.seat.boardId, bb.id);
});

test('two 555s cannot overlap on the same board', () => {
  resetIds();
  const c = new Circuit(5.0);
  const bb = c.addPart('breadboard', {}, 500, 300);

  const t1 = c.addPart('555', {}, 0, 0);
  const t2 = c.addPart('555', {}, 0, 0);

  assert.ok(c.seatPart(t1.id, bb.id, computeLeadMap(FOOTPRINTS['555'], 'e10')));
  // Overlapping: same columns → should fail
  assert.equal(c.seatPart(t2.id, bb.id, computeLeadMap(FOOTPRINTS['555'], 'e10')), false);
  // Adjacent: columns 14-17 → should succeed
  assert.ok(c.seatPart(t2.id, bb.id, computeLeadMap(FOOTPRINTS['555'], 'e14')));
});
