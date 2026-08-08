/**
 * Test that the simulation driver produces real values from bw-board.
 * These are the same hand-computed expectations from bw-board's own tests.
 */

import './_setup.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getEngine } from '../src/engine.js';

// Inline the demo netlist (same as demo-netlist.js minus layout fields)
const parts = [
  { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
  { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
  { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
  { id: 'LED1', kind: 'led', params: { vf: 2.0, color: 'red' }, terminals: ['anode', 'cathode'] },
  { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0'] },
];

const nets = [
  { id: 'net_vcc', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R1', terminal: 'a' }] },
  { id: 'net_r_led', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'LED1', terminal: 'anode' }] },
  { id: 'net_led_pin', terminals: [{ part: 'LED1', terminal: 'cathode' }, { part: 'MCU', terminal: 'P1.0' }] },
];

describe('simulation driver produces real engine values', () => {
  it('quasi-bidir driving LOW → LED brightness ~0.145', () => {
    const { BoardImpl } = getEngine();
    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);
    board.setPin('P1.0', 'quasi', false);
    board.advanceTo(25_000_000n);

    const b = board.ledBrightness('LED1');
    assert.ok(b > 0.13, `brightness ${b} should be > 0.13`);
    assert.ok(b < 0.16, `brightness ${b} should be < 0.16`);
  });

  it('quasi-bidir driving HIGH → LED brightness ~0', () => {
    const { BoardImpl } = getEngine();
    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);
    board.setPin('P1.0', 'quasi', true);
    board.advanceTo(25_000_000n);

    const b = board.ledBrightness('LED1');
    assert.ok(b < 0.01, `brightness ${b} should be ~0`);
  });

  it('nodeVoltage returns real volts', () => {
    const { BoardImpl } = getEngine();
    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);
    board.setPin('P1.0', 'quasi', false);
    board.advanceTo(1_000_000n);

    const vcc = board.nodeVoltage('net_vcc');
    assert.ok(Math.abs(vcc - 5.0) < 0.1, `VCC net should be ~5V, got ${vcc}`);
  });
});
