/**
 * Circuit importer registry.
 *
 * importCircuit(format, text) → { parts, wires, warnings, unmapped }
 *
 * Supported formats:
 *   'kicad-netlist'  — KiCad .net s-expression netlist
 *   'wokwi'          — Wokwi diagram.json
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

import { importKicadNetlist } from './kicad-netlist.js';
import { importWokwi, exportWokwi } from './wokwi.js';

const IMPORTERS = {
  'kicad-netlist': importKicadNetlist,
  'wokwi':         importWokwi,
};

/**
 * Import a circuit from a foreign format.
 *
 * @param {string} format  One of the registered format keys
 * @param {string} text    Raw file content (string, not bytes)
 * @returns {{ parts: Array, wires: Array, warnings: string[], unmapped: Array }}
 */
export function importCircuit(format, text) {
  const importer = IMPORTERS[format];
  if (!importer) {
    return {
      parts: [], wires: [],
      warnings: [`Unknown import format: "${format}". Supported: ${Object.keys(IMPORTERS).join(', ')}`],
      unmapped: [],
    };
  }
  return importer(text);
}

export { exportWokwi };

/**
 * List supported import formats.
 * @returns {string[]}
 */
export function getSupportedFormats() {
  return Object.keys(IMPORTERS);
}
