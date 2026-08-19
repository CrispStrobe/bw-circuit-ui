/**
 * Neutral netlist extractor.
 *
 * Takes a Circuit instance and produces a format-agnostic netlist
 * data structure that any serializer (SPICE, KiCad, EasyEDA) can
 * consume. Breadboards and jumpers are dissolved — only electrical
 * nets and placed components appear in the output.
 *
 * @module
 */

import { formatSi } from './si.js';
import { PART_SYMBOLS } from '../data/easyeda-symbols.js';

/** Kinds that are infrastructure, not schematic components */
const INFRASTRUCTURE = new Set([
  'breadboard', 'breadboard_full', 'breadboard_half', 'breadboard_mini',
  'header', 'jumper',
]);

/** Kinds that are power rails (represented as net names, not components) */
const POWER_RAILS = new Set(['vcc', 'gnd']);

/** Refdes prefix by kind (falls back to symbol map, then 'U') */
const PREFIX_MAP = {
  resistor: 'R', capacitor: 'C', inductor: 'L',
  diode: 'D', zener: 'D', led: 'D', rgb_led: 'D',
  npn: 'Q', pnp: 'Q', nmos: 'Q', pmos: 'Q', tip120: 'Q',
  opamp: 'U', '555': 'U', relay: 'K', relay_dpdt: 'K',
  button: 'SW', switch: 'SW', slide_switch: 'SW',
  potentiometer: 'RV', ldr: 'R', ntc: 'R',
  buzzer: 'LS', dc_motor: 'M', servo: 'M', gearmotor: 'M',
  fuse: 'F', solar_cell: 'BT', battery_9v: 'BT', battery_aa: 'BT',
  battery_coin: 'BT', vsource: 'V', isource: 'I',
};

/**
 * Derive a SPICE-friendly value string from part params.
 * @param {string} kind
 * @param {Record<string,*>} params
 * @returns {string}
 */
function deriveValue(kind, params) {
  if (!params) return '';
  if (params.ohms != null) return formatSi(params.ohms);
  if (params.farads != null) return formatSi(params.farads);
  if (params.henrys != null) return formatSi(params.henrys);
  if (params.voltage != null) return formatSi(params.voltage);
  if (params.vz != null) return formatSi(params.vz) + 'V';
  if (kind === 'vsource' && params.v != null) return formatSi(params.v);
  return '';
}

/**
 * @typedef {object} NetlistPart
 * @property {string} partId — original circuit part id
 * @property {string} refdes — stable reference designator (R1, C2, U3…)
 * @property {string} kind — part kind slug
 * @property {string} value — formatted value string
 * @property {string} footprint — KiCad footprint (from symbol map)
 * @property {string} symbol — KiCad symbol lib:part (from symbol map)
 * @property {Record<string,*>} params — raw params
 */

/**
 * @typedef {object} NetlistNet
 * @property {string} name — net name
 * @property {Array<{partId: string, refdes: string, pin: string}>} nodes
 */

/**
 * @typedef {object} Netlist
 * @property {NetlistPart[]} parts
 * @property {NetlistNet[]} nets
 * @property {string[]} warnings — parts skipped or with missing data
 */

/**
 * Extract a format-neutral netlist from a circuit.
 *
 * @param {object} circuit — a Circuit instance (or plain {parts, resolvedNets})
 * @returns {Netlist}
 */
export function extractNetlist(circuit) {
  const warnings = [];

  // ── 1. Assign stable refdes ────────────────────────────────────
  const counters = {};  // prefix -> next number
  const partMap = new Map(); // partId -> NetlistPart

  const rawParts = circuit.parts || [];
  // Sort by id for deterministic refdes assignment
  const sorted = [...rawParts].sort((a, b) => {
    const ka = a.kind.localeCompare(b.kind);
    return ka !== 0 ? ka : (a.id || '').localeCompare(b.id || '');
  });

  for (const p of sorted) {
    if (INFRASTRUCTURE.has(p.kind)) continue;
    if (POWER_RAILS.has(p.kind)) continue;

    const sym = PART_SYMBOLS[p.kind];
    const prefix = PREFIX_MAP[p.kind]
      || (sym && sym.refdesPrefix)
      || 'U';

    counters[prefix] = (counters[prefix] || 0) + 1;
    const refdes = `${prefix}${counters[prefix]}`;

    partMap.set(p.id, {
      partId: p.id,
      refdes,
      kind: p.kind,
      value: deriveValue(p.kind, p.params),
      footprint: (sym && sym.kicadFootprint) || '',
      symbol: (sym && sym.kicadSymbol) || '',
      params: p.params || {},
    });
  }

  // ── 2. Build nets from resolvedNets ────────────────────────────
  const rawNets = circuit.resolvedNets || [];
  const nets = [];
  let netCode = 0;

  for (const net of rawNets) {
    const nodes = [];
    for (const t of (net.terminals || [])) {
      const entry = partMap.get(t.part);
      if (!entry) continue; // skip infrastructure/power terminals
      nodes.push({
        partId: t.part,
        refdes: entry.refdes,
        pin: t.terminal,
      });
    }
    if (nodes.length === 0) continue;

    // Derive a human-friendly net name
    let name = net.id || '';
    // Power-rail nets get canonical names
    if (name.includes('vcc') || name.includes('VCC')) name = 'VCC';
    else if (name.includes('gnd') || name.includes('GND')) name = 'GND';
    else {
      netCode++;
      name = name || `Net${netCode}`;
    }

    nets.push({ name, nodes });
  }

  return {
    parts: [...partMap.values()],
    nets,
    warnings,
  };
}
