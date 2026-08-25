/**
 * Phase 8's honest core: simulate the board AS BUILT, not as drawn.
 *
 * The lift wires the circuit from the COPPER netlist plus the parts'
 * internal terminal maps, so a board fault IS a circuit fact after
 * lifting — no new simulator machinery, the same partition the MNA
 * solve consumes. These tests pin that at the partition level:
 *
 *   - plant a terminal-short in the mini fixture (GND onto the other
 *     pad of SW1's terminal `a`) → the lifted circuit's N1 node and its
 *     GND node become ONE electrical node. A simulator fed this circuit
 *     shows the key permanently pressed — no fault-injection pass
 *     needed, the lift already told the truth.
 *   - live: the broken calculator's six dead keys — after lifting, the
 *     six shorted GPIO columns sit in the SAME node as GND; on the
 *     repaired board they do not (its faults are different ones).
 */

import './_setup.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { importEasyEdaPcb } from '../src/importers/easyeda-pcb.js';
import { liftBoardToCircuit } from '../src/model/board-lift.js';
import { circuitPartition } from '../src/model/board-pairing.js';

const FIX = join(import.meta.dirname, 'fixtures');
const mini = () => importEasyEdaPcb(readFileSync(join(FIX, 'easyeda-pcb-mini.json'), 'utf8'));

/** Are two (ref, terminal) nodes one electrical node in the lifted circuit? */
function sameNode(lift, a, b) {
  const P = circuitPartition(lift);
  return P.groups.find(a.replace('.', '/')) === P.groups.find(b.replace('.', '/'));
}

describe('the lift carries the fault into the simulation input', () => {
  test('healthy mini: the button terminal is NOT on the ground node', () => {
    const lift = liftBoardToCircuit(mini());
    assert.equal(sameNode(lift, 'SW1.a', 'SW1.b'), false,
      'a and b of an open switch must be separate nodes');
  });

  test('planted terminal-short: the key is soldered pressed', () => {
    const board = mini();
    // The real dead keys ROUTE the ground column onto a pad that shares
    // the GPIO pad's internal terminal. Plant exactly that: label SW1
    // pad 3 (terminal `a`, like pad 1) GND, and run GND copper to it —
    // a bottom track from the pour region to the pad.
    const sw = board.parts.find((p) => p.ref === 'SW1');
    const p3 = sw.pads.find((p) => p.num === '3');
    p3.net = 'GND';
    board.tracks.push({
      layer: 'bottom', layerId: 2, net: 'GND', width: 0.6096,
      points: [[p3.x, p3.y], [18.5, p3.y]], id: 'planted',
    });
    const lift = liftBoardToCircuit(board);
    // The COPPER never touches the N1 route — yet in the lifted circuit
    // terminal `a` (pads 1 and 3) is one node, so the GPIO side and the
    // ground side collapse: the key reads pressed forever. That is the
    // fault the simulator now SHOWS instead of a DRC string naming it.
    assert.equal(sameNode(lift, 'SW1.a', 'SW1.b'), true, 'a and b joined: soldered pressed');
    assert.equal(sameNode(lift, 'R1.b', 'SW1.b'), true, 'and the GPIO route is on ground');
  });
});

// ── live corpus ────────────────────────────────────────────────────

const LIVE = process.env.BW_PCB_BOARDS || join(homedir(), 'Downloads');
const BROKEN = join(LIVE, 'PCB_PCB_TaschenRechner3_2026-08-25.json');
const FIXED = join(LIVE, 'PCB_TaschenRechner3_FIXED.json');
const haveLive = [BROKEN, FIXED].every((f) => existsSync(f));

describe('live (skips without the local boards)', { skip: !haveLive }, () => {
  test('broken board, lifted: the six dead keys sit ON the ground node', () => {
    const lift = liftBoardToCircuit(importEasyEdaPcb(readFileSync(BROKEN, 'utf8')));
    // The dead keys (DRC: SW5, SW8, SW11, SW13, SW14, SW16) tie a GPIO
    // column to ground through their internal terminals. After lifting,
    // each of those columns is electrically one node with a GND pin.
    // gp4/gp6/gp10/gp13/gp14/gp15 are the columns measured earlier.
    for (const gp of ['gp4', 'gp6', 'gp10', 'gp13', 'gp14', 'gp15']) {
      assert.equal(sameNode(lift, `U2.${gp}`, 'U2.gnd_1'), true,
        `${gp} must sit on ground: that is what a dead key IS`);
    }
    // And a healthy column does not.
    assert.equal(sameNode(lift, 'U2.gp0', 'U2.gnd_1'), false, 'gp0 (OLED SDA) stays free');
  });

  test('repaired board, lifted: the keys are free again', () => {
    const lift = liftBoardToCircuit(importEasyEdaPcb(readFileSync(FIXED, 'utf8')));
    for (const gp of ['gp4', 'gp6', 'gp10', 'gp13', 'gp14', 'gp15']) {
      assert.equal(sameNode(lift, `U2.${gp}`, 'U2.gnd_1'), false, `${gp} freed by the repair`);
    }
  });
});
