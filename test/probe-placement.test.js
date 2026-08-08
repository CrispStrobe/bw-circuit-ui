/**
 * Tests for multimeter probe placement flow.
 *
 * Verifies that placing probes on different nets produces correct
 * readings from the engine.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Circuit, resetIds } from '../src/model/circuit.js';
import { createMeterState, readMeter } from '../src/model/multimeter.js';

const MS = 1_000_000n;

beforeEach(() => resetIds());

function buildCircuitWithNets() {
  const c = new Circuit(5.0);
  const vcc = c.addPart('vcc', {}, 0, 0);
  const r = c.addPart('resistor', { ohms: 1000 }, 0, 0);
  const led = c.addPart('led', { vf: 2.0 }, 0, 0);
  const mcu = c.addPart('mcu', { pins: ['P1.0'] }, 0, 0);
  const gnd = c.addPart('gnd', {}, 0, 0);

  const w1 = c.addWire(vcc.id, 'vcc', r.id, 'a');         // net_vcc
  const w2 = c.addWire(r.id, 'b', led.id, 'anode');        // net_r_led
  const w3 = c.addWire(led.id, 'cathode', mcu.id, 'P1.0'); // net_led_pin
  const wGnd = c.addWire(gnd.id, 'gnd', mcu.id, 'P1.0');   // merges into net_led_pin? no, separate wire

  c.setPin('P1.0', 'quasi', false);
  c.advanceTo(25n * MS);

  return { c, vcc, r, led, mcu, gnd, w1, w2, w3 };
}

describe('probe placement → voltage reading', () => {
  it('probes on VCC net and LED-pin net gives voltage drop', () => {
    const { c, w1, w3 } = buildCircuitWithNets();
    const meter = createMeterState();
    meter.mode = 'voltage';
    meter.probeA = { netId: w1.netId, partId: null, terminal: null };
    meter.probeB = { netId: w3.netId, partId: null, terminal: null };

    const reading = readMeter(meter, c);
    const v = parseFloat(reading.value);
    assert.ok(v > 2.0 && v < 6.0, `V across circuit: ${v}`);
  });

  it('probes on same net gives ~0V', () => {
    const { c, w1 } = buildCircuitWithNets();
    const meter = createMeterState();
    meter.mode = 'voltage';
    meter.probeA = { netId: w1.netId, partId: null, terminal: null };
    meter.probeB = { netId: w1.netId, partId: null, terminal: null };

    const reading = readMeter(meter, c);
    const v = parseFloat(reading.value);
    assert.ok(Math.abs(v) < 0.001, `same net should be ~0V: ${v}`);
  });
});

describe('probe placement → current reading', () => {
  it('probe on LED anode gives branch current', () => {
    const { c, led } = buildCircuitWithNets();
    const meter = createMeterState();
    meter.mode = 'current';
    meter.probeA = { netId: null, partId: led.id, terminal: 'anode' };

    const reading = readMeter(meter, c);
    const mA = parseFloat(reading.value);
    assert.ok(Math.abs(mA) > 1.0, `current should be > 1 mA: ${mA}`);
  });

  it('probe on resistor terminal gives same current as LED', () => {
    const { c, r, led } = buildCircuitWithNets();

    const meterR = createMeterState();
    meterR.mode = 'current';
    meterR.probeA = { netId: null, partId: r.id, terminal: 'a' };
    const readingR = readMeter(meterR, c);

    const meterLed = createMeterState();
    meterLed.mode = 'current';
    meterLed.probeA = { netId: null, partId: led.id, terminal: 'anode' };
    const readingLed = readMeter(meterLed, c);

    const iR = Math.abs(parseFloat(readingR.value));
    const iLed = Math.abs(parseFloat(readingLed.value));
    // Series circuit — same current through both (within tolerance)
    assert.ok(Math.abs(iR - iLed) < 0.5,
      `series current should match: R=${iR} mA, LED=${iLed} mA`);
  });
});

describe('probe placement → resistance with power-off flow', () => {
  it('full flow: powered → refuses, power off → reads ohms', () => {
    const { c, w1, w2 } = buildCircuitWithNets();
    const meter = createMeterState();
    meter.mode = 'resistance';
    meter.probeA = { netId: w1.netId, partId: null, terminal: null };
    meter.probeB = { netId: w2.netId, partId: null, terminal: null };

    // Step 1: powered — should refuse
    const r1 = readMeter(meter, c);
    assert.equal(r1.value, '---');
    assert.ok(r1.note.includes('Turn power OFF'));

    // Step 2: user turns off power
    c.setPower(false);
    c.advanceBy(1n * MS);

    // Step 3: now reads resistance
    const r2 = readMeter(meter, c);
    assert.equal(r2.note, null, `should read after power off: ${r2.note}`);
    assert.ok(parseFloat(r2.value) > 0, `resistance should be > 0: ${r2.value}`);
  });
});

describe('switching meter modes between probes', () => {
  it('same probes, different modes give different readings', () => {
    const { c, w1, w3, led } = buildCircuitWithNets();
    const meter = createMeterState();
    meter.probeA = { netId: w1.netId, partId: led.id, terminal: 'anode' };
    meter.probeB = { netId: w3.netId, partId: null, terminal: null };

    // Voltage mode
    meter.mode = 'voltage';
    const vReading = readMeter(meter, c);
    assert.equal(vReading.unit, 'V');

    // Current mode (uses probeA partId/terminal)
    meter.mode = 'current';
    const iReading = readMeter(meter, c);
    assert.equal(iReading.unit, 'mA');

    // Resistance mode (powered — should refuse)
    meter.mode = 'resistance';
    const rReading = readMeter(meter, c);
    assert.ok(rReading.note.includes('Turn power OFF'));
  });
});
