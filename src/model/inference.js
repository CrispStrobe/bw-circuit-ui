/**
 * Boundary C integration — infer a circuit from pin declarations
 * and check for wiring issues.
 *
 * Imports inferNetlist and checkWiring from bw-board.
 * Adds layout positions so the inferred parts can be rendered.
 */

import { inferNetlist, checkWiring } from '../../../bw-board/src/infer-netlist.js';

// Re-export for consumers
export { checkWiring };

/**
 * Layout constants for auto-placed parts.
 */
const LAYOUT = {
  mcuX: 450,
  mcuY: 220,
  vccX: 100,
  vccY: 50,
  gndX: 100,
  gndY: 420,
  startX: 100,
  startY: 130,
  colSpacing: 120,
  rowSpacing: 80,
};

/**
 * Infer a netlist from project pin declarations and add layout positions.
 *
 * @param {object} stc — { device?, clock?, pins: StcPin[] }
 * @returns {{ parts: Array, nets: Array, notes: string[] }}
 */
export function inferCircuit(stc) {
  const { parts, nets, notes } = inferNetlist(stc);

  // Assign layout positions to each part
  let col = 0;
  let row = 0;

  const positioned = parts.map(part => {
    let x, y;

    switch (part.id) {
      case 'VCC':
        x = LAYOUT.vccX;
        y = LAYOUT.vccY;
        break;
      case 'GND':
        x = LAYOUT.gndX;
        y = LAYOUT.gndY;
        break;
      case 'MCU':
        x = LAYOUT.mcuX;
        y = LAYOUT.mcuY;
        break;
      default:
        // Auto-place in a grid
        x = LAYOUT.startX + col * LAYOUT.colSpacing;
        y = LAYOUT.startY + row * LAYOUT.rowSpacing;
        col++;
        if (col > 2) {
          col = 0;
          row++;
        }
        break;
    }

    return { ...part, x, y };
  });

  return { parts: positioned, nets, notes };
}
