/**
 * EasyEDA export — via KiCad netlist import.
 *
 * EasyEDA's native JSON schematic format uses a tilde-delimited DSL
 * for every drawing primitive (pin geometry, component body outlines,
 * wire paths) that requires exact canvas coordinates and is not
 * practical to synthesize from a netlist. The documented import path
 * is KiCad .net → EasyEDA schematic, which handles symbol placement
 * and wiring automatically.
 *
 * This module re-exports the KiCad serializer with an EasyEDA-branded
 * filename and adds user-facing instructions.
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
