/**
 * EAGLE schematic importer (.sch, EAGLE 6 and later).
 *
 * From EAGLE 6 the .sch/.brd/.lbr files are XML with a published DTD, so the
 * connectivity is explicit and needs no geometry reasoning:
 *
 *   <parts><part name="R1" library="resistor" deviceset="R-EU_" value="10k"/>
 *   <nets><net name="VCC"><segment>
 *     <pinref part="R1" gate="G$1" pin="1"/> ... </segment></net></nets>
 *
 * As with kicad-netlist.js, the parsing is the easy half. The work is mapping
 * EAGLE's library/deviceset vocabulary onto engine kinds and its per-device
 * pin NAMES onto our terminal names — EAGLE pins are strings ("1", "A", "GND",
 * "P$1"), not positions, and differ per library.
 *
 * Anything unmapped is REPORTED, never silently dropped: a schematic that
 * half-imports without saying so is worse than one that refuses, because the
 * simulation then answers confidently about a circuit nobody drew.
 *
 * Deliberately NOT handled: .brd (a board layout is copper and footprints; the
 * schematic carries the netlist we want) and EAGLE 5 and earlier (binary).
 *
 * @module
 */

// Minimal tag scanning, same approach as kicad-netlist.js — no XML dependency.
const attrs = (tag) => {
  const out = {};
  for (const m of tag.matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"/g)) out[m[1]] = m[2];
  return out;
};

// ── value parsing ──────────────────────────────────────────────────
// EAGLE values are human strings: "10k", "4k7", "100n", "1u5", "470R".
// The R/k/M and p/n/u/m forms both use the letter as a decimal point when it
// sits between digits, which is why "4k7" must read as 4700 and not 4.7.
const SI = { p: 1e-12, n: 1e-9, u: 1e-6, µ: 1e-6, m: 1e-3, r: 1, R: 1, k: 1e3, K: 1e3, M: 1e6, G: 1e9 };
export function parseEagleValue(raw) {
  if (!raw) return null;
  const s = String(raw).trim().replace(/(ohm|Ω|F|farad)s?$/i, '');
  let m = /^(\d+)([pnuµmrRkKMG])(\d+)$/.exec(s);          // 4k7  1u5  470R0
  if (m) return (Number(m[1]) + Number(m[3]) / 10 ** m[3].length) * (SI[m[2]] ?? 1);
  m = /^(\d*\.?\d+)\s*([pnuµmrRkKMG])?$/.exec(s);          // 10k  100n  470
  if (m) return Number(m[1]) * (m[2] ? SI[m[2]] ?? 1 : 1);
  return null;
}

// ── deviceset → engine kind ────────────────────────────────────────
// Matched against the deviceset name, which is the stable part of an EAGLE
// library reference (the device suffix is the package: R-EU_0207/10).
// Drawing artifacts, not components. A fiducial, a mounting hole, a sheet
// frame or a test point has no electrical model and never should have one, so
// counting them as "unmapped" overstates the loss and buries the components
// that genuinely need a rule. They are reported separately.
const NON_ELECTRICAL = /^(FIDUCIAL|MOUNTING[-_ ]?HOLE|STAND[-_ ]?OFF|FRAME|LOGO|TEST[-_ ]?POINT|TESTPOINT|DOCFIELD|SJ|SOLDER[-_ ]?JUMPER)/i;

const DIODE_PINS = { A: 'anode', C: 'cathode', K: 'cathode', '1': 'anode', '2': 'cathode', 'P$1': 'anode', 'P$2': 'cathode' };
const SUPPLY_PINS = { '+': 'pos', '-': 'neg', '+VE': 'pos', '-VE': 'neg', 'P$1': 'pos', 'P$2': 'neg', '1': 'pos', '2': 'neg' };

const FET_PINS = { G: 'gate', D: 'drain', S: 'source', '1': 'gate', '2': 'source', '3': 'drain' };
const BJT_PINS = { B: 'base', C: 'collector', E: 'emitter', '1': 'base', '2': 'collector', '3': 'emitter' };

/**
 * The engine's header model has EIGHT terminals and no parameter widens it.
 * So a 2x5 connector is DRAWN ten wide and can be WIRED only eight wide, and
 * emitting p9/p10 anyway produces wires the board silently ignores -- the
 * quietest kind of wrong. The count still goes in params, because the symbol
 * and the BOM want it; the pin map stops where the engine does, and says so.
 * Found by the terminal-name contract in engine-contract.test.js, which was
 * written for the KiCad importers and immediately caught this one here.
 */
const HEADER_TERMINALS = 8;

/** An n-pin header, with p1..pn terminals. Connectors differ only in width. */
function headerPins(n) {
  return Object.fromEntries(Array.from({ length: Math.min(n, HEADER_TERMINALS) },
    (_, i) => [String(i + 1), `p${i + 1}`]));
}

function headerOf(n, ds) {
  return {
    kind: 'header',
    params: { pins: n },
    pins: headerPins(n),
    _note: `EAGLE ${ds} imported as a ${n}-pin header`
      + (n > HEADER_TERMINALS
        ? `; only the first ${HEADER_TERMINALS} pins can be wired -- the engine's header model has ${HEADER_TERMINALS} terminals`
        : ''),
  };
}

export const RULES = [
  // power symbols — one terminal, and EAGLE draws one per connection point
  // The symbol's PIN name is not its deviceset name: a VCC symbol may carry a
  // pin called VIN, and a supply symbol's pins are +VE/-VE in some libraries.
  [/^(GND|AGND|DGND|0V)$/i,            () => ({ kind: 'gnd', anyPin: 'gnd' })],
  [/^(VCC|VDD|\+5V|V\+|VIN|VBUS|VBAT)$/i, () => ({ kind: 'vcc', anyPin: 'vcc' })],
  // SparkFun and friends name the supply symbol after the RAIL: 5V, 3.3V,
  // 5.0V, 3V3. Sixty of these in a twelve-board corpus, all previously
  // unmapped, which is why the rule is by shape rather than by enumeration.
  [/^[+]?\d+(\.\d+)?V\d*$|^[+]?\d+V\d+$/i, () => ({ kind: 'vcc',
    anyPin: 'vcc' })],
  // ...and the passive after its VALUE: 0.1UF, 1KOHM, 10KOHM.
  [/^[\d.]+\s*(UF|NF|PF|MF)$/i,       (v, ds) => ({ kind: 'capacitor',
    params: { farads: parseEagleValue(ds.replace(/F$/i, '').replace(/U$/i, 'u').replace(/N$/i, 'n').replace(/P$/i, 'p')) ?? 1e-7 },
    pins: { '1': 'a', '2': 'b' } })],
  [/^[\d.]+\s*[KM]?OHMS?$/i,          (v, ds) => ({ kind: 'resistor',
    params: { ohms: parseEagleValue(ds.replace(/OHMS?$/i, '')) ?? 1000 },
    pins: { '1': 'a', '2': 'b' } })],
  // connectors
  [/^(HEADER|PINHD)[-_]?(\d+)X(\d+)/i, (v, ds) => {
    const m = /(\d+)X(\d+)/i.exec(ds);
    return headerOf(Number(m[1]) * Number(m[2]), ds);
  }],
  // passives
  [/^R[-_]?(EU|US)?/i,                 (v) => ({ kind: 'resistor',  params: { ohms: parseEagleValue(v) ?? 1000 }, pins: { '1': 'a', '2': 'b' } })],
  [/^C[-_]?(EU|US)?/i,                 (v) => ({ kind: 'capacitor', params: { farads: parseEagleValue(v) ?? 1e-7 }, pins: { '1': 'a', '2': 'b' } })],
  [/^L[-_]?(EU|US)?$/i,                (v) => ({ kind: 'inductor',  params: { henries: parseEagleValue(v) ?? 1e-3 }, pins: { '1': 'a', '2': 'b' } })],
  // discretes
  [/^LED/i,                            () => ({ kind: 'led',   pins: DIODE_PINS })],
  [/^(DIODE|D)[-_]?/i,                 () => ({ kind: 'diode', pins: DIODE_PINS })],
  [/^(ZENER|BZX)/i,                    () => ({ kind: 'zener', pins: DIODE_PINS })],
  // displays / modules we model
  // An 8x8 module's EAGLE pins are A1..A8 / C1..C8. Which axis is which is
  // stated by the deviceset itself — ROWCATHODE means the rows are the
  // cathodes — so C maps to row and A to col. Recorded as a note because the
  // engine's terminal names (col0../row0..) do not encode polarity, and a
  // transposed display is exactly the "loads but wrong" outcome.
  [/^SEGMENT_8X8|^MATRIX8X8|^8X8/i,    (v, ds) => ({
    kind: 'matrix8x8',
    pins: Object.fromEntries([
      ...Array.from({ length: 8 }, (_, i) => [`A${i + 1}`, `col${i}`]),
      // cathodes are K1..K8 in the SparkFun/adafruit libraries, C1..C8 in others
      ...Array.from({ length: 8 }, (_, i) => [`C${i + 1}`, `row${i}`]),
      ...Array.from({ length: 8 }, (_, i) => [`K${i + 1}`, `row${i}`]),
    ]),
    _note: /ROWCATHODE/i.test(ds)
      ? 'A1-A8 read as col0-7 and C1-C8 as row0-7 (deviceset says ROWCATHODE); check the axes are not transposed'
      : 'A1-A8 read as col0-7 and C1-C8 as row0-7 — the deviceset does not state which axis is the cathode, so verify',
  })],
  [/^(2032|CR2032|BATTERY[-_]?COIN)/i, () => ({ kind: 'battery_coin', pins: SUPPLY_PINS })],
  [/^(BATTERY|BAT)/i,                  () => ({ kind: 'battery', pins: SUPPLY_PINS })],
  // ICs whose EAGLE pin names already ARE our terminal names once the
  // annotations are stripped — see normalizeEaglePin.
  [/^(TINY|ATTINY)\s*48\/?88|^ATTINY88/i, () => ({ kind: 'attiny88', byName: true })],
  // The engine's at24c02 models the bus only. A real 24Cxx also has A0-A2 and
  // WP, and emitting those would hand the engine terminals it does not have —
  // which does not warn, it REJECTS THE WHOLE BENCH and leaves a board with
  // zero parts. Found by round-tripping a real board, not by reading the model.
  [/^EEPROM[-_]?I2C|^24[CL]C?\d/i,         () => ({ kind: 'at24c02',  byName: true,
    terminals: ['vcc', 'gnd', 'sda', 'scl'] })],
  [/^PINHD[-_]?1X(\d+)/i,                  (v, ds) => headerOf(Number(/1X(\d+)/i.exec(ds)[1]), ds)],
  // ── rules driven by MEASURING a real corpus ──────────────────────
  // Everything below was added by importing 286 published EAGLE schematics
  // and ranking what failed to map, rather than by guessing which parts are
  // common. The counts in the comments are from that run.

  // Discretes. A ferrite bead is an inductor as far as any netlist is
  // concerned, and the corpus spells inductors both ways (70 + 38).
  [/^(FERRITE|FERRITE[-_]?BEAD|BLM\d|MPZ\d)/i, () => ({ kind: 'inductor',
    params: { henries: 1e-6 }, pins: { '1': 'a', '2': 'b' } })],
  [/^INDUCTOR/i,                       (v) => ({ kind: 'inductor',
    params: { henries: parseEagleValue(v) ?? 1e-3 }, pins: { '1': 'a', '2': 'b' } })],
  // MOSFET-N_DUAL is two devices in one package; the engine has one model, so
  // it maps to a single N-channel and says so rather than inventing a pair.
  [/^MOSFET[-_]?N[-_]?DUAL/i,          () => ({ kind: 'nmos', pins: FET_PINS,
    _note: 'dual N-MOSFET imported as a single device — the second channel is not modelled' })],
  [/^(MOSFET[-_]?N|NMOS|N[-_]?CHANNEL)/i, () => ({ kind: 'nmos', pins: FET_PINS })],
  [/^(MOSFET[-_]?P|PMOS|P[-_]?CHANNEL)/i, () => ({ kind: 'pmos', pins: FET_PINS })],
  [/NPN/i,                             () => ({ kind: 'npn', pins: BJT_PINS })],
  [/PNP/i,                             () => ({ kind: 'pnp', pins: BJT_PINS })],
  [/^XTAL|^CRYSTAL|^RESONATOR/i,       () => ({ kind: 'crystal',
    pins: { '1': 'a', '2': 'b' },
    _note: 'crystal has no engine model; imported for the schematic only' })],

  // Switches. A tact switch is a momentary button; DPDT is a changeover.
  [/^SWITCH[-_]?DPDT|^DPDT/i,          () => ({ kind: 'slide_switch' })],
  [/^(SWITCH[-_]?TACT|SPST[-_]?TACT|TACT|B3F|KMR\d)/i, () => ({ kind: 'button',
    pins: { '1': 'a', '2': 'b', '3': 'a', '4': 'b', 'P$1': 'a', 'P$2': 'b' } })],

  // Addressable LEDs. One package, one RGB emitter plus its controller: the
  // engine's neopixel is the right model, and the corpus has 106 of them.
  [/^(WS2812|SK6812|APA10\d)/i,        () => ({ kind: 'neopixel', byName: true })],

  // Regulators. The engine HAS models for these -- vreg generically, plus
  // lm7805 and ld1117v33 by name -- which is why the part number is matched
  // before the generic rule. An earlier version of this invented a
  // `regulator` kind instead, which drew a nice box and could not be
  // simulated, wired to an MCU or used from the dialect. A symbol is one
  // layer of four; emitting a kind the engine does not know silently loses
  // the other three. engine-contract.test.js now fails on that.
  [/^(LM7805|7805|MC7805)/i,           () => ({ kind: 'lm7805' })],
  [/^(LD1117|AMS1117|LM1117)/i,        () => ({ kind: 'ld1117v33' })],
  [/^(VREG|LM\d{2,4}|LP\d{3,4}|AP\d{4}|MCP17\d\d|AXP\d+|TPS\d{4}|XC6\d{3})/i,
    (v, ds) => ({ kind: 'vreg',
      _note: `EAGLE ${ds} imported as a generic vreg; check the pinout` })],

  // Connectors. USB, card sockets, terminal blocks, JST leads and the various
  // 1xN strips are all "a labelled row of pins" to a netlist. Together they
  // are the single largest unmapped group in the corpus.
  [/^USB(?![A-Z])|^USB[-_]?(A|B|C|MICRO|MINI|TYPEA|TYPEC)/i, () => ({ kind: 'usb_a' })],
  [/^(MICROSD|SD[-_]?CARD|MICRO[-_]?SD)/i, (v, ds) => headerOf(8, ds)],
  [/^(TERMBLOCK|JST|MOLEX|SCREWTERMINAL|CONN)[-_]?(\d+)?X?(\d+)?/i, (v, ds) => {
    const m = /(\d+)/.exec(ds.replace(/^[A-Z_]+/i, ''));
    return headerOf(m ? Number(m[1]) : 2, ds);
  }],
  [/^(\d+)X(\d+)$/i,                   (v, ds) => {
    const m = /^(\d+)X(\d+)$/i.exec(ds);
    return headerOf(Number(m[1]) * Number(m[2]), ds);
  }],
  [/^(\d+)[-_]?STRIP$/i,               (v, ds) => headerOf(Number(/^(\d+)/.exec(ds)[1]), ds) ],
  [/^(STEMMA|QWIIC|GROVE)/i,           (v, ds) => headerOf(4, ds) ],
  [/^(FEATHERWING|ARDUINO_R3|ICSP|SHIELD)/i, (v, ds) => headerOf(6, ds) ],
  // A pad is a one-pin connector: test points, perfboard holes and Adafruit's
  // conductive sewing taps all exist so a wire can be attached.
  [/^(TP|PERFHOLE|SEWTAP|PAD|VIA)$/i,  (v, ds) => headerOf(1, ds) ],

  // 74-series: the deviceset carries the number, e.g. 74*00N / 74HC595N.
  //
  // The part number must be captured WHOLE. A lazy `\w*?` in front of
  // `(\d{2,3})` walks forward until three digits match and stops there, so
  // 74HC4050D and 74HC4051 BOTH became `74hc405` -- a hex buffer and an
  // 8-channel analog mux collapsed into one kind that is neither, 23 parts of
  // it in the gallery. The digits are anchored between the family letters and
  // the package suffix instead, and four digits are allowed because the 4000
  // series is four digits long.
  [/^74[A-Z*_ -]{0,5}(\d{2,4})[A-Z]*\d?$/i, (v, ds) => {
    const n = /^74[A-Z*_ -]{0,5}(\d{2,4})/i.exec(ds)[1];
    return { kind: `74hc${n}`, _note: `EAGLE ${ds} mapped to 74hc${n}; verify the pinout matches` };
  }],
];

// ── pin-name normalisation ─────────────────────────────────────────
// EAGLE decorates IC pin names with their alternate functions and marks
// duplicated pins with @N:  "PB0(ICP1/CLKO/PCINT0)" and "GND@2". Stripping
// both recovers the plain name, which is what our terminals are called. Used
// only by rules that opt in via `byName`, so passives stay strict — a
// resistor pin must be 1 or 2, not whatever the library felt like.
export function normalizeEaglePin(pin) {
  const bare = String(pin).replace(/\(.*$/, '').replace(/@\d+$/, '').trim().toLowerCase();
  if (bare === 'vss') return 'gnd';
  if (bare === 'avcc' || bare === 'vdd') return 'vcc';
  return bare;
}

function mapDeviceset(deviceset, value) {
  for (const [re, make] of RULES) {
    if (re.test(deviceset)) {
      const r = make(value, deviceset);
      return { params: {}, pins: {}, ...r };
    }
  }
  return null;
}

/**
 * Import an EAGLE 6+ schematic.
 *
 * @param {string} text  Raw .sch XML
 * @returns {{parts: Array, wires: Array, warnings: string[], unmapped: Array}}
 */
export function importEagle(text) {
  const warnings = [];
  const unmapped = [];
  const ignored = [];               // drawing artifacts: no electrical model by design
  const parts = [];
  const wires = [];

  if (!/<eagle\b/.test(text)) {
    return { parts, wires, unmapped, ignored, warnings: ['Not an EAGLE file: no <eagle> root element'] };
  }
  if (/<board\b/.test(text) && !/<schematic\b/.test(text)) {
    return {
      parts, wires, unmapped, ignored,
      warnings: ['This is an EAGLE .brd (board layout). Import the matching .sch — '
        + 'the schematic carries the netlist; a board carries copper and footprints.'],
    };
  }

  // ── parts ────────────────────────────────────────────────────────
  const pinMaps = new Map();          // part name -> EAGLE pin -> our terminal
  const byName = new Set();           // parts whose pins are named, not numbered
  const anyPin = new Map();           // single-pin symbols: any pin is that terminal
  const allowed = new Map();          // kinds whose engine model is narrower than the chip
  for (const m of text.matchAll(/<part\s+([^>]*?)\/?>/g)) {
    const a = attrs(m[1]);
    if (!a.name || !a.deviceset) continue;
    if (NON_ELECTRICAL.test(a.deviceset)) { ignored.push({ ref: a.name, libsource: `${a.library || '?'}/${a.deviceset}` }); continue; }
    const hit = mapDeviceset(a.deviceset, a.value);
    if (!hit) {
      unmapped.push({ ref: a.name, value: a.value || '', libsource: `${a.library || '?'}/${a.deviceset}` });
      warnings.push(`Unmapped component: ${a.name} (${a.library || '?'}/${a.deviceset}${a.value ? ` = ${a.value}` : ''})`);
      continue;
    }
    if (hit._note) warnings.push(`${a.name}: ${hit._note}`);
    const params = { ...hit.params };
    if (a.value) params._value = a.value;      // keep the human string for display
    parts.push({ id: a.name, kind: hit.kind, params, x: 0, y: 0 });
    pinMaps.set(a.name, hit.pins || {});
    if (hit.byName) byName.add(a.name);
    if (hit.anyPin) anyPin.set(a.name, hit.anyPin);
    if (hit.terminals) allowed.set(a.name, new Set(hit.terminals));
  }

  // ── nets → wires ─────────────────────────────────────────────────
  // Star from the first pin, matching kicad-netlist.js: the engine unions
  // terminals per net, so any spanning shape is equivalent.
  const known = new Set(parts.map((p) => p.id));
  for (const netM of text.matchAll(/<net\s+([^>]*?)>([\s\S]*?)<\/net>/g)) {
    const netName = attrs(netM[1]).name || '?';
    const refs = [];
    for (const pr of netM[2].matchAll(/<pinref\s+([^>]*?)\/?>/g)) {
      const a = attrs(pr[1]);
      if (!a.part || !a.pin) continue;
      if (!known.has(a.part)) continue;                 // its component was unmapped
      const map = pinMaps.get(a.part) || {};
      const term = map[a.pin]
        ?? anyPin.get(a.part)
        ?? (byName.has(a.part) ? normalizeEaglePin(a.pin) : undefined);
      if (!term) {
        warnings.push(`Unknown pin "${a.pin}" on ${a.part} in net "${netName}"`);
        continue;
      }
      const ok = allowed.get(a.part);
      if (ok && !ok.has(term)) {
        // Emitting it would be worse than dropping it: the engine validates
        // terminals and refuses the ENTIRE netlist, so one extra pin costs the
        // whole board.
        warnings.push(`${a.part} pin "${a.pin}" dropped — the engine's model has no "${term}" terminal`);
        continue;
      }
      refs.push({ part: a.part, terminal: term });
    }
    // Dedupe by electrical NODE before wiring the star. Real schematics repeat
    // a pinref: Adafruit's Relay FeatherWing lists JP4 pin 1 twice in one net,
    // presumably because two wire segments land on the same pad. A repeat adds
    // no connectivity, but it does add a ref — and when the net's OTHER member
    // is an unmapped part (MS1/MICROSHIELD here), the survivors are two copies
    // of one pin and the star wires that pin TO ITSELF.
    //
    // A self-loop is not harmless. netsFromWires counts it as a net, so eight
    // of them turned 6 real nets into "14" on import, against 6 on export, and
    // five corpus boards failed round-trip on a difference that did not exist.
    const seen = new Set();
    const uniq = refs.filter((r) => {
      const k = r.part + '\u0000' + r.terminal;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    for (let i = 1; i < uniq.length; i++) {
      wires.push({
        from: uniq[0].part, fromTerminal: uniq[0].terminal,
        to: uniq[i].part, toTerminal: uniq[i].terminal,
      });
    }
  }

  if (ignored.length) warnings.push(`${ignored.length} drawing artifact(s) skipped (fiducials, mounting holes, frames, test points) — not components`);
  if (!parts.length) warnings.push('No mappable components found — is this an EAGLE 6+ schematic?');
  return { parts, wires, warnings, unmapped, ignored };
}
