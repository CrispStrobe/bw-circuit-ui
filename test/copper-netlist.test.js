/**
 * The copper netlist: the partition the BOARD actually implements.
 *
 * Fixture expectations were computed by hand before the code ran. On the
 * mini fixture that means working the joins out on paper: R1.2–SW1.1 joined
 * by a track, a via 0.508 mm off the track's centreline (0.305 + 0.305 of
 * radii reaches it), and a copper arc rooted on R1.2; SW1.2–SW1.4 joined by
 * a bottom track crossing the GND pour's file-carried fill. SW1.3 declares
 * N1 and reaches NOTHING — the fixture deliberately ships a net-island
 * defect, so N1 must come back as TWO islands.
 *
 * The live corpus assertions are FACTS MEASURED ON THE REAL BOARDS and
 * cross-checked by an independent Python sweep of the raw files
 * (2026-08-25):
 *
 *   - the broken calculator's GND is two islands, and one of them is
 *     BAT1.1 alone — the "battery unconnected" fault, rediscovered from
 *     the copper side with no schematic in sight.
 *   - the REPAIRED board contains three real hairline shorts the repair
 *     itself introduced: vias of SW16_2 and SW14_2 overlap passing tracks
 *     of other nets by 10–17 µm. The plan's v1 assumption ("repaired twin
 *     = 0 findings") was measured false, by the exact checker the v1
 *     prototype's inscribed-circle model could not be: the overlaps are
 *     smaller than the corner error of that approximation.
 *   - TinyProbe (fabbed, working) reads CLEAN — no split nets, no
 *     cross-net islands — which is the against-healthy-designs guard
 *     (§7.2: a warning that fires on healthy designs stops being read).
 */

import './_setup.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { importEasyEdaPcb } from '../src/importers/easyeda-pcb.js';
import { computeCopperNetlist } from '../src/model/copper-netlist.js';

const FIX = join(import.meta.dirname, 'fixtures');
const read = (f) => readFileSync(join(FIX, f), 'utf8');
const key = (p) => `${p.ref}.${p.num}`;
const padSets = (cn) => cn.islands.map((i) => i.pads.map(key).sort().join(' ')).sort();

describe('mini fixture — islands worked out on paper', () => {
  const board = importEasyEdaPcb(read('easyeda-pcb-mini.json'));
  const cn = computeCopperNetlist(board);

  test('the four islands, pad for pad', () => {
    assert.deepEqual(padSets(cn), [
      'R1.1',          // VCC pad, copper reaches nothing else
      'R1.2 SW1.1',    // track + via + arc
      'SW1.2 SW1.4',   // bottom track through the GND pour fill
      'SW1.3',         // declares N1, reaches nothing — the planted defect
    ]);
  });

  test('N1 is split: two islands claim it', () => {
    assert.equal(cn.netIslands.N1.length, 2);
    assert.equal(cn.netIslands.GND.length, 1);
    assert.equal(cn.netIslands.VCC.length, 1);
  });

  test('no cross-net island, and nothing was approximated', () => {
    assert.ok(cn.islands.every((i) => i.nets.length === 1));
    assert.equal(cn.approx, false);
  });
});

