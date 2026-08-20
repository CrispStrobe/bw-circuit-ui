/**
 * EasyEDA Standard schematic importer (.json, docType 5).
 *
 * EasyEDA saves a whole document as JSON whose payload is NOT JSON: every
 * drawing primitive is a TILDE-DELIMITED string in `dataStr.shape`, and a
 * component is one such string with its sub-shapes appended after `#@$`.
 *
 *   LIB~50~-320~package`HDR-TH_2P`spicePre`P`~~0~gge23894~<uuid>~...
 *     #@$T~N~56.4~-338~0~...~comment~Header~1~end~gge2198~0~     <- VALUE
 *     #@$T~P~56.4~-346~0~...~comment~P2~1~end~gge2204~0~         <- DESIGNATOR
 *     #@$P~show~1~1~65~-325~0~gge2213~0^^65~-325^^M 65 -325 h -10...  <- a PIN
 *
 * Like the two KiCad schematic importers and unlike eagle.js, connectivity is
 * GEOMETRY: the file states where a wire runs and where a pin sits, and the
 * reader has to work out which touch. So this module reuses kicad-common.js's
 * NetSolver rather than growing a second union-find.
 *
 * ── The one thing that makes EasyEDA easier than KiCad ──────────────
 *
 * A pin's coordinates are ABSOLUTE, already in sheet space. The library
 * placement carries a rotation (`LIB` field 4, one of ''/90/180/270) and a
 * mirror flag (field 5), and NEITHER has to be applied: EasyEDA bakes the
 * transform into the pin when it writes the file. Measured on the 31-component
 * 8085 devkit board: 186 of 209 pins land EXACTLY on a wire endpoint, junction
 * or label anchor with no transform at all, including every pin of the 21
 * symbols placed at 90/180/270 degrees. The 23 that do not are genuinely
 * unwired IC pins. Applying placePin() here would be a bug, not a refinement.
 *
 * The check is not left to trust: `geometry:` in the warnings reports the
 * attach rate, so a file where absoluteness fails announces itself as a
 * collapsed number instead of as silently missing nets.
 *
 * ── Buses ───────────────────────────────────────────────────────────
 *
 * `B` (a bus polyline) is NOT wire. Unioning a bus would short A0..A15 into
 * one node -- the loudest possible wrong answer. `BE` (a bus entry) IS wire:
 * it is the short diagonal stub between a wire end and the bus, and the net
 * LABEL that names the connection sits at its bus-side end. Drop BE and the
 * label never reaches the wire and the whole address bus goes dark; keep BE
 * and drop B and each entry stays private to its own label, which is exactly
 * the bus semantics. Same policy as kicad-common: connect by NAME, never by
 * the bus body.
 *
 * @module
 */

import { NetSolver, wiresFromNets, makeId, terminalFor, classifyPower } from './kicad-common.js';
import { parseEagleValue } from './eagle.js';

// ── the shape DSL ──────────────────────────────────────────────────

/** Sub-shapes hang off the head after `#@$`; sections inside one hang off `^^`. */
const SUB = '#@$';

/**
 * `package`HDR-1X2`spicePre`P`` -> { package: 'HDR-1X2', spicePre: 'P' }.
 *
 * An empty value writes two backticks in a row (``Manufacturer Part``spicePre``),
 * so the pairs must be taken by position; splitting and filtering blanks
 * would shift every key onto the next key's value.
 */
export function parseLibAttrs(raw) {
  const out = {};
  if (!raw) return out;
  const f = String(raw).split('`');
  for (let i = 0; i + 1 < f.length; i += 2) if (f[i]) out[f[i]] = f[i + 1];
  return out;
}

/**
 * The text of a `T` sub-shape.
 *
 * Field 11 is the literal word `comment` in all 94 T shapes of the reference
 * board, and field 12 is the string the user sees. Anchored on the marker so
 * a file with a differently sized prefix still reads, rather than silently
 * returning a colour.
 */
function textOf(f) {
  const i = f.indexOf('comment');
  return (i >= 0 ? f[i + 1] : f[12]) ?? '';
}

