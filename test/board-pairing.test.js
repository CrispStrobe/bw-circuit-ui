/**
 * SCH/PCB pairing: the partition diff, and its honesty rules.
 *
 * Synthetic cases first (each hand-built, expected results stated before
 * running), then the live pair — where the expected findings are facts
 * established by the copper netlist AND cross-checked against the raw
 * files with an independent Python sweep:
 *
 *   BROKEN pair: no splits, no error bridges. Its two real faults are out
 *   of this diff's jurisdiction by design — the battery is unmapped in
 *   the schematic (reported via onlyBoard), and the six dead keys
 *   collapse identically on both sides (terminal-short is pcb-drc's).
 *
 *   FIXED pair: EXACTLY two error bridges — the three hairline via-track
 *   overlaps short five keypad columns into two groups:
 *   {SW14,SW15} and {SW2,SW16,SW17}. The pairing diff sees them because
 *   the schematic keeps those columns apart and the copper does not.
 *
 *   FIXED also reports ONE vocabulary mismatch: D1, a 1N5817 sitting in
 *   a resistor footprint on the board. (The OLED used to be a second one
 *   until its module land pattern — with the pin order MEASURED via this
 *   very diff — let it lift to the ssd1306 kind the schematic reads.)
 */

import './_setup.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { importEasyEda } from '../src/importers/easyeda.js';
import { importEasyEdaPcb } from '../src/importers/easyeda-pcb.js';
import { liftBoardToCircuit } from '../src/model/board-lift.js';
import { diffBoardAgainstSchematic, circuitPartition } from '../src/model/board-pairing.js';

const wire = (from, fromTerminal, to, toTerminal) => ({ from, fromTerminal, to, toTerminal });
const part = (id, kind, params = {}) => ({ id, kind, params, x: 0, y: 0 });

describe('circuitPartition', () => {
  test('wires union across terminals, and rails dissolve', () => {
    const P = circuitPartition({
      parts: [part('GND1', 'gnd'), part('R1', 'resistor'), part('C1', 'capacitor')],
      wires: [
        wire('R1', 'b', 'GND1', 'gnd'),
        wire('C1', 'b', 'GND1', 'gnd'),
        wire('R1', 'a', 'C1', 'a'),
      ],
    });
    assert.equal(P.groups.find('R1/b'), P.groups.find('C1/b'), 'joined through the rail');
    assert.equal(P.groups.find('R1/a'), P.groups.find('C1/a'));
    assert.notEqual(P.groups.find('R1/a'), P.groups.find('R1/b'));
  });
});

