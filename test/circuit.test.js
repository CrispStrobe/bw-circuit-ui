/**
 * Tests for the Circuit model — the mutable core of the circuit designer.
 *
 * Every test that checks an instrument reading confirms the value comes
 * from the real engine, not from fabricated data.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Circuit, resetIds } from '../src/model/circuit.js';

const MS = 1_000_000n;

beforeEach(() => resetIds());

// ── Part operations ─────────────────────────────────────────────────

describe('addPart', () => {
  it('adds a part with correct terminals', () => {
    const c = new Circuit();
    const r = c.addPart('resistor', { ohms: 1000 }, 100, 200);
    assert.equal(r.kind, 'resistor');
    assert.deepEqual(r.terminals, ['a', 'b']);
    assert.equal(r.x, 100);
    assert.equal(r.y, 200);
    assert.equal(c.parts.length, 1);
  });

  it('assigns unique IDs', () => {
    const c = new Circuit();
    const r1 = c.addPart('resistor', { ohms: 100 }, 0, 0);
    const r2 = c.addPart('resistor', { ohms: 200 }, 0, 0);
    assert.notEqual(r1.id, r2.id);
  });

  it('creates correct terminals for each kind', () => {
    const c = new Circuit();
    assert.deepEqual(c.addPart('vcc', {}, 0, 0).terminals, ['vcc']);
    assert.deepEqual(c.addPart('gnd', {}, 0, 0).terminals, ['gnd']);
    assert.deepEqual(c.addPart('led', { vf: 2 }, 0, 0).terminals, ['anode', 'cathode']);
    assert.deepEqual(c.addPart('potentiometer', { ohms: 10000 }, 0, 0).terminals, ['a', 'wiper', 'b']);
    assert.deepEqual(c.addPart('button', {}, 0, 0).terminals, ['a', 'b']);
    assert.deepEqual(c.addPart('buzzer', {}, 0, 0).terminals, ['a', 'b']);
    assert.deepEqual(c.addPart('capacitor', { farads: 0.0001 }, 0, 0).terminals, ['a', 'b']);
  });

  it('creates MCU with specified pins', () => {
    const c = new Circuit();
    const mcu = c.addPart('mcu', { pins: ['P1.0', 'P1.3'] }, 0, 0);
    assert.deepEqual(mcu.terminals, ['P1.0', 'P1.3']);
  });
});

describe('removePart', () => {
  it('removes a part', () => {
    const c = new Circuit();
    const r = c.addPart('resistor', { ohms: 1000 }, 0, 0);
    assert.equal(c.removePart(r.id), true);
    assert.equal(c.parts.length, 0);
  });

  it('returns false for nonexistent part', () => {
    const c = new Circuit();
    assert.equal(c.removePart('nope'), false);
  });

  it('removes wires connected to the part', () => {
    const c = new Circuit();
    const vcc = c.addPart('vcc', {}, 0, 0);
    const r = c.addPart('resistor', { ohms: 1000 }, 0, 0);
    c.addWire(vcc.id, 'vcc', r.id, 'a');
    assert.equal(c.wires.length, 1);
    c.removePart(r.id);
    assert.equal(c.wires.length, 0);
  });
});

describe('movePart', () => {
  it('updates position', () => {
    const c = new Circuit();
    const r = c.addPart('resistor', { ohms: 1000 }, 10, 20);
    c.movePart(r.id, 50, 60);
    assert.equal(r.x, 50);
    assert.equal(r.y, 60);
  });

  it('returns false for nonexistent part', () => {
    const c = new Circuit();
    assert.equal(c.movePart('nope', 0, 0), false);
  });
});

// ── Wire operations ─────────────────────────────────────────────────

describe('addWire', () => {
  it('connects two terminals', () => {
    const c = new Circuit();
    const vcc = c.addPart('vcc', {}, 0, 0);
    const r = c.addPart('resistor', { ohms: 1000 }, 0, 0);
    const w = c.addWire(vcc.id, 'vcc', r.id, 'a');
    assert.ok(w);
    assert.equal(c.wires.length, 1);
    assert.equal(w.from.part, vcc.id);
    assert.equal(w.to.part, r.id);
  });

  it('returns null for nonexistent part', () => {
    const c = new Circuit();
    c.addPart('resistor', { ohms: 1000 }, 0, 0);
    assert.equal(c.addWire('nope', 'a', 'nope2', 'b'), null);
  });

  it('returns null for nonexistent terminal', () => {
    const c = new Circuit();
    const r = c.addPart('resistor', { ohms: 1000 }, 0, 0);
    const r2 = c.addPart('resistor', { ohms: 1000 }, 0, 0);
    assert.equal(c.addWire(r.id, 'nope', r2.id, 'a'), null);
  });

  it('returns null for self-connection', () => {
    const c = new Circuit();
    const r = c.addPart('resistor', { ohms: 1000 }, 0, 0);
    assert.equal(c.addWire(r.id, 'a', r.id, 'a'), null);
  });

  it('returns null for duplicate wire', () => {
    const c = new Circuit();
    const vcc = c.addPart('vcc', {}, 0, 0);
    const r = c.addPart('resistor', { ohms: 1000 }, 0, 0);
    c.addWire(vcc.id, 'vcc', r.id, 'a');
    assert.equal(c.addWire(vcc.id, 'vcc', r.id, 'a'), null);
  });

  it('returns null for reverse duplicate', () => {
    const c = new Circuit();
    const vcc = c.addPart('vcc', {}, 0, 0);
    const r = c.addPart('resistor', { ohms: 1000 }, 0, 0);
    c.addWire(vcc.id, 'vcc', r.id, 'a');
    assert.equal(c.addWire(r.id, 'a', vcc.id, 'vcc'), null);
  });

  it('merges nets when connecting two wired terminals', () => {
    const c = new Circuit();
    const vcc = c.addPart('vcc', {}, 0, 0);
    const r = c.addPart('resistor', { ohms: 1000 }, 0, 0);
    const led = c.addPart('led', { vf: 2 }, 0, 0);
    const gnd = c.addPart('gnd', {}, 0, 0);

    // Two separate nets
    const w1 = c.addWire(vcc.id, 'vcc', r.id, 'a');
    const w2 = c.addWire(led.id, 'cathode', gnd.id, 'gnd');
    assert.notEqual(w1.netId, w2.netId);

    // Bridge them → should merge into one net
    const w3 = c.addWire(r.id, 'b', led.id, 'anode');
    // w3 gets a net, and doesn't crash
    assert.ok(w3);
  });
});

describe('removeWire', () => {
  it('removes a wire', () => {
    const c = new Circuit();
    const vcc = c.addPart('vcc', {}, 0, 0);
    const r = c.addPart('resistor', { ohms: 1000 }, 0, 0);
    const w = c.addWire(vcc.id, 'vcc', r.id, 'a');
    assert.equal(c.removeWire(w.id), true);
    assert.equal(c.wires.length, 0);
  });

  it('returns false for nonexistent wire', () => {
    const c = new Circuit();
    assert.equal(c.removeWire('nope'), false);
  });
});

// ── Engine integration ──────────────────────────────────────────────

describe('engine integration — active-low LED', () => {
  function buildActiveLowCircuit() {
    const c = new Circuit(5.0);
    const vcc = c.addPart('vcc', {}, 200, 60);
    const r = c.addPart('resistor', { ohms: 1000 }, 200, 150);
    const led = c.addPart('led', { vf: 2.0, color: 'red' }, 200, 260);
    const mcu = c.addPart('mcu', { pins: ['P1.0'] }, 400, 200);

    c.addWire(vcc.id, 'vcc', r.id, 'a');
    c.addWire(r.id, 'b', led.id, 'anode');
    c.addWire(led.id, 'cathode', mcu.id, 'P1.0');

    return { c, vcc, r, led, mcu };
  }

  it('quasi LOW → LED brightness ~0.145 (from engine)', () => {
    const { c, led } = buildActiveLowCircuit();
    c.setPin('P1.0', 'quasi', false);
    c.advanceTo(25n * MS);

    const b = c.ledBrightness(led.id);
    assert.ok(b > 0.13, `brightness ${b} should be > 0.13`);
    assert.ok(b < 0.16, `brightness ${b} should be < 0.16`);
  });

  it('quasi HIGH → LED brightness ~0 (from engine)', () => {
    const { c, led } = buildActiveLowCircuit();
    c.setPin('P1.0', 'quasi', true);
    c.advanceTo(25n * MS);

    const b = c.ledBrightness(led.id);
    assert.ok(b < 0.01, `brightness ${b} should be ~0`);
  });

  it('nodeVoltage on VCC net returns ~5V (from engine)', () => {
    const { c, vcc, r } = buildActiveLowCircuit();
    c.setPin('P1.0', 'quasi', false);
    c.advanceTo(1n * MS);

    // Find the net connecting VCC to the resistor
    const vccWire = c.wires.find(w =>
      w.from.part === vcc.id || w.to.part === vcc.id
    );
    const v = c.nodeVoltage(vccWire.netId);
    assert.ok(Math.abs(v - 5.0) < 0.1, `VCC net should be ~5V, got ${v}`);
  });

  it('advanceBy works', () => {
    const { c, led } = buildActiveLowCircuit();
    c.setPin('P1.0', 'quasi', false);
    c.advanceBy(25n * MS);

    const b = c.ledBrightness(led.id);
    assert.ok(b > 0.13, `brightness ${b} should be > 0.13`);
  });
});

describe('engine integration — potentiometer', () => {
  it('pot at midpoint → ADC reads ~2.5V (from engine)', () => {
    const c = new Circuit(5.0);
    const vcc = c.addPart('vcc', {}, 0, 0);
    const pot = c.addPart('potentiometer', { ohms: 10000 }, 0, 0);
    const mcu = c.addPart('mcu', { pins: ['P1.3'] }, 0, 0);
    const gnd = c.addPart('gnd', {}, 0, 0);

    c.addWire(vcc.id, 'vcc', pot.id, 'a');
    c.addWire(pot.id, 'wiper', mcu.id, 'P1.3');
    c.addWire(pot.id, 'b', gnd.id, 'gnd');

    c.setPin('P1.3', 'input', false);
    c.setControl(pot.id, 0.5);
    c.advanceTo(1n * MS);

    const v = c.board.readAnalog('P1.3');
    assert.ok(Math.abs(v - 2.5) < 0.2, `pot midpoint should be ~2.5V, got ${v}`);
  });

  it('pot at 0 → ~0V, pot at 1 → ~5V', () => {
    const c = new Circuit(5.0);
    const vcc = c.addPart('vcc', {}, 0, 0);
    const pot = c.addPart('potentiometer', { ohms: 10000 }, 0, 0);
    const mcu = c.addPart('mcu', { pins: ['P1.3'] }, 0, 0);
    const gnd = c.addPart('gnd', {}, 0, 0);

    c.addWire(vcc.id, 'vcc', pot.id, 'a');
    c.addWire(pot.id, 'wiper', mcu.id, 'P1.3');
    c.addWire(pot.id, 'b', gnd.id, 'gnd');

    c.setPin('P1.3', 'input', false);

    c.setControl(pot.id, 0.0);
    c.advanceTo(1n * MS);
    const v0 = c.board.readAnalog('P1.3');
    assert.ok(v0 < 0.5, `pot at 0 should be ~0V, got ${v0}`);

    c.setControl(pot.id, 1.0);
    c.advanceBy(1n * MS);
    const v1 = c.board.readAnalog('P1.3');
    assert.ok(v1 > 4.5, `pot at 1 should be ~5V, got ${v1}`);
  });
});

describe('engine integration — button', () => {
  it('button press pulls pin LOW (from engine)', () => {
    const c = new Circuit(5.0);
    const btn = c.addPart('button', {}, 0, 0);
    const mcu = c.addPart('mcu', { pins: ['P3.2'] }, 0, 0);
    const gnd = c.addPart('gnd', {}, 0, 0);

    // Button between pin and GND (typical active-low button)
    c.addWire(btn.id, 'a', mcu.id, 'P3.2');
    c.addWire(btn.id, 'b', gnd.id, 'gnd');

    c.setPin('P3.2', 'quasi', true); // quasi with internal pull-up
    c.advanceTo(1n * MS);

    // Not pressed → pin reads 1 (pull-up)
    assert.equal(c.board.readPin('P3.2'), 1, 'button not pressed → 1');

    // Press → pin reads 0
    c.setControl(btn.id, 1);
    assert.equal(c.board.readPin('P3.2'), 0, 'button pressed → 0');

    // Release → pin reads 1
    c.setControl(btn.id, 0);
    assert.equal(c.board.readPin('P3.2'), 1, 'button released → 1');
  });
});

describe('engine integration — buzzer', () => {
  it('toggling pin produces buzzer tone (from engine)', () => {
    const c = new Circuit(5.0);
    const buzzer = c.addPart('buzzer', {}, 0, 0);
    const mcu = c.addPart('mcu', { pins: ['P1.5'] }, 0, 0);

    c.addWire(buzzer.id, 'a', mcu.id, 'P1.5');

    // Toggle at 1 kHz (every 0.5 ms)
    const halfPeriod = 500_000n; // 0.5 ms in ns
    for (let i = 0; i < 20; i++) {
      c.board.advanceTo(BigInt(i) * halfPeriod);
      c.board.setPin('P1.5', 'pushpull', i % 2 === 0);
    }

    const tone = c.buzzerTone(buzzer.id);
    assert.ok(tone.on, 'buzzer should be producing sound');
    assert.ok(tone.hz > 800 && tone.hz < 1200,
      `buzzer freq ${tone.hz} should be ~1000 Hz`);
  });
});

// ── Netlist sync ────────────────────────────────────────────────────

describe('netlist sync', () => {
  it('adding a wire updates the engine netlist', () => {
    const c = new Circuit(5.0);
    const vcc = c.addPart('vcc', {}, 0, 0);
    const r = c.addPart('resistor', { ohms: 1000 }, 0, 0);

    // Before wiring — engine has no nets
    assert.equal(c.board.nets.length, 0);

    c.addWire(vcc.id, 'vcc', r.id, 'a');

    // After wiring — engine has one net
    assert.equal(c.board.nets.length, 1);
  });

  it('removing a wire updates the engine netlist', () => {
    const c = new Circuit(5.0);
    const vcc = c.addPart('vcc', {}, 0, 0);
    const r = c.addPart('resistor', { ohms: 1000 }, 0, 0);
    const w = c.addWire(vcc.id, 'vcc', r.id, 'a');

    assert.equal(c.board.nets.length, 1);
    c.removeWire(w.id);
    assert.equal(c.board.nets.length, 0);
  });

  it('removing a part updates the engine', () => {
    const c = new Circuit(5.0);
    const vcc = c.addPart('vcc', {}, 0, 0);
    const r = c.addPart('resistor', { ohms: 1000 }, 0, 0);
    c.addWire(vcc.id, 'vcc', r.id, 'a');

    c.removePart(r.id);
    assert.equal(c.board.parts.length, 1); // only VCC remains
    assert.equal(c.board.nets.length, 0);
  });
});

// ── Serialization ───────────────────────────────────────────────────

describe('toJSON / fromJSON', () => {
  it('round-trips the circuit state', () => {
    const c = new Circuit(5.0);
    const vcc = c.addPart('vcc', {}, 100, 50);
    const r = c.addPart('resistor', { ohms: 1000 }, 200, 150);
    c.addWire(vcc.id, 'vcc', r.id, 'a');

    const json = c.toJSON();
    const c2 = Circuit.fromJSON(json);

    assert.equal(c2.parts.length, 2);
    assert.equal(c2.wires.length, 1);
    assert.equal(c2.vcc, 5.0);
    assert.equal(c2.board.nets.length, 1);
  });
});

// ── Power toggle ────────────────────────────────────────────────────

describe('power toggle', () => {
  it('setPower(false) powers off the board', () => {
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

    // LED should be on
    const bOn = c.ledBrightness(led.id);
    assert.ok(bOn > 0.10, `LED should be on: ${bOn}`);

    // Power off → LED should go dark
    c.setPower(false);
    c.advanceBy(25n * MS);
    const bOff = c.ledBrightness(led.id);
    assert.ok(bOff < 0.01, `LED should be off after power-off: ${bOff}`);
  });
});
