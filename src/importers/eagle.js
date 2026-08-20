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
const DIODE_PINS = { A: 'anode', C: 'cathode', K: 'cathode', '1': 'anode', '2': 'cathode', 'P$1': 'anode', 'P$2': 'cathode' };
const SUPPLY_PINS = { '+': 'pos', '-': 'neg', '+VE': 'pos', '-VE': 'neg', 'P$1': 'pos', 'P$2': 'neg', '1': 'pos', '2': 'neg' };

const RULES = [
  // power symbols — one terminal, and EAGLE draws one per connection point
  // The symbol's PIN name is not its deviceset name: a VCC symbol may carry a
  // pin called VIN, and a supply symbol's pins are +VE/-VE in some libraries.
  [/^(GND|AGND|DGND|0V)$/i,            () => ({ kind: 'gnd',
    pins: { GND: 'gnd', VSS: 'gnd', '0V': 'gnd', '1': 'gnd', 'P$1': 'gnd' } })],
  [/^(VCC|VDD|\+5V|V\+|VIN|VBUS)$/i,   () => ({ kind: 'vcc',
    pins: { VCC: 'vcc', VDD: 'vcc', VIN: 'vcc', VBUS: 'vcc', 'V+': 'vcc', '+V': 'vcc', '1': 'vcc', 'P$1': 'vcc' } })],
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
  [/^EEPROM[-_]?I2C|^24[CL]C?\d/i,         () => ({ kind: 'at24c02',  byName: true })],
  [/^PINHD[-_]?1X(\d+)/i,                  (v, ds) => ({
    kind: 'header',
    params: { pins: Number(/1X(\d+)/i.exec(ds)[1]) },
    pins: Object.fromEntries(Array.from({ length: Number(/1X(\d+)/i.exec(ds)[1]) },
      (_, i) => [String(i + 1), `p${i + 1}`])),
  })],
  // 74-series: the deviceset carries the number, e.g. 74*00N / 74HC595N
  [/^74\w*?(\d{2,3})[A-Z]?$/i,         (v, ds) => {
    const n = /^74\w*?(\d{2,3})/i.exec(ds)[1];
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
  const parts = [];
  const wires = [];

  if (!/<eagle\b/.test(text)) {
    return { parts, wires, unmapped, warnings: ['Not an EAGLE file: no <eagle> root element'] };
  }
  if (/<board\b/.test(text) && !/<schematic\b/.test(text)) {
    return {
      parts, wires, unmapped,
      warnings: ['This is an EAGLE .brd (board layout). Import the matching .sch — '
        + 'the schematic carries the netlist; a board carries copper and footprints.'],
    };
  }

  // ── parts ────────────────────────────────────────────────────────
  const pinMaps = new Map();          // part name -> EAGLE pin -> our terminal
  const byName = new Set();           // parts whose pins are named, not numbered
  for (const m of text.matchAll(/<part\s+([^>]*?)\/?>/g)) {
    const a = attrs(m[1]);
    if (!a.name || !a.deviceset) continue;
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
      const term = map[a.pin] ?? (byName.has(a.part) ? normalizeEaglePin(a.pin) : undefined);
      if (!term) {
        warnings.push(`Unknown pin "${a.pin}" on ${a.part} in net "${netName}"`);
        continue;
      }
      refs.push({ part: a.part, terminal: term });
    }
    for (let i = 1; i < refs.length; i++) {
      wires.push({
        from: refs[0].part, fromTerminal: refs[0].terminal,
        to: refs[i].part, toTerminal: refs[i].terminal,
      });
    }
  }

  if (!parts.length) warnings.push('No mappable components found — is this an EAGLE 6+ schematic?');
  return { parts, wires, warnings, unmapped };
}
