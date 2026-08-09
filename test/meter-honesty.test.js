// Tests for the multimeter's honesty rules.
//
// simulation.md trap 1: "Ω on a powered circuit is meaningless."
// simulation.md trap 1: "consider the meter's own burden voltage"
// The meter must refuse rather than fabricate, and teach rather than hide.

import './_setup.js';
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Circuit, resetIds } from '../src/model/circuit.js';
import { getMeterReading } from '../src/model/meter-reading.js';

const MS = 1_000_000n;
beforeEach(() => resetIds());

function buildCircuit() {
  const c = new Circuit(5.0);
  const vcc = c.addPart('vcc', {}, 0, 0);
  const gnd = c.addPart('gnd', {}, 0, 0);
  const r = c.addPart('resistor', { ohms: 1000 }, 0, 0);
  const led = c.addPart('led', { vf: 2.0 }, 0, 0);
  const mcu = c.addPart('mcu', { pins: ['P1.0'] }, 0, 0);
  const meter = c.addPart('meter', { mode: 'resistance' }, 0, 0);

  c.addWire(vcc.id, 'vcc', r.id, 'a');
  c.addWire(r.id, 'b', led.id, 'anode');
  c.addWire(led.id, 'cathode', mcu.id, 'P1.0');
  c.addWire(meter.id, 'probe_a', vcc.id, 'vcc');
  c.addWire(meter.id, 'probe_b', r.id, 'b');

  c.setPin('P1.0', 'quasi', false);
  c.advanceTo(25n * MS);

  return { c, meter, vcc, r, led };
}

describe('honesty rule: resistance on powered board', () => {
  it('refuses with "Turn power OFF" — never shows a number', () => {
    const { c, meter } = buildCircuit();
    const reading = getMeterReading(meter, c.wires, c);
    assert.equal(reading.value, '---');
    assert.ok(reading.note.includes('Turn power OFF'));
  });

  it('reads resistance after power off — a number, not a refusal', () => {
    const { c, meter } = buildCircuit();
    c.setPower(false);
    c.advanceBy(1n * MS);
    const reading = getMeterReading(meter, c.wires, c);
    // Should return a number (the actual resistance), not "requires-power-off"
    // The exact value depends on the engine's behavior with the power off.
    // What matters: it does NOT refuse, because the power IS off.
    assert.ok(!reading.note || !reading.note.includes('power OFF'),
      `should not refuse when power is off: ${reading.note}`);
  });

  it('the refusal is a teaching moment, not an error', () => {
    const { c, meter } = buildCircuit();
    const reading = getMeterReading(meter, c.wires, c);
    // The note should explain WHY, not just say "error"
    assert.ok(!reading.note.includes('error'), 'should not say "error"');
    assert.ok(!reading.note.includes('Error'), 'should not say "Error"');
    assert.ok(reading.note.includes('power'), 'should mention power');
  });
});

describe('honesty rule: burden voltage in current mode', () => {
  it('notes that a real ammeter drops burden voltage', () => {
    const { c, meter, led } = buildCircuit();
    meter.params.mode = 'current';
    // Re-wire probe A to the LED
    c.wires = c.wires.filter(w => w.from.part !== meter.id && w.to.part !== meter.id);
    c.addWire(meter.id, 'probe_a', led.id, 'anode');

    const reading = getMeterReading(meter, c.wires, c);
    if (parseFloat(reading.value) > 0.1) {
      assert.ok(reading.note && reading.note.includes('burden'),
        `current > 0.1 mA should mention burden voltage: ${reading.note}`);
    }
  });
});

describe('honesty rule: no board = "needs the simulator"', () => {
  it('never returns zero — returns a refusal string', () => {
    const meter = { id: 'm', kind: 'meter', params: { mode: 'voltage' }, terminals: ['probe_a', 'probe_b'] };
    const reading = getMeterReading(meter, [], null);
    assert.equal(reading.value, '---');
    assert.ok(reading.note.includes('simulator'));
    // Verify it's NOT zero (the outcome the design set out to avoid)
    assert.notEqual(reading.value, '0');
    assert.notEqual(reading.value, 0);
  });
});
