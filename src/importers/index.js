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
};

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
