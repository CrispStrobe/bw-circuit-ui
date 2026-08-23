/**
 * KiCad 6+ schematic serializer (.kicad_sch).
 *
 * The inverse of src/importers/kicad-sch.js, and unlike the EAGLE serializer
 * beside it this one writes a file KiCad will actually OPEN: it emits its own
 * `lib_symbols` definitions, so every symbol it places has real geometry and
 * real pins, and it places them on a generated grid.
 *
 * HOW CONNECTIVITY IS WRITTEN, and why it is not wires. KiCad joins pins by
 * geometry OR by name, and only the second of those survives being generated:
 * routing wires between arbitrary grid positions means an autorouter, and a
 * wrong route is a wrong netlist. So each net gets a name and every pin on it
 * gets a LOCAL LABEL at its own connection point. That is a normal thing for a
 * schematic to do -- it is how power rails and buses are drawn by hand -- and
 * it is exact.
 *
 * What that costs: the sheet has no drawn wires, so it reads as a rats-nest of
 * labelled stubs rather than a schematic anybody would have drawn. It is
 * correct interchange, not a document. Opening it in eeschema and pressing
 * "annotate" or dragging symbols will not break the netlist, because the
 * netlist is in the names.
 *
 * Kinds map back to STOCK KiCad library names -- Device:R, power:GND,
 * Switch:SW_Push -- rather than to a private `bw:` library, so the output is
 * meaningful to a KiCad user and re-imports through our own rule table
 * unchanged. The round-trip test is what keeps the two in step.
 *
 * @module
 */

import { wireEndpoint, isBoardEndpoint } from '../wire-endpoints.js';

/** Quote a KiCad s-expression atom. */
const q = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

/**
 * kind -> the stock KiCad symbol that means it, plus terminal -> pin number
 * and the NAME each pin carries. The names matter as much as the numbers:
 * our importer resolves an opamp's inputs by name ("+", "-") and its output
 * by electrical type, and a 74-series chip entirely by name.
 *
 * `pinNames` is optional; where it is absent the pin is written unnamed ("~")
 * and the number carries the meaning, which is what a passive does.
 */
