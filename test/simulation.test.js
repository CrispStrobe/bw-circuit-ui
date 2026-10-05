/**
 * Test that the simulation driver produces real values from bw-board.
 * These are the same hand-computed expectations from bw-board's own tests.
 */

import './_setup.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getEngine } from '../src/engine.js';
import { demoPinScriptApplies, armBoardForRun, classifyRunPins, greenFlagArmsOwnBoard, designerClockPlan } from '../src/model/simulation.js';
import { readFileSync } from 'node:fs';

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

// A run is armed BEFORE the program writes (brickwright-lite task B7). The
// designer's start-of-run clear (reset + arm every MCU pin) used to run in its
// [mode] effect after the green flag's event arrived on a setTimeout(0), so it
// could land after the Scratch VM's first write and wipe it — measured in a
// real browser on production: `turn on led` at 68.7 ms, the reset at 174 ms,
// the LED dark for the program's whole 2 s wait.
describe('armBoardForRun: the clear of a run', () => {
  const wires = [
    { from: 'MCU', fromTerminal: 'P1.0', to: 'LED1', toTerminal: 'cathode' },
    { from: 'MCU', fromTerminal: 'P3.2', to: 'B1', toTerminal: 'a' },
    { from: 'MCU', fromTerminal: 'P1.1', to: 'POT', toTerminal: 'wiper' },
  ];
  const benchParts = [
    { id: 'MCU', kind: 'mcu', terminals: ['P1.0', 'P3.2', 'P1.1', 'P2.7'] },
    { id: 'LED1', kind: 'led' }, { id: 'B1', kind: 'button' }, { id: 'POT', kind: 'potentiometer' },
  ];

  it('resets the board and arms each MCU pin by what it is wired to', () => {
    const calls = [];
    let resets = 0;
    const out = armBoardForRun({
      board: { reset() { resets++; } }, parts: benchParts, wires,
      setPin: (pin, mode, high) => calls.push([pin, mode, high]),
    });
    assert.equal(resets, 1);
    assert.equal(out.mcu.id, 'MCU');
    assert.deepEqual(out.outputPins, ['P1.0', 'P2.7'], 'an LED pin and an unwired pin are outputs');
    assert.deepEqual(out.inputPins, ['P3.2']);
    assert.deepEqual(out.analogPins, ['P1.1']);
    assert.deepEqual(calls, [['P1.0', 'quasi', true], ['P2.7', 'quasi', true], ['P3.2', 'quasi', true], ['P1.1', 'input', false]]);
  });

  it('is a CLEAR: a program write before it is lost, one after it is kept — so it must run first', () => {
    const { BoardImpl } = getEngine();
    const fresh = () => { const b = new BoardImpl(5.0); b.setNetlist(parts, nets); b.setPower(true); return b; };
    const arm = (b) => armBoardForRun({ board: b, parts, wires: [{ from: 'MCU', fromTerminal: 'P1.0', to: 'LED1', toTerminal: 'cathode' }], setPin: (p, m, h) => b.setPin(p, m, h) });
    const writeFirst = fresh();
    writeFirst.setPin('P1.0', 'pushpull', false);   // the program: turn on led (active low)
    arm(writeFirst);                                  // the old order: the clear after it
    assert.deepEqual([writeFirst.pinStates.get('p1.0').mode, writeFirst.pinStates.get('p1.0').driveHigh], ['quasi', true], 'wiped');
    const armFirst = fresh();
    arm(armFirst);
    armFirst.setPin('P1.0', 'pushpull', false);
    assert.deepEqual([armFirst.pinStates.get('p1.0').mode, armFirst.pinStates.get('p1.0').driveHigh], ['pushpull', false], 'kept');
  });

  it('the designer arms from the green-flag event itself, before it changes mode, and the effect does not arm again', () => {
    const src = readFileSync(new URL('../src/components/CircuitDesigner.jsx', import.meta.url), 'utf8');
    const handler = src.slice(src.indexOf('const onGreenFlag = () => {'), src.indexOf("window.addEventListener('bw-green-flag', onGreenFlag);"));
    assert.ok(handler.includes('armBoardForRun('), 'the green-flag handler arms the run synchronously');
    assert.ok(handler.indexOf('armBoardForRun(') < handler.indexOf("setMode('simulate')"), 'and does so before the mode change');
    const effect = src.slice(src.indexOf('const armedByFlag = runArmedRef.current;'));
    assert.match(effect, /runArmedRef\.current = null;/, 'every run of the effect consumes the flag');
    assert.match(effect, /designerClockPlan\(\{ armedByFlag, board: circuit\.board, released \}\)/, 'and decides through the tested plan');
    assert.match(effect, /plan === 'reuse' \? armedByFlag\.armed/, 'and reuses its arming instead of clearing again');
  });
});

