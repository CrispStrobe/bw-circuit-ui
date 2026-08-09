/**
 * Tests for declaration generation.
 * Three constraints tested: polarity from wiring, TONE singularity, ANALOG pin restriction.
 */

import './_setup.js';
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { generatePartName, partToDeclaration, circuitToDeclarations } from '../src/model/declarations.js';
import { Circuit, resetIds } from '../src/model/circuit.js';

const MS = 1_000_000n;
beforeEach(() => resetIds());

describe('generatePartName', () => {
  it('generates led1 for first LED', () => {
    assert.equal(generatePartName('led', []), 'led1');
  });
  it('generates led2 when led1 exists', () => {
    assert.equal(generatePartName('led', ['led1']), 'led2');
  });
  it('skips existing names', () => {
    assert.equal(generatePartName('led', ['led1', 'led2', 'led3']), 'led4');
  });
  it('generates btn1 for button', () => {
    assert.equal(generatePartName('button', []), 'btn1');
  });
});

describe('polarity from wiring (constraint 1)', () => {
  it('LED wired VCC→R→LED→pin is active-low', () => {
    const c = new Circuit(5.0);
    const vcc = c.addPart('vcc', {}, 0, 0);
    const gnd = c.addPart('gnd', {}, 0, 0);
    const r = c.addPart('resistor', { ohms: 1000 }, 0, 0);
    const led = c.addPart('led', { vf: 2.0 }, 0, 0, 'led1');
    const mcu = c.addPart('mcu', { pins: ['P1.0'] }, 0, 0);

    c.addWire(vcc.id, 'vcc', r.id, 'a');
    c.addWire(r.id, 'b', led.id, 'anode');
    c.addWire(led.id, 'cathode', mcu.id, 'P1.0');

    const decl = partToDeclaration(led, 'P1.0', { parts: c.parts, wires: c.wires });
    assert.equal(decl.activeLow, true, 'VCC→R→LED→pin should be active-low');
  });

  it('LED wired pin→R→LED→GND is active-high', () => {
    const c = new Circuit(5.0);
    const vcc = c.addPart('vcc', {}, 0, 0);
    const gnd = c.addPart('gnd', {}, 0, 0);
    const r = c.addPart('resistor', { ohms: 1000 }, 0, 0);
    const led = c.addPart('led', { vf: 2.0 }, 0, 0, 'led1');
    const mcu = c.addPart('mcu', { pins: ['P1.0'] }, 0, 0);

    c.addWire(mcu.id, 'P1.0', r.id, 'a');
    c.addWire(r.id, 'b', led.id, 'anode');
    c.addWire(led.id, 'cathode', gnd.id, 'gnd');

    const decl = partToDeclaration(led, 'P1.0', { parts: c.parts, wires: c.wires });
    assert.equal(decl.activeLow, false, 'pin→R→LED→GND should be active-high');
  });

  it('button wired to GND is active-low', () => {
    const c = new Circuit(5.0);
    const btn = c.addPart('button', {}, 0, 0, 'btn1');
    const gnd = c.addPart('gnd', {}, 0, 0);
    const mcu = c.addPart('mcu', { pins: ['P3.2'] }, 0, 0);

    c.addWire(btn.id, 'a', mcu.id, 'P3.2');
    c.addWire(btn.id, 'b', gnd.id, 'gnd');

    const decl = partToDeclaration(btn, 'P3.2', { parts: c.parts, wires: c.wires });
    assert.equal(decl.activeLow, true, 'button to GND should be active-low');
  });
});

describe('TONE singularity (constraint 2)', () => {
  it('first buzzer gets direction tone', () => {
    const ctx = { toneAlreadyClaimed: false };
    const decl = partToDeclaration(
      { kind: 'buzzer', params: {}, declName: 'buzzer1', id: 'b1' },
      'P3.5', ctx
    );
    assert.equal(decl.direction, 'tone');
  });

  it('second buzzer gets direction output (not tone)', () => {
    const ctx = { toneAlreadyClaimed: true };
    const decl = partToDeclaration(
      { kind: 'buzzer', params: {}, declName: 'buzzer2', id: 'b2' },
      'P3.6', ctx
    );
    assert.equal(decl.direction, 'output',
      'second buzzer should be OUTPUT, not TONE (only one Timer 1)');
  });
});

describe('ANALOG pin restriction (constraint 3)', () => {
  it('pot on P1.x gets direction analog', () => {
    const decl = partToDeclaration(
      { kind: 'potentiometer', params: {}, declName: 'pot1', id: 'p1' },
      'P1.3', {}
    );
    assert.equal(decl.direction, 'analog');
  });

  it('pot on P3.x gets direction input (ANALOG is P1.x only)', () => {
    const decl = partToDeclaration(
      { kind: 'potentiometer', params: {}, declName: 'pot1', id: 'p1' },
      'P3.2', {}
    );
    assert.equal(decl.direction, 'input',
      'pot on P3.x should be INPUT, not ANALOG (ADC is P1.x only)');
  });
});

describe('circuitToDeclarations', () => {
  it('produces correct declarations for active-low LED circuit', () => {
    const c = new Circuit(5.0);
    const vcc = c.addPart('vcc', {}, 0, 0);
    const gnd = c.addPart('gnd', {}, 0, 0);
    const r = c.addPart('resistor', { ohms: 1000 }, 0, 0);
    const led = c.addPart('led', { vf: 2.0 }, 0, 0, 'led1');
    const mcu = c.addPart('mcu', { pins: ['P1.0'] }, 0, 0);

    c.addWire(vcc.id, 'vcc', r.id, 'a');
    c.addWire(r.id, 'b', led.id, 'anode');
    c.addWire(led.id, 'cathode', mcu.id, 'P1.0');

    const decls = circuitToDeclarations(c.parts, c.wires);
    assert.equal(decls.pins.length, 1);
    assert.equal(decls.pins[0].name, 'led1');
    assert.equal(decls.pins[0].direction, 'output');
    assert.equal(decls.pins[0].activeLow, true);
    assert.equal(decls.pins[0].port, 1);
    assert.equal(decls.pins[0].bit, 0);
  });

  it('TONE claimed by first buzzer, second becomes OUTPUT', () => {
    const c = new Circuit(5.0);
    const gnd = c.addPart('gnd', {}, 0, 0);
    const bz1 = c.addPart('buzzer', {}, 0, 0, 'buzzer1');
    const bz2 = c.addPart('buzzer', {}, 0, 0, 'buzzer2');
    const mcu = c.addPart('mcu', { pins: ['P3.5', 'P3.6'] }, 0, 0);

    c.addWire(bz1.id, 'a', mcu.id, 'P3.5');
    c.addWire(bz1.id, 'b', gnd.id, 'gnd');
    c.addWire(bz2.id, 'a', mcu.id, 'P3.6');

    const decls = circuitToDeclarations(c.parts, c.wires);
    const tones = decls.pins.filter(p => p.direction === 'tone');
    const outputs = decls.pins.filter(p => p.direction === 'output');
    assert.equal(tones.length, 1, 'only one TONE');
    assert.equal(outputs.length, 1, 'second buzzer is OUTPUT');
  });
});