const KIND_TO_KICAD = {
  resistor:      { lib: 'Device:R', pins: { a: 1, b: 2 }, value: (p) => p.ohms },
  capacitor:     { lib: 'Device:C', pins: { a: 1, b: 2 }, value: (p) => p.farads },
  polarized_cap: { lib: 'Device:C_Polarized', pins: { pos: 1, neg: 2 }, value: (p) => p.farads },
  inductor:      { lib: 'Device:L', pins: { a: 1, b: 2 }, value: (p) => p.henries },
  fuse:          { lib: 'Device:Fuse', pins: { a: 1, b: 2 } },
  crystal:       { lib: 'Device:Crystal', pins: { a: 1, b: 2 } },
  potentiometer: { lib: 'Device:R_Potentiometer', pins: { a: 1, wiper: 2, b: 3 } },
  led:           { lib: 'Device:LED', pins: { cathode: 1, anode: 2 }, pinNames: { 1: 'K', 2: 'A' } },
  diode:         { lib: 'Device:D', pins: { cathode: 1, anode: 2 }, pinNames: { 1: 'K', 2: 'A' } },
  zener:         { lib: 'Device:D_Zener', pins: { cathode: 1, anode: 2 }, pinNames: { 1: 'K', 2: 'A' } },
  // The pin ORDER is in the symbol name, so the name has to match the map.
  npn:           { lib: 'Device:Q_NPN_BCE', pins: { base: 1, collector: 2, emitter: 3 },
    pinNames: { 1: 'B', 2: 'C', 3: 'E' } },
  pnp:           { lib: 'Device:Q_PNP_BCE', pins: { base: 1, collector: 2, emitter: 3 },
    pinNames: { 1: 'B', 2: 'C', 3: 'E' } },
  nmos:          { lib: 'Device:Q_NMOS_GSD', pins: { gate: 1, source: 2, drain: 3 },
    pinNames: { 1: 'G', 2: 'S', 3: 'D' } },
  pmos:          { lib: 'Device:Q_PMOS_GSD', pins: { gate: 1, source: 2, drain: 3 },
    pinNames: { 1: 'G', 2: 'S', 3: 'D' } },
  tip120:        { lib: 'Transistor_BJT:TIP120', pins: { base: 1, collector: 2, emitter: 3 },
    pinNames: { 1: 'B', 2: 'C', 3: 'E' } },
  button:        { lib: 'Switch:SW_Push', pins: { a: 1, b: 2 } },
  // KiCad's changeover symbols put the COMMON on pin 2, between the throws.
  slide_switch:  { lib: 'Switch:SW_SPDT', pins: { a: 1, com: 2, b: 3 },
    pinNames: { 1: 'A', 2: 'B', 3: 'C' } },
  battery:       { lib: 'Device:Battery_Cell', pins: { pos: 1, neg: 2 },
    pinNames: { 1: '+', 2: '-' }, value: (p) => p.volts },
  battery_coin:  { lib: 'Device:Battery_Cell', pins: { pos: 1, neg: 2 },
    pinNames: { 1: '+', 2: '-' } },
  vsource:       { lib: 'pspice:VSOURCE', pins: { pos: 1, neg: 2 },
    pinNames: { 1: '+', 2: '-' }, value: (p) => p.volts },
  buzzer:        { lib: 'Device:Buzzer', pins: { a: 1, b: 2 } },
  dc_motor:      { lib: 'Motor:Motor_DC', pins: { a: 1, b: 2 } },
  light_bulb:    { lib: 'Device:Lamp', pins: { a: 1, b: 2 } },
  usb_a:         { lib: 'Connector:USB_B_Micro', pins: { vbus: 1, dm: 2, dp: 3, gnd: 4 },
    pinNames: { 1: 'VBUS', 2: 'D-', 3: 'D+', 4: 'GND' } },
  dht11:         { lib: 'Sensor:DHT11', pins: { vcc: 1, data: 2, gnd: 3 },
    pinNames: { 1: 'VDD', 2: 'DATA', 3: 'GND' } },
  lm7805:        { lib: 'Regulator_Linear:LM7805_TO220', pins: { vin: 1, gnd: 2, vout: 3 },
    pinNames: { 1: 'VI', 2: 'GND', 3: 'VO' } },
  vreg:          { lib: 'Regulator_Linear:AP2112K-3.3', pins: { in: 1, gnd: 2, out: 3 },
    pinNames: { 1: 'VI', 2: 'GND', 3: 'VO' } },
  // The engine's opamp is ideal and three-terminal. Its output is written
  // with electrical type `output` and no name, exactly as the stock libraries
  // do, because that is the only mark our importer can find it by.
  opamp:         { lib: 'Amplifier_Operational:LM358', pins: { out: 1, inn: 2, inp: 3 },
    pinNames: { 2: '-', 3: '+' }, pinTypes: { 1: 'output', 2: 'input', 3: 'input' } },
  timer_555:     { lib: 'Timer:NE555', pins: { gnd: 1, trigger: 2, output: 3, reset: 4,
    control: 5, threshold: 6, discharge: 7, vcc: 8 },
  pinNames: { 1: 'GND', 2: 'TR', 3: 'Q', 4: 'R', 5: 'CV', 6: 'THR', 7: 'DIS', 8: 'VCC' } },
  optocoupler:   { lib: 'Isolator:PC817', pins: { anode: 1, cathode: 2, emitter: 3, collector: 4 },
    pinNames: { 1: 'A', 2: 'K', 3: 'E', 4: 'C' } },
  h_bridge:      { lib: 'Driver_Motor:L298N',
    pins: { vcc: 1, gnd: 2, en1: 3, in1: 4, in2: 5, out1: 6, out2: 7,
      en2: 8, in3: 9, in4: 10, out3: 11, out4: 12 },
    pinNames: { 1: 'VS', 2: 'GND', 3: 'ENA', 4: 'IN1', 5: 'IN2', 6: 'OUT1', 7: 'OUT2',
      8: 'ENB', 9: 'IN3', 10: 'IN4', 11: 'OUT3', 12: 'OUT4' } },
  // A four-position DIP switch: pins 1-4 are one side, 5-8 the other, which
  // is what the importer's SW_DIP_x rule reads back.
  dip_switch:    { lib: 'Switch:SW_DIP_x04',
    pins: { s0_a: 1, s1_a: 2, s2_a: 3, s3_a: 4, s0_b: 5, s1_b: 6, s2_b: 7, s3_b: 8 } },
  at24c02:       { lib: 'Memory_EEPROM:24LC256', pins: { vcc: 1, gnd: 2, sda: 3, scl: 4 },
    pinNames: { 1: 'VCC', 2: 'GND', 3: 'SDA', 4: 'SCL' } },
  neopixel:      { lib: 'LED:WS2812B', pins: { vcc: 1, din: 2, dout: 3, gnd: 4 },
    pinNames: { 1: 'VDD', 2: 'DIN', 3: 'DOUT', 4: 'VSS' } },
  // Power symbols: one pin, and the RAIL NAME is the pin name. Both the
  // importer and KiCad itself read the net off that.
  vcc:           { lib: 'power:VCC', power: true, pins: { vcc: 1 }, pinNames: { 1: 'VCC' } },
  gnd:           { lib: 'power:GND', power: true, pins: { gnd: 1 }, pinNames: { 1: 'GND' } },
};