describe('the diff, synthetically', () => {
  const schBase = {
    parts: [part('R1', 'resistor'), part('SW1', 'button')],
    wires: [wire('R1', 'b', 'SW1', 'a')],
  };

  test('agreement is silence', () => {
    const d = diffBoardAgainstSchematic(schBase, schBase);
    assert.deepEqual(d.splits, []);
    assert.deepEqual(d.bridges, []);
    assert.deepEqual(d.vocabularyMismatch, []);
  });

  test('a schematic net the board leaves apart is a SPLIT', () => {
    const board = { parts: schBase.parts, wires: [] };
    // Force both nodes into the board universe by wiring them elsewhere:
    // an unwired-on-board node still splits, as its own solo island.
    const d = diffBoardAgainstSchematic(schBase, board);
    assert.equal(d.splits.length, 1);
    assert.deepEqual(d.splits[0].net, ['R1.b', 'SW1.a']);
    assert.equal(d.splits[0].islands.length, 2);
  });

  test('a board island joining two DRAWN nets is an error BRIDGE', () => {
    const sch = {
      parts: [part('R1', 'resistor'), part('R2', 'resistor'), part('SW1', 'button')],
      wires: [wire('R1', 'a', 'SW1', 'a'), wire('R2', 'a', 'SW1', 'b')],
    };
    const board = {
      parts: sch.parts,
      wires: [wire('R1', 'a', 'SW1', 'a'), wire('R2', 'a', 'SW1', 'b'), wire('R1', 'a', 'R2', 'a')],
    };
    const d = diffBoardAgainstSchematic(sch, board);
    assert.equal(d.bridges.length, 1);
    assert.equal(d.bridges[0].severity, 'error');
    assert.equal(d.bridges[0].nets.length, 2);
  });

  test('a board joining pins the schematic never draws is info', () => {
    const sch = {
      parts: [part('U1', 'pi_pico'), part('SW1', 'button')],
      wires: [wire('U1', 'gnd_1', 'SW1', 'b')],
    };
    const board = {
      parts: sch.parts,
      wires: [wire('U1', 'gnd_1', 'SW1', 'b'), wire('U1', 'gnd_4', 'SW1', 'b')],
    };
    const d = diffBoardAgainstSchematic(sch, board);
    assert.equal(d.bridges.length, 1);
    assert.equal(d.bridges[0].severity, 'info');
  });

  test('different kinds are a reported mismatch, not a guessed diff', () => {
    const sch = { parts: [part('OLED1', 'ssd1306'), part('R1', 'resistor')], wires: [wire('OLED1', 'sda', 'R1', 'a')] };
    const board = { parts: [part('OLED1', 'header', { pins: 4 }), part('R1', 'resistor')], wires: [wire('OLED1', 'p1', 'R1', 'a')] };
    const d = diffBoardAgainstSchematic(sch, board);
    assert.deepEqual(d.vocabularyMismatch, [{ ref: 'OLED1', schKind: 'ssd1306', boardKind: 'header' }]);
    // And crucially: NO split and NO bridge was manufactured from the gap.
    assert.deepEqual(d.splits, []);
    assert.deepEqual(d.bridges, []);
  });

  test('parts only one side knows are listed, never diffed', () => {
    const sch = { parts: [part('R1', 'resistor'), part('R9', 'resistor')], wires: [] };
    const board = { parts: [part('R1', 'resistor'), part('X7', 'button')], wires: [] };
    const d = diffBoardAgainstSchematic(sch, board);
    assert.deepEqual(d.onlySchematic, ['R9']);
    assert.deepEqual(d.onlyBoard, ['X7']);
    assert.deepEqual(d.comparedRefs, ['R1']);
  });
});

// ── live corpus ────────────────────────────────────────────────────

const LIVE = process.env.BW_PCB_BOARDS || join(homedir(), 'Downloads');
const pairs = {
  broken: ['SCH_TaschenRechner3_2026-08-25.json', 'PCB_PCB_TaschenRechner3_2026-08-25.json'],
  fixed: ['SCH_TaschenRechner3_FIXED.json', 'PCB_TaschenRechner3_FIXED.json'],
};
const haveLive = Object.values(pairs).flat().every((f) => existsSync(join(LIVE, f)));
const diffPair = ([schF, pcbF]) => diffBoardAgainstSchematic(
  importEasyEda(readFileSync(join(LIVE, schF), 'utf8')),
  liftBoardToCircuit(importEasyEdaPcb(readFileSync(join(LIVE, pcbF), 'utf8'))),
);

describe('live pair (skips without the local boards)', { skip: !haveLive }, () => {
  test('broken pair: quiet here, loud in the right places elsewhere', () => {
    const d = diffPair(pairs.broken);
    assert.deepEqual(d.splits, []);
    assert.deepEqual(d.bridges.filter((b) => b.severity === 'error'), []);
    // Nothing unmatched any more: the ssd1306 land pattern (measured pin
    // order) lets the OLED lift to the same kind the schematic reads.
    assert.deepEqual(d.vocabularyMismatch, []);
    assert.ok(d.onlyBoard.includes('BAT1'), 'the battery is board-only (unmapped in the schematic)');
  });

  test('fixed pair: the three hairline shorts arrive as two error bridges', () => {
    const d = diffPair(pairs.fixed);
    const errors = d.bridges.filter((b) => b.severity === 'error');
    assert.equal(errors.length, 2);
    const groups = errors.map((b) => b.nets.flat().filter((n) => /^SW/.test(n)).sort().join(' ')).sort();
    assert.deepEqual(groups, ['SW14.a SW15.a', 'SW16.a SW17.a SW2.a']);
    assert.deepEqual(d.splits, []);
    assert.deepEqual(d.vocabularyMismatch.map((v) => v.ref), ['D1']);
  });
});
