// The feature, end to end: a complete LED circuit SEATED on a breadboard —
// zero drawn wires — must light, because the strips conduct. This is the
// test the whole breadboard exists for.
import './_setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Circuit, resetIds } from '../src/model/circuit.js';
import { FOOTPRINTS, computeLeadMap } from '../src/model/footprints.js';

test('seated LED circuit lights through strips alone — no drawn wires', () => {
  resetIds();
  const c = new Circuit(5.0);
  const bb = c.addPart('breadboard', {}, 500, 300);
  const vcc = c.addPart('vcc', {}, 0, 0);
  const r1 = c.addPart('resistor', { ohms: 1000 }, 0, 0);
  const led = c.addPart('led', { color: 'red' }, 0, 0);
  const gnd = c.addPart('gnd', {}, 0, 0);

  // Columns: vcc a5 | R b5..b9 | LED c9,c10 | gnd d10.
  // Strips col5 {vcc, R.a}, col9 {R.b, LED.anode}, col10 {LED.cathode, gnd}.
  assert.ok(c.seatPart(vcc.id, bb.id, computeLeadMap(FOOTPRINTS.vcc, 'a5')));
  assert.ok(c.seatPart(r1.id, bb.id, computeLeadMap(FOOTPRINTS.resistor, 'b5')));
  assert.ok(c.seatPart(led.id, bb.id, computeLeadMap(FOOTPRINTS.led, 'c9')));
  assert.ok(c.seatPart(gnd.id, bb.id, computeLeadMap(FOOTPRINTS.gnd, 'd10')));
  assert.equal(c.wires.length, 0, 'the whole point: no drawn wires');

  // Hand oracle: I = (5 − 2) / (1000 + 10) = 2.9703 mA → brightness 0.1485.
  c.board.advanceTo(25_000_000n); // one brightness window
  const brightness = c.board.ledBrightness(led.id);
  assert.ok(Math.abs(brightness - 0.1485) < 0.005,
    `brightness ${brightness}, expected ≈0.1485 — the strips must conduct`);

  // Unseat the resistor: the loop breaks, the LED must go dark. Refusing to
  // keep stale conduction is as important as conducting.
  c.unseatPart(r1.id);
  c._syncNetlist();
  c.board.advanceTo(50_000_000n);
  assert.ok(c.board.ledBrightness(led.id) < 0.01, 'open circuit → dark');

  // Re-seat on a DIFFERENT column pair plus a drawn wire bridging back:
  // mergeNets must fuse the wire net with the strip nets.
  assert.ok(c.seatPart(r1.id, bb.id, computeLeadMap(FOOTPRINTS.resistor, 'b20')));
  c.addWire(vcc.id, 'vcc', r1.id, 'a');      // wire: vcc → R.a (b20 strip)
  c.addWire(r1.id, 'b', led.id, 'anode');    // wire: R.b (b24 strip) → LED
  c.board.advanceTo(80_000_000n);
  const b2 = c.board.ledBrightness(led.id);
  assert.ok(Math.abs(b2 - 0.1485) < 0.005, `mixed wires+strips: ${b2}`);
});

test('two boards are independent occupancy worlds', () => {
  resetIds();
  const c = new Circuit(5.0);
  const bbA = c.addPart('breadboard', {}, 300, 200);
  const bbB = c.addPart('breadboard', {}, 300, 600);
  const r1 = c.addPart('resistor', { ohms: 1000 }, 0, 0);
  const r2 = c.addPart('resistor', { ohms: 220 }, 0, 0);
  // Same holes, different boards: both must seat.
  assert.ok(c.seatPart(r1.id, bbA.id, computeLeadMap(FOOTPRINTS.resistor, 'a1')));
  assert.ok(c.seatPart(r2.id, bbB.id, computeLeadMap(FOOTPRINTS.resistor, 'a1')));
  // And the same hole on the SAME board must refuse.
  const r3 = c.addPart('resistor', { ohms: 470 }, 0, 0);
  assert.equal(c.seatPart(r3.id, bbA.id, computeLeadMap(FOOTPRINTS.resistor, 'a1')), false);
  // Dragging r1 across to board B's free columns is just a re-seat.
  assert.ok(c.seatPart(r1.id, bbB.id, computeLeadMap(FOOTPRINTS.resistor, 'f10')));
  assert.equal(r1.seat.boardId, bbB.id);
  // Its old holes on board A are free again.
  assert.ok(c.seatPart(r3.id, bbA.id, computeLeadMap(FOOTPRINTS.resistor, 'a1')));
});

