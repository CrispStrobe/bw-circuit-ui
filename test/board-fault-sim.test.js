/**
 * Phase 8, at the MNA level: the fault is not a finding, it is a lit LED.
 *
 * One circuit — VCC → R 220Ω → LED → key → GND — projected to a clean
 * board, then a second copy with THE fault of plan §1 planted physically:
 * the GND column routed (on the empty bottom layer) onto the pad that
 * shares the key's internal terminal with the LED side. The copper never
 * touches the LED route; the DRC names it terminal-short; and when the
 * lifted circuits are handed to bw-board's real engine:
 *
 *   healthy board:  key unpressed → LED dark        (brightness ≈ 0)
 *   faulty board:   key soldered pressed → LED LIT  (brightness ≈ 0.5+)
 *
 * No fault-injection machinery anywhere — the lift built the simulation
 * input from copper + terminal maps, and the engine simply solved what
 * the fab would have shipped.
 */

import './_setup.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getEngine } from '../src/engine.js';
import { terminalsForKind } from '../src/model/circuit.js';
import { projectBoard, netsFromCircuit } from '../src/model/board-projection.js';
import { liftBoardToCircuit } from '../src/model/board-lift.js';
import { runPcbDrc } from '../src/model/pcb-drc.js';

const CIRCUIT = {
  parts: [
    { id: 'J1', kind: 'header', params: { pins: 2 } },
    { id: 'R1', kind: 'resistor', params: { ohms: 220 } },
    { id: 'LED1', kind: 'led', params: {} },
    { id: 'SW1', kind: 'button', params: {} },
  ],
  wires: [
    { from: 'J1', fromTerminal: 'p1', to: 'R1', toTerminal: 'a' },
    { from: 'R1', fromTerminal: 'b', to: 'LED1', toTerminal: 'anode' },
    { from: 'LED1', fromTerminal: 'cathode', to: 'SW1', toTerminal: 'a' },
    { from: 'SW1', fromTerminal: 'b', to: 'J1', toTerminal: 'p2' },
  ],
};

/** Project, optionally plant the terminal-short, and lift back. */
function boardCircuit({ planted }) {
  const { board } = projectBoard(CIRCUIT);
  if (planted) {
    const sw = board.parts.find((p) => p.ref === 'SW1');
    // The projection nets ONE pad per terminal — the fault lands on the
    // UNNETTED twin of terminal `a` (whichever of pads 1/3 that is).
    const p3 = sw.pads.find((p) => (p.num === '1' || p.num === '3') && !p.net);
    const bNet = sw.pads.filter((q) => q.num === '2' || q.num === '4')
      .map((q) => q.net).find(Boolean);
    p3.net = bNet;
    // The strap runs between the switch's OWN two pads at the same
    // height — the 6.5 mm across the body crosses nothing else (two
    // longer detours measured before this: a run at pad height ploughed
    // through the whole shelf row's through-pads, and a drop beside the
    // header clipped the resistor pad 0.5 mm away). That is also how the
    // real calculator's dead keys look: a ground column landing on the
    // wrong side of the key.
    const partner = sw.pads.find((q) => (q.num === '2' || q.num === '4') && Math.abs(q.y - p3.y) < 0.1);
    board.tracks.push({
      layer: 'bottom', layerId: 2, net: bNet, width: 0.254,
      points: [[partner.x, partner.y], [p3.x, p3.y]], id: 'planted',
    });
  }
  return { board, lift: liftBoardToCircuit(board) };
}

/**
 * Lifted circuit → engine (parts, nets): the bench's power header becomes
 * the rails themselves — (J1, p1) reads as (VCC, vcc), (J1, p2) as
 * (GND, gnd) — exactly what plugging the board into the bench supply
 * means, and the same shape simulation.test.js hands the engine.
 */
function engineNetlist(lift) {
  const sub = (m) => (m.partId === 'J1'
    ? (m.terminal === 'p1' ? { partId: 'VCC', terminal: 'vcc' } : { partId: 'GND', terminal: 'gnd' })
    : m);
  const parts = [
    ...lift.parts.filter((p) => p.id !== 'J1'),
    { id: 'VCC', kind: 'vcc', params: {} },
    { id: 'GND', kind: 'gnd', params: {} },
  ].map((p) => ({
    id: p.id, kind: p.kind,
    params: p.id === 'R1' ? { ohms: 220 } : p.id === 'LED1' ? { vf: 2.0, color: 'red' } : (p.params || {}),
    terminals: terminalsForKind(p.kind, p.params) || [],
  }));
  const nets = netsFromCircuit({ parts: lift.parts, wires: lift.wires }).map((n, i) => ({
    id: `net_${n.name || i}`,
    terminals: n.members.map((m) => {
      const s = sub(m);
      return { part: s.partId, terminal: s.terminal };
    }),
  }));
  return { parts, nets };
}

function solveBrightness(lift) {
  const { BoardImpl } = getEngine();
  const board = new BoardImpl(5.0);
  const { parts, nets } = engineNetlist(lift);
  board.setNetlist(parts, nets);
  board.advanceTo(25_000_000n);
  return board.ledBrightness('LED1');
}

describe('the board as built, solved by the real engine', () => {
  it('healthy board: the key is open, the LED is dark', () => {
    const { board, lift } = boardCircuit({ planted: false });
    assert.deepEqual(runPcbDrc(board), [], 'the projection is clean');
    const b = solveBrightness(lift);
    assert.ok(b < 0.01, `unpressed key must leave the LED dark (brightness ${b})`);
  });

  it('planted terminal-short: the LED is LIT with nobody touching the key', () => {
    const { board, lift } = boardCircuit({ planted: true });
    const shorts = runPcbDrc(board).filter((f) => f.rule === 'terminal-short');
    assert.equal(shorts.length, 1, 'the DRC names the planted fault');
    assert.equal(shorts[0].partId, 'SW1');
    const b = solveBrightness(lift);
    assert.ok(b > 0.3, `the soldered-pressed key must light the LED (brightness ${b})`);
  });
});
