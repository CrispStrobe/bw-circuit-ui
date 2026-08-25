/**
 * Board projection: the checker gates, and the partition is the oracle.
 *
 * The projection is a heuristic and is never trusted (plan §7.1): every
 * test here judges its output with the EXACT tools — runPcbDrc must find
 * NOTHING, and computeCopperNetlist's partition must equal the circuit's
 * nets, pad for pad. The two together are the Phase-3 acceptance from
 * plan §6: "every projection output must pass Phase-2 DRC with zero
 * findings. The router is heuristic; the checker is exact; the checker
 * gates."
 *
 * The live case is the campaign's full-circle: the BROKEN calculator is
 * lifted from its board (faults and all) and re-projected — 21 parts,
 * Pico included — into a fresh board that routes completely and passes
 * DRC clean. What the projection cannot fix, honestly kept: the lifted
 * circuit still HAS the terminal-collapse and the unconnected battery in
 * its wiring; the new board implements that circuit faithfully.
 */

import './_setup.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { projectBoard, netsFromCircuit } from '../src/model/board-projection.js';
import { runPcbDrc } from '../src/model/pcb-drc.js';
import { computeCopperNetlist } from '../src/model/copper-netlist.js';
import { importEasyEdaPcb } from '../src/importers/easyeda-pcb.js';
import { liftBoardToCircuit } from '../src/model/board-lift.js';

const CIRCUIT = {
  parts: [
    { id: 'J1', kind: 'header', params: { pins: 2 } },
    { id: 'R1', kind: 'resistor', params: {} },
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

/** The oracle: every declared net is ONE island, and no island mixes nets. */
function assertPartitionFaithful(board) {
  const cn = computeCopperNetlist(board);
  for (const [net, islands] of Object.entries(cn.netIslands)) {
    assert.equal(islands.length, 1, `net ${net} split into ${islands.length} islands`);
  }
  assert.ok(cn.islands.every((i) => i.nets.length <= 1), 'an island mixes nets');
}

describe('netsFromCircuit', () => {
  test('rails dissolve into named nets', () => {
    const nets = netsFromCircuit({
      parts: [{ id: 'GND1', kind: 'gnd' }, { id: 'R1', kind: 'resistor' }, { id: 'C1', kind: 'capacitor' }],
      wires: [
        { from: 'R1', fromTerminal: 'b', to: 'GND1', toTerminal: 'gnd' },
        { from: 'C1', fromTerminal: 'b', to: 'GND1', toTerminal: 'gnd' },
      ],
    });
    assert.equal(nets.length, 1);
    assert.equal(nets[0].name, 'GND');
    assert.equal(nets[0].members.length, 2);
  });
});

describe('the simple chain', () => {
  const r = projectBoard(CIRCUIT);

  test('places and routes everything', () => {
    assert.deepEqual(r.unplaced, []);
    assert.deepEqual(r.unrouted, []);
    assert.equal(r.board.parts.length, 4);
    assert.ok(r.board.tracks.length >= 4);
  });

  test('THE GATE: zero DRC findings', () => {
    assert.deepEqual(runPcbDrc(r.board), []);
  });

  test('THE ORACLE: the copper partition is the circuit partition', () => {
    assertPartitionFaithful(r.board);
    const cn = computeCopperNetlist(r.board);
    // Four two-pad nets: the chain, exactly.
    assert.equal(Object.keys(cn.netIslands).length, 4);
  });

  test('deterministic: projecting twice gives identical boards', () => {
    const again = projectBoard(CIRCUIT);
    assert.deepEqual(JSON.parse(JSON.stringify(again.board)), JSON.parse(JSON.stringify(r.board)));
  });
});

describe('overrides', () => {
  test('a pinned part sits where the override says, and the gate still holds', () => {
    const r = projectBoard(CIRCUIT, { overrides: { parts: { SW1: { x: 40, y: 30 } } } });
    const sw = r.board.parts.find((p) => p.ref === 'SW1');
    // Board-model coordinates are shifted by the outline origin; the
    // override is honoured in placement space, so check the RELATIVE
    // geometry: SW1 is far from the shelf rows the others flow into.
    assert.ok(sw.x > 25, `SW1.x = ${sw.x}`);
    assert.deepEqual(r.unrouted, []);
    assert.deepEqual(runPcbDrc(r.board), []);
    assertPartitionFaithful(r.board);
  });

  test('an override may not change connectivity, only position', () => {
    const r = projectBoard(CIRCUIT, { overrides: { parts: { SW1: { x: 40, y: 30 } } } });
    const cn = computeCopperNetlist(r.board);
    assert.equal(Object.keys(cn.netIslands).length, 4);
  });
});

describe('honest degradation', () => {
  test('a kind with no pattern is unplaced and SAID, never dropped silently', () => {
    const r = projectBoard({
      parts: [{ id: 'U1', kind: 'stc_mcu', params: {} }, { id: 'R1', kind: 'resistor', params: {} }],
      wires: [{ from: 'U1', fromTerminal: 'p1_0', to: 'R1', toTerminal: 'a' }],
    });
    assert.deepEqual(r.unplaced, ['U1']);
    assert.ok(r.warnings.some((w) => /U1.*no land pattern/.test(w)));
  });

  test('an oversized header degrades to unplaced, not to a wrong pattern', () => {
    const r = projectBoard({
      parts: [{ id: 'J9', kind: 'header', params: { pins: 40 } }],
      wires: [],
    });
    assert.deepEqual(r.unplaced, ['J9']);
  });
});

// ── live: the full circle ──────────────────────────────────────────

const LIVE = process.env.BW_PCB_BOARDS || join(homedir(), 'Downloads');
const BROKEN = join(LIVE, 'PCB_PCB_TaschenRechner3_2026-08-25.json');

describe('live (skips without the local boards)', { skip: !existsSync(BROKEN) }, () => {
  test('the lifted calculator re-projects: 21 parts, all routed, DRC clean', () => {
    const lift = liftBoardToCircuit(importEasyEdaPcb(readFileSync(BROKEN, 'utf8')));
    const r = projectBoard({ parts: lift.parts, wires: lift.wires });
    assert.deepEqual(r.unplaced, []);
    assert.deepEqual(r.unrouted, []);
    assert.equal(r.board.parts.length, 21);
    assert.deepEqual(runPcbDrc(r.board), []);
    assertPartitionFaithful(r.board);
  });
});
