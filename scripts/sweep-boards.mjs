/**
 * Sweep board files through the whole pipeline: import → copper netlist →
 * DRC → render, one line per board, no throws tolerated.
 *
 * Usage:
 *   node scripts/sweep-boards.mjs <dir-or-file> [...more] [--json out.json]
 *
 * The triage tool for corpus intake: run it over a directory of freshly
 * fetched boards, read the table, chase anything that throws or shorts,
 * then pin the survivors' verdicts in a manifest. Formats are detected
 * per file: .kicad_pcb, EasyEDA Standard .json, EasyEDA Pro .epcb/.epru/
 * .epcb2 — same dispatch the corpus test uses.
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import '../test/_setup.js';
import { importKicadPcb } from '../src/importers/kicad-pcb.js';
import { importEasyEdaPcb } from '../src/importers/easyeda-pcb.js';
import { importEasyEdaProPcb } from '../src/importers/easyeda-pro-pcb.js';
import { computeCopperNetlist } from '../src/model/copper-netlist.js';
import { runPcbDrc } from '../src/model/pcb-drc.js';
import { renderBoardSvg } from '../src/model/board-svg.js';

export function importBoardFile(file, text) {
  if (file.endsWith('.kicad_pcb')) return importKicadPcb(text);
  if (/\.(epcb|epcb2|epru)$/.test(file)) return importEasyEdaProPcb(text);
  return importEasyEdaPcb(text);
}

export function sweepBoard(file, text) {
  const t0 = Date.now();
  const board = importBoardFile(file, text);
  const copper = computeCopperNetlist(board);
  const findings = runPcbDrc(board, { copper });
  renderBoardSvg(board);
  const verdict = {};
  for (const f of findings) {
    const k = `${f.rule}/${f.severity}`;
    verdict[k] = (verdict[k] || 0) + 1;
  }
  return {
    file: basename(file),
    parts: board.parts.length,
    tracks: board.tracks.length,
    vias: board.vias.length,
    pours: board.pours.length,
    outline: board.outline.length,
    copperLayers: board.copperLayers,
    bbox: `${board.bbox.w.toFixed(0)}x${board.bbox.h.toFixed(0)}`,
    shorts: copper.islands.filter((i) => i.nets.length > 1).length,
    verdict,
    warnings: board.warnings,
    ignored: board.ignored,
    ms: Date.now() - t0,
  };
}

const isMain = process.argv[1] && import.meta.url.endsWith(basename(process.argv[1]));
if (isMain) {
  const args = process.argv.slice(2);
  const jsonIdx = args.indexOf('--json');
  const jsonOut = jsonIdx >= 0 ? args.splice(jsonIdx, 2)[1] : null;
  const files = [];
  for (const a of args) {
    if (statSync(a).isDirectory()) {
      for (const f of readdirSync(a).sort()) {
        if (/\.(kicad_pcb|json|epcb|epcb2|epru)$/.test(f) && !/manifest|sch|schematic/i.test(f)) {
          files.push(join(a, f));
        }
      }
    } else {
      files.push(a);
    }
  }
  const results = [];
  let failed = 0;
  for (const f of files) {
    try {
      const r = sweepBoard(f, readFileSync(f, 'utf8'));
      results.push(r);
      const v = Object.entries(r.verdict).map(([k, n]) => `${k}x${n}`).join(' ') || 'CLEAN';
      console.log(`${r.file.padEnd(34)} ${String(r.parts).padStart(3)}c ${String(r.tracks).padStart(5)}t `
        + `${String(r.pours).padStart(3)}z L${r.copperLayers.join('.')}`.padEnd(64)
        + ` ${r.bbox.padStart(9)} shorts:${r.shorts} ${v}`);
      if (r.warnings.length) console.log(`  ! ${r.warnings[0].slice(0, 100)}`);
    } catch (e) {
      failed += 1;
      results.push({ file: basename(f), error: e.message });
      console.log(`${basename(f).padEnd(34)} THREW: ${e.message.slice(0, 90)}`);
    }
  }
  console.log(`\n${files.length} boards, ${failed} threw, `
    + `${results.filter((r) => !r.error && !Object.keys(r.verdict).length).length} clean.`);
  if (jsonOut) writeFileSync(jsonOut, JSON.stringify(results, null, 1));
}