/**
 * Kinds that are deliberately NOT exported, because there is nothing to
 * export: they are engine kinds with no terminal model here, so a symbol
 * would carry no connections and re-import as a different part. Writing them
 * would look like progress and lose the netlist.
 */
const NO_TERMINAL_MODEL = new Set(['ams1117_33', 'ams1117_50', 'lm7809', 'lm7812', 'ld1117v33']);

/** A 74-series chip: stock library name, pins named after our terminals. */
function logicFor(kind, terminals) {
  const m = /^74hc(\d{2,3})$/i.exec(kind);
  if (!m) return null;
  const pins = {}; const pinNames = {};
  terminals.forEach((t, i) => { pins[t] = i + 1; pinNames[i + 1] = t.toUpperCase(); });
  return { lib: `74xx:74HC${m[1]}`, pins, pinNames };
}

/** A header: Conn_01xNN, pins numbered as they are named. */
function headerFor(part, terminals) {
  const n = Number((part.params && part.params.pins) || terminals.length || 2) || 2;
  const pins = {}; const pinNames = {};
  for (let i = 0; i < n; i++) { pins[`p${i + 1}`] = i + 1; pinNames[i + 1] = `Pin_${i + 1}`; }
  return { lib: `Connector_Generic:Conn_01x${String(n).padStart(2, '0')}`, pins, pinNames };
}

/**
 * What a power symbol's rail is called. The importer keeps the original
 * spelling in params._value ("+3V3", "GNDREF"); a hand-built circuit has
 * none, and falls back to the generic rail for its kind.
 *
 * Sanitised because the string becomes a library symbol name.
 */
function railNameOf(part) {
  const raw = String((part.params || {})._value || '').trim();
  const clean = raw.replace(/[^A-Za-z0-9+._-]/g, '');
  if (clean) return clean;
  return part.kind === 'gnd' ? 'GND' : 'VCC';
}

/**
 * Union-find over wires, so one NET is emitted per electrical node.
 *
 * Reads endpoints through the canonical accessor. The hand-rolled version
 * keyed on `${w.from} ${w.fromTerminal}`, which on a NESTED wire is the
 * literal string "[object Object] undefined" — one key for every endpoint
 * of every wire, so the whole circuit union-found into a single root and
 * the emitted schematic carried NO net labels at all. That is the shape
 * the live app holds (Circuit.fromJSON normalizes to nested), so KiCad
 * export from the running app produced a schematic of floating symbols.
 *
 * Breadboard-hole endpoints are dropped: connectivity here is written as
 * NET LABELS on part pins, and a hole has no pin to label. This exporter
 * is scoped to round-tripping our own importer, which has no breadboards.
 */