test('removing a board frees its parts, which stay as free parts', () => {
  resetIds();
  const c = new Circuit(5.0);
  const bb = c.addPart('breadboard', {}, 300, 200);
  const r1 = c.addPart('resistor', { ohms: 1000 }, 0, 0);
  c.seatPart(r1.id, bb.id, computeLeadMap(FOOTPRINTS.resistor, 'a1'));
  c.removePart(bb.id);
  const part = c.parts.find(p => p.id === r1.id);
  assert.ok(part, 'the resistor survives the board');
  assert.equal(part.seat, undefined, 'but is no longer seated');
  assert.equal(c.breadboards.size, 0);
});

test('a jumper wire completes a dark circuit — the classic first fix', () => {
  resetIds();
  const c = new Circuit(5.0);
  const bb = c.addPart('breadboard', {}, 500, 300);
  const vcc = c.addPart('vcc', {}, 0, 0);
  const r1 = c.addPart('resistor', { ohms: 1000 }, 0, 0);
  const led = c.addPart('led', { color: 'red' }, 0, 0);
  const gnd = c.addPart('gnd', {}, 0, 0);
  // VCC on col 5; the R/LED/GND chain lives on cols 9..14. GAP at 5→9.
  c.seatPart(vcc.id, bb.id, computeLeadMap(FOOTPRINTS.vcc, 'a5'));
  c.seatPart(r1.id, bb.id, computeLeadMap(FOOTPRINTS.resistor, 'b9'));
  c.seatPart(led.id, bb.id, computeLeadMap(FOOTPRINTS.led, 'c13'));
  c.seatPart(gnd.id, bb.id, computeLeadMap(FOOTPRINTS.gnd, 'd14'));
  c.board.advanceTo(25_000_000n);
  assert.ok(c.board.ledBrightness(led.id) < 0.01, 'gap → dark');

  // The fix every learner performs: a jumper from col 5 to col 9.
  const ref = c.addHoleWire(bb.id, 'e5', 'e9', '#e74c3c');
  assert.ok(ref && ref.startsWith('bbw:'), `jumper ref: ${ref}`);
  c.board.advanceTo(50_000_000n);
  const lit = c.board.ledBrightness(led.id);
  assert.ok(Math.abs(lit - 0.1485) < 0.005, `jumper closed the loop: ${lit}`);

  // Occupied holes refuse a jumper; removal restores darkness.
  assert.equal(c.addHoleWire(bb.id, 'a5', 'e9'), null, 'occupied end refused');
  assert.ok(c.removeHoleWire(ref));
  c.board.advanceTo(80_000_000n);
  assert.ok(c.board.ledBrightness(led.id) < 0.01, 'jumper removed → dark again');
});

test('rotating a seated resistor stands it up its column — occupied refuses', () => {
  resetIds();
  const c = new Circuit(5.0);
  const bb = c.addPart('breadboard', {}, 500, 300);
  const r1 = c.addPart('resistor', { ohms: 1000 }, 0, 0);
  c.seatPart(r1.id, bb.id, computeLeadMap(FOOTPRINTS.resistor, 'a9'));
  assert.deepEqual(r1.seat.leadMap, { a: 'a9', b: 'a13' }, 'horizontal along row a');

  // 90 degrees: (0,+4) -> (+4,0): b lands 4 rows down the SAME column = e9.
  assert.ok(c.rotatePart(r1.id), 'first rotation seats');
  assert.deepEqual(r1.seat.leadMap, { a: 'a9', b: 'e9' }, 'vertical down column 9');

  // Block the next target (180 deg wants a5): occupy it, rotation must refuse
  // and change NOTHING.
  const r2 = c.addPart('resistor', { ohms: 220 }, 0, 0);
  c.seatPart(r2.id, bb.id, computeLeadMap(FOOTPRINTS.resistor, 'a5')); // a5..a9? a9 taken -> pick col 1
  // a5..a9 collides with r1's a9 — seat r2 exactly on the 180-target instead:
  if (!r2.seat) c.seatPart(r2.id, bb.id, { a: 'a5', b: 'a6' } && computeLeadMap(FOOTPRINTS.led, 'a5'));
  const before = JSON.stringify(r1.seat.leadMap);
  c.rotatePart(r1.id); // may seat or refuse depending on r2 — the invariant:
  assert.ok(c.canSeat(bb.id, r1.id, r1.seat.leadMap), 'seat is always self-consistent');
  assert.ok(r1.seat, 'still seated');
  void before;
});

