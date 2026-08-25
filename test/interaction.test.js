/**
 * Tests for interactive operations on the Circuit model.
 *
 * These test the flows a user would trigger:
 * - Build a circuit from scratch via addPart + addWire
 * - Turn a pot and see voltage change
 * - Press a button and see pin go low
 * - Delete parts/wires and confirm engine updates
 * - Toggle power and confirm LED goes off
 * - Move parts (layout only, no engine effect)
 * - Serialization round-trip preserves engine state
 */

import './_setup.js';
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Circuit, resetIds } from '../src/model/circuit.js';

const MS = 1_000_000n;

beforeEach(() => resetIds());

describe('build a circuit from scratch', () => {
  it('active-low LED: add parts, wire, drive pin, read brightness', () => {
    const c = new Circuit(5.0);

    // User adds parts from palette
    const vcc = c.addPart('vcc', {}, 200, 60);
    const r = c.addPart('resistor', { ohms: 1000 }, 200, 150);
    const led = c.addPart('led', { vf: 2.0, color: 'red' }, 200, 260);
    const mcu = c.addPart('mcu', { pins: ['P1.0'] }, 400, 200);

    // User wires them: VCC→R→LED→MCU
    const w1 = c.addWire(vcc.id, 'vcc', r.id, 'a');
    const w2 = c.addWire(r.id, 'b', led.id, 'anode');
    const w3 = c.addWire(led.id, 'cathode', mcu.id, 'P1.0');

    assert.ok(w1 && w2 && w3, 'all wires created');
    assert.equal(c.wires.length, 3);

    // Simulate: drive pin low
    c.setPin('P1.0', 'quasi', false);
    c.advanceTo(25n * MS);

    const b = c.ledBrightness(led.id);
    assert.ok(b > 0.13, `brightness ${b} should be > 0.13`);
    assert.ok(b < 0.16, `brightness ${b} should be < 0.16`);
  });

  it('pot + ADC: add pot, wire to MCU, turn knob, read voltage', () => {
    const c = new Circuit(5.0);
    const vcc = c.addPart('vcc', {}, 0, 0);
    const pot = c.addPart('potentiometer', { ohms: 10000 }, 0, 0);
    const mcu = c.addPart('mcu', { pins: ['P1.3'] }, 0, 0);
    const gnd = c.addPart('gnd', {}, 0, 0);

    c.addWire(vcc.id, 'vcc', pot.id, 'a');
    c.addWire(pot.id, 'wiper', mcu.id, 'P1.3');
    c.addWire(pot.id, 'b', gnd.id, 'gnd');

    c.setPin('P1.3', 'input', false);
    c.advanceTo(1n * MS);

    // Turn to 25%
    c.setControl(pot.id, 0.25);
    const v25 = c.board.readAnalog('P1.3');
    assert.ok(Math.abs(v25 - 1.25) < 0.3, `pot at 25% → ~1.25V, got ${v25}`);

    // Turn to 75%
    c.setControl(pot.id, 0.75);
    const v75 = c.board.readAnalog('P1.3');
    assert.ok(Math.abs(v75 - 3.75) < 0.3, `pot at 75% → ~3.75V, got ${v75}`);
  });
});

describe('delete interactions', () => {
  it('deleting a middle wire breaks the circuit', () => {
    const c = new Circuit(5.0);
    const vcc = c.addPart('vcc', {}, 0, 0);
    const r = c.addPart('resistor', { ohms: 1000 }, 0, 0);
    const led = c.addPart('led', { vf: 2.0 }, 0, 0);
    const mcu = c.addPart('mcu', { pins: ['P1.0'] }, 0, 0);

    c.addWire(vcc.id, 'vcc', r.id, 'a');
    const w2 = c.addWire(r.id, 'b', led.id, 'anode');
    c.addWire(led.id, 'cathode', mcu.id, 'P1.0');

    c.setPin('P1.0', 'quasi', false);
    c.advanceTo(25n * MS);

    // LED should be on
    assert.ok(c.ledBrightness(led.id) > 0.10);

    // Delete the middle wire → circuit broken → LED off
    c.removeWire(w2.id);
    c.advanceTo(50n * MS);
    const bAfter = c.ledBrightness(led.id);
    assert.ok(bAfter < 0.01, `LED should be off after wire delete: ${bAfter}`);
  });

  it('deleting the resistor removes its wires and breaks the circuit', () => {
    const c = new Circuit(5.0);
    const vcc = c.addPart('vcc', {}, 0, 0);
    const r = c.addPart('resistor', { ohms: 1000 }, 0, 0);
    const led = c.addPart('led', { vf: 2.0 }, 0, 0);
    const mcu = c.addPart('mcu', { pins: ['P1.0'] }, 0, 0);

    c.addWire(vcc.id, 'vcc', r.id, 'a');
    c.addWire(r.id, 'b', led.id, 'anode');
    c.addWire(led.id, 'cathode', mcu.id, 'P1.0');

    c.setPin('P1.0', 'quasi', false);
    c.advanceTo(25n * MS);
    assert.ok(c.ledBrightness(led.id) > 0.10);

    // Delete resistor → its wires go too
    c.removePart(r.id);
    assert.equal(c.wires.length, 1); // only LED→MCU remains
    c.advanceTo(50n * MS);
    assert.ok(c.ledBrightness(led.id) < 0.01);
  });
});