/** "65 -325 75 -325 75 -300" -> [[65,-325],[75,-325],[75,-300]] */
function polyline(s) {
  const n = String(s || '').trim().split(/\s+/).map(Number);
  const pts = [];
  for (let i = 0; i + 1 < n.length; i += 2) {
    if (Number.isFinite(n[i]) && Number.isFinite(n[i + 1])) pts.push([n[i], n[i + 1]]);
  }
  return pts;
}

// ── values ─────────────────────────────────────────────────────────
// EasyEDA writes the same human strings EAGLE does ("100nF", "4k7", "1u",
// "75k"), so parseEagleValue is the parser -- one spelling table, not two.
// A crystal is the exception: its "value" is a FREQUENCY, and that is also
// the only reliable way to tell X1-the-crystal from U1-the-CPU, both of which
// EasyEDA labels spicePre `X`.
const FREQ = /^\s*\d+(\.\d+)?\s*[kKmM]?[hH][zZ]\s*$/;

// ── pin maps ───────────────────────────────────────────────────────
const PASSIVE2 = { 1: 'a', 2: 'b' };
const DIODE_PINS = { 1: 'anode', 2: 'cathode', A: 'anode', K: 'cathode', C: 'cathode' };
const BJT_PINS = { 1: 'base', 2: 'collector', 3: 'emitter', B: 'base', C: 'collector', E: 'emitter' };
const FET_PINS = { 1: 'gate', 2: 'drain', 3: 'source', G: 'gate', D: 'drain', S: 'source' };
// The engine calls all three regulator pins in/out/gnd. See the note in
// kicad-common.js: a wire to `vin` is accepted here and ignored by the board.
const VREG_PINS = { 1: 'in', 2: 'gnd', 3: 'out', IN: 'in', OUT: 'out', GND: 'gnd',
  VI: 'in', VO: 'out', VIN: 'in', VOUT: 'out' };

/**
 * The engine's header model has EIGHT terminals and no parameter widens it,
 * so a 20-pin strip draws twenty wide and wires eight wide. Same cap, same
 * reason, as eagle.js and kicad-common.js -- emitting p9 produces a wire the
 * board silently ignores.
 */
const HEADER_TERMINALS = 8;

/**
 * A header's pin map, keyed by the pin NUMBER as written.
 *
 * EasyEDA does not promise the number is numeric: the 8085 board's barrel
 * jack numbers its three pins `P1`,`P2`,`P3`, and its 3-pin header lists them
 * out of order (3,1,2). So the digits are extracted from whatever is there
 * and the ORDER the pins appear in is never used.
 */
function headerOf(n, why) {
  const pins = {};
  for (let i = 1; i <= n && i <= HEADER_TERMINALS; i++) {
    pins[String(i)] = `p${i}`;
    pins[`P${i}`] = `p${i}`;
  }
  return {
    kind: 'header',
    params: { pins: n },
    pins,
    _note: n > HEADER_TERMINALS
      ? `${why || `imported as a ${n}-pin header`}; only the first ${HEADER_TERMINALS} pins can be wired `
        + `-- the engine's header model has ${HEADER_TERMINALS} terminals`
      : why,
  };
}

/**
 * 74HC138 3-to-8 decoder.
 *
 * Spelled out rather than left to `byName` because the engine marks every
 * active-low pin with a trailing `b` (`y0b`, `g2ab`) and EasyEDA's library
 * writes the bare datasheet name (`Y0`, `G2A`). `byName` would hand the board
 * eight terminals it does not have, which is a wire that draws and does not
 * conduct. engine-contract.test.js checks exactly this.
 */
const PINS_74HC138 = {
  A: 'a', B: 'b', C: 'c', G1: 'g1', G2A: 'g2ab', G2B: 'g2bb',
  Y0: 'y0b', Y1: 'y1b', Y2: 'y2b', Y3: 'y3b',
  Y4: 'y4b', Y5: 'y5b', Y6: 'y6b', Y7: 'y7b',
  VCC: 'vcc', GND: 'gnd',
};

