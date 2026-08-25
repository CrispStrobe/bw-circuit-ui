/**
 * The lift: a board becomes the circuit it implements.
 *
 * Mini fixture, worked out on paper: R1 lifts to a resistor, SW1 to a
 * button; the copper joins R1.2 to SW1.1, so the lifted circuit is ONE
 * wire, resistor.b — button.a. SW1's pads 2 and 4 are one terminal (b)
 * joined by copper — an island that collapses to a single endpoint and
 * must produce NO wire. SW1.3 and R1.1 reach nothing.
 *
 * Live: the broken calculator lifts completely — 21 parts, no unmapped
 * footprints, no unmapped pads — and the lifted wires encode the board AS
 * BUILT: BAT1's neg terminal is wired to NOTHING (the battery fault), and
 * U2's gnd terminals ARE wired to the switches.
 */

import './_setup.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { importEasyEdaPcb } from '../src/importers/easyeda-pcb.js';
import { liftBoardToCircuit } from '../src/model/board-lift.js';

const FIX = join(import.meta.dirname, 'fixtures');
const read = (f) => readFileSync(join(FIX, f), 'utf8');

describe('mini fixture', () => {
  const board = importEasyEdaPcb(read('easyeda-pcb-mini.json'));
  const lift = liftBoardToCircuit(board);

  test('both parts lift to their kinds', () => {
    assert.deepEqual(
      lift.parts.map((p) => `${p.id}:${p.kind}`).sort(),
      ['R1:resistor', 'SW1:button'],
    );
    assert.deepEqual(lift.unmapped, []);
  });

  test('exactly one wire: resistor.b to button.a', () => {
    assert.equal(lift.wires.length, 1);
    const w = lift.wires[0];
    const ends = [`${w.from}.${w.fromTerminal}`, `${w.to}.${w.toTerminal}`].sort();
    assert.deepEqual(ends, ['R1.b', 'SW1.a']);
  });

  test('the report accounts for everything', () => {
    assert.equal(lift.report.liftedParts, 2);
    assert.equal(lift.report.unmappedPads, 0);
    assert.equal(lift.report.approxIslands, 0);
  });
});

// ── live corpus ────────────────────────────────────────────────────

const LIVE = process.env.BW_PCB_BOARDS || join(homedir(), 'Downloads');
const BROKEN = join(LIVE, 'PCB_PCB_TaschenRechner3_2026-08-25.json');
const haveLive = existsSync(BROKEN);

describe('live corpus (skips without the local boards)', { skip: !haveLive }, () => {
  const board = importEasyEdaPcb(readFileSync(BROKEN, 'utf8'));
  const lift = liftBoardToCircuit(board);

  test('the whole calculator lifts: 21 parts, nothing unmapped', () => {
    assert.equal(lift.parts.length, 21);
    assert.deepEqual(lift.unmapped, []);
    assert.equal(lift.report.unmappedPads, 0);
    const kinds = {};
    for (const p of lift.parts) kinds[p.kind] = (kinds[p.kind] || 0) + 1;
    // Seventeen tact switches — the plan's own count — plus the power
    // slide switch, the OLED module (a real ssd1306 since its pattern
    // carries the measured pin order), the battery holder, and the Pico.
    assert.deepEqual(kinds, { button: 17, slide_switch: 1, ssd1306: 1, battery_aa: 1, pi_pico: 1 });
  });

  test('the lifted circuit is the board as built: the battery is an island', () => {
    const touches = (id) => lift.wires.filter((w) => w.from === id || w.to === id);
    // BAT1.neg carried GND on the board, but its copper reaches nothing:
    // the battery fault survives the lift, which is the point of lifting
    // from copper instead of from labels.
    assert.equal(touches('BAT1').length, 0, 'BAT1 must be wired to nothing');
    // The keypad ground DOES reach the Pico.
    const gndWires = lift.wires.filter((w) =>
      (w.from === 'U2' && /gnd/.test(w.fromTerminal)) ||
      (w.to === 'U2' && /gnd/.test(w.toTerminal)));
    assert.ok(gndWires.length >= 1, 'U2 ground is wired to the keypad returns');
  });
});
