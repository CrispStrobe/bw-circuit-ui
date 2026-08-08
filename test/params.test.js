/**
 * Tests for part parameter editing.
 */

import './_setup.js';
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Circuit, resetIds } from '../src/model/circuit.js';

const MS = 1_000_000n;

beforeEach(() => resetIds());

describe('updateParams', () => {
  it('changes resistor value', () => {
    const c = new Circuit(5.0);
    const r = c.addPart('resistor', { ohms: 1000 }, 0, 0);
    assert.equal(r.params.ohms, 1000);

    c.updateParams(r.id, { ohms: 4700 });
    assert.equal(r.params.ohms, 4700);
  });

  it('changes LED color', () => {
    const c = new Circuit(5.0);
    const led = c.addPart('led', { vf: 2.0, color: 'red' }, 0, 0);
    c.updateParams(led.id, { color: 'green' });
    assert.equal(led.params.color, 'green');
    assert.equal(led.params.vf, 2.0); // unchanged
  });

  it('returns false for nonexistent part', () => {
    const c = new Circuit(5.0);
    assert.equal(c.updateParams('nope', { ohms: 100 }), false);
  });

  it('is undoable', () => {
    const c = new Circuit(5.0);
    const r = c.addPart('resistor', { ohms: 1000 }, 0, 0);

    c.updateParams(r.id, { ohms: 4700 });
    assert.equal(r.params.ohms, 4700);

    c.undo();
    const restored = c.parts.find(p => p.kind === 'resistor');
    assert.equal(restored.params.ohms, 1000);
  });

  it('changing resistor value affects LED brightness (engine)', () => {
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

    const b1k = c.ledBrightness(led.id);

    // Increase resistance → lower current → dimmer LED
    c.updateParams(r.id, { ohms: 10000 });
    c.setPin('P1.0', 'quasi', false);
    c.advanceTo(50n * MS);

    const b10k = c.ledBrightness(led.id);
    assert.ok(b10k < b1k,
      `10kΩ brightness (${b10k}) should be less than 1kΩ (${b1k})`);
  });
});