/**
 * Part-number rules, matched against a component's DESCRIPTOR.
 *
 * The descriptor is the `Manufacturer Part` attribute when the library set
 * one, else the value text, else the package -- the first of the three that
 * actually names the device. Ordered; first match wins.
 *
 * Anchored on purpose. An unanchored `/LM7805/` would be fine, but an
 * unanchored `/^C/` for capacitors turns `CD4093BE` into one, which is why
 * generic passives are decided by `spicePre` below and NOT by a rule here.
 *
 * Exported so engine-contract.test.js can fire every rule and check that the
 * kinds and terminal names it produces are ones the engine actually has.
 */
export const EASYEDA_RULES = [
  // -- regulators. Part number first: the engine models these three by name,
  //    and falling through to the generic `vreg` would lose their models.
  [/^(LM|MC|UA|KA|L)?78L?05/i, () => ({ kind: 'lm7805', pins: VREG_PINS })],
  [/^(LM|MC|UA|KA|L)?78L?09/i, () => ({ kind: 'lm7809', pins: VREG_PINS })],
  [/^(LM|MC|UA|KA|L)?78L?12/i, () => ({ kind: 'lm7812', pins: VREG_PINS })],
  [/^(AMS|AZ|HT)1117[-_ ]?3[.,]?3/i, () => ({ kind: 'ams1117_33', pins: VREG_PINS })],
  [/^(AMS|AZ|HT)1117[-_ ]?5([.,]0)?$/i, () => ({ kind: 'ams1117_50', pins: VREG_PINS })],
  [/^(LD|LM)1117/i, () => ({ kind: 'ld1117v33', pins: VREG_PINS })],

  // -- logic. The number must be captured WHOLE and only numbers the engine
  //    actually models are emitted; see LOGIC_KINDS.
  [/^(SN|MC|CD|DM|MM|HD|TC)?74[A-Z]{0,4}(\d{2,4})[A-Z]{0,3}\d?$/i, (v, d) => {
    const n = /74[A-Z]{0,4}(\d{2,4})/i.exec(d)[1];
    const kind = logicKind(n);
    if (!kind) return null;
    return kind === '74hc138'
      ? { kind, pins: PINS_74HC138 }
      : { kind, byName: true, _note: `${d} mapped to ${kind}; verify the pinout matches` };
  }],
  [/^(CD|MC|HEF|HCF)?4093/i, () => ({ kind: 'cd4093', byName: true })],
  [/^(CD|MC|HEF|HCF)?4511/i, () => ({ kind: 'cd4511', byName: true })],

  // -- analogue ICs the engine models by name
  [/^(LM|NE|UA|MC)?555\w*$/i, () => ({ kind: 'timer_555', byName: true })],
  [/^(LM|NE|UA|MC)?556\w*$/i, () => ({ kind: 'timer_556', byName: true })],
  [/^(LM|MC)?358/i, () => ({ kind: 'lm358', byName: true })],
  [/^(LM|MC)?339/i, () => ({ kind: 'lm339', byName: true })],
  [/^(LM|MC)?393/i, () => ({ kind: 'lm393', byName: true })],
  [/^MAX7219/i, () => ({ kind: 'max7219', byName: true })],
  [/^PCF8574/i, () => ({ kind: 'pcf8574', byName: true })],
  [/^(AT)?24[CL]C?\d/i, () => ({ kind: 'at24c02', byName: true,
    terminals: ['vcc', 'gnd', 'sda', 'scl'],
    _note: 'the engine models the 24Cxx bus only; A0-A2 and WP are dropped rather than '
      + 'handed to the board as terminals it does not have' })],
  [/^(WS2812|SK6812|APA10\d)/i, () => ({ kind: 'neopixel', byName: true })],
  [/^(DS18B20)/i, () => ({ kind: 'ds18b20', byName: true })],
  [/^(DHT11)/i, () => ({ kind: 'dht11', byName: true })],
  [/^(DHT22|AM2302)/i, () => ({ kind: 'dht22', byName: true })],
  [/^(DS1302)/i, () => ({ kind: 'ds1302', byName: true })],
  [/^(DS3231)/i, () => ({ kind: 'ds3231', byName: true })],
  [/^(TIP120)/i, () => ({ kind: 'tip120', pins: BJT_PINS })],
  [/^(HD44780|LCD1602|LCD2004)/i, () => ({ kind: 'hd44780', byName: true })],
  [/^(SSD1306)/i, () => ({ kind: 'ssd1306', byName: true })],
];