// brickwright-lite task B8, measured in a real browser on production (54-motor-
// driver, three green flags on one page): from the second flag on the designer
// displayed a debugger's private board while the Scratch VM wrote the designer's
// own board, which was never cleared (the flag skipped it while ANY external
// board was on screen) and never clocked again (the simulation effect did not
// re-run when the external board went away): frozen at 500 ms of board time
// for every later run.
describe('one board per run: the designer binding (task B8)', () => {
  it('the green flag arms the own board unless it is the board the external engine drives', () => {
    const own = {}; const other = {};
    assert.equal(greenFlagArmsOwnBoard({ ownBoard: own, externalBoard: undefined }), true);
    assert.equal(greenFlagArmsOwnBoard({ ownBoard: own, externalBoard: other }), true, 'a debugger board on screen does not exempt the VM board');
    assert.equal(greenFlagArmsOwnBoard({ ownBoard: own, externalBoard: own }), false, 'a machine on the designer board is not cleared under its CPU');
    assert.equal(greenFlagArmsOwnBoard({ ownBoard: null, externalBoard: undefined }), false);
  });

  it('the clock plan: reuse the flag, resume a handed-back board, arm otherwise', () => {
    const b = {}; const stale = {};
    assert.equal(designerClockPlan({ armedByFlag: { board: b }, board: b, released: false }), 'reuse');
    assert.equal(designerClockPlan({ armedByFlag: { board: b }, board: b, released: true }), 'reuse', 'a flag that armed this board wins over the hand-back');
    assert.equal(designerClockPlan({ armedByFlag: null, board: b, released: true }), 'resume');
    assert.equal(designerClockPlan({ armedByFlag: { board: stale }, board: b, released: false }), 'arm', 'an arming of a rebuilt board is not reused');
    assert.equal(designerClockPlan({ armedByFlag: null, board: b, released: false }), 'arm');
  });

  it('a resumed board keeps what the program wrote; classifyRunPins touches no board', () => {
    const { BoardImpl } = getEngine();
    const b = new BoardImpl(5.0); b.setNetlist(parts, nets); b.setPower(true);
    const w = [{ from: 'MCU', fromTerminal: 'P1.0', to: 'LED1', toTerminal: 'cathode' }];
    armBoardForRun({ board: b, parts, wires: w, setPin: (p, m, h) => b.setPin(p, m, h) });
    b.setPin('P1.0', 'pushpull', false);
    b.advanceTo(200_000_000n);
    const pins = classifyRunPins({ parts, wires: w });
    assert.deepEqual(pins.outputPins, ['P1.0']);
    assert.deepEqual([b.pinStates.get('p1.0').mode, b.pinStates.get('p1.0').driveHigh], ['pushpull', false], 'the write survives');
    assert.equal(b.timeNs, 200_000_000n, 'and board time is not reset');
  });

  it('the designer wires both: the flag through greenFlagArmsOwnBoard, the effect re-runs on the hand-back', () => {
    const src = readFileSync(new URL('../src/components/CircuitDesigner.jsx', import.meta.url), 'utf8');
    const handler = src.slice(src.indexOf('const onGreenFlag = () => {'), src.indexOf("window.addEventListener('bw-green-flag', onGreenFlag);"));
    assert.match(handler, /greenFlagArmsOwnBoard\(\{ ownBoard: live\.board, externalBoard: live\.externalBoard \}\)/);
    assert.doesNotMatch(handler, /!live\.externalBoard && live\.board/, 'the old skip-while-anything-external rule');
    assert.match(handler, /runArmedRef\.current = live\.mode === 'simulate' && !live\.externalBoard \? null/, 'the arming waits for the hand-back too');
    const effect = src.slice(src.indexOf('const armedByFlag = runArmedRef.current;'));
    assert.match(effect, /\}, \[mode, parts, wires, stc, hasExternalBoard\]\);/, 'the effect re-runs when the external board comes or goes');
    assert.match(effect, /const released = hadExternalRef\.current && !hasExternalBoard;/);
  });
});