function netsFromWires(wires) {
  const parent = new Map();
  const find = (x) => {
    if (!parent.has(x)) parent.set(x, x);
    while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); }
    return x;
  };
  for (const w of wires || []) {
    const f = wireEndpoint(w, 'from');
    const t = wireEndpoint(w, 'to');
    if (!f || !t || isBoardEndpoint(f) || isBoardEndpoint(t)) continue;
    const a = find(`${f.part} ${f.terminal}`); const b = find(`${t.part} ${t.terminal}`);
    if (a !== b) parent.set(a, b);
  }
  const groups = new Map();
  for (const k of parent.keys()) {
    const r = find(k);
    if (!groups.has(r)) groups.set(r, []);
    const sp = k.indexOf(' ');
    groups.get(r).push({ part: k.slice(0, sp), terminal: k.slice(sp + 1) });
  }
  return [...groups.values()];
}

/**
 * Deterministic UUIDs. A KiCad file wants one per item; a random one per
 * export makes every re-export a diff of nothing but UUIDs, which hides the
 * change that mattered. This is a hash, not entropy, and it is not claimed to
 * be a real UUID beyond the shape.
 */
function uuidFor(seed) {
  let h1 = 0x811c9dc5; let h2 = 0x01000193;
  for (let i = 0; i < seed.length; i++) {
    h1 = Math.imul(h1 ^ seed.charCodeAt(i), 16777619) >>> 0;
    h2 = Math.imul(h2 + seed.charCodeAt(i) * (i + 1), 2246822519) >>> 0;
  }
  const hex = (n) => (n >>> 0).toString(16).padStart(8, '0');
  const a = hex(h1); const b = hex(h2); const c = hex(h1 ^ h2); const d = hex(Math.imul(h1, h2));
  return `${a}-${b.slice(0, 4)}-4${b.slice(5)}-8${c.slice(1, 4)}-${c.slice(4)}${d}`;
}

const GRID_X = 40;      // mm between columns
const GRID_Y = 30;      // mm between rows
const COLS = 8;
const PIN_REACH = 5.08; // how far a pin's connection point sits from the body

/**
 * Serialize a circuit to a KiCad 6+ .kicad_sch.
 *
 * @param {{parts: Array, wires?: Array}} circuit
 * @param {{terminalsForKind?: (kind: string, params: object) => string[]}} [opts]
 *        supply the engine's terminal list so kinds with dynamic terminals
 *        (74-series, headers) can be written; without it those fall back to
 *        the terminals the WIRES mention, which is enough for round-tripping
 *        and less than the real part has.
 * @returns {{text: string, warnings: string[], skipped: Array}}
 */