/** 74-series numbers with a real engine device, from bw-board's registry. */
const LOGIC_74HC = new Set(['00', '02', '04', '08', '10', '11', '125', '132', '138', '14',
  '165', '20', '21', '244', '245', '27', '283', '32', '34', '374', '4050', '595', '688',
  '73', '74', '75', '86', '93', '95']);
const LOGIC_74LS = new Set(['04', '107', '157', '161', '173', '189', '32']);

/**
 * A 74-series number to an engine kind, or null.
 *
 * Deliberately NOT `74hc${n}` for every n, which is what eagle.js does. The
 * engine has no `74hc373`, and emitting one produces a part that draws, takes
 * its wires with it into a board that cannot build it, and never simulates.
 * Losing the 74LS373 on the reference board and SAYING so is the smaller
 * error -- and mapping it to the `74hc374` the engine does have would be the
 * 4050/4051 collapse again: a transparent latch is not a D flip-flop.
 */
export function logicKind(n) {
  const s = String(n).replace(/^0+(?=\d)/, '');
  if (LOGIC_74HC.has(s) || LOGIC_74HC.has(String(n))) return `74hc${LOGIC_74HC.has(s) ? s : n}`;
  if (LOGIC_74LS.has(s) || LOGIC_74LS.has(String(n))) return `74ls${LOGIC_74LS.has(s) ? s : n}`;
  return null;
}

/**
 * `spicePre` to an engine part, for everything no part-number rule claimed.
 *
 * This is the strongest signal EasyEDA gives: the letter is the SPICE prefix
 * the library author chose, so it survives however the part is named. It is
 * also the only signal for a component whose value is just "1k".
 *
 * `X` is the ambiguous one -- SPICE's subcircuit prefix. The 8085 board uses
 * it for BOTH a 3.579545 MHz crystal and a 40-pin CPU. The frequency-shaped
 * value is what separates them; anything else stays unmapped rather than
 * becoming a crystal nobody drew.
 */
function mapSpicePre(pre, value, pinCount, pkg) {
  const v = value || '';
  // A COUNT, not the pin array. Passing the array once produced headers with
  // an empty pin map -- every connector imported, drew, and wired nothing,
  // and the only visible symptom was a net count one lower than it should be.
  const n = Number.isFinite(pinCount) ? pinCount : 0;
  switch (String(pre || '').toUpperCase()) {
    case 'R':
      if (/^POT|TRIM|RV/i.test(pkg || '') || n === 3) {
        return { kind: 'potentiometer', pins: { 1: 'a', 2: 'wiper', 3: 'b' } };
      }
      return { kind: 'resistor', params: { ohms: parseEagleValue(v) ?? 1000 }, pins: PASSIVE2 };
    case 'C':
      return { kind: 'capacitor', params: { farads: parseEagleValue(v) ?? 1e-7 }, pins: PASSIVE2 };
    case 'L':
      return { kind: 'inductor', params: { henries: parseEagleValue(v) ?? 1e-3 }, pins: PASSIVE2 };
    case 'D':
      if (/^LED/i.test(v) || /LED/i.test(pkg || '')) return { kind: 'led', pins: DIODE_PINS };
      if (/ZENER|^BZX|^1N47/i.test(v)) return { kind: 'zener', pins: DIODE_PINS };
      return { kind: 'diode', pins: DIODE_PINS };
    case 'Q':
      if (/PNP|^BC5|^2N3906|^S8550/i.test(v)) return { kind: 'pnp', pins: BJT_PINS };
      if (/^(IRF|AO|BSS|2N7|SI\d)/i.test(v)) return { kind: 'nmos', pins: FET_PINS };
      return { kind: 'npn', pins: BJT_PINS };
    case 'K':
      return { kind: 'relay', byName: true };
    case 'S':
    case 'SW':
      // A 2-pin switch is a momentary button; a 3-pin one is a changeover.
      return n >= 3
        ? { kind: 'slide_switch', byName: true }
        : { kind: 'button', pins: { 1: 'a', 2: 'b', 3: 'a', 4: 'b' } };
    case 'X':
      if (FREQ.test(v)) return { kind: 'crystal', pins: PASSIVE2 };
      return null;                       // a subcircuit; the caller reports it
    case 'P':
    case 'J':
    case 'H':
    case 'CN':
      return headerOf(n || 2, `EasyEDA spicePre "${pre}" imported as a `
        + `${n || 2}-pin header`);
    case 'V':
      return { kind: 'vsource', pins: { 1: 'pos', 2: 'neg', '+': 'pos', '-': 'neg' } };
    case 'BT':
      return { kind: 'battery', pins: { 1: 'pos', 2: 'neg', '+': 'pos', '-': 'neg' } };
    default:
      return null;
  }
}

