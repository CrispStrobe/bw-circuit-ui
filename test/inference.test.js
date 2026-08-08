/**
 * Tests for boundary C — inferNetlist integration.
 *
 * Verifies that inferred circuits work with the engine and produce
 * correct readings. Also tests the teaching notes (checkWiring).
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Circuit, resetIds } from '../src/model/circuit.js';
import { inferCircuit, checkWiring } from '../src/model/inference.js';

const MS = 1_000_000n;

beforeEach(() => resetIds());

describe('inferCircuit', () => {
  it('infers active-low LED circuit from output pin', () => {
    const result = inferCircuit({
      device: 'STC12C5A60S2',
      clock: 11059200,
      pins: [
        { name: 'led1', port: 1, bit: 0, direction: 'output', activeLow: true },
      ],
    });

    assert.ok(result.parts.length >= 4, `should have VCC, GND, MCU, R, LED — got ${result.parts.length}`);
    assert.ok(result.nets.length >= 3, `should have at least 3 nets — got ${result.nets.length}`);

    // Check that all parts have layout positions
    for (const part of result.parts) {
      assert.ok(typeof part.x === 'number', `${part.id} should have x`);
      assert.ok(typeof part.y === 'number', `${part.id} should have y`);
    }
  });

  it('inferred active-low LED lights up when driven (engine values)', () => {
    const { parts, nets } = inferCircuit({
      pins: [
        { name: 'led1', port: 1, bit: 0, direction: 'output', activeLow: true },
      ],
    });

    const c = new Circuit(5.0);
    // Load inferred parts into circuit (stripping layout for engine)
    for (const p of parts) {
      c.parts.push(p);
    }
    // Build wires from nets
    for (const net of nets) {
      for (let i = 1; i < net.terminals.length; i++) {
        c.wires.push({
          id: `inferred_wire_${net.id}_${i}`,
          netId: net.id,
          from: net.terminals[0],
          to: net.terminals[i],
        });
      }
    }
    c._syncNetlist();

    // Drive pin low (active-low → LED on)
    c.board.setPin('P1.0', 'quasi', false);
    c.board.advanceTo(25n * MS);

    const ledPart = parts.find(p => p.kind === 'led');
    const b = c.board.ledBrightness(ledPart.id);
    assert.ok(b > 0.10, `inferred LED brightness ${b} should be > 0.10`);
  });

  it('inferred active-high LED lights up when driven high in push-pull', () => {
    const { parts, nets } = inferCircuit({
      pins: [
        { name: 'led2', port: 1, bit: 1, direction: 'output', activeLow: false },
      ],
    });

    const c = new Circuit(5.0);
    for (const p of parts) c.parts.push(p);
    for (const net of nets) {
      for (let i = 1; i < net.terminals.length; i++) {
        c.wires.push({
          id: `w_${net.id}_${i}`, netId: net.id,
          from: net.terminals[0], to: net.terminals[i],
        });
      }
    }
    c._syncNetlist();

    c.board.setPin('P1.1', 'pushpull', true);
    c.board.advanceTo(25n * MS);

    const ledPart = parts.find(p => p.kind === 'led');
    const b = c.board.ledBrightness(ledPart.id);
    assert.ok(b > 0.10, `active-high LED brightness ${b} should be > 0.10`);
  });

  it('infers potentiometer for analog pin', () => {
    const { parts, nets } = inferCircuit({
      pins: [
        { name: 'pot1', port: 1, bit: 3, direction: 'analog', activeLow: false },
      ],
    });

    const potPart = parts.find(p => p.kind === 'potentiometer');
    assert.ok(potPart, 'should have a potentiometer');

    const c = new Circuit(5.0);
    for (const p of parts) c.parts.push(p);
    for (const net of nets) {
      for (let i = 1; i < net.terminals.length; i++) {
        c.wires.push({
          id: `w_${net.id}_${i}`, netId: net.id,
          from: net.terminals[0], to: net.terminals[i],
        });
      }
    }
    c._syncNetlist();

    c.board.setPin('P1.3', 'input', false);
    c.board.setControl(potPart.id, 0.5);
    c.board.advanceTo(1n * MS);

    const v = c.board.readAnalog('P1.3');
    assert.ok(Math.abs(v - 2.5) < 0.3, `pot at 50% → ~2.5V, got ${v}`);
  });

  it('infers button with pull-up for input pin', () => {
    const { parts, nets } = inferCircuit({
      pins: [
        { name: 'btn1', port: 3, bit: 2, direction: 'input', activeLow: false },
      ],
    });

    const btnPart = parts.find(p => p.kind === 'button');
    assert.ok(btnPart, 'should have a button');

    const rpuPart = parts.find(p => p.kind === 'resistor' && p.params.ohms === 10000);
    assert.ok(rpuPart, 'should have a 10kΩ pull-up resistor');

    const c = new Circuit(5.0);
    for (const p of parts) c.parts.push(p);
    for (const net of nets) {
      for (let i = 1; i < net.terminals.length; i++) {
        c.wires.push({
          id: `w_${net.id}_${i}`, netId: net.id,
          from: net.terminals[0], to: net.terminals[i],
        });
      }
    }
    c._syncNetlist();

    c.board.setPin('P3.2', 'quasi', true);
    c.board.advanceTo(1n * MS);

    assert.equal(c.board.readPin('P3.2'), 1, 'button not pressed → 1');
    c.board.setControl(btnPart.id, 1);
    assert.equal(c.board.readPin('P3.2'), 0, 'button pressed → 0');
  });

  it('infers full scenario: LED + pot + button', () => {
    const { parts, nets, notes } = inferCircuit({
      device: 'STC12C5A60S2',
      clock: 11059200,
      pins: [
        { name: 'led1', port: 1, bit: 0, direction: 'output', activeLow: true },
        { name: 'pot', port: 1, bit: 3, direction: 'analog', activeLow: false },
        { name: 'button', port: 3, bit: 2, direction: 'input', activeLow: false },
      ],
    });

    // Should have: VCC, GND, MCU, R_led1, LED_led1, POT_pot, R_PU_button, BTN_button
    assert.ok(parts.length >= 8, `should have 8+ parts, got ${parts.length}`);
    assert.ok(notes.length === 0, `should have no inference notes, got: ${notes.join(', ')}`);
  });
});

describe('checkWiring — teaching notes', () => {
  it('warns about declared pin with nothing wired', () => {
    const declaredPins = [
      { name: 'led1', port: 1, bit: 0, direction: 'output', activeLow: true },
      { name: 'unused', port: 1, bit: 1, direction: 'output', activeLow: false },
    ];

    // Only wire P1.0, leave P1.1 unwired
    const wiredParts = [
      { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0', 'P1.1'] },
      { id: 'LED1', kind: 'led', params: {}, terminals: ['anode', 'cathode'] },
    ];
    const wiredNets = [
      { id: 'n1', terminals: [
        { part: 'MCU', terminal: 'P1.0' },
        { part: 'LED1', terminal: 'cathode' },
      ]},
    ];

    const notes = checkWiring(declaredPins, wiredParts, wiredNets);
    assert.ok(notes.some(n => n.includes('P1.1') && n.includes('nothing wired')),
      `should warn about unwired P1.1: ${notes.join('; ')}`);
  });

  it('warns about wired pin not declared in project', () => {
    const declaredPins = [
      { name: 'led1', port: 1, bit: 0, direction: 'output', activeLow: true },
    ];

    const wiredParts = [
      { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0', 'P1.7'] },
      { id: 'LED1', kind: 'led', params: {}, terminals: ['anode', 'cathode'] },
      { id: 'R_mystery', kind: 'resistor', params: {}, terminals: ['a', 'b'] },
    ];
    const wiredNets = [
      { id: 'n1', terminals: [
        { part: 'MCU', terminal: 'P1.0' },
        { part: 'LED1', terminal: 'cathode' },
      ]},
      { id: 'n2', terminals: [
        { part: 'MCU', terminal: 'P1.7' },
        { part: 'R_mystery', terminal: 'a' },
      ]},
    ];

    const notes = checkWiring(declaredPins, wiredParts, wiredNets);
    assert.ok(notes.some(n => n.includes('P1.7') && n.includes('not declared')),
      `should warn about undeclared P1.7: ${notes.join('; ')}`);
  });

  it('no warnings when everything matches', () => {
    const declaredPins = [
      { name: 'led1', port: 1, bit: 0, direction: 'output', activeLow: true },
    ];
    const wiredParts = [
      { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0'] },
      { id: 'LED1', kind: 'led', params: {}, terminals: ['anode', 'cathode'] },
    ];
    const wiredNets = [
      { id: 'n1', terminals: [
        { part: 'MCU', terminal: 'P1.0' },
        { part: 'LED1', terminal: 'cathode' },
      ]},
    ];

    const notes = checkWiring(declaredPins, wiredParts, wiredNets);
    assert.equal(notes.length, 0, `should have no warnings: ${notes.join('; ')}`);
  });
});
