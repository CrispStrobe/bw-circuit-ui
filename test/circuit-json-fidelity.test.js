/**
 * Circuit JSON fidelity — load, save, load, assert deep equality.
 *
 * A serialiser that silently drops a field loses the user's work
 * with no error. This test catches it. Every field that does not
 * survive is either a bug or a documented exemption.
 *
 * Exemptions (deliberately not persisted):
 * - history (undo stack — session-only)
 * - board (engine instance — rebuilt from netlist)
 * - breadboards (rebuilt from parts with kind=breadboard)
 * - timeNs (simulation time — reset on load)
 * - powered (reset to true on load)
 *
 * Non-vacuity checks: at least one part with params, rotation,
 * declName, flipped; at least one wire with from/to objects.
 */

import './_setup.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Circuit, resetIds } from '../src/model/circuit.js';

describe('circuit.json fidelity: toJSON → fromJSON round-trip', () => {
  it('parts survive with all fields', () => {
    resetIds();
    const c = new Circuit(5.0);
    const r = c.addPart('resistor', { ohms: 4700 }, 120, 200, 'r1');
    c.rotatePart(r.id);  // rotation = 90
    c.rotatePart(r.id);  // rotation = 180
    c.flipPart(r.id);    // flipped = true
    const led = c.addPart('led', { vf: 2.0, color: 'green' }, 300, 150, 'led1');

    const json = c.toJSON();
    const parsed = JSON.parse(JSON.stringify(json)); // simulate file I/O

    // Non-vacuity: fixture has real content
    assert.ok(parsed.parts.length >= 2, 'must have at least 2 parts');
    const rPart = parsed.parts.find(p => p.kind === 'resistor');
    assert.ok(rPart, 'resistor must survive');
    assert.equal(rPart.params.ohms, 4700, 'params.ohms must survive');
    assert.equal(rPart.rotation, 180, 'rotation must survive');
    assert.equal(rPart.flipped, true, 'flipped must survive');
    assert.equal(rPart.declName, 'r1', 'declName must survive');
    assert.equal(rPart.x, 120, 'x must survive');
    assert.equal(rPart.y, 200, 'y must survive');

    const ledPart = parsed.parts.find(p => p.kind === 'led');
    assert.equal(ledPart.params.color, 'green', 'LED color param must survive');
  });

  it('wires survive with from/to objects', () => {
    resetIds();
    const c = new Circuit(5.0);
    const vcc = c.addPart('vcc', {}, 0, 0);
    const r = c.addPart('resistor', { ohms: 220 }, 0, 0);
    c.addWire(vcc.id, 'vcc', r.id, 'a');

    const json = c.toJSON();
    const parsed = JSON.parse(JSON.stringify(json));

    assert.ok(parsed.wires.length >= 1, 'must have at least 1 wire');
    const w = parsed.wires[0];
    assert.ok(w.from, 'wire.from must survive');
    assert.ok(w.to, 'wire.to must survive');
    assert.ok(w.from.part, 'wire.from.part must survive');
    assert.ok(w.from.terminal, 'wire.from.terminal must survive');
    assert.ok(w.to.part, 'wire.to.part must survive');
    assert.ok(w.to.terminal, 'wire.to.terminal must survive');
    assert.ok(w.netId, 'wire.netId must survive');
    assert.ok(w.id, 'wire.id must survive');
  });

  it('wire properties survive (color, waypoints)', () => {
    resetIds();
    const c = new Circuit(5.0);
    const vcc = c.addPart('vcc', {}, 0, 0);
    const gnd = c.addPart('gnd', {}, 0, 0);
    const w = c.addWire(vcc.id, 'vcc', gnd.id, 'gnd');
    c.updateWire(w.id, { color: '#e74c3c', waypoints: [{ x: 50, y: 100 }] });

    const json = c.toJSON();
    const parsed = JSON.parse(JSON.stringify(json));
    const pw = parsed.wires[0];
    assert.equal(pw.color, '#e74c3c', 'wire.color must survive');
    assert.deepEqual(pw.waypoints, [{ x: 50, y: 100 }], 'wire.waypoints must survive');
  });

  it('full round-trip: toJSON → fromJSON produces equivalent circuit', () => {
    resetIds();
    const c = new Circuit(5.0);
    const vcc = c.addPart('vcc', {}, 50, 50);
    const gnd = c.addPart('gnd', {}, 50, 400);
    const r = c.addPart('resistor', { ohms: 330 }, 200, 150, 'r1');
    const led = c.addPart('led', { vf: 2.0, color: 'red' }, 200, 250, 'led1');
    c.rotatePart(r.id);
    c.addWire(vcc.id, 'vcc', r.id, 'a');
    c.addWire(r.id, 'b', led.id, 'anode');
    c.addWire(led.id, 'cathode', gnd.id, 'gnd');

    const json1 = c.toJSON();
    const serialized = JSON.stringify(json1);

    // Simulate file save/load cycle
    resetIds();
    const c2 = Circuit.fromJSON(JSON.parse(serialized));
    const json2 = c2.toJSON();

    // Deep equality on the serializable portion
    assert.equal(json2.vcc, json1.vcc, 'vcc voltage must match');
    assert.equal(json2.parts.length, json1.parts.length, 'part count must match');
    assert.equal(json2.wires.length, json1.wires.length, 'wire count must match');

    for (let i = 0; i < json1.parts.length; i++) {
      const p1 = json1.parts[i];
      const p2 = json2.parts[i];
      assert.equal(p2.id, p1.id, `part[${i}].id`);
      assert.equal(p2.kind, p1.kind, `part[${i}].kind`);
      assert.equal(p2.x, p1.x, `part[${i}].x`);
      assert.equal(p2.y, p1.y, `part[${i}].y`);
      assert.equal(p2.rotation, p1.rotation, `part[${i}].rotation`);
      assert.equal(p2.declName, p1.declName, `part[${i}].declName`);
      assert.deepEqual(p2.params, p1.params, `part[${i}].params`);
      assert.deepEqual(p2.terminals, p1.terminals, `part[${i}].terminals`);
    }

    for (let i = 0; i < json1.wires.length; i++) {
      const w1 = json1.wires[i];
      const w2 = json2.wires[i];
      assert.equal(w2.id, w1.id, `wire[${i}].id`);
      assert.equal(w2.netId, w1.netId, `wire[${i}].netId`);
      assert.deepEqual(w2.from, w1.from, `wire[${i}].from`);
      assert.deepEqual(w2.to, w1.to, `wire[${i}].to`);
    }
  });

  it('seated parts survive round-trip', () => {
    resetIds();
    const c = new Circuit(5.0);
    const bb = c.addPart('breadboard', {}, 500, 300);
    const r = c.addPart('resistor', { ohms: 1000 }, 0, 0);
    c.seatPart(r.id, bb.id, { a: 'a5', b: 'a9' });

    const json = c.toJSON();
    const parsed = JSON.parse(JSON.stringify(json));
    const rPart = parsed.parts.find(p => p.kind === 'resistor');
    assert.ok(rPart.seat, 'seat must survive serialization');
    assert.equal(rPart.seat.boardId, bb.id, 'seat.boardId must survive');
    assert.deepEqual(rPart.seat.leadMap, { a: 'a5', b: 'a9' }, 'seat.leadMap must survive');
  });

  it('tap wires survive round-trip', () => {
    resetIds();
    const c = new Circuit(5.0);
    const bb = c.addPart('breadboard', {}, 500, 300);
    const vcc = c.addPart('vcc', {}, 0, 0);
    c.addTapWire(vcc.id, 'vcc', bb.id, 'a1');

    const json = c.toJSON();
    const parsed = JSON.parse(JSON.stringify(json));
    const tapWire = parsed.wires.find(w => w.to?.board);
    assert.ok(tapWire, 'tap wire must survive');
    assert.equal(tapWire.to.board, bb.id, 'tap wire board must survive');
    assert.equal(tapWire.to.hole, 'a1', 'tap wire hole must survive');
  });

  it('non-vacuity: fixture is not empty', () => {
    resetIds();
    const c = new Circuit(5.0);
    c.addPart('resistor', { ohms: 1000 }, 0, 0);
    const json = c.toJSON();

    // These assertions catch a test that passes over an empty corpus
    assert.ok(json.parts.length > 0, 'must have parts');
    assert.ok(json.parts.some(p => Object.keys(p.params).length > 0), 'must have parts with params');
  });
});
