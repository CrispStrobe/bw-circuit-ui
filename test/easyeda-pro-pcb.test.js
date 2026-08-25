/**
 * EasyEDA Pro import, both generations, geometry computed on paper.
 *
 * pro-mini.epcb (V2 array style): a 1000 x 600 mil board — one N1 route
 * crossing layers through a via, two through pads, a GND fill covering a
 * third pad, a pad-less component with a Designator ATTR. Expected mm
 * values are 1 unit = 1 mil, Y already up (no flip).
 *
 * pro-mini.epru (V3 log style) additionally plants the LOG SEMANTICS:
 *   - a FOOTPRINT document precedes the PCB document; its pad must NOT
 *     leak into the board (per-document isolation),
 *   - the same LINE id appears twice — garbage at ticket 1, the real
 *     coordinates at ticket 5. Only the dedupe rule makes the board
 *     routable,
 *   - the POURED fill is stored at 1/10 scale and must come back x10,
 *   - an ARC record is an endpoint pair plus included angle, not a path.
 *
 * The real corpus (three MIT .epcb boards) is pinned in
 * board-corpus.test.js; V3's only real sample is licence-restricted and
 * lives in the LOCAL corpus.
 */

import './_setup.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import {
  importEasyEdaProPcb, looksLikeEasyEdaProPcb, looksLikeEasyEdaProV2Pcb,
  looksLikeEasyEdaProV3Pcb, proRingToPoints,
} from '../src/importers/easyeda-pro-pcb.js';
import { detectFormat } from '../src/importers/detect.js';
import { importCircuit } from '../src/importers/index.js';
import { computeCopperNetlist } from '../src/model/copper-netlist.js';
import { runPcbDrc } from '../src/model/pcb-drc.js';

