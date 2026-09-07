/**
 * Test that the simulation driver produces real values from bw-board.
 * These are the same hand-computed expectations from bw-board's own tests.
 */

import './_setup.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getEngine } from '../src/engine.js';
import { demoPinScriptApplies } from '../src/model/simulation.js';

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

// ── The demo pin script must yield to a real program ─────────────────
//
// Reported by a consumer (brickwright): a two-LED example whose program
// alternates its pins rendered with both LEDs lighting TOGETHER. The program was
// running and its writes were correct, but they were not arriving at this board,
// so the designer's placeholder animation kept playing over the top. That
// placeholder drives every output pin from ONE shared value, which is why it can
// only ever show all-together — and why it is indistinguishable from a working
// program on any circuit with exactly one LED.
//
// The predicate is exported so this decision can be tested at all: in the
// component it lives inside a React effect, reachable only by rendering the
// whole designer.
describe('the demo pin script', () => {
  it('plays for a bench with an MCU and no declarations', () => {
    assert.equal(demoPinScriptApplies({ hasMcu: true }), true);
    assert.equal(demoPinScriptApplies({ hasMcu: true, stc: null }), true);
    assert.equal(demoPinScriptApplies({ hasMcu: true, stc: { pins: [] } }), true);
  });

  it('stands down as soon as the project declares a pin', () => {
    // One declaration is enough: there is an author for the pins now, and it is
    // not this module. Two authors on one pin is the defect being fixed.
    assert.equal(
      demoPinScriptApplies({ hasMcu: true, stc: { pins: [{ name: 'led1' }] } }),
      false,
    );
    assert.equal(
      demoPinScriptApplies({
        hasMcu: true,
        stc: { pins: [{ name: 'led1' }, { name: 'led2' }] },
      }),
      false,
    );
  });

  it('never plays without an MCU, declarations or not', () => {
    // A pure circuit (battery-LED, RC bench) still needs the clock to advance,
    // but it has no pins to script. The clock is not this predicate's business.
    assert.equal(demoPinScriptApplies({ hasMcu: false }), false);
    assert.equal(
      demoPinScriptApplies({ hasMcu: false, stc: { pins: [{ name: 'led1' }] } }),
      false,
    );
  });

  it('is not fooled by a malformed declarations object', () => {
    // `stc` arrives from a consumer's project model and has been seen as a bare
    // object mid-load. Treating a missing pins array as "declared" would silence
    // the placeholder on every bench.
    assert.equal(demoPinScriptApplies({ hasMcu: true, stc: {} }), true);
    assert.equal(demoPinScriptApplies({ hasMcu: true, stc: { pins: 'nope' } }), true);
  });
});
