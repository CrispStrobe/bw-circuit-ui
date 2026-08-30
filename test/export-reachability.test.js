/**
 * AN EXPORT NOBODY CAN INVOKE IS A DEFECT, NOT A FEATURE.
 *
 * It has tests, it has a golden file, and it has never once run for a user.
 * Measured on 2026-08-30 at ee0d108, before this file existed:
 *
 *     writer                 reachable from a UI?
 *     toKicadSch             no  (the only OPENABLE schematic we can write)
 *     exportWokwi            no  (re-exported from importers/index.js only)
 *     exportSvgAsPng         no  (zero references anywhere in src/)
 *     toEagleSch             no  (only from a component never rendered)
 *     exportGerbers          no  (in the package barrel, called by nobody)
 *     exportKicadPcb         no  (scripts/kicad-oracle.mjs only)
 *     exportEasyEdaPcb       no  (no callers at all)
 *
 * seven of ten. And two whole components — ExportNetlistMenu.jsx and
 * ImportCircuitMenu.jsx — were imported by BoardCanvas/CircuitDesigner and
 * placed in no tree, so the EAGLE export, the KiCad 4/5 .sch + -cache.lib
 * pairing and the import report did not exist in the running app.
 *
 * This file is the structural fix, in three parts:
 *   1. every writer module on disk is registered (enumerated from the
 *      FILESYSTEM, so a new file cannot slip past a hand-written list);
 *   2. every registry entry actually produces a non-empty file;
 *   3. every registry entry reaches a menu, and every menu entry comes from
 *      the registry.
 *
 * @module
 */

import './_setup.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Circuit } from '../src/model/circuit.js';
import { projectBoardFromCircuit } from '../src/model/board-projection.js';
import { CIRCUIT_EXPORTS, BOARD_EXPORTS, ALL_EXPORTS, runExport }
  from '../src/model/exporters/registry.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(here, '../src');

/**
 * Modules under src/model/exporters/ that are not writers, each with the
 * reason. A file leaving this list must gain a registry entry.
 */
const NOT_A_WRITER = new Map([
  ['download.js', 'the download path itself, not a format'],
  ['registry.js', 'the registry'],
]);

function bench() {
  return Circuit.fromJSON({
    parts: [
      { id: 'VCC1', kind: 'vcc', params: {}, x: 0, y: 0 },
      { id: 'GND1', kind: 'gnd', params: {}, x: 0, y: 200 },
      { id: 'R1', kind: 'resistor', params: { ohms: 220 }, x: 60, y: 0 },
      { id: 'LED1', kind: 'led', params: { color: 'red' }, x: 120, y: 0 },
      { id: 'SW1', kind: 'button', params: {}, x: 180, y: 0 },
    ],
    wires: [
      { from: 'VCC1', fromTerminal: 'vcc', to: 'R1', toTerminal: 'a' },
      { from: 'R1', fromTerminal: 'b', to: 'LED1', toTerminal: 'anode' },
      { from: 'LED1', fromTerminal: 'cathode', to: 'SW1', toTerminal: 'a' },
      { from: 'SW1', fromTerminal: 'b', to: 'GND1', toTerminal: 'gnd' },
    ],
  });
}

describe('every writer we ship is reachable', () => {
  it('every module under model/exporters/ is in the registry', () => {
    const dir = path.join(SRC, 'model/exporters');
    const files = readdirSync(dir).filter(f => f.endsWith('.js'));
    assert.ok(files.length >= 10, `only ${files.length} exporter modules — did the dir move?`);
    const registered = new Set(ALL_EXPORTS.map(e => e.module).filter(Boolean));
    const registrySource = readFileSync(path.join(dir, 'registry.js'), 'utf-8');
    const missing = [];
    for (const f of files) {
      if (NOT_A_WRITER.has(f)) continue;
      // The registry imports every writer it can run; a module it does not
      // import is a module no menu can reach.
      if (!registrySource.includes(`'./${f}'`) && !registered.has(f)) missing.push(f);
    }
    assert.deepEqual(missing, [],
      'exporter modules with no registry entry — either register them or move '
      + 'them into NOT_A_WRITER with a reason');
  });

  it('the two writers that live outside that directory are registered too', () => {
    // exportWokwi sits in importers/wokwi.js (it is the other half of that
    // format) and the PNG rasteriser in model/export-png.js. Both were dead.
    const registrySource = readFileSync(
      path.join(SRC, 'model/exporters/registry.js'), 'utf-8');
    assert.ok(registrySource.includes('importers/wokwi.js'), 'exportWokwi registered');
    assert.ok(registrySource.includes('export-png.js'), 'the PNG writer registered');
  });

  it('no writer is left with zero call sites outside its own module', () => {
    // The measurement that produced the list above, kept as a gate. Each
    // name must appear somewhere that is not its own definition and not a
    // test — the registry counts, a component counts, a script does not.
    const WRITERS = {
      'toSpice': 'model/exporters/spice.js',
      'toKicadNet': 'model/exporters/kicad.js',
      'toKicadSch': 'model/exporters/kicad-sch.js',
      'toEasyEDA': 'model/exporters/easyeda.js',
      'toEasyEdaSchematic': 'model/exporters/easyeda-schematic.js',
      'toEagleSch': 'model/exporters/eagle.js',
      'exportKicadPcb': 'model/exporters/kicad-pcb.js',
      'exportEasyEdaPcb': 'model/exporters/easyeda-pcb.js',
      'exportGerbers': 'model/exporters/gerber.js',
      'exportWokwi': 'importers/wokwi.js',
      'svgToPngBlob': 'model/export-png.js',
      'exportSvgAsPng': 'model/export-png.js',
    };
    const sources = [];
    const walk = (dir) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(js|jsx)$/.test(e.name)) sources.push([path.relative(SRC, p), readFileSync(p, 'utf-8')]);
      }
    };
    walk(SRC);
    const orphans = [];
    for (const [name, own] of Object.entries(WRITERS)) {
      const callers = sources.filter(([rel, text]) =>
        rel !== own && new RegExp(`\\b${name}\\b`).test(text));
      if (callers.length === 0) orphans.push(name);
    }
    assert.deepEqual(orphans, [], 'writers with no caller anywhere in src/');
  });
});

