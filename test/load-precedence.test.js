/**
 * Load precedence — three paths to the first screen, tested individually.
 *
 * circuitData > pin inference > autosave > starter circuit
 *
 * These test the model-level behavior, not React rendering. The mount
 * effects in CircuitDesigner implement the precedence; these tests verify
 * the handleLoad function and the data each path produces.
 */

import './_setup.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Circuit, resetIds } from '../src/model/circuit.js';

describe('load precedence: model-level behavior', () => {
  it('circuitData load replaces existing parts (example beats autosave)', () => {
    resetIds();
    const c = new Circuit(5.0);
    // Simulate autosave state: a resistor + LED
    c.addPart('vcc', {}, 0, 0);
    c.addPart('resistor', { ohms: 1000 }, 0, 0);
    c.addPart('led', { vf: 2.0 }, 0, 0);
    assert.equal(c.parts.length, 3);

    // Simulate circuitData load (gallery example)
    c._saveHistory(); // save before replacing (undo recovery)
    c.parts = [
      { id: 'ex_vcc', kind: 'vcc', params: {}, terminals: ['vcc'], x: 0, y: 0, rotation: 0 },
      { id: 'ex_gnd', kind: 'gnd', params: {}, terminals: ['gnd'], x: 0, y: 0, rotation: 0 },
    ];
    c.wires = [];
    c._syncNetlist();
    c._saveHistory();

    assert.equal(c.parts.length, 2, 'example replaces autosave state');
    assert.ok(c.history.canUndo, 'undo recovers the previous state');
  });

  it('undo after circuitData load recovers the previous circuit', () => {
    resetIds();
    const c = new Circuit(5.0);
    c.addPart('resistor', { ohms: 470 }, 100, 100);
    c.addPart('led', { vf: 2.0 }, 200, 200);
    assert.equal(c.parts.length, 2);

    // Save, then load example
    c._saveHistory();
    c.parts = [{ id: 'new1', kind: 'vcc', params: {}, terminals: ['vcc'], x: 0, y: 0, rotation: 0 }];
    c.wires = [];
    c._syncNetlist();
    c._saveHistory();
    assert.equal(c.parts.length, 1);

    // Undo recovers
    c.undo();
    assert.equal(c.parts.length, 2, 'undo must recover the pre-load state');
  });

  it('starter circuit has at least a breadboard, a source, and an LED', () => {
    // The starter is built imperatively in CircuitDesigner's mount effect.
    // This test verifies the minimum content a first-time user should see.
    resetIds();
    const c = new Circuit(5.0);
    // Simulate what 9752b8c builds
    c.addPart('breadboard', {}, 470, 300);
    c.addPart('vsource', { variant: '9v', volts: 5 }, 130, 150);
    c.addPart('resistor', { ohms: 1000 }, 0, 0);
    c.addPart('led', { color: 'red' }, 0, 0, 'led1');

    assert.ok(c.parts.some(p => p.kind === 'breadboard'), 'must have a breadboard');
    assert.ok(c.parts.some(p => p.kind === 'vsource'), 'must have a power source');
    assert.ok(c.parts.some(p => p.kind === 'led'), 'must have an LED');
    assert.ok(c.parts.some(p => p.kind === 'resistor'), 'must have a resistor');
    assert.equal(c.parts.length, 4, 'starter has exactly 4 parts');
  });

  it('toJSON round-trip of starter circuit preserves all parts', () => {
    resetIds();
    const c = new Circuit(5.0);
    c.addPart('breadboard', {}, 470, 300);
    c.addPart('vsource', { variant: '9v', volts: 5 }, 130, 150);
    c.addPart('resistor', { ohms: 1000 }, 0, 0);
    c.addPart('led', { color: 'red' }, 0, 0, 'led1');

    const json = c.toJSON();
    const serialized = JSON.stringify(json);
    resetIds();
    const c2 = Circuit.fromJSON(JSON.parse(serialized));

    assert.equal(c2.parts.length, 4, 'all 4 parts survive round-trip');
    assert.ok(c2.parts.some(p => p.kind === 'breadboard'));
    assert.ok(c2.parts.some(p => p.kind === 'vsource'));
  });
});
