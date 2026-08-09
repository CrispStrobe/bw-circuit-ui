/**
 * Tests for the multimeter model.
 *
 * The honesty rule: resistance on a powered board returns
 * 'requires-power-off'. This is correct behaviour, not an error.
 *
 * All readings come from the engine — nothing fabricated.
 */

import './_setup.js';
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Circuit, resetIds } from '../src/model/circuit.js';
import { createMeterState, readMeter } from '../src/model/multimeter.js';

const MS = 1_000_000n;

beforeEach(() => resetIds());

function buildTestCircuit() {
  const c = new Circuit(5.0);
  const vcc = c.addPart('vcc', {}, 0, 0);
  const r = c.addPart('resistor', { ohms: 1000 }, 0, 0);
  const led = c.addPart('led', { vf: 2.0 }, 0, 0);
  const mcu = c.addPart('mcu', { pins: ['P1.0'] }, 0, 0);
  const gnd = c.addPart('gnd', {}, 0, 0);

  const w1 = c.addWire(vcc.id, 'vcc', r.id, 'a');
  const w2 = c.addWire(r.id, 'b', led.id, 'anode');
  const w3 = c.addWire(led.id, 'cathode', mcu.id, 'P1.0');

  c.setPin('P1.0', 'quasi', false);
  c.advanceTo(25n * MS);

  return { c, vcc, r, led, mcu, gnd, w1, w2, w3 };
}

describe('multimeter — voltage mode', () => {
  it('reads voltage between two nets', () => {
    const { c, w1, w3 } = buildTestCircuit();
    const meter = createMeterState();
    meter.mode = 'voltage';
    meter.probeA = { netId: w1.netId, partId: null, terminal: null };
    meter.probeB = { netId: w3.netId, partId: null, terminal: null };

    const reading = readMeter(meter, c);
    assert.equal(reading.unit, 'V');
    assert.equal(reading.note, null);

    const v = parseFloat(reading.value);
    // VCC net (~5V) minus LED-pin net (~0.07V) ≈ ~4.9V
    assert.ok(v > 2.0, `voltage diff ${v} should be > 2V`);
    assert.ok(v < 6.0, `voltage diff ${v} should be < 6V`);
  });

  it('shows placeholder when probes not placed', () => {
    const { c } = buildTestCircuit();
    const meter = createMeterState();
    meter.mode = 'voltage';

    const reading = readMeter(meter, c);
    assert.equal(reading.value, '---');
    assert.ok(reading.note.includes('Place both probes'));
  });

  it('shows placeholder with one probe placed', () => {
    const { c, w1 } = buildTestCircuit();
    const meter = createMeterState();
    meter.mode = 'voltage';
    meter.probeA = { netId: w1.netId, partId: null, terminal: null };

    const reading = readMeter(meter, c);
    assert.equal(reading.value, '---');
  });
});

describe('multimeter — current mode', () => {
  it('reads branch current through LED', () => {
    const { c, led } = buildTestCircuit();
    const meter = createMeterState();
    meter.mode = 'current';
    meter.probeA = { netId: null, partId: led.id, terminal: 'anode' };

    const reading = readMeter(meter, c);
    assert.equal(reading.unit, 'mA');
    assert.equal(reading.note, null);

    const mA = parseFloat(reading.value);
    // ~2.9 mA through the LED
    assert.ok(Math.abs(mA) > 1.0, `current ${mA} mA should be > 1 mA`);
    assert.ok(Math.abs(mA) < 10.0, `current ${mA} mA should be < 10 mA`);
  });

  it('shows placeholder when probe not placed', () => {
    const { c } = buildTestCircuit();
    const meter = createMeterState();
    meter.mode = 'current';

    const reading = readMeter(meter, c);
    assert.equal(reading.value, '---');
    assert.ok(reading.note.includes('Place probe'));
  });
});

