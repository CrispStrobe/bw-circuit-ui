/**
 * Seated inference for the MakeCode boards: a program for a Calliope mini, a
 * Circuit Playground Express or a micro:bit arrives as that BOARD, its declared
 * pins on the board's own pads, the breadboard powered from the board.
 *
 * Before this, all three fell through to the generic 8051 `mcu` DIP, its pins
 * named `Pundefined.undefined` (the dialect's `where: 'P0'` has no port/bit),
 * so nothing a program declared reached a pad.
 *
 * Each section drives the build through the real designer model:
 *   1. which part is placed, and which pad each declared pin's part hangs on
 *      (read from the resolved nets, not from the builder's own bookkeeping);
 *   2. the electrical proof — the pad drives an LED whose current returns
 *      through the board's own GND pad, a button reaches the pad, a pot's wiper
 *      reads on it. Needs a bw-board that registers the kind; against one that
 *      does not it SKIPS by name (the micro:bit model is bw-board #137).
 */

import './_setup.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Circuit, resetIds } from '../src/model/circuit.js';
import { buildSeatedFromDeclarations, makeCodeBoardFor } from '../src/model/infer-seated.js';
import { getSidecar } from '../src/model/parts-registry.js';
import { getEngine } from '../src/engine.js';

// [device as the program names it, board kind, out pad, in pad, analog pad, supply pad, pin spelling]
const BOARDS = [
  ['calliopemini', 'calliopemini', 'p0', 'p1', 'p2', '3v', p => p.toUpperCase()],
  ['circuit_playground_express', 'circuit_playground_express', 'a1', 'a2', 'a3', '3v3', p => p.toUpperCase()],
  ['microbit', 'microbit', 'p0', 'p1', 'p2', '3v', p => p.toUpperCase()],
];

function build(device, out, inp, ana, spell, extra = []) {
  resetIds();
  const c = new Circuit(5.0);
  const { notes } = buildSeatedFromDeclarations(c, {
    device,
    pins: [
      { name: 'led', where: spell(out), direction: 'output', activeLow: false },
      { name: 'btn', where: spell(inp), direction: 'input', activeLow: false },
      { name: 'pot', where: spell(ana), direction: 'analog', activeLow: false },
      ...extra,
    ],
  });
  return { c, notes };
}

/** The board terminals sharing a resolved net with `partId.terminal`. */
function boardPadsOn(c, boardId, partId, terminal) {
  const net = c.board.nets.find(n => n.terminals.some(t => t.part === partId && t.terminal === terminal));
  assert.ok(net, `${partId}.${terminal} is on no net`);
  return net.terminals.filter(t => t.part === boardId).map(t => t.terminal).sort();
}

