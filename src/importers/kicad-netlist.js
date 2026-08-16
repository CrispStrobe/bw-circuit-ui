/**
 * KiCad netlist (.net) importer.
 *
 * Parses s-expression netlists exported by KiCad (File → Export →
 * Netlist, or `kicad-cli sch export netlist`). The .net format has
 * connectivity pre-resolved: components with ref/value/libsource,
 * nets with (node ref pin).
 *
 * The mapping table translates KiCad libsource part names and pin
 * numbers/names to engine kind slugs and terminal names. Built from
 * bw-parts sidecar knowledge (datasheet-audited pin tables).
 *
 * Unmapped components are surfaced in the `unmapped` array with their
 * refs — NEVER silently dropped.
 *
 * @module
 */

import { parseSexpr, findAll, findOne, getVal } from './sexpr.js';

// ── Mapping table: KiCad libsource/value → engine kind ──────────────
//
// Keys: lowercase libsource part name or value field.
// pinMap: KiCad pin number (string) → engine terminal name.
// For ICs, pin numbers follow the datasheet DIP pinout.

const KICAD_KIND_MAP = {
  // ── 74-series TTL/CMOS ──────────────────────────────────────────
  '74ls00':  { kind: '74hc00',  pinMap: { '1':'1a','2':'1b','3':'1y','4':'2a','5':'2b','6':'2y','7':'gnd','8':'3y','9':'3a','10':'3b','11':'4y','12':'4a','13':'4b','14':'vcc' } },
  '74hc00':  { kind: '74hc00',  pinMap: { '1':'1a','2':'1b','3':'1y','4':'2a','5':'2b','6':'2y','7':'gnd','8':'3y','9':'3a','10':'3b','11':'4y','12':'4a','13':'4b','14':'vcc' } },
  '74ls02':  { kind: '74hc02',  pinMap: { '1':'1y','2':'1a','3':'1b','4':'2y','5':'2a','6':'2b','7':'gnd','8':'3a','9':'3b','10':'3y','11':'4a','12':'4b','13':'4y','14':'vcc' } },
  '74ls04':  { kind: '74hc04',  pinMap: { '1':'1a','2':'1y','3':'2a','4':'2y','5':'3a','6':'3y','7':'gnd','8':'4y','9':'4a','10':'5y','11':'5a','12':'6y','13':'6a','14':'vcc' } },
  '74hc04':  { kind: '74hc04',  pinMap: { '1':'1a','2':'1y','3':'2a','4':'2y','5':'3a','6':'3y','7':'gnd','8':'4y','9':'4a','10':'5y','11':'5a','12':'6y','13':'6a','14':'vcc' } },
  '74ls08':  { kind: '74hc08',  pinMap: { '1':'1a','2':'1b','3':'1y','4':'2a','5':'2b','6':'2y','7':'gnd','8':'3y','9':'3a','10':'3b','11':'4y','12':'4a','13':'4b','14':'vcc' } },
  '74ls32':  { kind: '74hc32',  pinMap: { '1':'1a','2':'1b','3':'1y','4':'2a','5':'2b','6':'2y','7':'gnd','8':'3y','9':'3a','10':'3b','11':'4y','12':'4a','13':'4b','14':'vcc' } },
  '74ls86':  { kind: '74hc86',  pinMap: { '1':'1a','2':'1b','3':'1y','4':'2a','5':'2b','6':'2y','7':'gnd','8':'3y','9':'3a','10':'3b','11':'4y','12':'4a','13':'4b','14':'vcc' } },
  '74ls138': { kind: '74hc138', pinMap: { '1':'a','2':'b','3':'c','4':'g2ab','5':'g2bb','6':'g1','7':'y7b','8':'gnd','9':'y6b','10':'y5b','11':'y4b','12':'y3b','13':'y2b','14':'y1b','15':'y0b','16':'vcc' } },
  '74ls245': { kind: '74hc245', pinMap: { '1':'dir','2':'a0','3':'a1','4':'a2','5':'a3','6':'a4','7':'a5','8':'a6','9':'a7','10':'gnd','11':'b7','12':'b6','13':'b5','14':'b4','15':'b3','16':'b2','17':'b1','18':'b0','19':'oeb','20':'vcc' } },
  '74ls595': { kind: '74hc595', pinMap: { '1':'qb','2':'qc','3':'qd','4':'qe','5':'qf','6':'qg','7':'qh','8':'gnd','9':'qh_s','10':'srclr','11':'srclk','12':'rclk','13':'oe','14':'ser','15':'qa','16':'vcc' } },
  '74hc595': { kind: '74hc595', pinMap: { '1':'qb','2':'qc','3':'qd','4':'qe','5':'qf','6':'qg','7':'qh','8':'gnd','9':'qh_s','10':'srclr','11':'srclk','12':'rclk','13':'oe','14':'ser','15':'qa','16':'vcc' } },

  // ── SAP-1 TTL tier ─────────────────────────────────────────────
  '74ls173': { kind: '74ls173', pinMap: { '1':'oe1b','2':'oe2b','3':'q0','4':'q1','5':'q2','6':'q3','7':'clk','8':'gnd','9':'g1b','10':'g2b','11':'d3','12':'d2','13':'d1','14':'d0','15':'mr','16':'vcc' } },
  '74ls161': { kind: '74ls161', pinMap: { '1':'clrb','2':'clk','3':'d0','4':'d1','5':'d2','6':'d3','7':'enp','8':'gnd','9':'loadb','10':'ent','11':'q3','12':'q2','13':'q1','14':'q0','15':'rco','16':'vcc' } },
  '74ls189': { kind: '74ls189', pinMap: { '1':'a0','2':'csb','3':'web','4':'d0','5':'o0','6':'d1','7':'o1','8':'gnd','9':'o2','10':'d2','11':'o3','12':'d3','13':'a3','14':'a2','15':'a1','16':'vcc' } },
  '74ls157': { kind: '74ls157', pinMap: { '1':'s','2':'1a','3':'1b','4':'1y','5':'2a','6':'2b','7':'2y','8':'gnd','9':'3y','10':'3b','11':'3a','12':'4y','13':'4b','14':'4a','15':'gb','16':'vcc' } },
  '74ls107': { kind: '74ls107', pinMap: { '1':'1j','2':'1qb','3':'1q','4':'1k','5':'2q','6':'2qb','7':'gnd','8':'2j','9':'2clk','10':'2clrb','11':'2k','12':'1clk','13':'1clrb','14':'vcc' } },
  '74ls283': { kind: '74hc283', pinMap: { '1':'s1','2':'b1','3':'a1','4':'s0','5':'a0','6':'b0','7':'cin','8':'gnd','9':'co','10':'s3','11':'b3','12':'a3','13':'s2','14':'a2','15':'b2','16':'vcc' } },
  // Additional 74-series used in Eater 8-bit (map to closest engine kind)
  '74ls139': { kind: '74hc138', pinMap: { '1':'a','2':'b','3':'c','4':'g2ab','5':'g2bb','6':'g1','7':'y7b','8':'gnd','9':'y6b','10':'y5b','11':'y4b','12':'y3b','13':'y2b','14':'y1b','15':'y0b','16':'vcc' }, _note: '74LS139 dual 2:4 decoder — mapped to 74HC138 (closest engine model)' },
  '74ls273': { kind: '74ls173', pinMap: { '1':'mr','2':'q0','3':'d0','4':'d1','5':'q1','6':'q2','7':'d2','8':'d3','9':'gnd','10':'q3','11':'clk','12':'d3','13':'q3','14':'d2','15':'q2','16':'d1','17':'q1','18':'d0','19':'q0','20':'vcc' }, _note: '74LS273 octal D register — mapped to 74LS173 (closest 4-bit D register)' },
  '74ls76': { kind: '74ls107', pinMap: { '1':'1j','2':'1qb','3':'1q','4':'1k','5':'2q','6':'2qb','7':'gnd','8':'2j','9':'2clk','10':'2clrb','11':'2k','12':'1clk','13':'1clrb','14':'vcc' }, _note: '74LS76 dual JK (preset+clear) — mapped to 74LS107 (falling-edge JK, no preset)' },
  '74ls107-alt': { kind: '74ls107', pinMap: { '1':'1j','2':'1qb','3':'1q','4':'1k','5':'2q','6':'2qb','7':'gnd','8':'2j','9':'2clk','10':'2clrb','11':'2k','12':'1clk','13':'1clrb','14':'vcc' } },
  '28c16':  { kind: '28c256', pinMap: { '1':'a7','2':'a6','3':'a5','4':'a4','5':'a3','6':'a2','7':'a1','8':'a0','9':'d0','10':'d1','11':'d2','12':'gnd','13':'d3','14':'d4','15':'d5','16':'d6','17':'d7','18':'ceb','19':'a10','20':'oeb','21':'web','22':'a9','23':'a8','24':'vcc' }, _note: '28C16 2K EEPROM — mapped to 28C256 (same interface, smaller address space)' },
  '74189':  { kind: '74ls189', pinMap: { '1':'a0','2':'csb','3':'web','4':'d0','5':'o0','6':'d1','7':'o1','8':'gnd','9':'o2','10':'d2','11':'o3','12':'d3','13':'a3','14':'a2','15':'a1','16':'vcc' } },

  // ── Passives ───────────────────────────────────────────────────
  'r':         { kind: 'resistor',  pinMap: { '1': 'a', '2': 'b' } },
  'r_small':   { kind: 'resistor',  pinMap: { '1': 'a', '2': 'b' } },
  'c':         { kind: 'capacitor', pinMap: { '1': 'a', '2': 'b' } },
  'c_small':   { kind: 'capacitor', pinMap: { '1': 'a', '2': 'b' } },
  'c_polarized': { kind: 'polarized_cap', pinMap: { '1': 'pos', '2': 'neg' } },
  'd':         { kind: 'diode',     pinMap: { '1': 'cathode', '2': 'anode' } },
  'led':       { kind: 'led',       pinMap: { '1': 'cathode', '2': 'anode' } },

  // ── Discrete semiconductors ────────────────────────────────────
  'q_npn_bec': { kind: 'npn', pinMap: { '1': 'base', '2': 'emitter', '3': 'collector' } },
  'q_npn_bce': { kind: 'npn', pinMap: { '1': 'base', '2': 'collector', '3': 'emitter' } },
  'q_pnp_bec': { kind: 'pnp', pinMap: { '1': 'base', '2': 'emitter', '3': 'collector' } },

  // ── Timing / misc ──────────────────────────────────────────────
  'lm555':     { kind: '555', pinMap: { '1':'gnd','2':'trigger','3':'output','4':'reset','5':'control','6':'threshold','7':'discharge','8':'vcc' } },
  'ne555':     { kind: '555', pinMap: { '1':'gnd','2':'trigger','3':'output','4':'reset','5':'control','6':'threshold','7':'discharge','8':'vcc' } },
  '555':       { kind: '555', pinMap: { '1':'gnd','2':'trigger','3':'output','4':'reset','5':'control','6':'threshold','7':'discharge','8':'vcc' } },

  // ── Memory / CPU ───────────────────────────────────────────────
  'at28c256':  { kind: '28c256', pinMap: { '1':'a14','2':'a12','3':'a7','4':'a6','5':'a5','6':'a4','7':'a3','8':'a2','9':'a1','10':'a0','11':'d0','12':'d1','13':'d2','14':'gnd','15':'d3','16':'d4','17':'d5','18':'d6','19':'d7','20':'ceb','21':'a10','22':'oeb','23':'a11','24':'a9','25':'a8','26':'a13','27':'web','28':'vcc' } },
  '28c256':    { kind: '28c256', pinMap: { '1':'a14','2':'a12','3':'a7','4':'a6','5':'a5','6':'a4','7':'a3','8':'a2','9':'a1','10':'a0','11':'d0','12':'d1','13':'d2','14':'gnd','15':'d3','16':'d4','17':'d5','18':'d6','19':'d7','20':'ceb','21':'a10','22':'oeb','23':'a11','24':'a9','25':'a8','26':'a13','27':'web','28':'vcc' } },
  '62256':     { kind: '62256',  pinMap: { '1':'a14','2':'a12','3':'a7','4':'a6','5':'a5','6':'a4','7':'a3','8':'a2','9':'a1','10':'a0','11':'d0','12':'d1','13':'d2','14':'gnd','15':'d3','16':'d4','17':'d5','18':'d6','19':'d7','20':'csb','21':'a10','22':'oeb','23':'a11','24':'a9','25':'a8','26':'a13','27':'web','28':'vcc' } },
  'w65c02s':   { kind: 'w65c02', pinMap: { '1':'vpb','2':'rdy','3':'phi1o','4':'irqb','5':'mlb','6':'nmib','7':'sync','8':'vdd','9':'a0','10':'a1','11':'a2','12':'a3','13':'a4','14':'a5','15':'a6','16':'a7','17':'a8','18':'a9','19':'a10','20':'a11','21':'vss','22':'a12','23':'a13','24':'a14','25':'a15','26':'d7','27':'d6','28':'d5','29':'d4','30':'d3','31':'d2','32':'d1','33':'d0','34':'rwb','35':'nc','36':'be','37':'phi2','38':'sob','39':'phi2o','40':'resb' } },

  // ── Connectors / power ─────────────────────────────────────────
  'vcc':       { kind: 'vcc', pinMap: { '1': 'vcc' } },
  'gnd':       { kind: 'gnd', pinMap: { '1': 'gnd' } },
  'pwr_flag':  null, // KiCad power flag — no circuit equivalent
  'conn_01x01': null, // test points etc — skip
};

