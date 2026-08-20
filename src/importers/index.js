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
 *   'wokwi'          - Wokwi diagram.json
 *
 * The two schematic importers differ from the netlist one in kind, not in
 * degree: a netlist states its connections, a schematic states GEOMETRY and
 * the reader must work the connections out. See kicad-common.js.
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
import { importWokwi, exportWokwi } from './wokwi.js';

const IMPORTERS = {
  'eagle':         importEagle,
  'kicad-sch':     importKicadSch,
  'kicad-legacy':  importKicadLegacy,
  'kicad-netlist': importKicadNetlist,
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