describe('multimeter — resistance mode (honesty rule)', () => {
  it('returns requires-power-off on a live board', () => {
    const { c, w1, w3 } = buildTestCircuit();
    const meter = createMeterState();
    meter.mode = 'resistance';
    meter.probeA = { netId: w1.netId, partId: null, terminal: null };
    meter.probeB = { netId: w3.netId, partId: null, terminal: null };

    // Board is powered → meter should refuse, not show a fake number
    const reading = readMeter(meter, c);
    assert.equal(reading.value, '---');
    assert.ok(reading.note.includes('Turn power OFF'),
      `should prompt user to turn off power: "${reading.note}"`);
    assert.ok(reading.note.includes('real DMM'),
      `should explain why: "${reading.note}"`);
  });

  it('reads resistance when power is off', () => {
    const { c, w1, w2 } = buildTestCircuit();

    // Power off
    c.setPower(false);
    c.advanceBy(1n * MS);

    const meter = createMeterState();
    meter.mode = 'resistance';
    meter.probeA = { netId: w1.netId, partId: null, terminal: null };
    meter.probeB = { netId: w2.netId, partId: null, terminal: null };

    const reading = readMeter(meter, c);
    // Should now return a number, not 'requires-power-off'
    assert.equal(reading.note, null, `should have no note when powered off: ${reading.note}`);

    // The value should be parseable and represent the 1kΩ resistor path
    const val = parseFloat(reading.value);
    assert.ok(!isNaN(val), `resistance should be a number, got "${reading.value}"`);
    assert.ok(val > 0, `resistance should be > 0`);
  });

  it('shows placeholder when probes not placed', () => {
    const { c } = buildTestCircuit();
    const meter = createMeterState();
    meter.mode = 'resistance';

    const reading = readMeter(meter, c);
    assert.equal(reading.value, '---');
  });
});

describe('multimeter — unit formatting', () => {
  it('shows kΩ for values > 1000', () => {
    const c = new Circuit(5.0);
    const r = c.addPart('resistor', { ohms: 10000 }, 0, 0);
    const vcc = c.addPart('vcc', {}, 0, 0);
    const gnd = c.addPart('gnd', {}, 0, 0);

    const w1 = c.addWire(vcc.id, 'vcc', r.id, 'a');
    const w2 = c.addWire(r.id, 'b', gnd.id, 'gnd');

    c.setPower(false);
    c.advanceTo(1n * MS);

    const meter = createMeterState();
    meter.mode = 'resistance';
    meter.probeA = { netId: w1.netId, partId: null, terminal: null };
    meter.probeB = { netId: w2.netId, partId: null, terminal: null };

    const reading = readMeter(meter, c);
    assert.equal(reading.note, null);
    // Should be in kΩ
    assert.equal(reading.unit, 'kΩ');
  });
});

describe('multimeter — no-board refusal', () => {
  it('returns "Needs the simulator" when circuit is null', () => {
    const meter = createMeterState();
    meter.mode = 'voltage';
    const reading = readMeter(meter, null);
    assert.equal(reading.value, '---');
    assert.ok(reading.note.includes('simulator'),
      `should say needs simulator, got: "${reading.note}"`);
  });

  it('returns "Needs the simulator" when circuit.board is null', () => {
    const meter = createMeterState();
    meter.mode = 'resistance';
    const reading = readMeter(meter, { board: null });
    assert.equal(reading.value, '---');
    assert.ok(reading.note.includes('simulator'));
  });

  it('no-board refusal is distinct from power-off refusal', () => {
    // No board → "Needs the simulator"
    const noBoard = readMeter(createMeterState(), null);
    assert.ok(noBoard.note.includes('simulator'));

    // Board powered → "Turn power OFF" (different reason)
    const { c, w1, w3 } = buildTestCircuit();
    const meter = createMeterState();
    meter.mode = 'resistance';
    meter.probeA = { netId: w1.netId, partId: null, terminal: null };
    meter.probeB = { netId: w3.netId, partId: null, terminal: null };
    const powered = readMeter(meter, c);
    assert.ok(powered.note.includes('Turn power OFF'));
    assert.ok(!powered.note.includes('simulator'),
      'power-off refusal must not mention simulator');
  });
});
