/**
 * EasyEDA export — via KiCad netlist import (the FALLBACK path).
 *
 * HISTORY: this header once claimed the native tilde-DSL format "is not
 * practical to synthesize from a netlist." That judgment aged out on
 * 2026-08-24 — exporters/easyeda-schematic.js now writes the native
 * dialect directly (sidecar pin geometry + a collision-free router +
 * our own importer as the round-trip oracle: 221 of 222 lite examples
 * export fully with partition equality). Prefer that path; the
 * application opens its output natively.
 *
 * This KiCad-netlist route stays as the working fallback for anything
 * the native writer refuses, re-exporting the KiCad serializer with an
 * EasyEDA-branded filename plus user-facing instructions.
 *
 * @module
 */

import { toKicadNet } from './kicad.js';

/**
 * @param {import('../netlist.js').Netlist} netlist
 * @returns {{ text: string, instructions: string }}
 */
export function toEasyEDA(netlist) {
  const text = toKicadNet(netlist);
  const instructions = [
    'How to import into EasyEDA:',
    '1. Open EasyEDA (Standard or Pro)',
    '2. File → Import → KiCad… (or drag the .net file onto the editor)',
    '3. EasyEDA will create schematic symbols and nets automatically',
    '4. Arrange components as desired, then proceed to PCB layout',
    '',
    'Note: Component footprints are mapped to KiCad library names.',
    'EasyEDA will substitute its own matching footprints on import.',
  ].join('\n');

  return { text, instructions };
}