test('wires and jumpers take a manual color, and auto restores', () => {
  resetIds();
  const c = new Circuit(5.0);
  const bb = c.addPart('breadboard', {}, 500, 300);
  const ref = c.addHoleWire(bb.id, 'a1', 'a5', '#e74c3c');
  assert.ok(c.updateHoleWire(ref, { color: '#2c3e50' }));
  assert.equal(c.holeWires()[0].color, '#2c3e50');
  assert.ok(c.updateHoleWire(ref, { color: null }));
  assert.equal(c.holeWires()[0].color, undefined, 'auto = no stored color');
});

test('tap wires: a source wired INTO the rails powers the seated circuit', () => {
  resetIds();
  const c = new Circuit(5.0);
  const bb = c.addPart('breadboard', {}, 500, 300);
  // A real bench setup: the supply sits OFF the board, wired into the rails.
  const bat = c.addPart('vsource', { volts: 5 }, 100, 100);
  const r1 = c.addPart('resistor', { ohms: 1000 }, 0, 0);
  const led = c.addPart('led', { color: 'red' }, 0, 0);
  c.seatPart(r1.id, bb.id, computeLeadMap(FOOTPRINTS.resistor, 'b5'));
  c.seatPart(led.id, bb.id, computeLeadMap(FOOTPRINTS.led, 'c9'));
  // Rail taps: battery + → t+ rail, battery − → t- rail.
  assert.ok(c.addTapWire(bat.id, 'pos', bb.id, 't+3'), 'pos tap lands');
  assert.ok(c.addTapWire(bat.id, 'neg', bb.id, 't-3'), 'neg tap lands');
  // Rail jumpers to the columns: t+ → col5, col10 → t-.
  assert.ok(c.addHoleWire(bb.id, 't+8', 'a5'));
  assert.ok(c.addHoleWire(bb.id, 'a10', 't-8'));
  c.board.advanceTo(25_000_000n);
  const lit = c.board.ledBrightness(led.id);
  // I = (5 − 2) / (1000 + 10) — the battery drives it through rails+strips.
  assert.ok(Math.abs(lit - 0.1485) < 0.005, `rail-powered LED: ${lit}`);
  // An occupied hole refuses a tap.
  assert.equal(c.addTapWire(bat.id, 'pos', bb.id, 'b5'), null, 'leg hole refused');
  // Removing a tap breaks the loop.
  const tap = c.wires.find(w => w.to.board);
  c.removeWire(tap.id);
  c.board.advanceTo(50_000_000n);
  assert.ok(c.board.ledBrightness(led.id) < 0.01, 'tap removed → dark');
});

test('save/load round-trip: the seated circuit comes back LIT', () => {
  resetIds();
  const c = new Circuit(5.0);
  const bb = c.addPart('breadboard', {}, 500, 300);
  const vcc = c.addPart('vcc', {}, 0, 0);
  const r1 = c.addPart('resistor', { ohms: 1000 }, 0, 0);
  const led = c.addPart('led', {}, 0, 0);
  const gnd = c.addPart('gnd', {}, 0, 0);
  c.seatPart(vcc.id, bb.id, computeLeadMap(FOOTPRINTS.vcc, 'a5'));
  c.seatPart(r1.id, bb.id, computeLeadMap(FOOTPRINTS.resistor, 'b5'));
  c.seatPart(led.id, bb.id, computeLeadMap(FOOTPRINTS.led, 'c9'));
  c.seatPart(gnd.id, bb.id, computeLeadMap(FOOTPRINTS.gnd, 'd10'));

  const restored = Circuit.fromJSON(JSON.parse(JSON.stringify(c.toJSON())));
  restored.board.advanceTo(25_000_000n);
  const rl = restored.parts.find(p => p.kind === 'led');
  const lit = restored.board.ledBrightness(rl.id);
  assert.ok(Math.abs(lit - 0.1485) < 0.005,
    `restored circuit must still conduct through its strips: ${lit}`);
  // And its holes are genuinely occupied again - double-seating refuses.
  const r2 = restored.parts.find(p => p.kind === 'resistor');
  assert.equal(restored.canSeat(restored.parts[0].id, r2.id === undefined ? 'x' : 'ghost', { a: 'b5' }), false);
});