describe('every registry entry produces a file', () => {
  const circuit = bench();
  const board = projectBoardFromCircuit(circuit).board;

  for (const entry of ALL_EXPORTS) {
    it(`${entry.id} writes at least one non-empty file`, async () => {
      if (entry.browserOnly) {
        // Rasterising needs Canvas 2D. Assert the shape instead of the bytes:
        // the point of the gate is that the entry EXISTS and is wired.
        assert.equal(typeof entry.run, 'function');
        assert.equal(entry.needs, 'svg');
        return;
      }
      const { files, report } = await runExport(entry, { circuit, board });
      assert.ok(files.length >= 1, `${entry.id} produced no file`);
      for (const f of files) {
        assert.ok(f.name, `${entry.id}: a file with no name`);
        const size = f.text ? f.text.length : (f.blob ? f.blob.size : 0);
        assert.ok(size > 0, `${entry.id}: ${f.name} is empty`);
      }
      assert.equal(typeof report, 'object');
    });
  }

  it('every entry declares a label in both languages and a unique id', () => {
    const ids = new Set();
    for (const e of ALL_EXPORTS) {
      assert.ok(e.id && !ids.has(e.id), `duplicate or missing id: ${e.id}`);
      ids.add(e.id);
      assert.ok(e.label && e.labelDe, `${e.id} has no bilingual label`);
      assert.ok(['netlist', 'circuit', 'board', 'svg'].includes(e.needs),
        `${e.id} declares needs='${e.needs}'`);
    }
  });
});

describe('every registry entry reaches a menu, and every menu entry is registered', () => {
  const canvas = readFileSync(path.join(SRC, 'components/BoardCanvas.jsx'), 'utf-8');
  const panel = readFileSync(path.join(SRC, 'components/BoardPanel.jsx'), 'utf-8');

  it('the circuit export menu renders FROM the registry, not from a copy', () => {
    assert.ok(canvas.includes('CIRCUIT_EXPORTS'),
      'BoardCanvas must render its export submenu from CIRCUIT_EXPORTS — a '
      + 'hand-maintained second list is how three writers went dark');
    assert.ok(canvas.includes('runExport'), 'and run them through runExport');
  });

  it('the board export menu renders from BOARD_EXPORTS', () => {
    assert.ok(panel.includes('BOARD_EXPORTS'), 'BoardPanel must offer the board writers');
    assert.ok(panel.includes('runExport'), 'and run them through runExport');
  });

  it('no component keeps its own hardcoded format list', () => {
    // The exact regression: BoardCanvas had a switch with four cases and a
    // fifth writer with no button, while a whole second menu component held
    // a sixth. Both lists are gone; the registry is the list.
    for (const [name, text] of [['BoardCanvas.jsx', canvas], ['BoardPanel.jsx', panel]]) {
      assert.ok(!/case 'spice':/.test(text),
        `${name} still switches on format ids by hand`);
    }
  });

  it('the components that were imported and never rendered are gone', () => {
    // ExportNetlistMenu.jsx and ImportCircuitMenu.jsx. Deleting them is the
    // verdict; what they offered lives in the reachable menus now.
    const components = readdirSync(path.join(SRC, 'components'));
    assert.ok(!components.includes('ExportNetlistMenu.jsx'),
      'ExportNetlistMenu.jsx is dead code — its formats are in the registry');
    for (const [name, text] of [['BoardCanvas.jsx', canvas]]) {
      assert.ok(!text.includes('ExportNetlistMenu'), `${name} still imports it`);
    }
  });
});
