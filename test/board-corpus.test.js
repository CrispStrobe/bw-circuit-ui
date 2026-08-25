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
import { importEasyEdaProPcb } from '../src/importers/easyeda-pro-pcb.js';
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
  ['dvi-sock.kicad_pcb', 15, { 'clearance/warning': 23 }],
  ['otter-front.kicad_pcb', 2, {}],
  ['otter-back.kicad_pcb', 4, {}],
  ['tiny-esp.kicad_pcb', 12, {}],
  ['orpheuspad.kicad_pcb', 16, {}],
  ['atomic14.kicad_pcb', 21, {}],
  // Session-five promotions, each for a feature the first corpus lacked:
  // upduino = 4-layer stack + custom (primitives) pads; ef-s = the whole
  // outline is gr_circle records; usd-extender = renamed Top/Bottom
  // copper; niubi = a flex PCB routed everywhere at hairline clearances
  // (the 40 warnings are its normal state, capped by the reporter).
  ['upduino-v3.kicad_pcb', 113, {}],
  ['ef-s-lensmount.kicad_pcb', 40, {}],
  ['usd-extender.kicad_pcb', 3, {}],
  ['niubi-headphones-flex.kicad_pcb', 35, { 'clearance/warning': 40, 'clearance/info': 1 }],
  ['nanoels-pcb.json', 28, {}],
  ['tuitar-pcb.json', 18, {}],
  // EasyEDA PRO (V2 array style). Components import pad-less by design
  // (master/instance; bare documents carry no FOOTPRINT masters), so
  // `parts` counts components and the verdicts judge the copper. The
  // "0.8 mm outline gaps" first pinned here were a misreading: a POLY on
  // the outline layer is a polygon, its closing edge implied, and the
  // reader now closes it (nanohub healed). smartcar's remaining open
  // outline is real even after closure.
  ['macropad.epcb', 9, { 'clearance/warning': 3 }],
  ['nanohub.epcb', 23, { 'clearance/warning': 15 }],
  ['smartcar.epcb', 73, { 'outline-open/danger': 1 }],
];

const importBoard = (file, text) => (file.endsWith('.kicad_pcb')
  ? importKicadPcb(text)
  : /\.(epcb|epcb2|epru)$/.test(file) ? importEasyEdaProPcb(text)
    : importEasyEdaPcb(text));

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
        const expected = file.endsWith('.kicad_pcb') ? 'kicad-pcb'
          : file.endsWith('.epcb') ? 'easyeda-pro-pcb' : 'easyeda-pcb';
        assert.equal(detectFormat(text), expected);
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

      test('cross-exports hold the partition (EasyEDA and KiCad writers)', { skip: file.endsWith('.epcb') }, () => {
        const p0 = partition(board);
        const viaEda = importEasyEdaPcb(exportEasyEdaPcb(board));
        assert.deepEqual(partition(viaEda), p0, 'via the EasyEDA writer');
        const viaKicad = importKicadPcb(exportKicadPcb(board).text);
        assert.deepEqual(partition(viaKicad), p0, 'via the KiCad writer');
      });
    });
  }
});

// ── gallery boards (examples declaring files.pcb) ──────────────────

// EXAMPLES_DIR overrides the sibling lookup (same contract as
// schematic-geometry-corpus.test.js): an explicitly selected corpus is
// never silently replaced, and a missing one is an error, not a skip.
const EXPLICIT_EXAMPLES = process.env.EXAMPLES_DIR || null;
if (EXPLICIT_EXAMPLES && !existsSync(join(EXPLICIT_EXAMPLES, 'index.json'))) {
  throw new Error(`EXAMPLES_DIR=${EXPLICIT_EXAMPLES} has no index.json.`);
}
const EXAMPLES = EXPLICIT_EXAMPLES || [
  join(import.meta.dirname, '..', '..', 'sb3-creator', 'examples'),
  join(homedir(), 'code', 'sb3-creator', 'examples'),
].find((d) => existsSync(join(d, 'index.json')));

describe('gallery boards (skips without the sibling corpus)', { skip: !EXAMPLES }, () => {
  const entries = EXAMPLES
    ? JSON.parse(readFileSync(join(EXAMPLES, 'index.json'), 'utf8'))
      .filter((e) => e.files && e.files.pcb)
    : [];

  test('at least one example ships a board (the gate can fail)', () => {
    assert.ok(entries.length >= 1, 'no gallery entry declares files.pcb');
  });

  for (const entry of entries) {
    test(`${entry.id}: the shipped board carries exactly its declared verdict`, () => {
      const text = readFileSync(join(EXAMPLES, entry.files.pcb), 'utf8');
      const board = importBoard(entry.files.pcb, text);
      assert.ok(board.parts.length > 0);
      assert.deepEqual(board.warnings, []);
      // Default: defect-free. A TEACHING board declares its planted
      // faults in pcbExpectedFindings ({rule/severity: count}), and the
      // gate then pins the verdict EXACTLY — gaining or losing a finding
      // both fail, so a lesson's fault can neither heal nor spread.
      assert.deepEqual(verdictOf(runPcbDrc(board)), entry.pcbExpectedFindings || {},
        `${entry.id}: the shipped board's verdict must match its declaration`);
      renderBoardSvg(board);
    });
  }
});

// ── local-only corpus (redistribution-restricted designs) ──────────

const LOCAL = process.env.BW_PCB_CORPUS || join(homedir(), 'code', 'pcb-corpus-local');
const haveLocal = existsSync(LOCAL);

describe('local corpus (skips without the directory)', { skip: !haveLocal }, () => {
  const manifest = haveLocal && existsSync(join(LOCAL, 'manifest.json'))
    ? JSON.parse(readFileSync(join(LOCAL, 'manifest.json'), 'utf8'))
    : { boards: {} };
  const files = haveLocal
    ? readdirSync(LOCAL).filter((f) => /\.(kicad_pcb|json|epcb|epcb2|epru)$/.test(f)
      && !/manifest|sch/i.test(f))
    : [];

  test('every local board completes the pipeline and meets its expectation', () => {
    assert.ok(files.length > 0, 'local corpus present but empty');
    const failures = [];
    for (const f of files) {
      let findings;
      try {
        const board = importBoard(f, readFileSync(join(LOCAL, f), 'utf8'));
        findings = runPcbDrc(board);
        renderBoardSvg(board);
      } catch (e) {
        failures.push(`${f}: THREW ${e.message}`);
        continue;
      }
      const entry = manifest.boards?.[f];
      if (entry?.expected) {
        // A pinned verdict: drift EITHER way fails — a known defect may
        // neither heal silently nor spread.
        const verdict = {};
        for (const x of findings) {
          const k = `${x.rule}/${x.severity}`;
          verdict[k] = (verdict[k] || 0) + 1;
        }
        try { assert.deepEqual(verdict, entry.expected); } catch {
          failures.push(`${f}: verdict ${JSON.stringify(verdict)} != pinned ${JSON.stringify(entry.expected)}`);
        }
      } else {
        // Default expectation for a working, fabbed board: no dangers.
        const dangers = findings.filter((x) => x.severity === 'danger');
        if (dangers.length) failures.push(`${f}: dangers ${dangers.map((d) => d.rule).join(',')}`);
      }
    }
    assert.deepEqual(failures, []);
  });
});