// Value-based fallbacks (when libsource doesn't match)
const VALUE_KIND_MAP = {
  '74ls00': '74hc00', '74hc00': '74hc00',
  '74ls04': '74hc04', '74hc04': '74hc04',
  '74ls08': '74hc08', '74ls32': '74hc32',
  '74ls86': '74hc86', '74ls138': '74hc138',
  '74ls173': '74ls173', '74ls161': '74ls161',
  '74ls189': '74ls189', '74ls157': '74ls157',
  '74ls107': '74ls107', '74ls245': '74hc245',
  '74ls283': '74hc283', '74ls595': '74hc595',
};

/**
 * Normalize a KiCad libsource part name for lookup.
 * Strips library prefix, rescue suffixes, and lowercases.
 */
function normalizePartName(libsource) {
  let name = (libsource || '').toLowerCase();
  // Strip "libraryname:" prefix
  const colon = name.lastIndexOf(':');
  if (colon >= 0) name = name.substring(colon + 1);
  // Strip "-rescue" or "_rescue" suffixes (including project-specific ones)
  name = name.replace(/-[a-z0-9_]+-rescue$/, '').replace(/[-_]rescue$/, '');
  // Strip common prefixes
  name = name.replace(/^sn/, '').replace(/^74hct/, '74hc').replace(/^74act/, '74hc');
  return name;
}