/**
 * One component to an engine part, or null.
 *
 * @param {{descriptor:string, value:string, spicePre:string, pins:number, package:string}} c
 */
export function mapEasyEdaPart(c) {
  for (const [re, make] of EASYEDA_RULES) {
    if (!re.test(c.descriptor)) continue;
    let r;
    try { r = make(c.value, c.descriptor); } catch { continue; }
    if (r) return { params: {}, pins: {}, ...r };
  }
  const g = mapSpicePre(c.spicePre, c.value, c.pins.length, c.package);
  return g ? { params: {}, pins: {}, ...g } : null;
}

// ── document shape ─────────────────────────────────────────────────

/**
 * Is this text an EasyEDA document at all?
 *
 * Cheap enough for detect.js to call on every file: a substring test before
 * the parse, so a 40 MB non-JSON blob costs nothing.
 */
export function looksLikeEasyEda(text) {
  if (!/^\s*\{/.test(text)) return false;
  if (!/"editorVersion"\s*:/.test(text)) return false;
  return /"dataStr"\s*:/.test(text) || /"schematics"\s*:/.test(text) || /"shape"\s*:/.test(text);
}

/**
 * Every sheet's shape array, in document order.
 *
 * Three shapes of file are in circulation and all three are read:
 *   - the whole document: `{editorVersion, docType, schematics:[{dataStr}]}`
 *   - a single exported sheet: `{docType, dataStr}`
 *   - the bare payload: `{head, canvas, shape}`
 *
 * `dataStr` is an OBJECT in the 6.5.x export on hand and a JSON STRING in the
 * 6.2.x one; both occur in the wild and the brief for this work mentioned
 * only the first. Parsed either way.
 */
export function easyEdaSheets(doc) {
  const sheets = [];
  const payload = (ds) => {
    if (!ds) return null;
    if (typeof ds === 'string') { try { return JSON.parse(ds); } catch { return null; } }
    return typeof ds === 'object' ? ds : null;
  };
  const push = (title, ds) => {
    const p = payload(ds);
    if (p && Array.isArray(p.shape)) sheets.push({ title: title || '', shape: p.shape });
  };
  if (Array.isArray(doc?.schematics)) {
    for (const s of doc.schematics) push(s?.title, s?.dataStr);
  } else if (doc?.dataStr) {
    push(doc.title, doc.dataStr);
  } else if (Array.isArray(doc?.shape)) {
    sheets.push({ title: doc.title || '', shape: doc.shape });
  }
  return sheets;
}

/**
 * Pull the components out of one sheet's shape array.
 *
 * @returns {Array<{ref, value, descriptor, spicePre, package, pins, rot, mirror}>}
 */
export function readComponents(shape) {
  const out = [];
  for (const s of shape) {
    if (!String(s).startsWith('LIB' + '~')) continue;
    const subs = String(s).split(SUB);
    const head = subs[0].split('~');
    const attrs = parseLibAttrs(head[3]);
    let ref = ''; let value = '';
    const pins = [];
    for (let i = 1; i < subs.length; i++) {
      const sub = subs[i];
      if (sub.startsWith('T~')) {
        const f = sub.split('~');
        if (f[1] === 'P') ref = textOf(f);
        else if (f[1] === 'N') value = textOf(f);
      } else if (sub.startsWith('P~')) {
        const f = sub.split('^^')[0].split('~');
        const nameSec = sub.split('^^')[3];
        pins.push({
          num: f[3] ?? '',
          x: Number(f[4]), y: Number(f[5]),
          name: nameSec ? (nameSec.split('~')[4] ?? '') : '',
        });
      }
    }
    const mp = attrs['Manufacturer Part'];
    out.push({
      ref, value,
      descriptor: (mp && mp.trim()) || value || attrs.package || '',
      spicePre: attrs.spicePre || '',
      package: attrs.package || '',
      pins: pins.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y)),
      rot: head[4] || '0',
      mirror: head[5] || '0',
    });
  }
  return out;
}

