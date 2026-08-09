/**
 * Tests for undo/redo history.
 */

import './_setup.js';
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Circuit, resetIds } from '../src/model/circuit.js';
import { History } from '../src/model/history.js';

const MS = 1_000_000n;

beforeEach(() => resetIds());

describe('History class', () => {
  it('save + undo returns previous state', () => {
    const h = new History();
    h.save({ parts: [{ id: 'a' }], wires: [] });
    h.save({ parts: [{ id: 'a' }, { id: 'b' }], wires: [] });

    const prev = h.undo();
    assert.equal(prev.parts.length, 1);
    assert.equal(prev.parts[0].id, 'a');
  });

  it('undo at bottom returns null', () => {
    const h = new History();
    h.save({ parts: [], wires: [] });
    assert.equal(h.undo(), null);
  });

  it('redo after undo returns forward state', () => {
    const h = new History();
    h.save({ parts: [{ id: 'a' }], wires: [] });
    h.save({ parts: [{ id: 'a' }, { id: 'b' }], wires: [] });

    h.undo();
    const fwd = h.redo();
    assert.equal(fwd.parts.length, 2);
  });

  it('redo at top returns null', () => {
    const h = new History();
    h.save({ parts: [], wires: [] });
    assert.equal(h.redo(), null);
  });

  it('save after undo truncates redo stack', () => {
    const h = new History();
    h.save({ parts: [{ id: 'a' }], wires: [] });
    h.save({ parts: [{ id: 'b' }], wires: [] });
    h.save({ parts: [{ id: 'c' }], wires: [] });

    h.undo(); // → b
    h.undo(); // → a
    h.save({ parts: [{ id: 'd' }], wires: [] }); // new branch from a

    assert.equal(h.canRedo, false);
    assert.equal(h.length, 2); // a, d
  });

  it('preserves engineSnap through undo/redo', () => {
    const h = new History();
    const snap1 = { timeNs: 100n, powered: true };
    const snap2 = { timeNs: 200n, powered: false };
    h.save({ parts: [{ id: 'a' }], wires: [], engineSnap: snap1 });
    h.save({ parts: [{ id: 'b' }], wires: [], engineSnap: snap2 });

    const prev = h.undo();
    assert.equal(prev.engineSnap, snap1);

    const fwd = h.redo();
    assert.equal(fwd.engineSnap, snap2);
  });

  it('duplicate saves are ignored', () => {
    const h = new History();
    h.save({ parts: [{ id: 'a' }], wires: [] });
    h.save({ parts: [{ id: 'a' }], wires: [] });
    assert.equal(h.length, 1);
  });

  it('canUndo / canRedo reflect state', () => {
    const h = new History();
    assert.equal(h.canUndo, false);
    assert.equal(h.canRedo, false);

    h.save({ parts: [], wires: [] });
    assert.equal(h.canUndo, false); // only one state
    assert.equal(h.canRedo, false);

    h.save({ parts: [{ id: 'a' }], wires: [] });
    assert.equal(h.canUndo, true);
    assert.equal(h.canRedo, false);

    h.undo();
    assert.equal(h.canUndo, false);
    assert.equal(h.canRedo, true);
  });
});

describe('Circuit undo/redo integration', () => {
  it('undo restores deleted part', () => {
    const c = new Circuit(5.0);
    const vcc = c.addPart('vcc', {}, 0, 0);
    const gnd = c.addPart('gnd', {}, 0, 0);
    const r = c.addPart('resistor', { ohms: 1000 }, 100, 200);

    assert.equal(c.parts.length, 3);

    c.removePart(r.id);
    assert.equal(c.parts.length, 2);

    c.undo();
    assert.equal(c.parts.length, 3);
    const restored = c.parts.find(p => p.kind === 'resistor');
    assert.ok(restored, 'resistor should be restored');
    assert.equal(restored.params.ohms, 1000);
  });

  it('undo restores deleted wire', () => {
    const c = new Circuit(5.0);
    const vcc = c.addPart('vcc', {}, 0, 0);
    const gnd = c.addPart('gnd', {}, 0, 0);
    const r = c.addPart('resistor', { ohms: 1000 }, 0, 0);
    const mcu = c.addPart('mcu', { pins: ['P1.0'] }, 0, 0);

    const w = c.addWire(vcc.id, 'vcc', r.id, 'a');
    assert.equal(c.wires.length, 1);

    c.removeWire(w.id);
    assert.equal(c.wires.length, 0);

    c.undo();
    assert.equal(c.wires.length, 1);
  });

  it('redo re-applies after undo', () => {
    const c = new Circuit(5.0);
    c.addPart('vcc', {}, 0, 0);
    c.addPart('gnd', {}, 0, 0);
    const r = c.addPart('resistor', { ohms: 1000 }, 0, 0);

    c.removePart(r.id);
    assert.equal(c.parts.length, 2);

    c.undo();
    assert.equal(c.parts.length, 3);

    c.redo();
    assert.equal(c.parts.length, 2);
  });

  it('undo preserves engine state', () => {
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
    c.advanceTo(25n * MS);
    const bBefore = c.ledBrightness(led.id);
    assert.ok(bBefore > 0.10, `LED should be on: ${bBefore}`);

    // Delete a wire, LED goes off
    const w = c.wires.find(w2 => w2.from.part === r.id || w2.to.part === r.id);
    c.removeWire(w.id);

    // Undo → LED should work again after re-driving
    c.undo();
    c.setPin('P1.0', 'quasi', false);
    c.advanceTo(50n * MS);
    const bAfter = c.ledBrightness(led.id);
    assert.ok(bAfter > 0.10, `LED should be on after undo: ${bAfter}`);
  });

  it('multiple undos walk back through history', () => {
    const c = new Circuit(5.0);
    c.addPart('vcc', {}, 0, 0);       // history: 1 part
    c.addPart('gnd', {}, 0, 0);       // 2 parts
    c.addPart('resistor', {}, 0, 0);  // 3 parts

    assert.equal(c.parts.length, 3);

    c.undo(); // → 2 parts
    assert.equal(c.parts.length, 2);

    c.undo(); // → 1 part
    assert.equal(c.parts.length, 1);

    c.redo(); // → 2 parts
    assert.equal(c.parts.length, 2);

    c.redo(); // → 3 parts
    assert.equal(c.parts.length, 3);
  });
});
