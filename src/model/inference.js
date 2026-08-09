/**
 * Boundary C integration — infer a circuit from pin declarations
 * and check for wiring issues.
 *
 * Imports inferNetlist and checkWiring from bw-board.
 * Adds layout positions so the inferred parts can be rendered.
 */

import { getEngine } from '../engine.js';

/**
 * Re-export checkWiring from the injected engine.
 */
export function checkWiring(declaredPins, wiredParts, wiredNets) {
  return getEngine().checkWiring(declaredPins, wiredParts, wiredNets);
}

/**
 * Infer a netlist from project pin declarations and add layout positions.
 *
 * Layout strategy: parts arranged in vertical chains following the
 * signal path. Each pin/port gets a column. VCC at top, GND at bottom,
 * MCU on the right.
 *
 * @param {object} stc — { device?, clock?, pins?, ports?, parts? }
 * @returns {{ parts: Array, nets: Array, notes: string[] }}
 */
export function inferCircuit(stc) {
  const { inferNetlist } = getEngine();

  const expandedPins = [];
  const partNotes = [];

  // ── Expand PART declarations ──────────────────────────────────
  for (const part of (stc.parts || [])) {
    const safeName = part.name.replace(/[^a-zA-Z0-9_]/g, '_');
    if (part.kind === '74hc595') {
      for (const [role, pin] of Object.entries(part.pins || {})) {
        const match = pin.match(/P(\d+)\.(\d+)/);
        if (match) {
          expandedPins.push({
            name: `${safeName}_${role}`,
            port: parseInt(match[1]),
            bit: parseInt(match[2]),
            pin,
            direction: 'input',
            activeLow: false,
          });
        }
      }
      partNotes.push(
        `${part.kind.toUpperCase()} "${part.name}": 3 control pins → ` +
        `${part.outputs || 8} outputs. Not electrically simulated (edge-order logic).`
      );
    }
  }

  // ── Normalize pin directions ───────────────────────────────────
  const allPins = [...(stc.pins || []), ...expandedPins];
  const normalizedStc = {
    ...stc,
    ports: stc.ports || [],
    pins: allPins.map(pin => {
      if (pin.direction === 'pwm') return { ...pin, direction: 'output' };
      if (pin.direction === 'tone') {
        const buzzerPattern = /buzz|speaker|tone|beep/i;
        const name = buzzerPattern.test(pin.name) ? pin.name : `${pin.name}_buzzer`;
        return { ...pin, direction: 'output', activeLow: false, name };
      }
      return pin;
    }),
  };

  const { parts, nets, notes } = inferNetlist(normalizedStc);

  // ── Layout: vertical signal-path chains ────────────────────────
  // Group parts by the pin/port they belong to
  const pinNames = normalizedStc.pins.map(p => p.name.replace(/[^a-zA-Z0-9_]/g, '_'));
  const portNames = (normalizedStc.ports || []).map(p => p.name.replace(/[^a-zA-Z0-9_]/g, '_'));
  const allNames = [...pinNames, ...portNames];

  const groups = new Map(); // name → [partIds]
  for (const part of parts) {
    if (part.id === 'VCC' || part.id === 'GND' || part.id === 'MCU') continue;
    const owner = allNames.find(name => part.id.includes(name));
    if (owner) {
      if (!groups.has(owner)) groups.set(owner, []);
      groups.get(owner).push(part.id);
    }
  }

  // Count columns needed
  let totalCols = 0;
  for (const [name, ids] of groups) {
    if (portNames.includes(name) && ids.length > 6) {
      totalCols += Math.min(4, Math.ceil(ids.length / 4));
    } else {
      totalCols++;
    }
  }
  totalCols = Math.max(1, totalCols);

  // Layout constants
  const colWidth = 120;
  const startX = 140;
  const vccY = 60;
  const gndY = 400;
  const mcuX = startX + totalCols * colWidth + 80;
  const mcuY = (vccY + gndY) / 2;

  // Center VCC above all columns, GND below, MCU to the right
  const centerX = startX + (totalCols - 1) * colWidth / 2;
  const positions = new Map();
  positions.set('VCC', { x: centerX, y: vccY });
  positions.set('GND', { x: centerX, y: gndY });
  positions.set('MCU', { x: mcuX, y: mcuY });

  // Place each group in a vertical chain
  let colIdx = 0;
  for (const [groupName, partIds] of groups) {
    const isPort = portNames.includes(groupName);
    const colX = startX + colIdx * colWidth;

    if (isPort && partIds.length > 6) {
      // Port: grid layout (4 columns)
      const gridCols = 4;
      for (let i = 0; i < partIds.length; i++) {
        positions.set(partIds[i], {
          x: colX + (i % gridCols) * 70,
          y: vccY + 70 + Math.floor(i / gridCols) * 50,
        });
      }
      colIdx += Math.min(4, Math.ceil(partIds.length / gridCols));
    } else {
      // Pin: vertical chain between VCC and MCU
      // Parts are already in circuit order from inferNetlist
      // (e.g. [R_led1, LED_led1] for active-low output)
      const chainLen = partIds.length;
      const availH = gndY - vccY - 80;
      const stepY = Math.min(80, availH / (chainLen + 1));
      const topY = vccY + 50;

      for (let i = 0; i < chainLen; i++) {
        positions.set(partIds[i], {
          x: colX,
          y: topY + i * stepY,
        });
      }
      colIdx++;
    }
  }

  // Apply positions
  const positioned = parts.map(part => {
    const pos = positions.get(part.id) || { x: startX, y: mcuY };
    return { ...part, x: pos.x, y: pos.y };
  });

  return { parts: positioned, nets, notes: [...notes, ...partNotes] };
}