export function toKicadSch({ parts = [], wires = [] }, opts = {}) {
  const warnings = [];
  const skipped = [];

  // Which terminals each part actually needs. Used only for the kinds whose
  // pin list is not fixed.
  const usedTerms = new Map();
  for (const w of wires) {
    for (const side of ['from', 'to']) {
      const e = wireEndpoint(w, side);
      if (!e || isBoardEndpoint(e)) continue;
      if (!usedTerms.has(e.part)) usedTerms.set(e.part, new Set());
      usedTerms.get(e.part).add(e.terminal);
    }
  }

  // ---- name the nets FIRST ------------------------------------------
  // A power symbol carries its rail's name twice over: in the label we write
  // at its pin, and in the symbol's own pin name, which KiCad reads as a net
  // name all by itself. So the two have to agree, and the rail name has to be
  // decided before any symbol is built.
  //
  // The name comes from the part's _value, which is where the importer parked
  // the original "+5V" or "+3V3". Writing every vcc as `power:VCC` instead
  // collapses a 5 V rail and a 3.3 V rail into ONE net -- eight corpus boards
  // round-tripped wrong that way, with the parts and the wire count intact.
  const nets = netsFromWires(wires);
  const partOf = new Map(parts.map((p) => [p.id, p]));
  const railOfPart = new Map();     // part id -> the rail name it must carry
  const netName = new Map();        // net index -> name
  const usedNames = new Set();
  nets.forEach((terminals, i) => {
    const powerPart = terminals.map((t) => partOf.get(t.part))
      .find((p) => p && (p.kind === 'vcc' || p.kind === 'gnd'));
    let base = powerPart ? railNameOf(powerPart) : `N$${i + 1}`;
    if (usedNames.has(base)) {
      // Two separate nets asking for one name is a contradiction, not a
      // merge: keeping the name would silently short them on re-import.
      let n = 2;
      while (usedNames.has(`${base}_${n}`)) n++;
      warnings.push(`Two separate nets both wanted the name "${base}"; the second is written as `
        + `"${base}_${n}" so they stay apart`);
      base = `${base}_${n}`;
    }
    usedNames.add(base);
    netName.set(i, base);
    for (const t of terminals) {
      const p = partOf.get(t.part);
      if (p && (p.kind === 'vcc' || p.kind === 'gnd')) railOfPart.set(p.id, base);
    }
  });

  const defs = new Map();          // lib id -> {pins:[{num,name,type,x,y}]}
  const placed = [];               // {part, def, at, pinAt: Map(terminal -> [x,y])}

  parts.forEach((p, idx) => {
    const terms = [...(usedTerms.get(p.id) || [])].sort();
    let spec = KIND_TO_KICAD[p.kind];
    if (spec && spec.power) {
      // One library symbol per RAIL, not per kind: `power:+3V3` and
      // `power:+5V` are different symbols with different pin names, and that
      // difference is the only thing keeping the two rails apart.
      const rail = railOfPart.get(p.id) || railNameOf(p);
      spec = { ...spec, lib: `power:${rail}`, pinNames: { 1: rail } };
    }
    if (!spec && p.kind === 'header') spec = headerFor(p, terms);
    if (!spec) spec = logicFor(p.kind, opts.terminalsForKind
      ? opts.terminalsForKind(p.kind, p.params || {}) : terms);
    if (!spec) {
      skipped.push({ id: p.id, kind: p.kind });
      warnings.push(`No KiCad symbol for kind "${p.kind}" (${p.id}) -- part and its nets omitted`
        + (NO_TERMINAL_MODEL.has(p.kind)
          ? `; ${p.kind} has no terminal geometry in this repo, so there is nothing to wire`
          : ''));
      return;
    }

    // Build (or reuse) the library definition. Pins go down the left side and
    // then the right, which is arbitrary and consistent -- the sheet is
    // generated, so legibility comes from the labels, not the layout.
    const entries = Object.entries(spec.pins);
    if (!defs.has(spec.lib)) {
      const half = Math.ceil(entries.length / 2);
      const pins = entries.map(([, num], i) => {
        const left = i < half;
        const row = left ? i : i - half;
        const span = (left ? half : entries.length - half) - 1;
        return {
          num,
          name: (spec.pinNames || {})[num] || '~',
          type: (spec.pinTypes || {})[num] || (spec.power ? 'power_in' : 'passive'),
          // Library coordinates: Y points UP here and DOWN on the sheet.
          x: left ? -PIN_REACH : PIN_REACH,
          y: (span / 2 - row) * 2.54,
          rot: left ? 0 : 180,
        };
      });
      defs.set(spec.lib, { pins, power: !!spec.power });
    }

    const at = { x: 30 + (idx % COLS) * GRID_X, y: 30 + Math.floor(idx / COLS) * GRID_Y };
    const def = defs.get(spec.lib);
    const pinAt = new Map();
    for (const [term, num] of entries) {
      const lp = def.pins.find((x) => String(x.num) === String(num));
      if (lp) pinAt.set(term, [at.x + lp.x, at.y - lp.y]);
    }
    placed.push({ part: p, spec, at, pinAt });
  });

  const known = new Map(placed.map((x) => [x.part.id, x]));

  // Nets become NAMES. A power symbol's own rail name wins, so a ground net
  // is called GND rather than N$3 -- which is what KiCad users expect and
  // what makes the file readable.
  const labels = [];
  nets.forEach((terminals, i) => {
    const live = terminals.filter((t) => known.has(t.part) && known.get(t.part).pinAt.has(t.terminal));
    for (const t of terminals) {
      if (known.has(t.part) && !known.get(t.part).pinAt.has(t.terminal)) {
        warnings.push(`No KiCad pin for ${t.part}.${t.terminal} -- connection omitted`);
      }
    }
    if (live.length < 2) return;
    const name = netName.get(i);
    for (const t of live) {
      const [x, y] = known.get(t.part).pinAt.get(t.terminal);
      labels.push({ name, x, y });
    }
  });

  // ---- serialise ----------------------------------------------------
  const sheetUuid = uuidFor('sheet');
  const out = [];
  out.push('(kicad_sch');
  out.push('\t(version 20231120)');
  out.push(`\t(generator ${q('bw-circuit-ui')})`);
  out.push(`\t(uuid ${q(sheetUuid)})`);
  out.push(`\t(paper ${q('A4')})`);

  out.push('\t(lib_symbols');
  for (const [lib, def] of defs) {
    const bare = lib.includes(':') ? lib.slice(lib.indexOf(':') + 1) : lib;
    out.push(`\t\t(symbol ${q(lib)}`);
    if (def.power) out.push('\t\t\t(power)');
    out.push('\t\t\t(pin_names (offset 0.254))');
    out.push('\t\t\t(in_bom yes) (on_board yes)');
    out.push(`\t\t\t(property ${q('Reference')} ${q(def.power ? '#PWR' : 'U')} (at 0 5.08 0))`);
    out.push(`\t\t\t(property ${q('Value')} ${q(bare)} (at 0 -5.08 0))`);
    out.push(`\t\t\t(symbol ${q(`${bare}_1_1`)}`);
    for (const p of def.pins) {
      out.push(`\t\t\t\t(pin ${p.type} line`);
      out.push(`\t\t\t\t\t(at ${p.x} ${p.y} ${p.rot})`);
      out.push('\t\t\t\t\t(length 2.54)');
      out.push(`\t\t\t\t\t(name ${q(p.name)})`);
      out.push(`\t\t\t\t\t(number ${q(String(p.num))})`);
      out.push('\t\t\t\t)');
    }
    out.push('\t\t\t)');
    out.push('\t\t)');
  }
  out.push('\t)');

  for (const pl of placed) {
    const value = pl.spec.value ? pl.spec.value(pl.part.params || {}) : undefined;
    const shown = (value !== undefined && value !== null && value !== '')
      ? value : ((pl.part.params || {})._value ?? pl.part.kind);
    out.push('\t(symbol');
    out.push(`\t\t(lib_id ${q(pl.spec.lib)})`);
    out.push(`\t\t(at ${pl.at.x} ${pl.at.y} 0)`);
    out.push('\t\t(unit 1)');
    out.push(`\t\t(uuid ${q(uuidFor(`sym:${pl.part.id}`))})`);
    out.push(`\t\t(property ${q('Reference')} ${q(pl.part.id)} (at ${pl.at.x} ${pl.at.y - 7.62} 0))`);
    out.push(`\t\t(property ${q('Value')} ${q(shown)} (at ${pl.at.x} ${pl.at.y + 7.62} 0))`);
    out.push('\t\t(instances');
    out.push(`\t\t\t(project ${q('bw')}`);
    out.push(`\t\t\t\t(path ${q(`/${sheetUuid}`)} (reference ${q(pl.part.id)}) (unit 1))`);
    out.push('\t\t\t)');
    out.push('\t\t)');
    out.push('\t)');
  }

  for (const l of labels) {
    out.push(`\t(label ${q(l.name)}`);
    out.push(`\t\t(at ${Math.round(l.x * 1000) / 1000} ${Math.round(l.y * 1000) / 1000} 0)`);
    out.push(`\t\t(uuid ${q(uuidFor(`lbl:${l.name}:${l.x}:${l.y}`))})`);
    out.push('\t)');
  }

  out.push(`\t(sheet_instances (path ${q('/')} (page ${q('1')})))`);
  out.push(')');

  return { text: `${out.join('\n')}\n`, warnings, skipped };
}
