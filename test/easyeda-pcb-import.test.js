/**
 * EasyEDA PCB import: MEASURED VALUES, not "it parsed".
 *
 * The fixtures are hand-authored and their expected geometry was computed on
 * paper BEFORE the reader ran (house rule: assert absolute expected values,
 * never trace identity):
 *
 *   easyeda-pcb-mini.json    a 25.4 x 12.7 mm board. Outline is a closed
 *                            layer-10 rectangle 4000..4100 x 3000..3050 in
 *                            EasyEDA units, so the mm frame is origin
 *                            (4000, 3050), Y flipped: a point at unit
 *                            (4010, 3040) lands at mm (2.54, 2.54). R1 (two
 *                            through pads, VCC/N1) and SW1 (four pads,
 *                            N1/GND) with silk refs, one top track, one
 *                            bottom track, a via, an M3 hole, a copper ARC,
 *                            and a GND pour WITH file-carried fill.
 *
 *   easyeda-pcb-bare.json    the bare `{head, shape}` payload with no
 *                            top-level docType — the shape a PCB exported
 *                            alone actually has. One 1-pad part.
 *
 *   easyeda-pcb-module.json  docType 14 (PCB module): read, but warned
 *                            about, because a board that USES modules will
 *                            import with holes.
 *
 * The live corpus (three real boards in ~/Downloads, a private design) is
 * NOT in the repo; the live suite skips cleanly when the files are absent.
 * Live expectations are facts measured on the boards themselves: part count,
 * refdes lists, and — the plan's founding observation — the broken board's
 * bounding box being 34 mm TALLER than its repaired twin's because the open
 * outline leaves two ~39 mm tails.
 */

import './_setup.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import {
  importEasyEdaPcb, looksLikeEasyEdaPcb, looksLikeEasyEdaPro, parsePath,
  subpathToRing, MM_PER_UNIT,
} from '../src/importers/easyeda-pcb.js';
import { detectFormat } from '../src/importers/detect.js';
import { importCircuit } from '../src/importers/index.js';