const FIX = join(import.meta.dirname, 'fixtures');
const read = (f) => readFileSync(join(FIX, f), 'utf8');
const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`);

describe('the path mini-language', () => {
  test('L runs, R rings (closed), CIRCLE rings (closed)', () => {
    assert.deepEqual(proRingToPoints([0, 0, 'L', 10, 0, 10, 5]), [[0, 0], [10, 0], [10, 5]]);
    const rect = proRingToPoints(['R', 1, 2, 4, 3, 0, 0]);
    assert.equal(rect.length, 5);
    assert.deepEqual(rect[0], rect[4]);
    const circle = proRingToPoints(['CIRCLE', 0, 0, 5]);
    assert.equal(circle.length, 25);
    for (const [x, y] of circle) close(Math.hypot(x, y), 5, 1e-9);
  });

  test('ARC bulges by the included angle and lands on its endpoint', () => {
    const pts = proRingToPoints([10, 0, 'ARC', 90, 0, 10]);
    const last = pts[pts.length - 1];
    close(last[0], 0); close(last[1], 10);
    // A 90° arc from (10,0) to (0,10) has its every sample on radius 10.
    for (const [x, y] of pts) close(Math.hypot(x, y), 10, 1e-6);
  });
});

describe('V2 array style (pro-mini.epcb)', () => {
  const text = read('pro-mini.epcb');
  const b = importEasyEdaProPcb(text);

  test('detects as a Pro PCB, gates split by generation', () => {
    assert.equal(looksLikeEasyEdaProV2Pcb(text), true);
    assert.equal(looksLikeEasyEdaProV3Pcb(text), false);
    assert.equal(detectFormat(text), 'easyeda-pro-pcb');
  });

  test('frame and geometry, mil to mm', () => {
    close(b.bbox.w, 25.4); close(b.bbox.h, 15.24);
    const p1 = b.freePads.find((p) => p.num === '1');
    close(p1.x, 2.54); close(p1.y, 7.62);
    close(p1.w, 1.016); // 40 mil
    close(p1.drill, 0.508); // ROUND 20 mil
    const [t1] = b.tracks;
    close(t1.width, 0.254);
    assert.equal(b.vias.length, 1);
    close(b.vias[0].drill, 0.3048); // 12 mil
  });

  test('the copper truth: the via joins the layers, the fill owns pad 3', () => {
    const cn = computeCopperNetlist(b);
    const sets = cn.islands.filter((i) => i.pads.length)
      .map((i) => i.pads.map((p) => p.num).sort().join('+')).sort();
    assert.deepEqual(sets, ['1+2', '3']);
    assert.deepEqual(runPcbDrc(b, { copper: cn }), []);
  });

  test('components come through pad-less, said out loud', () => {
    assert.equal(b.parts.length, 1);
    assert.equal(b.parts[0].ref, 'U1');
    assert.deepEqual(b.parts[0].pads, []);
    assert.deepEqual(b.parts[0].attrs.padNets, { 1: 'N1' });
    assert.ok(b.warnings.some((w) => /without pad geometry/.test(w)));
  });

  test('the silk STRING survives', () => {
    assert.deepEqual(b.silk.texts.map((t) => t.text), ['PRO']);
  });
});

describe('V3 log style (pro-mini.epru)', () => {
  const text = read('pro-mini.epru');
  const b = importEasyEdaProPcb(text);

  test('detects, and the generations do not cross-match', () => {
    assert.equal(looksLikeEasyEdaProV3Pcb(text), true);
    assert.equal(looksLikeEasyEdaProV2Pcb(text), false);
    assert.equal(looksLikeEasyEdaProPcb(text), true);
    assert.equal(detectFormat(text), 'easyeda-pro-pcb');
  });

  test('THE LOG RULES: dedupe by ticket, isolate by document', () => {
    // Ticket 1 wrote garbage coordinates for t1; ticket 5 corrected them.
    const t1 = b.tracks.find((t) => t.id === 'pro-t1');
    close(t1.points[0][0], 2.54); // 100 mil from the origin
    // The FOOTPRINT document's pad must not appear on the board.
    assert.equal(b.freePads.length, 2);
  });

  test('POURED comes back at x10, exact', () => {
    const z = b.pours[0];
    assert.equal(z.fillFromFile, true);
    // Fill ring starts at (12, 6) stored -> (120, 60) mil -> mm.
    close(z.fills[0][0][0][0], 3.048);
    close(z.fills[0][0][0][1], 1.524);
  });

  test('the V3 arc is endpoint + angle', () => {
    // a1 sweeps 90° from (500,200) to (600,300): its samples all sit on
    // one circle through both endpoints.
    const arc = b.tracks.find((t) => t.id === 'pro-a1');
    assert.ok(arc, 'arc imported as a copper polyline');
    assert.ok(arc.points.length > 5, 'sampled, not chorded');
  });

  test('clean verdict, connected route', () => {
    const cn = computeCopperNetlist(b);
    assert.deepEqual(runPcbDrc(b, { copper: cn }), []);
    const sets = cn.islands.filter((i) => i.pads.length)
      .map((i) => i.pads.map((p) => p.num).sort().join('+'));
    assert.deepEqual(sets, ['1+2']);
  });
});

describe('the lift wrapper', () => {
  test('importCircuit easyeda-pro-pcb: copper lifts, components go to unmapped', () => {
    const r = importCircuit('easyeda-pro-pcb', read('pro-mini.epcb'));
    assert.equal(r.board.tracks.length, 2);
    assert.equal(r.unmapped.length, 1, 'the pad-less component is reported, not dropped');
    assert.ok(r.warnings.some((w) => /Pro board/.test(w)));
  });
});

// ── the local V3 real sample (licence-restricted, never committed) ─

const LS2K = join(process.env.BW_PCB_CORPUS || join(homedir(), 'code', 'pcb-corpus-local'), 'ls2k0300-v3.epru');

describe('the real V3 board (skips without the local corpus)', { skip: !existsSync(LS2K) }, () => {
  test('a 30k-line production log imports coherently', () => {
    const b = importEasyEdaProPcb(readFileSync(LS2K, 'utf8'));
    assert.equal(b.parts.length, 176);
    assert.ok(b.tracks.length > 6000);
    assert.deepEqual(b.copperLayers, [1, 2, 15, 16], 'a 4-copper-layer stack, inner layers intact');
    const cn = computeCopperNetlist(b);
    assert.ok(cn.islands.every((i) => i.nets.length <= 1), 'no cross-net islands');
    const dangers = runPcbDrc(b, { copper: cn }).filter((f) => f.severity === 'danger');
    assert.deepEqual(dangers, [], 'a shipped production board carries no dangers');
  });
});