describe('a MakeCode program seats its own board', () => {
  for (const [device, kind, out, inp, ana, supply, spell] of BOARDS) {
    it(`${device}: the ${kind} part, each declared pin on its pad`, () => {
      const { c } = build(device, out, inp, ana, spell);
      const board = c.parts.find(p => p.kind === kind);
      assert.ok(board, `no ${kind} part: placed ${c.parts.map(p => p.kind).join(', ')}`);
      assert.ok(!c.parts.some(p => p.kind === 'mcu'), 'fell through to the generic mcu');
      assert.ok(!c.parts.some(p => p.kind === 'vsource'), 'the board powers the rails; no bench battery');
      // The pads used are the sidecar's own names — no second naming.
      const pads = getSidecar(kind).terminals.map(t => t.name);
      for (const pad of [out, inp, ana, supply, 'gnd']) assert.ok(pads.includes(pad), `${pad} is not a ${kind} pad`);

      const led = c.parts.find(p => p.kind === 'led');
      const r = c.parts.find(p => p.kind === 'resistor' && p.params.ohms === 1000);
      const btn = c.parts.find(p => p.kind === 'button');
      const pot = c.parts.find(p => p.kind === 'potentiometer');
      // LED chain: pad → 1k → LED → − rail = the board's GND pad.
      assert.deepEqual(boardPadsOn(c, board.id, r.id, 'a'), [out]);
      assert.deepEqual(boardPadsOn(c, board.id, led.id, 'cathode'), ['gnd']);
      // Button between the pad and the board's supply pad.
      assert.deepEqual(boardPadsOn(c, board.id, btn.id, 'a'), [inp]);
      assert.deepEqual(boardPadsOn(c, board.id, btn.id, 'b'), [supply]);
      // Pot wiper on the analog pad, ends on supply and GND.
      assert.deepEqual(boardPadsOn(c, board.id, pot.id, 'wiper'), [ana]);
      assert.deepEqual(boardPadsOn(c, board.id, pot.id, 'a'), [supply]);
      assert.deepEqual(boardPadsOn(c, board.id, pot.id, 'b'), ['gnd']);
    });
  }

  it('the pin spellings MakeCode uses resolve to the same pads', () => {
    for (const [where, device, pad] of [
      ['DigitalPin.P2', 'calliopemini', 'p2'], ['AnalogPin.P1', 'microbit', 'p1'],
      ['CPlayPinName.A7', 'circuit_playground_express', 'a7'], ['a0', 'cpx', 'a0'], ['A4', 'adafruit', 'a4'],
    ]) {
      resetIds();
      const c = new Circuit(5.0);
      buildSeatedFromDeclarations(c, { device, pins: [{ name: 'led', where, direction: 'output' }] });
      const board = c.parts.find(p => p.kind === makeCodeBoardFor(device).kind);
      const r = c.parts.find(p => p.kind === 'resistor');
      assert.deepEqual(boardPadsOn(c, board.id, r.id, 'a'), [pad], `${device} ${where}`);
    }
  });

  it('a pin that is no pad of the board is refused by name, not wired to a guess', () => {
    const { c, notes } = build('circuit_playground_express', 'a1', 'a2', 'a3', p => p.toUpperCase(),
      [{ name: 'neo', where: 'D8', direction: 'output' }]);
    assert.equal(c.parts.filter(p => p.kind === 'led').length, 1, 'only the pad pin got an LED');
    assert.ok(notes.some(n => /^neo: D8 is not a pad of the Circuit Playground Express \(a0, .*a7\)/.test(n)), notes.join('\n'));
  });
});

describe('the seated MakeCode board drives its circuit', () => {
  for (const [device, kind, out, inp, ana, , spell] of BOARDS) {
    it(`${device}: ${out} lights the LED through the board's GND pad; ${inp} reads the button; ${ana} the pot`, (t) => {
      if (!getEngine().getDevice(kind)) {
        t.skip(`the pinned bw-board has no '${kind}' model, so its pads run as the generic 'mcu' surface (bw-board #137 adds the micro:bit)`);
        return;
      }
      const { c } = build(device, out, inp, ana, spell);
      const board = c.parts.find(p => p.kind === kind);
      const led = c.parts.find(p => p.kind === 'led');
      c.board.setPin(out, 'pushpull', true);
      const iGnd = Math.abs(c.board.branchCurrent(board.id, 'gnd')) * 1000;
      const iLed = Math.abs(c.board.branchCurrent(led.id, 'anode')) * 1000;
      // 3.3 V behind the pad's 25 R, 1k, a red LED: about 1.4 mA, all of it
      // returning into the board's own GND pad.
      assert.ok(iLed > 1 && iLed < 2, `LED ${iLed.toFixed(3)} mA`);
      assert.ok(iGnd >= iLed - 0.01, `GND pad carries ${iGnd.toFixed(3)} mA, LED ${iLed.toFixed(3)} mA`);
      assert.ok(c.board.ledBrightness(led.id) > 0.02, 'the LED lights');
      c.board.setPin(out, 'pushpull', false);
      assert.equal(c.board.ledBrightness(led.id), 0, 'pad low: dark');

      const btn = c.parts.find(p => p.kind === 'button');
      c.board.setPin(inp, 'input', false);
      assert.equal(c.board.readPin(inp), 0, 'released: the 10k pull-down holds it low');
      c.board.setControl(btn.id, 1);
      assert.equal(c.board.readPin(inp), 1, 'pressed: the 3V rail pulls it high');

      const pot = c.parts.find(p => p.kind === 'potentiometer');
      c.board.setPin(ana, 'input', false);
      c.board.setControl(pot.id, 0.5);
      const v = c.board.readAnalog(ana);
      assert.ok(Math.abs(v - 1.65) < 0.15, `wiper at mid-travel reads ~1.65 V: ${v}`);
    });
  }
});
