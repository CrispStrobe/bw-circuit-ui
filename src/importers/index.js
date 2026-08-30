/**
 * Circuit importer registry.
 *
 * importCircuit(format, text) → { parts, wires, warnings, unmapped }
 *
 * Supported formats:
 *   'eagle'          - EAGLE 6+ schematic (.sch, XML)
 *   'kicad-sch'      - KiCad 6+ schematic (.kicad_sch, s-expression)
 *   'kicad-legacy'   - KiCad 4/5 schematic (.sch, EESchema plain text)
 *   'kicad-netlist'  - KiCad .net s-expression or .xml netlist (auto-detected)
 *   'easyeda'        - EasyEDA Standard schematic (.json, tilde-delimited DSL)
 *   'fritzing'       - Fritzing schematic (.fz / inside .fzz, XML)
 *   'wokwi'          - Wokwi diagram.json
 *   'spice'          - SPICE netlist (.cir/.sp), any dialect's export
 *
 * The SCHEMATIC importers differ from the netlist one in kind, not in degree:
 * a netlist states its connections, a schematic states GEOMETRY and the
 * reader must work the connections out. See kicad-common.js, whose NetSolver
 * the KiCad and EasyEDA front ends share.
 *
 * The return value is a circuit descriptor compatible with the
 * bw-circuit-ui circuit model: parts[] with {id, kind, params, x, y},
 * wires[] with {from, fromTerminal, to, toTerminal}.
 *
 * unmapped[] contains components that could not be mapped to engine
 * kinds — they are NEVER silently dropped.
 *
 * @module
 */

import { importEagle } from './eagle.js';
import { importKicadSch } from './kicad-sch.js';
import { importKicadLegacy } from './kicad-legacy.js';
import { importKicadNetlist } from './kicad-netlist.js';
import { importEasyEda } from './easyeda.js';
import { importEasyEdaPcbAsCircuit, importEasyEdaProStub } from './easyeda-pcb.js';
import { importKicadPcbAsCircuit } from './kicad-pcb.js';
import { importEasyEdaProPcbAsCircuit } from './easyeda-pro-pcb.js';
import { importFritzing } from './fritzing.js';
import { importWokwi, exportWokwi } from './wokwi.js';
import { importSpice } from './spice.js';

const IMPORTERS = {
  'eagle':         importEagle,
  'kicad-sch':     importKicadSch,
  'kicad-legacy':  importKicadLegacy,
  'kicad-netlist': importKicadNetlist,
  'easyeda':       importEasyEda,
  // A board, not a schematic: the circuit contract is honoured with empty
  // parts/wires and the board model rides along as `board` (docs/PCB-SUPPORT-PLAN.md).
  'easyeda-pcb':   importEasyEdaPcbAsCircuit,
  // EasyEDA Pro PCB documents (V2 .epcb and V3 .epcb2/.epru): real reader.
  'easyeda-pro-pcb': importEasyEdaProPcbAsCircuit,
  // Named refusal for the REST of the Pro family (schematics, projects).
  'easyeda-pro':   importEasyEdaProStub,
  // KiCad board: same contract as easyeda-pcb — lifted circuit + board.
  'kicad-pcb':     importKicadPcbAsCircuit,
  // Fritzing (.fz, and the document inside a .fzz archive).
  'fritzing':      importFritzing,
  'wokwi':         importWokwi,
  // SPICE netlist — the universal bridge: every schematic tool exports one,
  // including the ones whose native formats are closed (ROADMAP X1.1).
  'spice':         importSpice,
};

/**
 * The import menu's entries, in one list.
 *
 * The menu used to hold hand-typed format ids, and one of them —
 * "Diagram (.json)", forcing `pendingFormat = 'json'` — was not a key in
 * IMPORTERS at all. importCircuit returned `{parts: [], warnings: [...]}`,
 * the caller checked `r.parts.length` and did nothing, and the entry was a
 * button that silently did nothing for its whole life (ROADMAP X0.5).
 *
 * Rendering the menu from THIS list, whose ids are checked against IMPORTERS
 * by test/import-reachability.test.js, is why that cannot recur.
 *
 * `id: null` means auto-detect. `lib: true` means the format needs a second
 * file picked alongside (a KiCad 4/5 .sch keeps its pin geometry in a
 * -cache.lib and cannot be wired without it).
 */