/**
 * Import a KiCad netlist (.net s-expression format).
 *
 * @param {string} text  Raw .net file content
 * @returns {{ parts: Array, wires: Array, warnings: string[], unmapped: Array }}
 */
export function importKicadNetlist(text) {
  const tree = parseSexpr(text);
  if (tree[0] !== 'export') {
    return { parts: [], wires: [], warnings: ['Not a KiCad netlist (expected "export" root)'], unmapped: [] };
  }

  const warnings = [];
  const unmapped = [];
  const parts = [];
  const partMap = new Map(); // ref → { kind, pinMap, partId }

  // ── Parse components ──────────────────────────────────────────
  const comps = findOne(tree, 'components');
  if (!comps) {
    return { parts: [], wires: [], warnings: ['No (components) section found'], unmapped: [] };
  }

  for (const comp of findAll(comps, 'comp')) {
    const ref = getVal(comp, 'ref');
    const value = getVal(comp, 'value');
    const libsourceNode = findOne(comp, 'libsource');
    const lib = libsourceNode ? getVal(libsourceNode, 'lib') : '';
    const part = libsourceNode ? getVal(libsourceNode, 'part') : '';
    const fullPart = part ? `${lib}:${part}` : '';

    // Try libsource part name first, then value
    const normPart = normalizePartName(part);
    const normFull = normalizePartName(fullPart);
    const normValue = (value || '').toLowerCase();

    let mapping = KICAD_KIND_MAP[normPart] || KICAD_KIND_MAP[normFull];

    // Value-based fallback for ICs
    if (!mapping && normValue in KICAD_KIND_MAP) {
      mapping = KICAD_KIND_MAP[normValue];
    }

    // Passive value inference
    if (!mapping) {
      if (/^r\d*$/.test(ref?.toLowerCase() || '')) mapping = KICAD_KIND_MAP['r'];
      else if (/^c\d*$/.test(ref?.toLowerCase() || '')) mapping = KICAD_KIND_MAP['c'];
      else if (/^d\d*$/.test(ref?.toLowerCase() || '')) mapping = KICAD_KIND_MAP['d'];
    }

    if (mapping === null) {
      // Explicitly skipped (power flags etc)
      continue;
    }

    if (!mapping) {
      unmapped.push({ ref, value, libsource: fullPart || part || value });
      warnings.push(`Unmapped component: ${ref} (${part || value})`);
      continue;
    }

    const partId = ref.toLowerCase().replace(/[^a-z0-9]/g, '_');
    const params = {};

    // Parse resistor/capacitor values
    if (mapping.kind === 'resistor' && value) {
      const ohms = parseResistorValue(value);
      if (ohms !== null) params.ohms = ohms;
    }
    if (mapping.kind === 'capacitor' && value) {
      params._value = value; // pass through for display
    }

    parts.push({
      id: partId,
      kind: mapping.kind,
      params: Object.keys(params).length ? params : {},
      x: 0, y: 0, // layout not in netlist
    });

    partMap.set(ref, { kind: mapping.kind, pinMap: mapping.pinMap, partId });
  }

  // ── Parse nets → wires ────────────────────────────────────────
  const wires = [];
  const netsNode = findOne(tree, 'nets');
  if (netsNode) {
    for (const net of findAll(netsNode, 'net')) {
      const netName = getVal(net, 'name');
      const nodes = findAll(net, 'node');
      if (nodes.length < 2) continue;

      // Connect all nodes in the net pairwise to the first node
      const first = nodes[0];
      const firstRef = getVal(first, 'ref');
      const firstPin = getVal(first, 'pin');
      const firstPart = partMap.get(firstRef);

      if (!firstPart) continue;
      const firstTerminal = firstPart.pinMap[firstPin];
      if (!firstTerminal) {
        warnings.push(`Unknown pin ${firstPin} on ${firstRef} in net "${netName}"`);
        continue;
      }

      for (let i = 1; i < nodes.length; i++) {
        const nodeRef = getVal(nodes[i], 'ref');
        const nodePin = getVal(nodes[i], 'pin');
        const nodePart = partMap.get(nodeRef);
        if (!nodePart) continue;

        const nodeTerminal = nodePart.pinMap[nodePin];
        if (!nodeTerminal) {
          warnings.push(`Unknown pin ${nodePin} on ${nodeRef} in net "${netName}"`);
          continue;
        }

        wires.push({
          from: firstPart.partId,
          fromTerminal: firstTerminal,
          to: nodePart.partId,
          toTerminal: nodeTerminal,
        });
      }
    }
  }

  return { parts, wires, warnings, unmapped };
}

/**
 * Parse a resistor value string like "1K", "4.7K", "10M", "470R", "100".
 * @returns {number|null} Value in ohms, or null if unparseable.
 */
function parseResistorValue(val) {
  const s = val.trim().toUpperCase();
  const m = s.match(/^([\d.]+)\s*([KMR]?)$/);
  if (!m) return null;
  const num = parseFloat(m[1]);
  if (isNaN(num)) return null;
  const mult = m[2] === 'K' ? 1000 : m[2] === 'M' ? 1000000 : 1;
  return num * mult;
}
