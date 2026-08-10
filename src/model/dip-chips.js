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

import { sidecarTerminals } from './parts-registry.js';

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
  // Triple 3-input gates — DIP-14, same pinout pattern
  '74hc10': {
    kind: '74hc10', label: '74HC10 Triple NAND3', pins: 14,
    desc: '3x 3-input NAND gates',
    pinMap: { 1: '1a', 2: '1b', 3: '2a', 4: '2b', 5: '2c', 6: '2y', 7: 'gnd', 8: '3y', 9: '3a', 10: '3b', 11: '3c', 12: '1y', 13: '1c', 14: 'vcc' },
  },
  '74hc11': {
    kind: '74hc11', label: '74HC11 Triple AND3', pins: 14,
    desc: '3x 3-input AND gates',
    pinMap: { 1: '1a', 2: '1b', 3: '2a', 4: '2b', 5: '2c', 6: '2y', 7: 'gnd', 8: '3y', 9: '3a', 10: '3b', 11: '3c', 12: '1y', 13: '1c', 14: 'vcc' },
  },
  '74hc27': {
    kind: '74hc27', label: '74HC27 Triple NOR3', pins: 14,
    desc: '3x 3-input NOR gates',
    pinMap: { 1: '1a', 2: '1b', 3: '2a', 4: '2b', 5: '2c', 6: '2y', 7: 'gnd', 8: '3y', 9: '3a', 10: '3b', 11: '3c', 12: '1y', 13: '1c', 14: 'vcc' },
  },
  // Hex inverters / Schmitt triggers — DIP-14
  '74hc14': {
    kind: '74hc14', label: '74HC14 Hex Schmitt Inv', pins: 14,
    desc: '6x Schmitt trigger inverters',
    pinMap: { 1: '1a', 2: '1y', 3: '2a', 4: '2y', 5: '3a', 6: '3y', 7: 'gnd', 8: '4y', 9: '4a', 10: '5y', 11: '5a', 12: '6y', 13: '6a', 14: 'vcc' },
  },
  '74hc132': {
    kind: '74hc132', label: '74HC132 Quad Schmitt NAND', pins: 14,
    desc: '4x 2-input Schmitt NAND',
    pinMap: { 1: '1a', 2: '1b', 3: '1y', 4: '2a', 5: '2b', 6: '2y', 7: 'gnd', 8: '3y', 9: '3a', 10: '3b', 11: '4y', 12: '4a', 13: '4b', 14: 'vcc' },
  },
  // Dual 4-input gates — DIP-14
  '74hc20': {
    kind: '74hc20', label: '74HC20 Dual NAND4', pins: 14,
    desc: '2x 4-input NAND gates',
    pinMap: { 1: '1a', 2: '1b', 3: 'nc1', 4: '1c', 5: '1d', 6: '1y', 7: 'gnd', 8: '2y', 9: '2a', 10: '2b', 11: 'nc2', 12: '2c', 13: '2d', 14: 'vcc' },
  },
  '74hc21': {
    kind: '74hc21', label: '74HC21 Dual AND4', pins: 14,
    desc: '2x 4-input AND gates',
    pinMap: { 1: '1a', 2: '1b', 3: 'nc1', 4: '1c', 5: '1d', 6: '1y', 7: 'gnd', 8: '2y', 9: '2a', 10: '2b', 11: 'nc2', 12: '2c', 13: '2d', 14: 'vcc' },
  },
  // Flip-flops — DIP-14
  '74hc73': {
    kind: '74hc73', label: '74HC73 Dual JK-FF', pins: 14,
    desc: '2x JK flip-flop with clear',
    pinMap: { 1: '1clk', 2: '1clr', 3: '1k', 4: 'vcc', 5: '2clk', 6: '2clr', 7: '2j', 8: '2qn', 9: '2q', 10: '2k', 11: 'gnd', 12: '1q', 13: '1qn', 14: '1j' },
  },
  '74hc74': {
    kind: '74hc74', label: '74HC74 Dual D-FF', pins: 14,
    desc: '2x D flip-flop with set/reset',
    pinMap: { 1: '1clr', 2: '1d', 3: '1clk', 4: '1prn', 5: '1q', 6: '1qn', 7: 'gnd', 8: '2qn', 9: '2q', 10: '2prn', 11: '2clk', 12: '2d', 13: '2clr', 14: 'vcc' },
  },
  '74hc75': {
    kind: '74hc75', label: '74HC75 4-bit Latch', pins: 16,
    desc: '4-bit level-triggered latch',
    pinMap: { 1: '1qn', 2: '1d', 3: '2d', 4: '2en', 5: 'vcc', 6: '3d', 7: '3qn', 8: 'gnd', 9: '3q', 10: '4qn', 11: '4d', 12: '4en', 13: '4q', 14: '1en', 15: '1q', 16: '2q' },
  },
  // Counters and shift registers — DIP-14
  '74hc93': {
    kind: '74hc93', label: '74HC93 4-bit Counter', pins: 14,
    desc: '4-bit ripple counter',
    pinMap: { 1: 'cka', 2: 'mr1', 3: 'mr2', 4: 'nc1', 5: 'vcc', 6: 'nc2', 7: 'nc3', 8: 'qc', 9: 'qb', 10: 'gnd', 11: 'qd', 12: 'qa', 13: 'nc4', 14: 'ckb' },
  },
  '74hc95': {
    kind: '74hc95', label: '74HC95 4-bit Shift Reg', pins: 14,
    desc: '4-bit shift register',
    pinMap: { 1: 'ser', 2: 'a', 3: 'b', 4: 'c', 5: 'd', 6: 'mode', 7: 'gnd', 8: 'clk2', 9: 'clk1', 10: 'qa', 11: 'qb', 12: 'qc', 13: 'qd', 14: 'vcc' },
  },
  '74hc283': {
    kind: '74hc283', label: '74HC283 4-bit Adder', pins: 16,
    desc: '4-bit full adder with carry',
    pinMap: { 1: 's2', 2: 'b2', 3: 'a2', 4: 's1', 5: 'a1', 6: 'b1', 7: 'cin', 8: 'gnd', 9: 'cout', 10: 's4', 11: 'b4', 12: 'a4', 13: 's3', 14: 'a3', 15: 'b3', 16: 'vcc' },
  },
  // CD4xxx — DIP-16
  'cd4017': {
    kind: 'cd4017', label: 'CD4017 Decade Counter', pins: 16,
    desc: 'Decade counter/divider with 10 decoded outputs',
    pinMap: { 1: 'q5', 2: 'q1', 3: 'q0', 4: 'q2', 5: 'q6', 6: 'q7', 7: 'q3', 8: 'gnd', 9: 'q8', 10: 'q4', 11: 'q9', 12: 'cout', 13: 'en', 14: 'clk', 15: 'rst', 16: 'vcc' },
  },
  'cd4511': {
    kind: 'cd4511', label: 'CD4511 BCD-to-7seg', pins: 16,
    desc: 'BCD to 7-segment latch/decoder/driver',
    pinMap: { 1: 'b', 2: 'c', 3: 'lt', 4: 'bi', 5: 'le', 6: 'd', 7: 'a', 8: 'gnd', 9: 'e', 10: 'd_out', 11: 'c_out', 12: 'b_out', 13: 'a_out', 14: 'g', 15: 'f', 16: 'vcc' },
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
/**
 * Get terminal names for a logic chip.
 *
 * Prefers bw-parts sidecar data (via parts-registry) over the local
 * LOGIC_CHIPS table. The local table is a FALLBACK for kinds bw-parts
 * has not yet defined; it should shrink as sidecars grow.
 *
 * bw-parts owns pin maps — they have audited 29 DIP chips against
 * datasheets (DIP-AUDIT.md). This table is the same split as the
 * current-ratings table was before 27cb14f fixed it.
 *
 * @param {string} kind
 * @returns {string[] | null}
 */
export function logicChipTerminals(kind) {
  // Try bw-parts sidecar first (one owner for pin maps)
  const sc = sidecarTerminals(kind);
  if (sc && sc.length > 2) {
    // Filter power pins — terminalsForKind returns signal pins only
    return sc.filter(n => n !== 'vcc' && n !== 'gnd');
  }
  // Fallback to local table
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