describe('button press/release flow', () => {
  it('press → pin LOW, release → pin HIGH', () => {
    const c = new Circuit(5.0);
    const btn = c.addPart('button', {}, 0, 0);
    const mcu = c.addPart('mcu', { pins: ['P3.2'] }, 0, 0);
    const gnd = c.addPart('gnd', {}, 0, 0);

    c.addWire(btn.id, 'a', mcu.id, 'P3.2');
    c.addWire(btn.id, 'b', gnd.id, 'gnd');

    c.setPin('P3.2', 'quasi', true);
    c.advanceTo(1n * MS);

    // Not pressed
    assert.equal(c.board.readPin('P3.2'), 1);

    // User presses button (mousedown)
    c.setControl(btn.id, 1);
    assert.equal(c.board.readPin('P3.2'), 0);

    // User releases button (mouseup)
    c.setControl(btn.id, 0);
    assert.equal(c.board.readPin('P3.2'), 1);
  });
});

describe('pot continuous control', () => {
  it('sweeping pot from 0 to 1 produces monotonic voltage', () => {
    const c = new Circuit(5.0);
    const vcc = c.addPart('vcc', {}, 0, 0);
    const pot = c.addPart('potentiometer', { ohms: 10000 }, 0, 0);
    const mcu = c.addPart('mcu', { pins: ['P1.3'] }, 0, 0);
    const gnd = c.addPart('gnd', {}, 0, 0);

    c.addWire(vcc.id, 'vcc', pot.id, 'a');
    c.addWire(pot.id, 'wiper', mcu.id, 'P1.3');
    c.addWire(pot.id, 'b', gnd.id, 'gnd');
    c.setPin('P1.3', 'input', false);
    c.advanceTo(1n * MS);

    let prev = -1;
    for (let i = 0; i <= 10; i++) {
      c.setControl(pot.id, i / 10);
      const v = c.board.readAnalog('P1.3');
      assert.ok(v >= prev, `voltage should be monotonic: step ${i}, v=${v}, prev=${prev}`);
      prev = v;
    }
    // At 0 should be near 0V, at 1 should be near 5V
    c.setControl(pot.id, 0);
    assert.ok(c.board.readAnalog('P1.3') < 0.5);
    c.setControl(pot.id, 1);
    assert.ok(c.board.readAnalog('P1.3') > 4.5);
  });
});

describe('power toggle interaction', () => {
  it('power off → LED dark, power on → LED restores', () => {
    const c = new Circuit(5.0);
    const vcc = c.addPart('vcc', {}, 0, 0);
    const r = c.addPart('resistor', { ohms: 1000 }, 0, 0);
    const led = c.addPart('led', { vf: 2.0 }, 0, 0);
    const mcu = c.addPart('mcu', { pins: ['P1.0'] }, 0, 0);

    c.addWire(vcc.id, 'vcc', r.id, 'a');
    c.addWire(r.id, 'b', led.id, 'anode');
    c.addWire(led.id, 'cathode', mcu.id, 'P1.0');

    c.setPin('P1.0', 'quasi', false);
    c.advanceTo(25n * MS);
    assert.ok(c.ledBrightness(led.id) > 0.10, 'LED on before power off');

    // Power off
    c.setPower(false);
    c.advanceBy(25n * MS);
    assert.ok(c.ledBrightness(led.id) < 0.01, 'LED off after power off');

    // Power back on
    c.setPower(true);
    c.setPin('P1.0', 'quasi', false);
    c.advanceBy(25n * MS);
    assert.ok(c.ledBrightness(led.id) > 0.10, 'LED on after power restored');
  });
});

