/**
 * EAGLE 6+ schematic serializer (.sch).
 *
 * The inverse of src/importers/eagle.js, and deliberately scoped: it writes
 * the CONNECTIVITY — parts, their devicesets and values, and the nets joining
 * their pins — in EAGLE's XML shape.
 *
 * WHAT IT IS NOT: a drawable schematic. A file EAGLE itself will open and
 * render needs <symbol> geometry, gates, package variants and sheet placement
 * for every device — a symbol library, not a netlist. This writes none of
 * that, so treat the output as interchange, not as a document to open in
 * EAGLE. Claiming otherwise would cost somebody an afternoon.
 *
 * What it IS for: round-tripping through our own importer, which is a
 * property test that the model preserves what it read, and handing
 * connectivity to tools that read EAGLE XML at the netlist level.
 *
 * Values are written as plain numbers ("4700"), which the importer's
 * parseEagleValue reads back exactly. EAGLE's own "4k7" spelling is prettier
 * and lossier, so it is not used.
 *
 * @module
 */

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// kind -> how EAGLE names it, and terminal -> EAGLE pin. The inverse of the
// importer's RULES; the round-trip test is what keeps the two in step.
const KIND_TO_EAGLE = {
  resistor:     { deviceset: 'R-EU_', pins: { a: '1', b: '2' }, value: (p) => p.ohms },
  capacitor:    { deviceset: 'C-EU',  pins: { a: '1', b: '2' }, value: (p) => p.farads },
  inductor:     { deviceset: 'L-EU',  pins: { a: '1', b: '2' }, value: (p) => p.henries },
  led:          { deviceset: 'LED',   pins: { anode: 'A', cathode: 'C' } },
  diode:        { deviceset: 'DIODE_', pins: { anode: 'A', cathode: 'C' } },
  zener:        { deviceset: 'ZENER', pins: { anode: 'A', cathode: 'C' } },
  gnd:          { deviceset: 'GND',   pins: { gnd: 'GND' } },
  vcc:          { deviceset: 'VCC',   pins: { vcc: 'VCC' } },
  battery:      { deviceset: 'BATTERY', pins: { pos: '+', neg: '-' } },
  battery_coin: { deviceset: '2032',  pins: { pos: '+', neg: '-' } },
  at24c02:      { deviceset: 'EEPROM-I2C', byName: true },
  attiny88:     { deviceset: 'TINY48/88',  byName: true },
  // Added when the importer gained rules for these; without an inverse entry
  // the exporter SKIPS the part silently, and a skipped part takes its nets
  // with it -- 84 of 287 corpus files stopped round-tripping and the only
  // symptom was a net count that had quietly shrunk. importer-exporter
  // symmetry is now a test, not a hope.
  polarized_cap: { deviceset: 'CPOL-EU', pins: { a: '1', b: '2' }, value: (p) => p.farads },
  nmos:         { deviceset: 'MOSFET-N', pins: { gate: 'G', drain: 'D', source: 'S' } },
  pmos:         { deviceset: 'MOSFET-P', pins: { gate: 'G', drain: 'D', source: 'S' } },
  npn:          { deviceset: 'NPN', pins: { base: 'B', collector: 'C', emitter: 'E' } },
  pnp:          { deviceset: 'PNP', pins: { base: 'B', collector: 'C', emitter: 'E' } },
  button:       { deviceset: 'SWITCH_TACT', pins: { a: '1', b: '2' } },
  // The changeover's common pin sits BETWEEN the throws, matching the SPDT
  // symbol; getting this order wrong swaps which throw is normally closed.
  slide_switch: { deviceset: 'SWITCH_DPDT', pins: { a: '1', com: '2', b: '3' } },
  crystal:      { deviceset: 'XTAL', pins: { a: '1', b: '2' } },
  vreg:         { deviceset: 'VREG', byName: true },
  lm7805:       { deviceset: 'LM7805', byName: true },
  ld1117v33:    { deviceset: 'LD1117', byName: true },
  neopixel:     { deviceset: 'WS2812B', byName: true },
  usb_a:        { deviceset: 'USB', byName: true },
  matrix8x8:    { deviceset: 'SEGMENT_8X8_ROWCATHODE',
    pins: Object.fromEntries([
      ...Array.from({ length: 8 }, (_, i) => ['col' + i, 'A' + (i + 1)]),
      ...Array.from({ length: 8 }, (_, i) => ['row' + i, 'K' + (i + 1)]),
    ]) },
};

