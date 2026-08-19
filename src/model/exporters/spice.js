/**
 * SPICE netlist serializer (.cir).
 *
 * Takes a neutral Netlist (from netlist.js) and produces a SPICE
 * deck. Only parts with known SPICE cards (R, C, L, D, Q, V, I)
 * are emitted; complex parts (ICs, MCUs) are logged as comments.
 *
 * @module
 */

import { PART_SYMBOLS } from '../../data/easyeda-symbols.js';

/** SPICE element types that take a simple two-terminal card */
const TWO_TERMINAL = new Set(['R', 'C', 'L', 'V', 'I', 'F']);

/** SPICE element types that need a .model statement */
const NEEDS_MODEL = new Set(['D', 'Q', 'M']);

/**
 * Build a node-name map: for each part+pin, find which net it belongs to.
 * Returns a function (refdes, pin) -> netName.
 */
function buildNodeMap(netlist) {
  const map = new Map();  // "refdes:pin" -> netName
  for (const net of netlist.nets) {
    for (const node of net.nodes) {
      map.set(`${node.refdes}:${node.pin}`, net.name);
    }
  }
  return (refdes, pin) => map.get(`${refdes}:${pin}`) || '?';
}

/**
 * Serialize a netlist to SPICE .cir format.
 *
 * @param {import('../netlist.js').Netlist} netlist
 * @param {string} [title='BrickWright Circuit']
 * @returns {{ text: string, skipped: string[] }}
 */
export function toSpice(netlist, title = 'BrickWright Circuit') {
  const lines = [title, ''];
  const skipped = [];
  const nodeOf = buildNodeMap(netlist);

  for (const part of netlist.parts) {
    const sym = PART_SYMBOLS[part.kind];
    const card = sym ? sym.spiceCard : null;

    if (!card || card === 'X' || card === 'S') {
      skipped.push(`${part.refdes} (${part.kind}): no SPICE model`);
      lines.push(`* ${part.refdes} ${part.kind} — skipped (no simple SPICE card)`);
      continue;
    }

    // Determine terminal order for this part kind
    const pins = getSpicePins(part.kind);
    const nodes = pins.map(p => nodeOf(part.refdes, p));

    if (TWO_TERMINAL.has(card)) {
      const value = part.value || '1';
      lines.push(`${part.refdes} ${nodes.join(' ')} ${value}`);
    } else if (card === 'D') {
      const model = (sym && sym.spiceModel) || 'D_DEFAULT';
      lines.push(`${part.refdes} ${nodes.join(' ')} ${model}`);
    } else if (card === 'Q') {
      const model = (sym && sym.spiceModel) || 'Q_DEFAULT';
      lines.push(`${part.refdes} ${nodes.join(' ')} ${model}`);
    } else if (card === 'M') {
      lines.push(`${part.refdes} ${nodes.join(' ')} MOSFET`);
    } else {
      skipped.push(`${part.refdes} (${part.kind}): unsupported card '${card}'`);
      lines.push(`* ${part.refdes} ${part.kind} — unsupported`);
    }
  }

  // Add default .model statements
  lines.push('');
  lines.push('* Default models');
  lines.push('.model D_DEFAULT D (Is=1e-14 N=1.0)');
  lines.push('.model LED D (Is=1e-20 N=1.8 Rs=5)');
  lines.push('.model 1N4148 D (Is=2.52n Rs=0.568 N=1.752)');
  lines.push('.model 1N4733A D (Is=1e-12 BV=5.1)');
  lines.push('.model 2N2222 NPN (Bf=200 Is=1e-14)');
  lines.push('.model 2N2907 PNP (Bf=200 Is=1e-14)');
  lines.push('.model TIP120 NPN (Bf=1000 Is=1e-12)');
  lines.push('.model Q_DEFAULT NPN (Bf=100 Is=1e-14)');
  lines.push('');
  lines.push('.end');

  return { text: lines.join('\n'), skipped };
}

/**
 * Get ordered terminal names for SPICE output.
 * For two-terminal parts: [positive, negative].
 * For transistors: [collector, base, emitter] (BJT) or [drain, gate, source] (MOS).
 * For diodes: [anode, cathode].
 */
function getSpicePins(kind) {
  switch (kind) {
    case 'resistor': case 'ldr': case 'ntc': case 'fuse':
      return ['a', 'b'];
    case 'capacitor': case 'polarized_cap':
      return ['a', 'b'];
    case 'inductor':
      return ['a', 'b'];
    case 'diode': case 'zener':
      return ['anode', 'cathode'];
    case 'led':
      return ['anode', 'cathode'];
    case 'npn': case 'pnp': case 'tip120':
      return ['collector', 'base', 'emitter'];
    case 'nmos': case 'pmos':
      return ['drain', 'gate', 'source'];
    case 'vsource': case 'battery_9v': case 'battery_aa':
      return ['pos', 'neg'];
    case 'isource':
      return ['pos', 'neg'];
    case 'potentiometer':
      return ['a', 'wiper'];
    case 'buzzer': case 'dc_motor':
      return ['a', 'b'];
    default:
      return ['a', 'b'];
  }
}
