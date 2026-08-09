/**
 * DIP chip definitions — 74HC and CD4xxx logic family.
 *
 * Each chip maps real DIP pin numbers to terminal names.
 * Pin numbering follows the standard: pins 1-N/2 on the left (top to bottom),
 * pins N/2+1 to N on the right (bottom to top). VCC and GND are always
 * the corner pins.
 *
 * @module
 */

/**
 * @typedef {object} DipChipDef
 * @property {string} kind — part kind slug
 * @property {string} label — display name
 * @property {number} pins — pin count (14, 16, etc.)
 * @property {Record<number, string>} pinMap — pin number → terminal name
 * @property {string} desc — one-line description
 */

/**
 * Generate terminal names from a pin map.
 * @param {Record<number, string>} pinMap
 * @returns {string[]}
 */
export function terminalsFromPinMap(pinMap) {
  return Object.values(pinMap).filter(name => name !== 'vcc' && name !== 'gnd');
}

/**
 * Generate a DIP breadboard footprint from pin count.
 * DIP packages straddle the gutter: pins 1-N/2 on one side,
 * pins N/2+1 to N on the other side (mirrored).
 *
 * @param {Record<number, string>} pinMap
 * @param {number} pinCount
 * @returns {import('./footprints.js').Footprint}
 */
export function dipFootprint(pinMap, pinCount) {
  const half = pinCount / 2;
  const leads = {};
  let refTerminal = null;

  for (let pin = 1; pin <= pinCount; pin++) {
    const name = pinMap[pin];
    if (!name) continue;

    if (pin <= half) {
      // Left side: pins 1-7 map to rows e, e+0 to e+(half-1)
      leads[name] = { dRow: 0, dCol: pin - 1 };
    } else {
      // Right side: pins 8-14 map to bottom (gutter), mirrored
      // Pin N is across from pin 1, pin N-1 across from pin 2, etc.
      const col = pinCount - pin;
      leads[name] = { dRow: 5, dCol: col };
    }

    if (!refTerminal) refTerminal = name;
  }

  return { refTerminal, straddlesGutter: true, leads };
}

// ── 74HC Logic Family — DIP-14 ──────────────────────────────────

/** @type {Record<string, DipChipDef>} */
export const LOGIC_CHIPS = {
  '74hc00': {
    kind: '74hc00', label: '74HC00 Quad NAND', pins: 14,
    desc: '4x 2-input NAND gates',
    pinMap: {
      1: '1a', 2: '1b', 3: '1y',
      4: '2a', 5: '2b', 6: '2y',
      7: 'gnd',
      8: '3y', 9: '3a', 10: '3b',
      11: '4y', 12: '4a', 13: '4b',
      14: 'vcc',
    },
  },
  '74hc02': {
    kind: '74hc02', label: '74HC02 Quad NOR', pins: 14,
    desc: '4x 2-input NOR gates',
    pinMap: {
      1: '1y', 2: '1a', 3: '1b',
      4: '2y', 5: '2a', 6: '2b',
      7: 'gnd',
      8: '3a', 9: '3b', 10: '3y',
      11: '4a', 12: '4b', 13: '4y',
      14: 'vcc',
    },
  },
  '74hc04': {
    kind: '74hc04', label: '74HC04 Hex Inverter', pins: 14,
    desc: '6x NOT gates',
    pinMap: {
      1: '1a', 2: '1y',
      3: '2a', 4: '2y',
      5: '3a', 6: '3y',
      7: 'gnd',
      8: '4y', 9: '4a',
      10: '5y', 11: '5a',
      12: '6y', 13: '6a',
      14: 'vcc',
    },
  },
  '74hc08': {
    kind: '74hc08', label: '74HC08 Quad AND', pins: 14,
    desc: '4x 2-input AND gates',
    pinMap: {
      1: '1a', 2: '1b', 3: '1y',
      4: '2a', 5: '2b', 6: '2y',
      7: 'gnd',
      8: '3y', 9: '3a', 10: '3b',
      11: '4y', 12: '4a', 13: '4b',
      14: 'vcc',
    },
  },
  '74hc32': {
    kind: '74hc32', label: '74HC32 Quad OR', pins: 14,
    desc: '4x 2-input OR gates',
    pinMap: {
      1: '1a', 2: '1b', 3: '1y',
      4: '2a', 5: '2b', 6: '2y',
      7: 'gnd',
      8: '3y', 9: '3a', 10: '3b',
      11: '4y', 12: '4a', 13: '4b',
      14: 'vcc',
    },
  },
  '74hc86': {
    kind: '74hc86', label: '74HC86 Quad XOR', pins: 14,
    desc: '4x 2-input XOR gates',
    pinMap: {
      1: '1a', 2: '1b', 3: '1y',
      4: '2a', 5: '2b', 6: '2y',
      7: 'gnd',
      8: '3y', 9: '3a', 10: '3b',
      11: '4y', 12: '4a', 13: '4b',
      14: 'vcc',
    },
  },
  '74hc595': {
    kind: '74hc595', label: '74HC595 Shift Register', pins: 16,
    desc: '8-bit shift register with output latch',
    pinMap: {
      1: 'q1', 2: 'q2', 3: 'q3', 4: 'q4', 5: 'q5', 6: 'q6', 7: 'q7',
      8: 'gnd',
      9: 'q7s', 10: 'mr', 11: 'shcp', 12: 'stcp', 13: 'oe',
      14: 'ds', 15: 'q0',
      16: 'vcc',
    },
  },
};

/**
 * Get terminal names for a logic chip.
 * @param {string} kind
 * @returns {string[] | null}
 */
export function logicChipTerminals(kind) {
  const chip = LOGIC_CHIPS[kind];
  if (!chip) return null;
  return terminalsFromPinMap(chip.pinMap);
}

/**
 * Get breadboard footprint for a logic chip.
 * @param {string} kind
 * @returns {import('./footprints.js').Footprint | null}
 */
export function logicChipFootprint(kind) {
  const chip = LOGIC_CHIPS[kind];
  if (!chip) return null;
  return dipFootprint(chip.pinMap, chip.pins);
}