describe('pour honesty: exact fills join copper, outlines join labels', () => {
  // A synthetic board, built directly: one bottom-layer pour outline
  // 0..10 x 0..10 mm, one same-net pad inside it, one foreign-net pad
  // inside it, one same-net pad outside it.
  const pad = (num, net, x, y) => ({
    num, net, shape: 'circle', x, y, w: 1, h: 1, rotation: 0,
    drill: 0.5, plated: true, through: true, layer: 'through', points: null, id: `p${num}`,
  });
  const base = {
    parts: [{
      id: 'x1', ref: 'X1', pads: [pad('1', 'GND', 5, 5), pad('2', 'SIG', 8, 8), pad('3', 'GND', 20, 5)],
    }],
    freePads: [], tracks: [], vias: [], holes: [], arcs: [],
    outline: [], silk: {}, texts: [], nets: ['GND', 'SIG'], copperLayers: [1, 2],
  };
  const RING = [[0, 0], [10, 0], [10, 10], [0, 10]];

  test('outline-only pour joins the SAME net and says approx', () => {
    const cn = computeCopperNetlist({
      ...base,
      pours: [{ layerId: 2, net: 'GND', outline: RING, fills: null, fillFromFile: false, id: 'ca' }],
    });
    const gnd = cn.islands.find((i) => i.pads.some((p) => p.num === '1'));
    assert.deepEqual(gnd.pads.map((p) => p.num).sort(), ['1']);
    assert.equal(gnd.approxPour, true);
    // The foreign-net pad inside the outline did NOT join: the
    // over-approximation may only ever add same-net connectivity.
    const sig = cn.islands.find((i) => i.pads.some((p) => p.num === '2'));
    assert.deepEqual(sig.nets, ['SIG']);
    assert.equal(cn.approx, true);
  });

  test('a file-carried fill is real copper: its holes are NOT copper', () => {
    // Fill = the outline with a hole carved around the SIG pad. The GND
    // pad joins; the SIG pad, inside the HOLE, does not — even though the
    // fill joins any net it truly touches.
    const HOLE = [[7, 7], [9, 7], [9, 9], [7, 9]];
    const cn = computeCopperNetlist({
      ...base,
      pours: [{ layerId: 2, net: 'GND', outline: RING, fills: [[RING, HOLE]], fillFromFile: true, id: 'ca' }],
    });
    const gnd = cn.islands.find((i) => i.pads.some((p) => p.num === '1'));
    assert.equal(gnd.approxPour, false);
    assert.deepEqual(gnd.nets, ['GND']);
    const sig = cn.islands.find((i) => i.pads.some((p) => p.num === '2'));
    assert.deepEqual(sig.nets, ['SIG'], 'the hole is not copper');
    assert.equal(cn.approx, false);
  });

  test('a fill that truly touches a foreign pad is a SHORT, not a label', () => {
    // Same fill, no hole: the SIG pad sits in real copper now, and the
    // island honestly carries both nets.
    const cn = computeCopperNetlist({
      ...base,
      pours: [{ layerId: 2, net: 'GND', outline: RING, fills: [[RING]], fillFromFile: true, id: 'ca' }],
    });
    const isl = cn.islands.find((i) => i.pads.some((p) => p.num === '1'));
    assert.deepEqual(isl.nets, ['GND', 'SIG']);
  });
});

// ── live corpus ────────────────────────────────────────────────────

const LIVE = process.env.BW_PCB_BOARDS || join(homedir(), 'Downloads');
const BROKEN = join(LIVE, 'PCB_PCB_TaschenRechner3_2026-08-25.json');
const FIXED = join(LIVE, 'PCB_TaschenRechner3_FIXED.json');
const PROBE = join(LIVE, 'PCB_TinyProbe_v1.0_2026-08-20.json');
const haveLive = [BROKEN, FIXED, PROBE].every((f) => existsSync(f));
const liveNetlist = (f) => computeCopperNetlist(importEasyEdaPcb(readFileSync(f, 'utf8')));

describe('live corpus (skips without the local boards)', { skip: !haveLive }, () => {
  test('broken board: GND is two islands and one is the battery, alone', () => {
    const cn = liveNetlist(BROKEN);
    assert.equal(cn.netIslands.GND.length, 2);
    const gndIslands = cn.netIslands.GND.map((i) => cn.islands[i]);
    const bat = gndIslands.find((i) => i.pads.length === 1);
    assert.ok(bat, 'one GND island must be a singleton');
    assert.equal(key(bat.pads[0]), 'BAT1.1');
    assert.ok(gndIslands.find((i) => i.pads.length >= 20), 'the other carries the whole keypad');
    assert.ok(cn.islands.every((i) => i.nets.length <= 1), 'no cross-net islands on the broken board');
  });

  test('repaired board: the repair introduced three hairline shorts', () => {
    const cn = liveNetlist(FIXED);
    const shorts = cn.islands.filter((i) => i.nets.length > 1)
      .map((i) => i.nets.join('+')).sort();
    // Cross-checked against the raw file by an independent sweep:
    // via SW16_2 x track SW2_1 (-10 µm), via SW16_2 x track SW17_1
    // (-14 µm), via SW14_2 x track SW15_1 (-17 µm).
    assert.deepEqual(shorts, ['SW14_2+SW15_1', 'SW16_2+SW17_1+SW2_1']);
    const split = Object.entries(cn.netIslands).filter(([, v]) => v.length > 1);
    assert.deepEqual(split, [], 'no split nets on the repaired board');
  });

  test('TinyProbe, fabbed and working, reads clean', () => {
    const cn = liveNetlist(PROBE);
    assert.ok(cn.islands.every((i) => i.nets.length <= 1), 'no cross-net islands');
    const split = Object.entries(cn.netIslands).filter(([, v]) => v.length > 1);
    assert.deepEqual(split, []);
    // The GND pour does real work: the biggest island is GND and spans
    // more pads than any track alone reaches.
    const gnd = cn.netIslands.GND.map((i) => cn.islands[i])[0];
    assert.ok(gnd.pads.length >= 5, `GND pour joins the returns (${gnd.pads.length} pads)`);
    assert.equal(cn.approx, false, 'every pour carried its fill, nothing approximated');
  });
});