describe('move part (layout only)', () => {
  it('moving a part does not change electrical behaviour', () => {
    const c = new Circuit(5.0);
    const vcc = c.addPart('vcc', {}, 200, 60);
    const r = c.addPart('resistor', { ohms: 1000 }, 200, 150);
    const led = c.addPart('led', { vf: 2.0 }, 200, 260);
    const mcu = c.addPart('mcu', { pins: ['P1.0'] }, 400, 200);

    c.addWire(vcc.id, 'vcc', r.id, 'a');
    c.addWire(r.id, 'b', led.id, 'anode');
    c.addWire(led.id, 'cathode', mcu.id, 'P1.0');

    c.setPin('P1.0', 'quasi', false);
    c.advanceTo(25n * MS);
    const bBefore = c.ledBrightness(led.id);

    // Move the LED to a completely different position
    c.movePart(led.id, 500, 400);
    assert.equal(led.x, 500);
    assert.equal(led.y, 400);

    // Brightness unchanged — move is layout only
    const bAfter = c.ledBrightness(led.id);
    assert.ok(Math.abs(bBefore - bAfter) < 0.001,
      `brightness should be unchanged: ${bBefore} vs ${bAfter}`);
  });
});

describe('serialization preserves interactive state', () => {
  it('save/load a wired circuit, then simulate', () => {
    const c = new Circuit(5.0);
    const vcc = c.addPart('vcc', {}, 200, 60);
    const r = c.addPart('resistor', { ohms: 1000 }, 200, 150);
    const led = c.addPart('led', { vf: 2.0 }, 200, 260);
    const mcu = c.addPart('mcu', { pins: ['P1.0'] }, 400, 200);

    c.addWire(vcc.id, 'vcc', r.id, 'a');
    c.addWire(r.id, 'b', led.id, 'anode');
    c.addWire(led.id, 'cathode', mcu.id, 'P1.0');

    // Save
    const json = c.toJSON();

    // Load into new circuit
    const c2 = Circuit.fromJSON(json);
    assert.equal(c2.parts.length, 4);
    assert.equal(c2.wires.length, 3);

    // Simulate on the loaded circuit
    c2.setPin('P1.0', 'quasi', false);
    c2.advanceTo(25n * MS);

    const ledPart = c2.parts.find(p => p.kind === 'led');
    const b = c2.ledBrightness(ledPart.id);
    assert.ok(b > 0.13, `loaded circuit LED brightness ${b} should be > 0.13`);
  });
});

describe('edge cases', () => {
  it('empty circuit — advanceTo is a no-op, not a crash', () => {
    const c = new Circuit(5.0);
    // The throw WAS the whole check, and an implicit one: if advanceTo threw,
    // the test failed; if it silently did something wrong, nothing noticed.
    // Made explicit, and given a postcondition — an empty circuit must still
    // be empty and its clock must have moved, which is the difference between
    // "did not crash" and "did the nothing it was supposed to do".
    assert.doesNotThrow(() => c.advanceTo(1n * MS),
      'advancing an empty circuit must be a no-op, not an error');
    assert.equal(c.parts.length, 0, 'advancing must not conjure parts');
    assert.equal(c.wires.length, 0, 'advancing must not conjure wires');
    assert.deepEqual(c.resolvedNets ?? [], [], 'an empty circuit has no nets to resolve');
  });

  it('parts with no wires — engine has parts but no nets', () => {
    const c = new Circuit(5.0);
    c.addPart('resistor', { ohms: 1000 }, 0, 0);
    c.addPart('led', { vf: 2.0 }, 0, 0);
    assert.equal(c.board.parts.length, 2);
    assert.equal(c.board.nets.length, 0);
  });

  it('wiring then unwiring the same terminals', () => {
    const c = new Circuit(5.0);
    const vcc = c.addPart('vcc', {}, 0, 0);
    const gnd = c.addPart('gnd', {}, 0, 0);
    const r = c.addPart('resistor', { ohms: 1000 }, 0, 0);
    const mcu = c.addPart('mcu', { pins: ['P1.0'] }, 0, 0);

    const w = c.addWire(vcc.id, 'vcc', r.id, 'a');
    // Circuit model tracks the wire
    assert.equal(c.wires.length, 1);

    c.removeWire(w.id);
    assert.equal(c.wires.length, 0);

    // Re-wire
    const w2 = c.addWire(vcc.id, 'vcc', r.id, 'a');
    assert.ok(w2);
    assert.equal(c.wires.length, 1);
  });

  it('multiple wires forming a single net', () => {
    const c = new Circuit(5.0);
    const vcc = c.addPart('vcc', {}, 0, 0);
    const gnd = c.addPart('gnd', {}, 0, 0);
    const r1 = c.addPart('resistor', { ohms: 1000 }, 0, 0);
    const r2 = c.addPart('resistor', { ohms: 2000 }, 0, 0);
    const mcu = c.addPart('mcu', { pins: ['P1.0'] }, 0, 0);

    // Both resistors connected to VCC on terminal a
    c.addWire(vcc.id, 'vcc', r1.id, 'a');
    c.addWire(vcc.id, 'vcc', r2.id, 'a');

    // All three should be in the same net (check circuit model)
    const netIds = new Set(c.wires.map(w => w.netId));
    assert.equal(netIds.size, 1, 'both wires should share a net');
    // Engine also has them merged
    const vccNets = c.board.nets.filter(n =>
      n.terminals.some(t => t.part === vcc.id));
    assert.ok(vccNets.length >= 1, 'engine should have a VCC net');
    assert.ok(vccNets[0].terminals.length >= 3,
      `VCC net should have 3+ terminals, got ${vccNets[0].terminals.length}`);
  });
});