const FIX = join(import.meta.dirname, 'fixtures');
const read = (f) => readFileSync(join(FIX, f), 'utf8');
const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`);

describe('unit and frame', () => {
  test('MM_PER_UNIT is 10 mil exactly', () => {
    close(MM_PER_UNIT, 0.254);
  });
});

describe('parsePath', () => {
  test('glued and comma-separated coordinates both read', () => {
    // The exact spelling a real board used: `L4015,3669.5` with no space.
    const sp = parsePath('M 4015 3619.5 L 4135 3619.5 L 4135 3669.5 L4015,3669.5 Z');
    assert.equal(sp.length, 1);
    assert.equal(sp[0].segs.length, 3);
    assert.equal(sp[0].closed, true);
    assert.deepEqual(sp[0].segs[2].x2, 4015);
    assert.deepEqual(sp[0].segs[2].y2, 3669.5);
  });

  test('implicit lineto after moveto', () => {
    const sp = parsePath('M 0 0 10 0 10 10');
    assert.equal(sp[0].segs.length, 2);
  });

  test('arc segment carries its five parameters', () => {
    const sp = parsePath('M4138.11 3048.839A19.685 19.685 0 0 1 4157.795 3068.524');
    const a = sp[0].segs[0];
    assert.equal(a.type, 'arc');
    assert.equal(a.rx, 19.685);
    assert.equal(a.sweep, 1);
    assert.equal(a.largeArc, 0);
  });

  test('subpathToRing samples a quarter arc onto the circle', () => {
    // Quarter circle radius 10 about (0,0): from (10,0) to (0,10).
    const sp = parsePath('M 10 0 A 10 10 0 0 1 0 10');
    const ring = subpathToRing(sp[0], 8);
    assert.equal(ring.length, 9); // start + 8 samples
    for (const [x, y] of ring) close(Math.hypot(x, y), 10, 1e-6);
    close(ring[8][0], 0, 1e-6);
    close(ring[8][1], 10, 1e-6);
  });
});

describe('mini fixture — the partition, in millimetres, computed first', () => {
  const m = importEasyEdaPcb(read('easyeda-pcb-mini.json'));

  test('reads clean: no warnings, nothing dropped silently', () => {
    assert.deepEqual(m.warnings, []);
    assert.deepEqual(m.ignored, [{ type: 'SVGNODE', count: 1 }]);
  });

  test('frame: 25.4 x 12.7 mm, origin at the outline bottom-left', () => {
    close(m.bbox.w, 25.4);
    close(m.bbox.h, 12.7);
    assert.equal(m.origin.x, 4000);
    assert.equal(m.origin.y, 3050);
  });

  test('two parts with refs read from their P texts', () => {
    assert.deepEqual(m.parts.map((p) => p.ref), ['R1', 'SW1']);
    assert.deepEqual(m.parts.map((p) => p.package), ['R_AXIAL-0.4', 'SW-TH_4P-L6.0-W6.0']);
    assert.deepEqual(m.parts.map((p) => p.side), ['top', 'top']);
  });

  test('R1 geometry: unit (4010,3040) is mm (2.54, 2.54)', () => {
    const r1 = m.parts[0];
    close(r1.x, 7.62);
    close(r1.y, 2.54);
    const [p1, p2] = r1.pads;
    assert.equal(p1.num, '1'); assert.equal(p1.net, 'VCC');
    close(p1.x, 2.54); close(p1.y, 2.54);
    close(p1.w, 1.524);
    close(p1.drill, 2 * 1.9685 * 0.254);
    assert.equal(p1.through, true);
    assert.equal(p1.plated, true);
    assert.equal(p2.net, 'N1');
    close(p2.x, 12.7);
  });

  test('SW1: four pads, nets as declared, numbers as written', () => {
    const sw = m.parts[1];
    assert.deepEqual(sw.pads.map((p) => p.num), ['1', '2', '3', '4']);
    assert.deepEqual(sw.pads.map((p) => p.net), ['N1', 'GND', 'N1', 'GND']);
    assert.deepEqual(sw.pads.map((p) => p.shape), ['rect', 'rect', 'rect', 'rect']);
  });

  test('copper: two tracks on their sides, widths in mm', () => {
    assert.equal(m.tracks.length, 2);
    const [t1, t2] = m.tracks;
    assert.equal(t1.layer, 'top'); assert.equal(t1.net, 'N1');
    assert.equal(t2.layer, 'bottom'); assert.equal(t2.net, 'GND');
    close(t1.width, 2.4 * 0.254);
    assert.equal(t1.points.length, 3);
    close(t1.points[0][0], 12.7); close(t1.points[0][1], 2.54);
  });

  test('via at (13.97, 3.048), drill 0.3048', () => {
    assert.equal(m.vias.length, 1);
    const v = m.vias[0];
    close(v.x, 13.97); close(v.y, 3.048);
    close(v.diameter, 0.6096);
    close(v.drill, 0.3048);
    assert.equal(v.net, 'N1');
  });

  test('the M3 hole: 3.0 mm diameter', () => {
    assert.equal(m.holes.length, 1);
    close(m.holes[0].diameter, 2 * 5.9055 * 0.254, 1e-6);
  });

  test('copper arc survives with flipped sweep', () => {
    assert.equal(m.arcs.length, 1);
    const s = m.arcs[0].segs[0];
    assert.equal(s.type, 'arc');
    close(s.x1, 12.7); close(s.y1, 2.54);
    close(s.x2, 15.24); close(s.y2, 5.08);
    assert.equal(s.sweep, 0); // was 1; the Y flip inverts it
  });

  test('pour: GND on bottom, fill carried by the file', () => {
    assert.equal(m.pours.length, 1);
    const c = m.pours[0];
    assert.equal(c.net, 'GND');
    assert.equal(c.layer, 'bottom');
    assert.equal(c.fillFromFile, true);
    assert.equal(c.fills.length, 1);
    close(c.fills[0][0][0], 15.24);
    close(c.fills[0][0][1], 11.43);
    close(c.clearance, 0.8 * 0.254);
  });

  test('outline: four closed line segments', () => {
    assert.equal(m.outline.length, 4);
    assert.ok(m.outline.every((s) => s.type === 'line'));
  });

  test('nets are the three declared names', () => {
    assert.deepEqual(m.nets, ['GND', 'N1', 'VCC']);
    assert.deepEqual(m.copperLayers, [1, 2]);
  });

  test('silk: R1 keeps its outline track and its ref text', () => {
    const r1 = m.parts[0];
    assert.equal(r1.silk.tracks.length, 1);
    assert.equal(r1.silk.texts.length, 1);
    assert.equal(r1.silk.texts[0].kind, 'P');
    assert.equal(r1.silk.texts[0].text, 'R1');
    // and the free label lands in board silk
    assert.deepEqual(m.silk.texts.map((t) => t.text), ['mini']);
  });
});

describe('the shapes a file actually arrives in', () => {
  test('bare {head, shape} payload reads without a docType warning', () => {
    const m = importEasyEdaPcb(read('easyeda-pcb-bare.json'));
    assert.deepEqual(m.warnings, []);
    assert.equal(m.parts.length, 1);
    assert.equal(m.parts[0].ref, 'J1');
    assert.deepEqual(m.nets, ['SIG']);
    assert.equal(m.outline.length, 4);
  });

  test('docType 14 reads but says what a module means', () => {
    const m = importEasyEdaPcb(read('easyeda-pcb-module.json'));
    assert.equal(m.tracks.length, 1);
    assert.ok(m.warnings.some((w) => /module/i.test(w)), m.warnings.join('; '));
  });

  test('a schematic handed to the board reader is redirected, not mangled', () => {
    const m = importEasyEdaPcb(read('easyeda-rc-divider.json'));
    assert.equal(m.parts.length, 0);
    assert.ok(m.warnings.some((w) => /SCHEMATIC/.test(w)));
  });

  test('non-JSON comes back as a warning, not a throw', () => {
    const m = importEasyEdaPcb('EESchema Schematic File Version 4');
    assert.equal(m.parts.length, 0);
    assert.equal(m.warnings.length, 1);
  });
});

describe('detection', () => {
  test('docType 3 detects as easyeda-pcb, ahead of the schematic rule', () => {
    assert.equal(detectFormat(read('easyeda-pcb-mini.json')), 'easyeda-pcb');
    assert.equal(detectFormat(read('easyeda-pcb-bare.json')), 'easyeda-pcb');
  });

  test('schematics still detect as easyeda', () => {
    assert.equal(detectFormat(read('easyeda-rc-divider.json')), 'easyeda');
  });

  test('looksLike guards: pcb yes, schematic no, pro no', () => {
    assert.equal(looksLikeEasyEdaPcb(read('easyeda-pcb-mini.json')), true);
    assert.equal(looksLikeEasyEdaPcb(read('easyeda-rc-divider.json')), false);
    assert.equal(looksLikeEasyEdaPro(read('easyeda-pcb-mini.json')), false);
  });

  test('an EasyEDA Pro document is named for what it is', () => {
    const pro = '["DOCTYPE","PCB","2.0"]\n["CANVAS",1,2,3]';
    assert.equal(looksLikeEasyEdaPro(pro), true);
    assert.equal(detectFormat(pro), 'easyeda-pro');
    const r = importCircuit('easyeda-pro', pro);
    assert.equal(r.parts.length, 0);
    assert.ok(r.warnings.some((w) => /Pro/.test(w)));
  });

  test('importCircuit easyeda-pcb keeps the circuit contract and carries the board', () => {
    const r = importCircuit('easyeda-pcb', read('easyeda-pcb-mini.json'));
    assert.deepEqual(r.parts, []);
    assert.deepEqual(r.wires, []);
    assert.ok(Array.isArray(r.unmapped));
    assert.equal(r.board.parts.length, 2);
    assert.ok(r.warnings.some((w) => /board/i.test(w)));
  });
});

// ── live corpus: real boards, never committed ──────────────────────

const LIVE = process.env.BW_PCB_BOARDS || join(homedir(), 'Downloads');
const board = (f) => join(LIVE, f);
const BROKEN = board('PCB_PCB_TaschenRechner3_2026-08-25.json');
const FIXED = board('PCB_TaschenRechner3_FIXED.json');
const PROBE = board('PCB_TinyProbe_v1.0_2026-08-20.json');
const haveLive = [BROKEN, FIXED, PROBE].every((f) => existsSync(f));

describe('live corpus (skips without the local boards)', { skip: !haveLive }, () => {
  test('the broken calculator: 21 parts, every refdes read', () => {
    const m = importEasyEdaPcb(readFileSync(BROKEN, 'utf8'));
    assert.equal(m.parts.length, 21);
    const refs = m.parts.map((p) => p.ref);
    for (let i = 1; i <= 18; i++) assert.ok(refs.includes(`SW${i}`), `SW${i} missing`);
    assert.ok(refs.includes('OLED1') && refs.includes('BAT1') && refs.includes('U2'));
    assert.equal(m.nets.length, 24);
    assert.equal(m.vias.length, 4);
    assert.equal(m.holes.length, 5);
    assert.equal(m.parts.find((p) => p.ref === 'BAT1').side, 'bottom');
    assert.deepEqual(m.warnings, []);
  });

  test('the open outline is visible in the numbers: broken is ~34 mm taller', () => {
    const broken = importEasyEdaPcb(readFileSync(BROKEN, 'utf8'));
    const fixed = importEasyEdaPcb(readFileSync(FIXED, 'utf8'));
    // Same board, same width; the two ~39 mm outline tails stretch the
    // broken board's bounding box. Height measured on the real files.
    close(broken.bbox.w, fixed.bbox.w, 0.5);
    assert.ok(broken.bbox.h - fixed.bbox.h > 30,
      `expected the tails: broken ${broken.bbox.h} vs fixed ${fixed.bbox.h}`);
  });

  test('TinyProbe: both GND pours arrive with file-carried fill', () => {
    const m = importEasyEdaPcb(readFileSync(PROBE, 'utf8'));
    assert.equal(m.pours.length, 2);
    for (const c of m.pours) {
      assert.equal(c.net, 'GND');
      assert.equal(c.fillFromFile, true);
      assert.ok(c.fills.length >= 1);
    }
    assert.equal(m.parts.length, 16);
  });
});
