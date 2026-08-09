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
 * Layout strategy: each pin gets a vertical column. Parts belonging to
 * that pin are arranged top-to-bottom in circuit order. VCC at top,
 * GND at bottom, MCU on the right.
 *
 * @param {object} stc — { device?, clock?, pins: StcPin[] }
 * @returns {{ parts: Array, nets: Array, notes: string[] }}
 */
export function inferCircuit(stc) {
  const { inferNetlist } = getEngine();

  // ── Normalize pin directions ───────────────────────────────────
  // - "pwm" → "output" (same LED netlist, duty cycle is handled by the engine)
  // - "tone" → "output" with a name that triggers buzzer detection
  // - ports are passed through to the engine's inferNetlist, which
  //   handles them natively (boundary C row 6: PORT OUTPUT → 8 LEDs)
  const normalizedStc = {
    ...stc,
    ports: stc.ports || [],
    pins: (stc.pins || []).map(pin => {
      if (pin.direction === 'pwm') {
        return { ...pin, direction: 'output' };
      }
      if (pin.direction === 'tone') {
        const buzzerPattern = /buzz|speaker|tone|beep/i;
        const name = buzzerPattern.test(pin.name) ? pin.name : `${pin.name}_buzzer`;
        return { ...pin, direction: 'output', activeLow: false, name };
      }
      return pin;
    }),
  };

  const { parts, nets, notes } = inferNetlist(normalizedStc);

  // Group non-fixed parts by the pin/port they belong to.
  // Convention from inferNetlist: R_<name>, LED_<name>, POT_<name>, etc.
  // Port parts use segment names: R_<portname>_a, LED_<portname>_b, etc.
  const pinNames = normalizedStc.pins.map(p => p.name.replace(/[^a-zA-Z0-9_]/g, '_'));
  const portNames = (normalizedStc.ports || []).map(p => p.name.replace(/[^a-zA-Z0-9_]/g, '_'));
  const allNames = [...pinNames, ...portNames];
  const pinParts = new Map(); // pinName → [partIds in circuit order]

  for (const part of parts) {
    if (part.id === 'VCC' || part.id === 'GND' || part.id === 'MCU') continue;
    const ownerPin = allNames.find(name => part.id.includes(name));
    if (ownerPin) {
      if (!pinParts.has(ownerPin)) pinParts.set(ownerPin, []);
      pinParts.get(ownerPin).push(part.id);
    }
  }

  // Layout constants
  const colWidth = 140;
  const startX = 120;
  // Estimate total columns needed (ports use more columns)
  let totalCols = 0;
  for (const [name, ids] of pinParts) {
    if (portNames.includes(name) && ids.length > 6) {
      totalCols += ids.length > 8 ? 3 : 2;
    } else {
      totalCols++;
    }
  }
  const mcuX = startX + Math.max(1, totalCols) * colWidth + 60;
  const mcuY = 220;
  const vccY = 50;
  const gndY = 420;

  // Position fixed parts
  const positions = new Map();
  positions.set('VCC', { x: startX, y: vccY });
  positions.set('GND', { x: startX, y: gndY });
  positions.set('MCU', { x: mcuX, y: mcuY });

  // Position per-pin/port parts in columns
  let colIdx = 0;
  for (const [groupName, partIds] of pinParts) {
    const isPort = portNames.includes(groupName);

    if (isPort && partIds.length > 6) {
      // Port with many parts: grid layout (4 columns of R+LED pairs)
      const gridCols = 4;
      for (let i = 0; i < partIds.length; i++) {
        const gc = i % gridCols;
        const gr = Math.floor(i / gridCols);
        positions.set(partIds[i], {
          x: startX + colIdx * colWidth + gc * 70,
          y: vccY + 60 + gr * 50,
        });
      }
      colIdx += Math.ceil(partIds.length / 4) > 2 ? 3 : 2;
    } else {
      // Single pin: vertical column
      const colX = startX + colIdx * colWidth;
      const stepY = Math.min(80, (gndY - vccY - 100) / (partIds.length + 1));
      const topY = vccY + 60;

      for (let i = 0; i < partIds.length; i++) {
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
    const pos = positions.get(part.id) || { x: startX + colIdx * colWidth, y: 200 };
    return { ...part, x: pos.x, y: pos.y };
  });

  return { parts: positioned, nets, notes };
}