export const IMPORT_FORMATS = [
  { id: null, label: 'File (auto-detect)', labelDe: 'Datei (automatisch)',
    accept: '.sch,.net,.xml,.json,.kicad_sch,.fz,.fzz,.lib' },
  { id: 'eagle', label: 'EAGLE schematic (.sch)', labelDe: 'EAGLE-Schaltplan (.sch)',
    accept: '.sch,.xml' },
  { id: 'kicad-sch', label: 'KiCad 6+ schematic (.kicad_sch)',
    labelDe: 'KiCad-6+-Schaltplan (.kicad_sch)', accept: '.kicad_sch' },
  { id: 'kicad-legacy', label: 'KiCad 4/5 schematic (.sch + -cache.lib)',
    labelDe: 'KiCad-4/5-Schaltplan (.sch + -cache.lib)', accept: '.sch,.lib', lib: true,
    hint: 'pick the .sch AND its -cache.lib together',
    hintDe: 'die .sch UND die -cache.lib zusammen wählen' },
  { id: 'kicad-netlist', label: 'KiCad netlist (.net/.xml)',
    labelDe: 'KiCad-Netzliste (.net/.xml)', accept: '.net,.xml' },
  { id: 'easyeda', label: 'EasyEDA schematic (.json)',
    labelDe: 'EasyEDA-Schaltplan (.json)', accept: '.json' },
  { id: 'fritzing', label: 'Breadboard document (.fz)',
    labelDe: 'Steckbrett-Dokument (.fz)', accept: '.fz,.fzz' },
  { id: 'wokwi', label: 'Diagram (diagram.json)', labelDe: 'Diagramm (diagram.json)',
    accept: '.json' },
  { id: 'spice', label: 'SPICE netlist (.cir/.sp/.net)',
    labelDe: 'SPICE-Netzliste (.cir/.sp/.net)', accept: '.cir,.sp,.spi,.ckt,.net' },
];

/**
 * Registered importers the menu deliberately does NOT offer, each with the
 * reason. A key leaving this map must gain an IMPORT_FORMATS entry.
 */
export const NOT_OFFERED = new Map([
  ['easyeda-pcb', 'a BOARD document: it returns an empty circuit with a board '
    + 'model riding along, and the circuit-import callback has nowhere to put '
    + 'copper. Reached by auto-detect, not chosen from the menu.'],
  ['easyeda-pro-pcb', 'same: a board, not a schematic.'],
  ['kicad-pcb', 'same: a board, not a schematic.'],
  ['easyeda-pro', 'a named refusal for the rest of the Pro family — something '
    + 'auto-detect resolves to in order to say so, never something to pick.'],
]);

/**
 * Import a circuit from a foreign format.
 *
 * @param {string} format  One of the registered format keys
 * @param {string} text    Raw file content (string, not bytes)
 * @param {object} [opts]  Format-specific extras. 'kicad-legacy' needs
 *                         `{ lib }`: a KiCad 4/5 schematic keeps pin
 *                         positions in a separate .lib and cannot be wired
 *                         without it.
 * @returns {{ parts: Array, wires: Array, warnings: string[], unmapped: Array }}
 */
export function importCircuit(format, text, opts = {}) {
  const importer = IMPORTERS[format];
  if (!importer) {
    return {
      parts: [], wires: [],
      warnings: [`Unknown import format: "${format}". Supported: ${Object.keys(IMPORTERS).join(', ')}`],
      unmapped: [],
    };
  }
  return importer(text, opts);
}

export { exportWokwi };

/**
 * List supported import formats.
 * @returns {string[]}
 */
export function getSupportedFormats() {
  return Object.keys(IMPORTERS);
}
