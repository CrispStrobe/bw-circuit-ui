/**
 * KiCad PCB import/export: the grammar rules that cost a corpus to learn,
 * pinned on a hand-authored fixture whose geometry was computed on paper.
 *
 * kicad-mini.kicad_pcb (40 x 26 mm, outline 22..62 x 22..48) plants one
 * instance of every trap the real-board sweep surfaced:
 *
 *   - R1 at 90°: pad angles are ABSOLUTE, positions rotate by the
 *     footprint angle — pad 1 (rel −3.81,0) lands at kicad (30, 38.81),
 *     model (8, 9.19).
 *   - SW1 with pads 1,1,2,2 — KiCad's same-number spelling of internal
 *     terminals. Only one "1" pad is routed; net-island must NOT fire.
 *   - H1: an np_thru_hole mounting pad is a HOLE, not copper.
 *   - EP1: a paste-only aperture is NOT copper at all.
 *   - a keepout zone is a constraint, not a pour.
 *   - the GND zone's fill has a second ring — a HOLE around the via —
 *     and the via must NOT join the pour through it (it joins via its
 *     own segment instead).
 *   - the outline closes through a 3-point gr_arc.
 *   - VCC reaches one pad by design: the unfinished-net warning is the
 *     ONLY finding, proving both that it fires and that nothing else does.
 */

import './_setup.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { importKicadPcb, looksLikeKicadPcb } from '../src/importers/kicad-pcb.js';
import { exportKicadPcb } from '../src/model/exporters/kicad-pcb.js';
import { detectFormat } from '../src/importers/detect.js';
import { importCircuit } from '../src/importers/index.js';
import { computeCopperNetlist } from '../src/model/copper-netlist.js';
import { runPcbDrc } from '../src/model/pcb-drc.js';
import { exportEasyEdaPcb } from '../src/model/exporters/easyeda-pcb.js';
import { importEasyEdaPcb } from '../src/importers/easyeda-pcb.js';

const FIX = join(import.meta.dirname, 'fixtures');
const text = readFileSync(join(FIX, 'kicad-mini.kicad_pcb'), 'utf8');
const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`);

describe('the hand-authored board', () => {
  const b = importKicadPcb(text);

  test('detects, and frames from Edge.Cuts', () => {
    assert.equal(looksLikeKicadPcb(text), true);
    assert.equal(detectFormat(text, 'kicad-mini.kicad_pcb'), 'kicad-pcb');
    close(b.bbox.w, 40);
    close(b.bbox.h, 26);
  });

  test('R1 at 90°: absolute pad angles, rotated positions', () => {
    const r1 = b.parts.find((p) => p.ref === 'R1');
    assert.equal(r1.rotation, 90);
    const p1 = r1.pads.find((p) => p.num === '1');
    close(p1.x, 8); close(p1.y, 9.19);
    assert.equal(p1.net, 'VCC');
    const p2 = r1.pads.find((p) => p.num === '2');
    close(p2.x, 8); close(p2.y, 16.81);
    assert.equal(p2.net, 'N1');
  });

  test('SW1: duplicate pad numbers survive with their nets', () => {
    const sw = b.parts.find((p) => p.ref === 'SW1');
    assert.deepEqual(sw.pads.map((p) => p.num).sort(), ['1', '1', '2', '2']);
    assert.deepEqual([...new Set(sw.pads.map((p) => p.net))].sort(), ['GND', 'N1']);
  });

  test('a mounting hole is a hole; a paste aperture is nothing', () => {
    assert.equal(b.holes.length, 1);
    close(b.holes[0].diameter, 3.2);
    assert.equal(b.parts.find((p) => p.ref === 'H1').pads.length, 0);
    assert.equal(b.parts.find((p) => p.ref === 'EP1').pads.length, 0);
    assert.ok(b.ignored.some((i) => i.type === 'pad:mask-or-paste-aperture'));
  });

  test('the keepout zone is ignored, the GND zone keeps its hole', () => {
    assert.ok(b.ignored.some((i) => i.type === 'zone:keepout'));
    assert.equal(b.pours.length, 1);
    const z = b.pours[0];
    assert.equal(z.net, 'GND');
    assert.equal(z.fillFromFile, true);
    assert.equal(z.fills.length, 1, 'one even-odd group');
    assert.equal(z.fills[0].length, 2, 'outer ring plus the hole');
  });

  test('the outline closes through the gr_arc', () => {
    assert.equal(b.outline.filter((s) => s.type === 'arc').length, 1);
    assert.deepEqual(runPcbDrc(b).filter((f) => f.rule === 'outline-open'), []);
  });

  test('copper truth: via joins by track, not through the fill hole', () => {
    const cn = computeCopperNetlist(b);
    const gnd = cn.netIslands.GND;
    assert.equal(gnd.length, 1, 'GND is one island');
    assert.ok(cn.islands.every((i) => i.nets.length <= 1), 'no cross-net islands');
  });

  test('the verdict is exactly the planted warning', () => {
    const f = runPcbDrc(b);
    assert.deepEqual(f.map((x) => `${x.rule}/${x.severity}`), ['unfinished-net/warning']);
    assert.equal(f[0].net, 'VCC');
  });

  test('the lift recognises KiCad library spellings', () => {
    const r = importCircuit('kicad-pcb', text);
    const kinds = Object.fromEntries(r.parts.map((p) => [p.id, p.kind]));
    assert.equal(kinds.R1, 'resistor');
    assert.equal(kinds.SW1, 'button');
    // N1 wire: resistor.b to button.a — through the duplicate-number pads.
    assert.ok(r.wires.some((w) => {
      const ends = [`${w.from}.${w.fromTerminal}`, `${w.to}.${w.toTerminal}`].sort().join(' ');
      return ends === 'R1.b SW1.a';
    }), JSON.stringify(r.wires));
  });
});

describe('round trips', () => {
  const b = importKicadPcb(text);
  const partition = (board) => computeCopperNetlist(board).islands
    .filter((i) => i.pads.length)
    .map((i) => i.pads.map((p) => `${p.ref}.${p.num}`).sort().join(' ')).sort();
  const verdict = (board) => runPcbDrc(board).map((x) => `${x.rule}/${x.severity}`).sort();

  test('through our own KiCad writer', () => {
    const back = importKicadPcb(exportKicadPcb(b).text);
    assert.deepEqual(partition(back), partition(b));
    assert.deepEqual(verdict(back), verdict(b));
  });

  test('across formats, through the EasyEDA writer', () => {
    const back = importEasyEdaPcb(exportEasyEdaPcb(b));
    assert.deepEqual(partition(back), partition(b));
    assert.deepEqual(verdict(back), verdict(b));
  });
});
