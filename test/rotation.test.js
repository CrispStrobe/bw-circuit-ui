/**
 * Tests for part rotation.
 */

import './_setup.js';
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Circuit, resetIds } from '../src/model/circuit.js';

beforeEach(() => resetIds());

describe('rotatePart', () => {
  it('rotates 0 → 90 → 180 → 270 → 0', () => {
    const c = new Circuit(5.0);
    const r = c.addPart('resistor', { ohms: 1000 }, 100, 100);

    assert.equal(r.rotation, 0);
    c.rotatePart(r.id);
    assert.equal(r.rotation, 90);
    c.rotatePart(r.id);
    assert.equal(r.rotation, 180);
    c.rotatePart(r.id);
    assert.equal(r.rotation, 270);
    c.rotatePart(r.id);
    assert.equal(r.rotation, 0);
  });

  it('returns false for nonexistent part', () => {
    const c = new Circuit(5.0);
    assert.equal(c.rotatePart('nope'), false);
  });

  it('is undoable', () => {
    const c = new Circuit(5.0);
    const r = c.addPart('resistor', { ohms: 1000 }, 100, 100);

    c.rotatePart(r.id);
    assert.equal(r.rotation, 90);

    c.undo();
    const restored = c.parts.find(p => p.kind === 'resistor');
    assert.equal(restored.rotation, 0);
  });

  it('rotation does not affect electrical behavior (engine)', () => {
    const c = new Circuit(5.0);
    const vcc = c.addPart('vcc', {}, 0, 0);
    const gnd = c.addPart('gnd', {}, 0, 0);
    const r = c.addPart('resistor', { ohms: 1000 }, 0, 0);
    const led = c.addPart('led', { vf: 2.0 }, 0, 0);
    const mcu = c.addPart('mcu', { pins: ['P1.0'] }, 0, 0);

    c.addWire(vcc.id, 'vcc', r.id, 'a');
    c.addWire(r.id, 'b', led.id, 'anode');
    c.addWire(led.id, 'cathode', mcu.id, 'P1.0');

    c.setPin('P1.0', 'quasi', false);
    c.advanceTo(25_000_000n);
    const bBefore = c.ledBrightness(led.id);

    // Rotate the resistor — should not change brightness
    c.rotatePart(r.id);
    const bAfter = c.ledBrightness(led.id);
    assert.ok(Math.abs(bBefore - bAfter) < 0.001,
      `rotation should not affect brightness: ${bBefore} vs ${bAfter}`);
  });

  it('serialization preserves rotation', () => {
    const c = new Circuit(5.0);
    const r = c.addPart('resistor', { ohms: 1000 }, 100, 100);
    c.rotatePart(r.id);
    c.rotatePart(r.id);
    assert.equal(r.rotation, 180);

    const json = c.toJSON();
    const c2 = Circuit.fromJSON(json);
    const restored = c2.parts.find(p => p.kind === 'resistor');
    assert.equal(restored.rotation, 180);
  });
});
