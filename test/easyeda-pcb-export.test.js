/**
 * EasyEDA PCB export: THE ROUND-TRIP ORACLE, never eyeballing.
 *
 * The discipline copied from easyeda-schematic.js, extended to boards:
 * export → importEasyEdaPcb → the copper partition must equal the
 * source's, pad for pad — and one step further: the DRC VERDICT of the
 * re-imported copy must equal the original's, finding for finding. A
 * writer that loses a defect in translation would launder a broken
 * board into a clean-looking file; the verdict equality is what makes
 * that impossible to miss.
 *
 * Three round trips:
 *   - the mini fixture (hand-authored, has a planted net-island defect
 *     that must SURVIVE the trip),
 *   - a projected board (clean, must STAY clean),
 *   - the live corpus (the broken calculator's 10 board-only findings
 *     — terminal-shorts included — arrive intact on the far side;
 *     TinyProbe's pours round-trip with their file-carried fills).
 */

import './_setup.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { importEasyEdaPcb } from '../src/importers/easyeda-pcb.js';
import { exportEasyEdaPcb } from '../src/model/exporters/easyeda-pcb.js';
import { detectFormat } from '../src/importers/detect.js';
import { runPcbDrc } from '../src/model/pcb-drc.js';
import { computeCopperNetlist } from '../src/model/copper-netlist.js';
import { liftBoardToCircuit } from '../src/model/board-lift.js';
import { projectBoard } from '../src/model/board-projection.js';

const FIX = join(import.meta.dirname, 'fixtures');
const read = (f) => readFileSync(join(FIX, f), 'utf8');

/** Canonical pad partition: sorted list of sorted "REF.num" island sets. */
const partition = (board) => computeCopperNetlist(board).islands
  .filter((i) => i.pads.length)
  .map((i) => i.pads.map((p) => `${p.ref || ''}.${p.num}`).sort().join(' '))
  .sort();

/** Canonical DRC verdict: sorted rule:severity list. */
const verdict = (board) => runPcbDrc(board).map((x) => `${x.rule}:${x.severity}`).sort();

function roundTrip(board) {
  const text = exportEasyEdaPcb(board);
  assert.equal(detectFormat(text), 'easyeda-pcb', 'the export must detect as what it is');
  const back = importEasyEdaPcb(text);
  assert.deepEqual(back.warnings, [], 'a clean model must re-import without warnings');
  return back;
}

describe('mini fixture round trip', () => {
  const b1 = importEasyEdaPcb(read('easyeda-pcb-mini.json'));
  const b2 = roundTrip(b1);

  test('every part and pad arrives', () => {
    assert.equal(b2.parts.length, b1.parts.length);
    assert.deepEqual(b2.parts.map((p) => p.ref).sort(), ['R1', 'SW1']);
    assert.deepEqual(b2.nets, b1.nets);
  });

  test('the copper partition is identical', () => {
    assert.deepEqual(partition(b2), partition(b1));
  });

  test('verdicts equal, finding for finding', () => {
    assert.deepEqual(verdict(b2), verdict(b1));
  });

  test('a PLANTED defect survives the trip', () => {
    // R1.1 relabelled N1: a genuine split (no copper and no internal
    // terminal reaches it). The written file must carry the fault.
    const planted = importEasyEdaPcb(read('easyeda-pcb-mini.json'));
    planted.parts.find((p) => p.ref === 'R1').pads.find((p) => p.num === '1').net = 'N1';
    assert.ok(verdict(planted).includes('net-island:danger'), 'the planted defect must exist');
    const back = roundTrip(planted);
    assert.deepEqual(verdict(back), verdict(planted));
  });

  test('geometry survives to a tenth of a micron', () => {
    const p1 = b1.parts[0].pads[0]; const p2 = b2.parts[0].pads[0];
    assert.ok(Math.abs(p1.x - p2.x) < 1e-4 && Math.abs(p1.y - p2.y) < 1e-4);
    assert.ok(Math.abs(p1.drill - p2.drill) < 1e-4);
    assert.ok(Math.abs(b1.bbox.w - b2.bbox.w) < 1e-3);
  });

  test('the pour keeps its file-carried fill through the trip', () => {
    assert.equal(b2.pours.length, 1);
    assert.equal(b2.pours[0].fillFromFile, true);
    assert.equal(b2.pours[0].net, 'GND');
  });
});

describe('projected board round trip', () => {
  const circuit = {
    parts: [
      { id: 'J1', kind: 'header', params: { pins: 2 } },
      { id: 'R1', kind: 'resistor', params: {} },
      { id: 'LED1', kind: 'led', params: {} },
    ],
    wires: [
      { from: 'J1', fromTerminal: 'p1', to: 'R1', toTerminal: 'a' },
      { from: 'R1', fromTerminal: 'b', to: 'LED1', toTerminal: 'anode' },
      { from: 'LED1', fromTerminal: 'cathode', to: 'J1', toTerminal: 'p2' },
    ],
  };

  test('clean stays clean, and the partition holds', () => {
    const { board } = projectBoard(circuit);
    const back = roundTrip(board);
    assert.deepEqual(verdict(back), []);
    assert.deepEqual(partition(back), partition(board));
  });
});

// ── live corpus ────────────────────────────────────────────────────

const LIVE = process.env.BW_PCB_BOARDS || join(homedir(), 'Downloads');
const BROKEN = join(LIVE, 'PCB_PCB_TaschenRechner3_2026-08-25.json');
const PROBE = join(LIVE, 'PCB_TinyProbe_v1.0_2026-08-20.json');
const haveLive = [BROKEN, PROBE].every((f) => existsSync(f));

describe('live corpus round trips (skips without the local boards)', { skip: !haveLive }, () => {
  test('the broken calculator: 21 parts and every defect arrive intact', () => {
    const b1 = importEasyEdaPcb(readFileSync(BROKEN, 'utf8'));
    const b2 = roundTrip(b1);
    assert.equal(b2.parts.length, 21);
    assert.deepEqual(partition(b2), partition(b1));
    const v = verdict(b2);
    assert.deepEqual(v, verdict(b1));
    assert.equal(v.filter((x) => x === 'terminal-short:danger').length, 6,
      'all six dead keys must survive the trip');
  });

  test('TinyProbe: pours with fills, still clean on the far side', () => {
    const b1 = importEasyEdaPcb(readFileSync(PROBE, 'utf8'));
    const b2 = roundTrip(b1);
    assert.deepEqual(partition(b2), partition(b1));
    assert.deepEqual(verdict(b2), []);
    assert.ok(b2.pours.every((c) => c.fillFromFile));
  });

  test('the full circle: broken board -> lift -> projection -> file -> clean board', () => {
    const lift = liftBoardToCircuit(importEasyEdaPcb(readFileSync(BROKEN, 'utf8')));
    const { board } = projectBoard({ parts: lift.parts, wires: lift.wires });
    const back = roundTrip(board);
    assert.deepEqual(verdict(back), []);
    assert.deepEqual(partition(back), partition(board));
    assert.equal(back.parts.length, 21);
  });
});
