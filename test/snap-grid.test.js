/**
 * Tests for snap-to-grid and layout behavior.
 */

import './_setup.js';
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Circuit, resetIds } from '../src/model/circuit.js';

beforeEach(() => resetIds());

const GRID = 20;
function snapToGrid(v) { return Math.round(v / GRID) * GRID; }

describe('snap-to-grid', () => {
  it('snaps to nearest grid point', () => {
    assert.equal(snapToGrid(0), 0);
    assert.equal(snapToGrid(10), 20);    // rounds up
    assert.equal(snapToGrid(9), 0);      // rounds down
    assert.equal(snapToGrid(15), 20);
    assert.equal(snapToGrid(25), 20);
    assert.equal(snapToGrid(30), 40);
    assert.equal(snapToGrid(100), 100);
    assert.equal(snapToGrid(107), 100);
    assert.equal(snapToGrid(113), 120);
  });

  it('movePart with snap produces grid-aligned coordinates', () => {
    const c = new Circuit(5.0);
    const r = c.addPart('resistor', { ohms: 1000 }, 100, 200);

    // Simulate snapped move
    c.movePart(r.id, snapToGrid(117), snapToGrid(203));
    assert.equal(r.x, 120);
    assert.equal(r.y, 200);

    c.movePart(r.id, snapToGrid(155), snapToGrid(268));
    assert.equal(r.x, 160);
    assert.equal(r.y, 260);
  });
});

describe('circuit model stability under rapid mutations', () => {
  it('add 20 parts, wire them in a chain, delete from the middle', () => {
    const c = new Circuit(5.0);
    const vcc = c.addPart('vcc', {}, 0, 0);
    const gnd = c.addPart('gnd', {}, 0, 0);
    const mcu = c.addPart('mcu', { pins: ['P1.0'] }, 0, 0);

    const resistors = [];
    for (let i = 0; i < 20; i++) {
      resistors.push(c.addPart('resistor', { ohms: 1000 }, i * 40, 100));
    }

    // Wire in a chain: VCC → R0 → R1 → ... → R19 → MCU
    c.addWire(vcc.id, 'vcc', resistors[0].id, 'a');
    for (let i = 0; i < 19; i++) {
      c.addWire(resistors[i].id, 'b', resistors[i + 1].id, 'a');
    }
    c.addWire(resistors[19].id, 'b', mcu.id, 'P1.0');

    assert.equal(c.parts.length, 23); // VCC + GND + MCU + 20 resistors
    assert.equal(c.wires.length, 21); // VCC→R0 + 19 R→R + R19→MCU

    // Delete R10 from the middle
    c.removePart(resistors[10].id);
    assert.equal(c.parts.length, 22);
    // Wires to R10 are removed: R9→R10 and R10→R11
    assert.equal(c.wires.length, 19);

    // Circuit should not crash
    c.advanceTo(1_000_000n);
  });

  it('rapid add/remove cycles do not leak state', () => {
    const c = new Circuit(5.0);
    for (let i = 0; i < 50; i++) {
      const r = c.addPart('resistor', { ohms: 1000 }, 0, 0);
      c.removePart(r.id);
    }
    assert.equal(c.parts.length, 0);
    assert.equal(c.wires.length, 0);
  });
});
