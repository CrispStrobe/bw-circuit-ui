/**
 * The real-board corpus: thirteen published designs through the whole
 * pipeline, verdicts pinned.
 *
 * Eleven of thirteen real boards read completely CLEAN — that is the §7.2
 * guard at corpus scale (a rule set that fires on healthy designs stops
 * being read), and it was NOT true on the first sweep: eight distinct
 * reader bugs surfaced and each is now a comment at its fix site
 * (v5 centre/angle arcs, pre-fracture zone-fill holes, per-fill layers,
 * absolute pad shape angles, drill offsets rotating with the pad,
 * mask/paste apertures as phantom copper, keepouts as copper, KiCad's
 * two machine-named no-connect spellings). The two non-clean boards carry
 * only sub-clearance WARNINGS, which is what a design routed under
 * tighter rules than EasyEDA's default 0.152 mm honestly looks like.
 *
 * Every committed board also cross-exports: partition equality through
 * our own EasyEDA writer AND our KiCad writer. A reader bug, a writer
 * bug, or a model bug each breaks a different leg of that triangle.
 *
 * Provenance and licences: test/fixtures/boards/PROVENANCE.md. The
 * local-only corpus (GPL/CC-BY-SA designs, $BW_PCB_CORPUS, default
 * ~/code/pcb-corpus-local) is swept when present, skipped cleanly when
 * not.
 */

import './_setup.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { importKicadPcb } from '../src/importers/kicad-pcb.js';
import { importEasyEdaPcb } from '../src/importers/easyeda-pcb.js';
import { detectFormat } from '../src/importers/detect.js';
import { computeCopperNetlist } from '../src/model/copper-netlist.js';
import { runPcbDrc } from '../src/model/pcb-drc.js';
import { renderBoardSvg } from '../src/model/board-svg.js';
import { exportEasyEdaPcb } from '../src/model/exporters/easyeda-pcb.js';
import { exportKicadPcb } from '../src/model/exporters/kicad-pcb.js';

const BOARDS = join(import.meta.dirname, 'fixtures', 'boards');

/** Pinned per-board expectations, measured 2026-08-25. */
const PINNED = [
  // file, parts, verdict {rule/severity: count} — {} means CLEAN
  ['dvi-sock.kicad_pcb', 15, { 'clearance/warning': 24 }],
  ['otter-front.kicad_pcb', 2, {}],
  ['otter-back.kicad_pcb', 4, {}],
  ['tiny-esp.kicad_pcb', 12, {}],
  ['orpheuspad.kicad_pcb', 16, {}],
  ['atomic14.kicad_pcb', 21, {}],
  ['nanoels-pcb.json', 28, {}],
  ['tuitar-pcb.json', 18, {}],
];

const importBoard = (file, text) => (file.endsWith('.kicad_pcb')
  ? importKicadPcb(text) : importEasyEdaPcb(text));

const verdictOf = (findings) => {
  const counts = {};
  for (const f of findings) {
    const k = `${f.rule}/${f.severity}`;
    counts[k] = (counts[k] || 0) + 1;
  }
  return counts;
};

const partition = (board) => computeCopperNetlist(board).islands
  .filter((i) => i.pads.length)
  .map((i) => i.pads.map((p) => `${p.ref || ''}.${p.num}`).sort().join(' '))
  .sort();

describe('committed corpus, pinned', () => {
  for (const [file, parts, verdict] of PINNED) {
    describe(file, () => {
      const text = readFileSync(join(BOARDS, file), 'utf8');
      const board = importBoard(file, text);

      test('detects and imports to the pinned shape', () => {
        assert.equal(detectFormat(text), file.endsWith('.kicad_pcb') ? 'kicad-pcb' : 'easyeda-pcb');
        assert.equal(board.parts.length, parts);
        assert.ok(board.outline.length > 0, 'has an outline');
        assert.ok(board.bbox.w > 5 && board.bbox.h > 5, 'sane size');
      });

      test('the DRC verdict is exactly the pinned one', () => {
        assert.deepEqual(verdictOf(runPcbDrc(board)), verdict);
      });

      test('renders', () => {
        const svg = renderBoardSvg(board);
        assert.match(svg, /^<svg /);
        assert.ok(svg.length > 1000);
      });

      test('cross-exports hold the partition (EasyEDA and KiCad writers)', () => {
        const p0 = partition(board);
        const viaEda = importEasyEdaPcb(exportEasyEdaPcb(board));
        assert.deepEqual(partition(viaEda), p0, 'via the EasyEDA writer');
        const viaKicad = importKicadPcb(exportKicadPcb(board).text);
        assert.deepEqual(partition(viaKicad), p0, 'via the KiCad writer');
      });
    });
  }
});

// ── local-only corpus (redistribution-restricted designs) ──────────

const LOCAL = process.env.BW_PCB_CORPUS || join(homedir(), 'code', 'pcb-corpus-local');
const haveLocal = existsSync(LOCAL);

describe('local corpus (skips without the directory)', { skip: !haveLocal }, () => {
  const files = haveLocal
    ? readdirSync(LOCAL).filter((f) => /\.(kicad_pcb|json)$/.test(f) && !/sch/i.test(f))
    : [];

  test('every local board completes the pipeline without a throw', () => {
    assert.ok(files.length > 0, 'local corpus present but empty');
    for (const f of files) {
      const board = importBoard(f, readFileSync(join(LOCAL, f), 'utf8'));
      const findings = runPcbDrc(board);
      renderBoardSvg(board);
      // The strong claim is bounded to what was measured: no DANGER
      // findings on any of these working, fabbed boards.
      const dangers = findings.filter((x) => x.severity === 'danger');
      assert.deepEqual(dangers, [], `${f}: ${dangers.map((d) => d.rule).join(',')}`);
    }
  });
});