export const eagleFor = (kind) => {
  if (KIND_TO_EAGLE[kind]) return KIND_TO_EAGLE[kind];
  const m = /^74hc(\d{2,3})$/i.exec(kind);
  if (m) return { deviceset: '74HC' + m[1], byName: true };
  return null;
};

// A header's terminals are p1..pN and its EAGLE pins are the bare numbers, so
// byName (which would emit "P1") loses every connection on re-import. The pin
// count comes from the part, not a fixed guess.
const headerFor = (part) => {
  const n = Number((part.params && part.params.pins) || 8) || 8;
  return {
    deviceset: 'PINHD-1X' + String(n).padStart(2, '0'),
    pins: Object.fromEntries(Array.from({ length: n }, (_, i) => ['p' + (i + 1), String(i + 1)])),
  };
};

/** Union-find over wires, so one <net> is emitted per electrical node. */
function netsFromWires(parts, wires) {
  const key = (p, t) => p + ' ' + t;
  const parent = new Map();
  const find = (x) => {
    if (!parent.has(x)) parent.set(x, x);
    while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); }
    return x;
  };
  const union = (a, b) => { const ra = find(a); const rb = find(b); if (ra !== rb) parent.set(ra, rb); };
  for (const w of wires || []) union(key(w.from, w.fromTerminal), key(w.to, w.toTerminal));
  const groups = new Map();
  for (const k of parent.keys()) {
    const r = find(k);
    if (!groups.has(r)) groups.set(r, []);
    const sp = k.indexOf(' ');
    groups.get(r).push({ part: k.slice(0, sp), terminal: k.slice(sp + 1) });
  }
  return [...groups.values()].map((terminals, i) => ({ id: 'N$' + (i + 1), terminals }));
}

/**
 * Serialize a circuit to EAGLE 6 .sch XML.
 *
 * @param {{parts: Array, wires?: Array, nets?: Array}} circuit
 * @returns {{xml: string, warnings: string[], skipped: Array}}
 */
export function toEagleSch({ parts = [], wires = [], nets = null }) {
  const warnings = [];
  const skipped = [];
  const emitted = new Map();

  const partLines = [];
  for (const p of parts) {
    const e = p.kind === 'header' ? headerFor(p) : eagleFor(p.kind);
    if (!e) {
      skipped.push({ id: p.id, kind: p.kind });
      warnings.push('No EAGLE deviceset for kind "' + p.kind + '" (' + p.id + ') — part and its nets omitted');
      continue;
    }
    emitted.set(p.id, e);
    const v = e.value ? e.value(p.params || {}) : (p.params && p.params._value);
    const valAttr = (v !== undefined && v !== null) ? ' value="' + esc(v) + '"' : '';
    partLines.push('   <part name="' + esc(p.id) + '" library="bw" deviceset="'
      + esc(e.deviceset) + '" device=""' + valAttr + '/>');
  }

  const netList = (nets && nets.length) ? nets : netsFromWires(parts, wires);
  const netLines = [];
  for (const n of netList) {
    const refs = [];
    for (const t of n.terminals) {
      const e = emitted.get(t.part);
      if (!e) continue;
      const pin = e.byName ? String(t.terminal).toUpperCase() : (e.pins || {})[t.terminal];
      if (!pin) { warnings.push('No EAGLE pin for ' + t.part + '.' + t.terminal + ' — connection omitted'); continue; }
      refs.push('      <pinref part="' + esc(t.part) + '" gate="G$1" pin="' + esc(pin) + '"/>');
    }
    if (refs.length < 2) continue;
    netLines.push('    <net name="' + esc(n.id) + '" class="0">\n     <segment>\n'
      + refs.join('\n') + '\n     </segment>\n    </net>');
  }

  const xml = '<?xml version="1.0" encoding="utf-8"?>\n'
    + '<!DOCTYPE eagle SYSTEM "eagle.dtd">\n'
    + '<eagle version="6.4">\n <drawing>\n  <schematic>\n'
    + '   <libraries>\n    <library name="bw">\n'
    + '     <description>Generated by bw-circuit-ui — connectivity only, no symbol geometry</description>\n'
    + '    </library>\n   </libraries>\n'
    + '   <parts>\n' + partLines.join('\n') + '\n   </parts>\n'
    + '   <sheets>\n    <sheet>\n     <nets>\n' + netLines.join('\n')
    + '\n     </nets>\n    </sheet>\n   </sheets>\n'
    + '  </schematic>\n </drawing>\n</eagle>\n';

  return { xml, warnings, skipped };
}
