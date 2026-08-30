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
  // `volts` is what the ENGINE reads (mna.js sourceVoltage); `v` was the only
  // spelling checked here, so a source authored the way bw-board expects
  // exported with an empty value and the deck fell back to a guess.
  if (params.volts != null) return formatSi(params.volts);
  if (params.amps != null) return formatSi(params.amps);
  if (kind === 'vsource' && params.v != null) return formatSi(params.v);
  return '';
}

/**
 * The same quantity as deriveValue, still a NUMBER.
 *
 * deriveValue formats for humans, and `formatSi` writes megohms as `M` —
 * which a SPICE deck reads as milli. A serializer that needs a value in a
 * machine-read file must format it itself (`formatSpiceValue`) from this
 * number rather than re-parsing the display string.
 *
 * @param {string} kind
 * @param {Record<string,*>} params
 * @returns {number|null}
 */
function deriveValueNumber(kind, params) {
  if (!params) return null;
  for (const k of ['ohms', 'farads', 'henrys', 'voltage', 'vz', 'volts', 'amps']) {
    if (typeof params[k] === 'number' && isFinite(params[k])) return params[k];
  }
  if (kind === 'vsource' && typeof params.v === 'number') return params.v;
  return null;
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
      valueNumber: deriveValueNumber(p.kind, p.params),
      footprint: (sym && sym.kicadFootprint) || '',
      symbol: (sym && sym.kicadSymbol) || '',
      params: p.params || {},
    });
  }

  // ── 2. Build nets from resolvedNets ────────────────────────────
  //
  // A net is a RAIL because a rail part sits on it, not because its id
  // spells one. The engine names nets `net-lgc-3`, `n-bb1-row-12`,
  // `net-7` — ids that can never contain the substrings "vcc" or "gnd",
  // so the old substring rename fired on exactly zero real circuits and
  // every deck we shipped named its ground `net-lgc-3`.
  const kindById = new Map();
  for (const p of rawParts) kindById.set(p.id, p.kind);

  const rawNets = circuit.resolvedNets || [];
  const nets = [];
  let netCode = 0;
  let vccSeq = 0;

  for (const net of rawNets) {
    const nodes = [];
    let rail = null;
    let railPartId = null;
    for (const t of (net.terminals || [])) {
      const railKind = kindById.get(t.part);
      if (railKind === 'gnd') { rail = 'gnd'; railPartId = t.part; }
      else if (railKind === 'vcc' && rail !== 'gnd') { rail = 'vcc'; railPartId = t.part; }
      const entry = partMap.get(t.part);
      if (!entry) continue; // skip infrastructure/power terminals
      nodes.push({
        partId: t.part,
        refdes: entry.refdes,
        pin: t.terminal,
      });
    }
    if (nodes.length === 0) continue;

    let name = net.id || '';
    if (rail === 'gnd') {
      name = 'GND';
    } else if (rail === 'vcc') {
      vccSeq++;
      name = vccSeq === 1 ? 'VCC' : `VCC${vccSeq}`;
    } else {
      netCode++;
      name = name || `Net${netCode}`;
    }

    // `id` is the ENGINE's net id, kept so a consumer can ask the board what
    // this net solved to (`circuit.nodeVoltage(id)`) after the name has been
    // canonicalised to VCC/GND. Without it the rename is one-way and the
    // SPICE oracle cannot line its nodes up with the engine's.
    nets.push({ id: net.id || null, name, nodes, rail, railPartId });
  }

  return {
    parts: [...partMap.values()],
    nets,
    // The rail voltage the designer's bench is running at. A serializer
    // that has to SYNTHESIZE the supply (SPICE has no implicit rails) can
    // only do so honestly if it is told the number rather than assuming 5.
    vcc: typeof circuit.vcc === 'number' ? circuit.vcc : null,
    warnings,
  };
}
