/**
 * Formatting utilities for part labels and values.
 */

/**
 * Format a resistance value with SI prefix.
 * @param {number} ohms
 * @returns {string}
 */
export function fmtOhms(ohms) {
  if (ohms >= 1e6) return (ohms / 1e6).toFixed(ohms % 1e6 === 0 ? 0 : 1) + 'MΩ';
  if (ohms >= 1e3) return (ohms / 1e3).toFixed(ohms % 1e3 === 0 ? 0 : 1) + 'kΩ';
  return ohms + 'Ω';
}

/**
 * Format a capacitance value with SI prefix.
 * @param {number} farads
 * @returns {string}
 */
export function fmtFarads(farads) {
  if (farads >= 1e-3) return (farads * 1e3).toFixed(1) + 'mF';
  if (farads >= 1e-6) return (farads * 1e6).toFixed(0) + 'µF';
  if (farads >= 1e-9) return (farads * 1e9).toFixed(0) + 'nF';
  return (farads * 1e12).toFixed(0) + 'pF';
}

/**
 * Format a short label for a part.
 * @param {object} part — { id, kind, params }
 * @returns {string}
 */
export function partLabel(part) {
  // If the part has a declaration name (for blocks), show that
  if (part.declName) return part.declName;

  const num = part.id.replace(/\D+/g, '');
  switch (part.kind) {
    case 'resistor': return `R${num} ${fmtOhms(part.params.ohms || 0)}`;
    case 'led': return `LED${num}`;
    case 'capacitor': return `C${num} ${fmtFarads(part.params.farads || 0)}`;
    case 'potentiometer': return `POT${num} ${fmtOhms(part.params.ohms || 0)}`;
    case 'buzzer': return `BZ${num}`;
    case 'button': return `BTN${num}`;
    case 'diode': return `D${num}`;
    default: return part.id;
  }
}

/**
 * What a VCC symbol actually delivers: its own authored rail, else the board's.
 *
 * bw-board resolves this as knob > `params.volts` > board default, and the cap
 * printed `params.volts ?? 5` — so on a 3.3 V board every supply read "+5V",
 * and the label disagreed with the solver that fed the very nodes beside it.
 *
 * @param {object} part @param {number} boardVolts @returns {number}
 */
export function effectiveRailVolts(part, boardVolts) {
  const authored = part?.params?.volts;
  return Number.isFinite(authored) ? authored : boardVolts;
}

/**
 * Should this net be drawn highlighted?
 *
 * Two independent reasons, and the wire cannot tell them apart: the pointer is
 * over the net right now, or the reader PINNED it by clicking its voltage pill.
 * Pinning is what makes a reading answerable — "1.9 V" beside a dozen wires is
 * a number without a subject, and the owner asked which conductor it belongs
 * to. Hover alone cannot answer that, because moving to the wire you are asking
 * about is what ends the hover.
 *
 * @param {string|null|undefined} netId
 * @param {string|null|undefined} hoveredNet
 * @param {string|null|undefined} pinnedNet
 * @returns {boolean}
 */
export function netIsHighlighted(netId, hoveredNet, pinnedNet) {
  if (!netId) return false;
  return netId === hoveredNet || netId === pinnedNet;
}

/**
 * Where a node voltage sits between ground and the supply, clamped to 0..1.
 *
 * The wire colour scale divided by a hardcoded 5.0, so on a 3.3 V board a rail
 * at the supply read 0.66 and drew ORANGE — "mid-high" — when it was the
 * highest voltage in the circuit. The scale has to be relative to the rail the
 * board actually runs on, which is the same number the VCC cap prints.
 *
 * @param {number} volts @param {number} supplyVolts @returns {number}
 */
export function railFraction(volts, supplyVolts) {
  const rail = Number.isFinite(supplyVolts) && supplyVolts > 0 ? supplyVolts : 5;
  if (!Number.isFinite(volts)) return 0;
  return Math.max(0, Math.min(1, volts / rail));
}