/**
 * Symbols that exist so a human can read the sheet.
 *
 * A sheet frame is a LIB with spicePre `.`, package `NONE` and no pins at
 * all. Counting it as an unmapped component would overstate the loss and bury
 * the parts that genuinely need a rule -- same policy as eagle.js and
 * kicad-common.js. Pin count is the real test: nothing with zero pins can
 * take part in a net.
 */
function isArtifact(c) {
  if (c.pins.length === 0) return true;
  return c.spicePre === '.' || /^(FRAME|LOGO|FIDUCIAL|MOUNTING)/i.test(c.package || '');
}

// ── the importer ───────────────────────────────────────────────────

/**
 * Import an EasyEDA Standard schematic.
 *
 * @param {string} text  Raw .json content
 * @returns {{parts: Array, wires: Array, warnings: string[], unmapped: Array, ignored: Array}}
 */
export function importEasyEda(text) {
  const warnings = [];
  const unmapped = [];
  const ignored = [];
  const parts = [];

  let doc;
  try { doc = JSON.parse(text); } catch (e) {
    return { parts, wires: [], unmapped, ignored,
      warnings: [`Not an EasyEDA file: the JSON did not parse (${e.message})`] };
  }
  // docType 3 is a PCB and 4 a footprint. Same class of mistake as handing
  // eagle.js a .brd: the copper is there and the netlist is not.
  const dt = String(doc?.docType ?? '');
  if (dt === '3' || dt === '4') {
    return { parts, wires: [], unmapped, ignored,
      warnings: ['This is an EasyEDA PCB/footprint document (docType ' + dt + '). '
        + 'Export the SCHEMATIC (docType 5) -- a board carries copper and footprints, '
        + 'the schematic carries the netlist.'] };
  }

  const sheets = easyEdaSheets(doc);
  if (!sheets.length) {
    return { parts, wires: [], unmapped, ignored,
      warnings: ['No EasyEDA sheet found: the document has no dataStr with a shape array'] };
  }

  const used = new Set();
  const byNet = new Map();
  const rails = new Map();            // rail name -> the part id that carries it
  let attached = 0; let floating = 0; let pinCount = 0;
  let buses = 0; let busEntries = 0; let labels = 0; let mirrored = 0;

  sheets.forEach((sheet, sheetIx) => {
    const net = new NetSolver();
    // Net names are scoped to the SHEET. Merging them across sheets would
    // invent connections between two boards that merely reused a label,
    // which is the failure this codebase prefers to lose nets over; see the
    // bus note in kicad-sch.js. The prefix keeps them apart.
    const scope = (n) => `s${sheetIx}:${n}`;
    const railNames = new Set();

    // -- geometry first, so every pin has something to land on ------
    for (const raw of sheet.shape) {
      const s = String(raw);
      const f = s.split('~');
      switch (f[0]) {
        case 'W': {                                  // a wire polyline
          const pts = polyline(f[1]);
          for (let i = 0; i + 1 < pts.length; i++) {
            net.addSegment(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
          }
          break;
        }
        case 'B':                                    // a BUS. Never wire.
          buses++;
          break;
        case 'BE': {                                 // bus entry: IS wire
          busEntries++;
          const x1 = Number(f[2]); const y1 = Number(f[3]);
          const x2 = Number(f[4]); const y2 = Number(f[5]);
          if ([x1, y1, x2, y2].every(Number.isFinite)) net.addSegment(x1, y1, x2, y2);
          break;
        }
        case 'J':                                    // junction dot
          if (Number.isFinite(Number(f[1]))) net.addPoint(Number(f[1]), Number(f[2]));
          break;
        case 'N': {                                  // net label
          const name = f[5];
          if (name && Number.isFinite(Number(f[1]))) {
            labels++;
            net.addName(Number(f[1]), Number(f[2]), scope(name));
          }
          break;
        }
        case 'F': {                                  // power flag / net port
          const secs = s.split('^^');
          const name = secs[2] ? secs[2].split('~')[0] : '';
          const x = Number(f[2]); const y = Number(f[3]);
          if (name && Number.isFinite(x)) {
            labels++;
            net.addName(x, y, scope(name));
            // GND and VCC flags are not just labels: they are the board's
            // reference and supply. One part per distinct rail NAME, not one
            // per flag -- a sheet with forty GND symbols wants one ground.
            if (/^(GND|VCC|VDD|VSS|AGND|DGND|\+?\d+(\.\d+)?V\d*|V\+|VBUS|VBAT)$/i.test(name)) {
              railNames.add(name);
            }
          }
          break;
        }
        default:
          break;
      }
    }

    for (const c of readComponents(sheet.shape)) {
      for (const p of c.pins) net.addPoint(p.x, p.y);
    }
    net.solve();

    for (const name of railNames) {
      const kind = classifyPower(name);
      const id = makeId(name.replace(/[^A-Za-z0-9_]/g, '') || kind, used);
      parts.push({ id, kind, params: { _value: name }, x: 0, y: 0 });
      rails.set(scope(name), id);
      const netId = net.netOfName(scope(name));
      if (!byNet.has(netId)) byNet.set(netId, []);
      byNet.get(netId).push({ part: id, terminal: kind });
    }

    // -- components -------------------------------------------------
    for (const c of readComponents(sheet.shape)) {
      if (isArtifact(c)) {
        ignored.push({ ref: c.ref || '?', libsource: c.package || c.descriptor || '?' });
        continue;
      }
      if (c.mirror && c.mirror !== '0') mirrored++;
      const hit = mapEasyEdaPart(c);
      if (!hit) {
        unmapped.push({ ref: c.ref || '?', value: c.value || '',
          libsource: `${c.spicePre || '?'}/${c.descriptor || c.package || '?'}` });
        warnings.push(`Unmapped component: ${c.ref || '?'} `
          + `(spicePre ${c.spicePre || '?'}, ${c.descriptor || c.package || '?'}`
          + `${c.value ? ` = ${c.value}` : ''})`);
        continue;
      }
      if (hit._note) warnings.push(`${c.ref || '?'}: ${hit._note}`);

      const params = { ...hit.params };
      if (c.value) params._value = c.value;
      const id = makeId(c.ref || c.spicePre || 'U', used);
      parts.push({ id, kind: hit.kind, params, x: 0, y: 0 });

      const allow = hit.terminals ? new Set(hit.terminals) : null;
      for (const p of c.pins) {
        // A pin NUMBER may be "P1" rather than "1"; headerOf() carries both
        // spellings, and the digits are the fallback for anything else.
        const digits = /(\d+)/.exec(p.num)?.[1];
        const term = terminalFor(hit, p.num, p.name, undefined)
          ?? (digits ? hit.pins?.[digits] : undefined);
        if (!term) continue;
        if (allow && !allow.has(term)) continue;
        pinCount++;
        const netId = net.netAt(p.x, p.y);
        if (!byNet.has(netId)) byNet.set(netId, []);
        byNet.get(netId).push({ part: id, terminal: term });
        if (net.liveRoots().has(netId)) attached++; else floating++;
      }
    }
  });

  const { wires, nets } = wiresFromNets(byNet);

  if (sheets.length > 1) {
    warnings.push(`${sheets.length} sheets read; net names are NOT merged across sheets `
      + '-- a cross-sheet rail joined only by its label will import as two nets, which '
      + 'loses a connection rather than inventing one');
  }
  if (buses) {
    warnings.push(`${buses} bus polyline(s) ignored -- bus membership is by name expansion. `
      + `The ${busEntries} bus entr(y/ies) ARE followed, so a labelled bus connection still `
      + 'resolves through its net label.');
  }
  if (mirrored) {
    warnings.push(`${mirrored} component(s) carry a mirror flag; EasyEDA writes pin `
      + 'coordinates already transformed, so no mirror was applied. Check the geometry '
      + 'rate below if their nets look wrong.');
  }
  if (ignored.length) {
    warnings.push(`${ignored.length} drawing artifact(s) skipped (sheet frames, logos, `
      + 'pinless symbols) -- not components');
  }
  if (parts.length && !wires.length) {
    warnings.push('No connections resolved: every pin came out floating. Either the sheet '
      + 'really is unwired, or its pin coordinates are not in sheet space as this importer '
      + 'assumes.');
  }
  if (!parts.length) warnings.push('No mappable components found -- is this an EasyEDA schematic (docType 5)?');

  warnings.push(`geometry: ${attached}/${pinCount} mapped pins landed on a net `
    + `(${nets} nets, ${labels} labels)`);
  if (floating) warnings.push(`${floating} pin(s) touch no wire, junction or label`);

  return { parts, wires, unmapped, ignored, warnings };
}

/**
 * The net partition over EasyEDA's own (designator, pin-number) nodes.
 *
 * The same shape a netlist carries, and independent of our kind mapping: an
 * unmapped CPU still contributes its pins here. That is the point -- it is
 * the only oracle for the geometry that is not this importer's rule table
 * agreeing with itself.
 *
 * @param {string} text
 * @returns {string[]} one sorted "REF/PIN|REF/PIN|..." string per net with
 *                     two or more nodes, itself sorted.
 */
export function easyEdaPartition(text) {
  let doc;
  try { doc = JSON.parse(text); } catch { return []; }
  const out = [];
  easyEdaSheets(doc).forEach((sheet, sheetIx) => {
    const net = new NetSolver();
    const scope = (n) => `s${sheetIx}:${n}`;
    for (const raw of sheet.shape) {
      const s = String(raw); const f = s.split('~');
      if (f[0] === 'W') {
        const pts = polyline(f[1]);
        for (let i = 0; i + 1 < pts.length; i++) net.addSegment(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
      } else if (f[0] === 'BE') {
        const n = [f[2], f[3], f[4], f[5]].map(Number);
        if (n.every(Number.isFinite)) net.addSegment(n[0], n[1], n[2], n[3]);
      } else if (f[0] === 'J') {
        if (Number.isFinite(Number(f[1]))) net.addPoint(Number(f[1]), Number(f[2]));
      } else if (f[0] === 'N') {
        if (f[5] && Number.isFinite(Number(f[1]))) net.addName(Number(f[1]), Number(f[2]), scope(f[5]));
      } else if (f[0] === 'F') {
        const secs = s.split('^^');
        const name = secs[2] ? secs[2].split('~')[0] : '';
        if (name && Number.isFinite(Number(f[2]))) net.addName(Number(f[2]), Number(f[3]), scope(name));
      }
    }
    const comps = readComponents(sheet.shape);
    for (const c of comps) for (const p of c.pins) net.addPoint(p.x, p.y);
    net.solve();
    const byNet = new Map();
    for (const c of comps) {
      if (!c.ref) continue;
      for (const p of c.pins) {
        const id = net.netAt(p.x, p.y);
        if (!byNet.has(id)) byNet.set(id, new Set());
        byNet.get(id).add(`${c.ref}/${p.num}`);
      }
    }
    for (const s of byNet.values()) if (s.size > 1) out.push([...s].sort().join('|'));
  });
  return out.sort();
}