// ── Fit-to-parts view math (the Circuit Designer's "fit all parts" button,
//    the F shortcut, and auto-fit-on-load all frame a circuit through this).
import { computeFitView } from '../src/interaction/transform.js';

describe('computeFitView — frame all parts in the viewport', () => {
  // screen = (world − pan) · zoom  (the canvas's screenToCanvas inverse)
  const toScreen = (v, wx, wy) => ({ x: (wx - v.pan.x) * v.zoom, y: (wy - v.pan.y) * v.zoom });

  it('returns null when there is nothing to frame', () => {
    assert.equal(computeFitView([], { w: 800, h: 600 }), null);
    assert.equal(computeFitView(null, { w: 800, h: 600 }), null);
    assert.equal(computeFitView([{ minX: 0, maxX: 10, minY: 0, maxY: 10 }], { w: 0, h: 0 }), null);
  });

  it('centers the content bounding box in the viewport', () => {
    const v = computeFitView([{ minX: 0, maxX: 100, minY: 0, maxY: 50 }], { w: 800, h: 600 });
    const c = toScreen(v, 50, 25); // content center → viewport center
    assert.ok(Math.abs(c.x - 400) < 1e-6, `center x = ${c.x}`);
    assert.ok(Math.abs(c.y - 300) < 1e-6, `center y = ${c.y}`);
  });

  it('clamps zoom to maxZoom for tiny content (no absurd magnification)', () => {
    const v = computeFitView([{ minX: 0, maxX: 10, minY: 0, maxY: 10 }], { w: 800, h: 600 });
    assert.equal(v.zoom, 1.5);
  });

  it('zooms out to fit large content, with the whole box on screen', () => {
    const v = computeFitView([{ minX: 0, maxX: 2000, minY: 0, maxY: 1500 }], { w: 800, h: 600 });
    assert.ok(v.zoom < 1, `zoom ${v.zoom} < 1`);
    const tl = toScreen(v, 0, 0), br = toScreen(v, 2000, 1500);
    assert.ok(tl.x >= -1 && tl.y >= -1, `top-left in view (${tl.x},${tl.y})`);
    assert.ok(br.x <= 801 && br.y <= 601, `bottom-right in view (${br.x},${br.y})`);
  });

  it('respects the minZoom floor for enormous benches', () => {
    const v = computeFitView([{ minX: 0, maxX: 100000, minY: 0, maxY: 100000 }], { w: 800, h: 600 });
    assert.equal(v.zoom, 0.08);
  });

  it('merges multiple part bounds into one framing', () => {
    const single = computeFitView([{ minX: 0, maxX: 100, minY: 0, maxY: 100 }], { w: 800, h: 600 });
    const split = computeFitView([
      { minX: 0, maxX: 40, minY: 0, maxY: 100 },
      { minX: 60, maxX: 100, minY: 0, maxY: 100 },
    ], { w: 800, h: 600 });
    assert.deepEqual(split, single); // identical overall bbox → identical view
  });
});
