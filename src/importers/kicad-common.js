/**
 * Shared machinery for the two KiCad SCHEMATIC importers.
 *
 * `kicad-sch.js` (v6+ s-expression) and `kicad-legacy.js` (v4/v5 EESchema)
 * disagree about syntax and about coordinates, and about nothing else: both
 * state connectivity GEOMETRICALLY, both name their parts through a library
 * reference of the form `Library:Symbol`, and both let a label override the
 * geometry. So the geometry solver and the symbol vocabulary live here and the
 * two front ends only parse.
 *
 * This is the structural difference from `eagle.js`. EAGLE writes
 * `<pinref part="R1" pin="1"/>` inside a `<net>` -- the netlist is IN the
 * file. KiCad writes line segments and symbol placements and expects the
 * reader to work out which pin touches which wire. Get that wrong and the
 * import looks perfect: every part present, every symbol drawn, and
 * connections silently missing. Which is why test/kicad-import.test.js checks
 * NET PARTITIONS against hand-computed answers rather than checking that
 * parsing succeeded.
 *
 * Format facts (what a token means, where a pin's origin sits, how the
 * orientation matrix is applied) came from the KiCad file-format
 * documentation and from the MIT-licensed schema definitions in KiCadFiles;
 * see THIRD-PARTY.md. The code is ours.
 *
 * @module
 */

import { parseEagleValue, normalizeEaglePin } from './eagle.js';

// -- geometry -------------------------------------------------------

/** Coordinates are mm (v6) or 1/1000 inch (legacy); 3 decimals is exact for both. */
const Q = 1000;
const q = (v) => Math.round(v * Q) / Q;
export const ptKey = (x, y) => `${q(x)},${q(y)}`;

/**
 * Connectivity solver: line segments in, electrical nets out.
 *
 * The rules it implements, which are KiCad's:
 *
 *   - two wires connect where their ENDPOINTS coincide;
 *   - a wire endpoint, a pin or a label lying ON another wire's span is a
 *     T-connection and DOES connect (eeschema drops a junction dot there);
 *   - two wires merely CROSSING do not connect -- unless a junction says so,
 *     and a junction is itself a registered point, so the same rule covers it;
 *   - a label, a global label and a power symbol's pin all connect by NAME,
 *     across any distance and with no wire at all. Power rails are almost
 *     never drawn as wires, so a solver without this finds a circuit with no
 *     supply and every rail floating.
 *
 * Named merging goes through synthetic nodes (`name:VCC`), so it is the same
 * union-find and needs no second pass.
 */
export class NetSolver {
  constructor() {
    this.parent = new Map();
    this.segments = [];          // {x1,y1,x2,y2}
    this.points = new Set();     // keys of every point that may T onto a wire
    this.names = new Set();      // every net NAME the sheet mentions
  }

  _find(a) {
    if (!this.parent.has(a)) this.parent.set(a, a);
    let r = a;
    while (this.parent.get(r) !== r) r = this.parent.get(r);
    while (this.parent.get(a) !== r) { const n = this.parent.get(a); this.parent.set(a, r); a = n; }
    return r;
  }

  union(a, b) {
    const ra = this._find(a); const rb = this._find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }

  /** A wire segment. Its endpoints are registered points in their own right. */
  addSegment(x1, y1, x2, y2) {
    this.segments.push({ x1: q(x1), y1: q(y1), x2: q(x2), y2: q(y2) });
    this.addPoint(x1, y1); this.addPoint(x2, y2);
    this.union(ptKey(x1, y1), ptKey(x2, y2));
  }

  /** A point that participates in connectivity: pin, junction, label anchor. */
  addPoint(x, y) { const k = ptKey(x, y); this.points.add(k); this._find(k); return k; }

  /** Tie a point to a NAME, so every other point with that name joins it. */
  addName(x, y, name) {
    if (!name) return;
    this.names.add(name);
    this.union(this.addPoint(x, y), 'name:' + name);
  }

  /**
   * Fold every T-connection in, then freeze.
   *
   * Indexed by row and column because KiCad wires are overwhelmingly
   * axis-aligned: without it this is segments x points, and the 1.1 MB
   * tinytapeout board makes that eight million collinearity tests.
   */
  solve() {
    const byX = new Map(); const byY = new Map();
    const all = [];
    for (const k of this.points) {
      const c = k.indexOf(',');
      const p = { k, x: Number(k.slice(0, c)), y: Number(k.slice(c + 1)) };
      all.push(p);
      if (!byX.has(p.x)) byX.set(p.x, []);
      byX.get(p.x).push(p);
      if (!byY.has(p.y)) byY.set(p.y, []);
      byY.get(p.y).push(p);
    }
    const between = (v, a, b) => v > Math.min(a, b) && v < Math.max(a, b);
    for (const s of this.segments) {
      const endA = ptKey(s.x1, s.y1);
      let cands;
      if (s.y1 === s.y2) cands = (byY.get(s.y1) || []).filter((p) => between(p.x, s.x1, s.x2));
      else if (s.x1 === s.x2) cands = (byX.get(s.x1) || []).filter((p) => between(p.y, s.y1, s.y2));
      else {
        // Diagonal wires are rare and no index covers them; full scan.
        const dx = s.x2 - s.x1; const dy = s.y2 - s.y1;
        cands = all.filter((p) => Math.abs((p.x - s.x1) * dy - (p.y - s.y1) * dx) < 1e-3
          && between(p.x, s.x1, s.x2) && between(p.y, s.y1, s.y2));
      }
      for (const p of cands) this.union(p.k, endA);
    }
    return this;
  }

  /** Canonical net id for a point, or null if it was never registered. */
  netAt(x, y) {
    const k = ptKey(x, y);
    return this.points.has(k) ? this._find(k) : null;
  }

  /** Net id for a NAME node (power rails, labels). */
  netOfName(name) { return this._find('name:' + name); }

  /**
   * Roots of every net the author actually drew or named.
   *
   * A pin outside this set touches no wire, no junction and no label, and is
   * floating. Names belong in it: a rail joined only by its +3V3 symbol is
   * connected, and counting it as floating made a correct import look like a
   * half-failed one.
   */
  liveRoots() {
    const live = new Set();
    for (const n of this.names) live.add(this.netOfName(n));
    return live;
  }
}

/**
 * Place a library pin in schematic coordinates.
 *
 * Two things bite here. The library stores Y pointing UP and the sheet stores
 * it pointing DOWN, so the local point is flipped before anything else. And a
 * rotation of 90 degrees in the file is 90 degrees COUNTER-clockwise as the
 * user sees it, which in a Y-down frame is a clockwise matrix.
 *
 * Both were settled by measurement, not by reading: across the 81 .kicad_sch
 * files on hand, the convention below puts 74% of all pins exactly on a wire
 * endpoint, junction or label anchor, and 92% of the pins of rotated symbols;
 * reversing the rotation sense drops the rotated figure to 88%, and swapping
 * the mirror axis drops mirrored symbols from 90% to 58%. The remainder are
 * genuinely unconnected pins -- an MCU's unused GPIOs.
 *
 * Mirror is applied in the symbol's own frame, before rotation. The corpus
 * cannot prove that ordering: every mirrored-AND-rotated symbol in it is a
 * two-pin passive, which is symmetric under the difference.
 *
 * @param {number} px  pin X in library coordinates
 * @param {number} py  pin Y in library coordinates (Y up)
 * @param {{x:number,y:number,rot:number,mirror:?string}} at  the placement
 * @returns {[number, number]} sheet coordinates
 */
export function placePin(px, py, at) {
  let u = px; let v = -py;
  if (at.mirror === 'y') u = -u;
  else if (at.mirror === 'x') v = -v;
  const t = ((at.rot || 0) % 360) * Math.PI / 180;
  const c = Math.cos(t); const s = -Math.sin(t);
  return [at.x + (u * c - v * s), at.y + (u * s + v * c)];
}

// -- the symbol vocabulary ------------------------------------------

/**
 * Symbols that exist so a human can read the sheet. A mounting hole, a
 * fiducial, a logo, a sheet frame or a PWR_FLAG has no electrical model and
 * never should have one, so counting them as "unmapped" overstates the loss
 * and buries the parts that genuinely need a rule. Same policy as eagle.js.
 */
export const NON_ELECTRICAL =
  /^(MountingHole|Mounting_Hole|Fiducial|Logo|PWR_FLAG|NetTie|DOCFIELD|Graphic|SolderJumper)/i;

const PASSIVE2 = { 1: 'a', 2: 'b' };
const DIODE_PINS = { 1: 'cathode', 2: 'anode', K: 'cathode', A: 'anode' };
const BJT_PINS = { 1: 'base', 2: 'collector', 3: 'emitter', B: 'base', C: 'collector', E: 'emitter' };
const FET_PINS = { 1: 'gate', 2: 'source', 3: 'drain', G: 'gate', S: 'source', D: 'drain' };

/**
 * The engine's header model has EIGHT terminals and no parameter widens it,
 * so a 12-pin connector can be drawn twelve-wide and wired only eight-wide.
 * The pin COUNT still goes in params (the symbol and the BOM want it); the
 * pin MAP stops at what the engine can actually accept, and says so. Emitting
 * p9 instead produces a wire the board quietly ignores.
 */
const HEADER_TERMINALS = 8;

// ONE map for every three-pin regulator. There used to be two -- a `vin/vout`
// one for lm7805 and an `in/out` one for vreg -- because the catalog sidecars
// disagreed with each other about the same physical pin. The engine calls them
// in/out/gnd for all three, and the sidecars now agree, so the second spelling
// is gone. It was not harmless while it lasted: a wire to `vin` is accepted by
// the importer and then ignored by the board, which is a connection that
// exists on screen and not in the simulation.
const VREG_PINS = { VI: 'in', VO: 'out', GND: 'gnd', IN: 'in', OUT: 'out',
  VIN: 'in', VOUT: 'out', EN: 'in', 1: 'in', 2: 'gnd', 3: 'out' };

const BJT_ORDER = { B: 'base', C: 'collector', E: 'emitter' };
const FET_ORDER = { G: 'gate', D: 'drain', S: 'source' };

/**
 * Read a pin order out of a KiCad symbol name: `Q_NMOS_GDS` says pin 1 is the
 * gate, pin 2 the drain, pin 3 the source. Returns null when the name carries
 * no such suffix, so the caller falls back to its default table.
 */
function orderedPins(name, letters) {
  const keys = Object.keys(letters).join('');
  const m = new RegExp(`_([${keys}]{3})(_|$)`).exec(String(name).toUpperCase());
  if (!m) return null;
  const seq = m[1];
  if (new Set(seq).size !== 3) return null;
  const pins = {};
  for (let i = 0; i < 3; i++) { pins[String(i + 1)] = letters[seq[i]]; pins[seq[i]] = letters[seq[i]]; }
  return pins;
}

const headerOf = (n, why) => ({
  kind: 'header',
  params: { pins: n },
  pins: Object.fromEntries(Array.from({ length: Math.min(n, HEADER_TERMINALS) },
    (_, i) => [String(i + 1), `p${i + 1}`])),
  _note: n > HEADER_TERMINALS
    ? `${why || `imported as a ${n}-pin header`}; only the first ${HEADER_TERMINALS} pins can be wired -- the engine's header model has ${HEADER_TERMINALS} terminals`
    : why,
});

/**
 * Name to engine kind. Matched against the symbol name only (the part after
 * the colon in `Device:R`), because the library half is whatever the project
 * called its local copy: the same resistor appears as `Device:R`,
 * `pic_programmer:R`, `kit-dev-coldfire-xilinx_5213:R` and `New_Library:R`
 * across the corpus.
 *
 * Ordered; first match wins. Anchored deliberately -- an unanchored `^R` rule
 * turns `RP2040` into a resistor and `^D` turns a `DB9` connector into a
 * diode. Both happened while this table was first drafted by reusing
 * eagle.js's RULES, whose patterns are tuned to EAGLE deviceset names and are
 * not safe here.
 */
export const KICAD_RULES = [
  // -- power rails -------------------------------------------------
  // Reached both by name and by the (power) flag, see classifyPower().
  [/^(GND|GNDA|GNDD|GNDS|GNDPWR|GNDREF|AGND|DGND|VSS|0V|Earth|Earth_Protective|Earth_Clean)$/i,
    () => ({ kind: 'gnd', anyPin: 'gnd' })],
  [/^(VCC|VDD|VDDA|VBUS|VBAT|VAA|VPP|VEE|VMEM|VIN|VDRIVE)$/i, () => ({ kind: 'vcc', anyPin: 'vcc' })],
  // Rails named after their VOLTAGE: +3V3, +5V, +1V8, +3.3V, +12V, P3V3.
  [/^[+-]?P?\d+(\.\d+)?V\d*$/i, () => ({ kind: 'vcc', anyPin: 'vcc' })],
  // SPICE-flavoured symbol libraries: a real source and a plain capacitor.
  [/^VSOURCE$|^VDC$|^VSRC$/i, () => ({ kind: 'vsource', pins: { 1: 'pos', 2: 'neg', '+': 'pos', '-': 'neg' } })],
  [/^AC$/i, () => ({ kind: 'vcc', anyPin: 'vcc',
    _note: 'AC supply symbol imported as a DC rail -- the engine has no AC source' })],

  // -- passives ----------------------------------------------------
  [/^R_Potentiometer(_Small|_Trim)?$|^POT$|^Potentiometer$/i,
    () => ({ kind: 'potentiometer', pins: { 1: 'a', 2: 'wiper', 3: 'b' } })],
  [/^R_(Network|Pack)\d*/i,
    (v, n) => headerOf(8, `${n} resistor network imported as a header -- the engine has no array model`)],
  [/^R(_(Small|US|Variable|Photo)(_US)?)?$/i,
    (v) => ({ kind: 'resistor', params: { ohms: parseEagleValue(v) ?? 1000 }, pins: PASSIVE2 })],
  // Footprint-named parts from BOM-driven libraries: R1206_10K_1%_0.25W_100PPM.
  [/^R\d{3,4}[_-]/i, (v, n) => ({ kind: 'resistor',
    params: { ohms: parseEagleValue(v) ?? parseEagleValue(n.split('_')[1]) ?? 1000 }, pins: PASSIVE2 })],
  [/^C(_(Polarized|Polarised)(_Small|_US)?|P(_Small)?)$/i,
    (v) => ({ kind: 'polarized_cap', params: { farads: parseEagleValue(v) ?? 1e-6 },
      pins: { 1: 'pos', 2: 'neg' } })],
  [/^C(_(Small|US))?$/i,
    (v) => ({ kind: 'capacitor', params: { farads: parseEagleValue(v) ?? 1e-7 }, pins: PASSIVE2 })],
  // BOM-driven libraries name a part after its footprint AND its value:
  // CC1206_100NF_50V_10%_X7R, CTEB_2.2UF_35V. The value in the name is the
  // only value such a symbol carries.
  [/^C[A-Z]{1,3}\d{0,4}_[\d.]+\s*[UNPM]F/i, (v, n) => ({ kind: 'capacitor',
    params: { farads: parseEagleValue(v) ?? parseEagleValue(n.split('_')[1]) ?? 1e-7 }, pins: PASSIVE2 })],
  [/^C[CTE]{1,2}\d{3,4}[_-]/i, (v, n) => ({ kind: 'capacitor',
    params: { farads: parseEagleValue(v) ?? parseEagleValue(n.split('_')[1]) ?? 1e-7 }, pins: PASSIVE2 })],
  [/^L(_(Small|Core_Ferrite|Core_Iron))?$|^INDUCTOR$|^Ferrite|^Choke/i,
    (v) => ({ kind: 'inductor', params: { henries: parseEagleValue(v) ?? 1e-3 }, pins: PASSIVE2 })],
  [/^(Poly)?Fuse(_Small)?$|^Polyfuse/i, () => ({ kind: 'fuse', pins: PASSIVE2 })],
  [/^Crystal|^Resonator|^ECS-\d|^XTAL/i, () => ({ kind: 'crystal', pins: PASSIVE2,
    _note: 'crystal has no engine model; imported so the schematic is complete' })],

  // -- discretes ---------------------------------------------------
  [/^LED(_Small|_ALT|_Dual|_RCGB)?$|^LED_/i, () => ({ kind: 'led', pins: DIODE_PINS })],
  [/^D_Zener|^Zener|^BZX|^1N47\d\d/i, () => ({ kind: 'zener', pins: DIODE_PINS })],
  [/^D(_(Small|Schottky|TVS|Photo|Bridge|ALT)\w*)?$|^1N\d{4}|^ESD5Z|^BAT\d{2}|^SS1[24]/i,
    () => ({ kind: 'diode', pins: DIODE_PINS })],
  // KiCad spells the pin ORDER into the symbol name: Q_NPN_BCE has base on 1
  // and collector on 2, Q_NPN_BEC has them the other way round, and the same
  // for Q_NMOS_GDS against Q_NMOS_GSD. A fixed table is right for one variant
  // and silently wrong for the other -- which swaps a transistor's drain and
  // source, a circuit that still draws and cannot work.
  [/^Q?_?NPN|^BC(1\d\d|2\d\d|3[0-4]\d|54\d|550)|^2N(2222|3904|5551)|^S8050|^MMBT39\d\d/i,
    (v, n) => ({ kind: 'npn', pins: orderedPins(n, BJT_ORDER) || BJT_PINS })],
  [/^Q?_?PNP|^BC(30[5-9]|32\d|55[6-9]|560)|^2N(2907|3906)|^S8550/i,
    (v, n) => ({ kind: 'pnp', pins: orderedPins(n, BJT_ORDER) || BJT_PINS })],
  [/^Q?_?NMOS|^BSS138|^IRF[ZLR]?\d|^AO\d{4}|^2N7000/i,
    (v, n) => ({ kind: 'nmos', pins: orderedPins(n, FET_ORDER) || FET_PINS })],
  [/^Q?_?PMOS|^AO32\d\d|^IRF9/i,
    (v, n) => ({ kind: 'pmos', pins: orderedPins(n, FET_ORDER) || FET_PINS })],
  [/^TIP12\d|^Darlington/i, () => ({ kind: 'tip120', pins: BJT_PINS })],
  // Power BJTs whose part number says nothing about polarity: BD24x is the
  // NPN half of a complementary pair (BD25x is the PNP).
  [/^BD1\d\d$|^BD24\d|^TIP3\d/i, () => ({ kind: 'npn', pins: BJT_PINS })],
  [/^BD25\d|^TIP3[24]\d/i, () => ({ kind: 'pnp', pins: BJT_PINS })],

  // -- switches ----------------------------------------------------
  [/^SW_?Push|^SW_SPST|^SW_MEC|^Tact|^B3F|^KMR\d/i, () => ({ kind: 'button', pins: PASSIVE2 })],
  // A DIP switch's terminals are s<i>_a / s<i>_b, not its pin NUMBERS, and
  // the engine models four positions. An 8-way switch draws eight and wires
  // four; emitting "1".."16" wired nothing at all.
  [/^SW_DIP_x(\d+)/i, (v, n) => {
    const w = Number(/x(\d+)/i.exec(n)[1]);
    const modelled = Math.min(w, 4);
    const pins = {};
    for (let i = 0; i < modelled; i++) { pins[String(i + 1)] = `s${i}_a`; pins[String(w + i + 1)] = `s${i}_b`; }
    return { kind: 'dip_switch', params: { positions: w }, pins,
      _note: w > modelled ? `${n} has ${w} positions; the engine models ${modelled}` : null };
  }],
  // KiCad's own SPDT/DPDT symbols put the COMMON on pin 2: the library draws
  // A(1) and C(3) as the two throws on one side and B(2) alone on the other.
  // Checked against Switch_SW_DPDT_x2 in a real cache library rather than
  // assumed from the pin numbering, which reads as if 1 were the common.
  [/^SW_(SPDT|DPDT|DP3T)/i, () => ({ kind: 'slide_switch',
    pins: { 1: 'a', 2: 'com', 3: 'b', A: 'a', B: 'com', C: 'b' } })],
  [/^SW_(Rotary|Lever|Toggle)/i, () => ({ kind: 'slide_switch' })],
  [/^JUMPER_TRIPLE$|^Jumper_3/i, (v, n) => headerOf(3, `${n} imported as a 3-pin header`)],
  [/^Jumper(_\w+)?$|^JUMPER$/i, (v, n) => headerOf(2, `${n} imported as a 2-pin header`)],

  // -- regulators --------------------------------------------------
  // Part number BEFORE the generic rule, and never a new kind name: the
  // engine already models lm7805, ams1117_33 and a generic vreg. Inventing a
  // `regulator` kind here is the mistake eagle.js's comments record.
  // KiCad names a three-terminal regulator's pins VI / VO / GND.
  [/^(LM|MC|KA|UA)?78[LM]?05/i, () => ({ kind: 'lm7805', pins: VREG_PINS })],
  // lm7809 and lm7812 are registered engine kinds with NO terminal geometry
  // in this repo -- no sidecar, so terminalsForKind falls back to a generic
  // two-pin shape. Naming vin/gnd/vout would emit wires the board accepts and
  // ignores, so the part imports for the schematic and says why.
  [/^(LM|MC|KA|UA)?78[LM]?09/i, (v, n) => ({ kind: 'lm7809',
    _note: `${n} imported for the schematic only -- lm7809 has no terminal geometry here yet` })],
  [/^(LM|MC|KA|UA)?78[LM]?1[25]/i, (v, n) => ({ kind: 'lm7812',
    _note: `${n} imported for the schematic only -- lm7812 has no terminal geometry here yet` })],
  [/^(AMS|AZ|LM|LD)1117[-_]?3\.?3/i, () => ({ kind: 'ams1117_33' })],
  [/^(AMS|AZ|LM|LD)1117[-_]?5\.?0/i, () => ({ kind: 'ams1117_50' })],
  [/^(AMS|AZ|LM|LD)1117/i, () => ({ kind: 'ams1117_33',
    _note: 'AMS1117 with no voltage in the name imported as the 3.3 V version' })],
  [/^(LM|MC|KA|UA)?79[LM]?\d\d/i, () => ({ kind: 'vreg',
    _note: 'negative regulator imported as a generic vreg -- the engine models positive rails only' })],
  [/^(LP|AP|MCP1|TPS|XC6|NCP|MIC|HT7|AZ11|LD11)\d{2,4}[A-Z]?[-_]?/i,
    (v, n) => ({ kind: 'vreg', pins: VREG_PINS,
      _note: `${n} imported as a generic vreg; check the pinout` })],

  // -- analogue and logic ICs --------------------------------------
  // opamp's engine model is the ideal three-terminal one, so the supply pins
  // and the second half of a dual package have nowhere to go. Emitting them
  // anyway does not warn, it REJECTS THE WHOLE NETLIST -- see eagle.js.
  // The engine's opamp is the ideal three-terminal one: inp, inn, out. Its
  // supply pins and the second half of a dual package have nowhere to go.
  // KiCad names the inputs "+" and "-" and leaves the OUTPUT unnamed ("~"),
  // so the output is found by the pin's electrical TYPE instead -- there is
  // nothing else to find it by, and a per-number map cannot work because
  // unit A's output is pin 1 and unit B's is pin 7.
  [/^(TL07\d|TL08\d|LM3\d\d|OPA\d+|MCP60\d|LF35\d|UA741|LM741|NE553\d)/i,
    (v, n) => ({ kind: 'opamp',
      pins: { '+': 'inp', '-': 'inn', '~+': 'inp', '~-': 'inn' },
      byType: { output: 'out' },
      terminals: ['inp', 'inn', 'out'],
      _note: `${n} imported as an ideal opamp -- supply pins and any second channel are dropped` })],
  // The 555's engine terminals are the datasheet's FUNCTION names; KiCad's
  // symbol abbreviates them (TR, THR, CV, DIS, Q, R), so byName alone maps
  // none of them.
  [/^(LM|NE|SE|ICM|TLC)?555\w*$/i, () => ({ kind: 'timer_555',
    pins: { GND: 'gnd', TR: 'trigger', Q: 'output', OUT: 'output', R: 'reset',
      RESET: 'reset', CV: 'control', CONT: 'control', THR: 'threshold',
      TH: 'threshold', DIS: 'discharge', VCC: 'vcc', VDD: 'vcc' },
    terminals: ['gnd', 'trigger', 'output', 'reset', 'vcc', 'discharge', 'threshold', 'control'] })],
  // The logic FAMILY has to be enumerated. An unanchored `^74\w*?(\d{2,3})`
  // reads 74CBTLV3257 as "74hc325" -- a kind no engine models and no
  // datasheet describes, which then draws as a plausible box and simulates
  // as nothing. An unrecognised family is reported as unmapped instead.
  // Four digits, not three: the 4000 series is four long, and capturing only
  // three collapses 74HC4050 and 74HC4051 -- a hex buffer and an 8-channel
  // analog mux -- onto one kind that is neither. That failure makes the
  // coverage numbers look BETTER, which is how it survived on the EAGLE side
  // until someone went looking for the datasheet of "74hc405".
  [/^(SN|MC|DM|CD)?74(HCT|HC|LS|ALS|AHCT|AHC|ACT|AC|AS|LVC|LVT|VHC|VHCT|F|S|C|H|L)?(\d{2,4})[A-Z]*\d?$/i,
    (v, n) => {
      const num = /^(?:SN|MC|DM|CD)?74(?:HCT|HC|LS|ALS|AHCT|AHC|ACT|AC|AS|LVC|LVT|VHC|VHCT|F|S|C|H|L)?(\d{2,4})/i.exec(n)[1];
      return { kind: `74hc${num}`, byName: true,
        _note: `${n} mapped to 74hc${num}; verify the pinout matches` };
    }],
  [/^L298/i, () => ({ kind: 'h_bridge',
    pins: { ENA: 'en1', ENB: 'en2', IN1: 'in1', IN2: 'in2', IN3: 'in3', IN4: 'in4',
      OUT1: 'out1', OUT2: 'out2', OUT3: 'out3', OUT4: 'out4',
      VS: 'vcc', VSS: 'vcc', GND: 'gnd' },
    terminals: ['vcc', 'gnd', 'en1', 'in1', 'in2', 'out1', 'out2', 'en2', 'in3', 'in4', 'out3', 'out4'],
    _note: 'L298 imported as an h_bridge; the current-sense pins have no model' })],
  [/^PCF8574/i, () => ({ kind: 'pcf8574', byName: true })],
  [/^24[LC]C?\d{2,3}|^AT24C/i, () => ({ kind: 'at24c02', byName: true,
    terminals: ['vcc', 'gnd', 'sda', 'scl'] })],

  // -- modules and actuators ---------------------------------------
  // dc_motor's terminals are a and b -- it has no polarity in the model, and
  // emitting pos/neg wired the motor to nothing.
  [/^Motor_DC$|^Motor_Servo|^Fan(_\w+)?$|^MOTOR/i,
    () => ({ kind: 'dc_motor', pins: { 1: 'a', 2: 'b', '+': 'a', '-': 'b' } })],
  [/^Buzzer$|^Speaker/i, () => ({ kind: 'buzzer', pins: PASSIVE2 })],
  [/^DHT(11|21|22)$|^AM230\d/i, (v, n) => ({ kind: /22|2302|AM230/i.test(n) ? 'dht22' : 'dht11',
    pins: { VDD: 'vcc', VCC: 'vcc', DATA: 'data', DAT: 'data', GND: 'gnd',
      1: 'vcc', 2: 'data', 4: 'gnd' },
    terminals: ['vcc', 'data', 'gnd'] })],
  // On an optocoupler "C" is the COLLECTOR, not the cathode -- the LED side
  // is A/K and the transistor side is C/E. The four-pin numbering (PC817 and
  // most of the family) is 1 anode, 2 cathode, 3 emitter, 4 collector; the
  // six-pin 4N35 numbers its transistor 4/5 instead, so that package has to
  // be read by pin NAME, and is.
  [/^Relay_|^NSL-32|^Optocoupler|^PC8\d\d|^4N\d\d|^TLP\d{3}|^LTV-?8\d\d/i,
    () => ({ kind: 'optocoupler',
      pins: { A: 'anode', K: 'cathode', C: 'collector', E: 'emitter',
        1: 'anode', 2: 'cathode', 3: 'emitter', 4: 'collector' },
      terminals: ['anode', 'cathode', 'emitter', 'collector'] })],
  [/^WS2812|^SK6812|^APA10\d/i, () => ({ kind: 'neopixel', byName: true })],
  [/^Battery(_Cell)?$/i,
    () => ({ kind: 'battery', pins: { 1: 'pos', 2: 'neg', '+': 'pos', '-': 'neg' } })],
  [/^Lamp|^Light_Bulb/i, () => ({ kind: 'light_bulb', pins: PASSIVE2 })],

  // -- connectors --------------------------------------------------
  // KiCad spells the data pair "D+"/"D-"; the engine spells it dp/dm, and
  // normalising the name does not bridge that.
  [/^USB_/i, () => ({ kind: 'usb_a',
    pins: { VBUS: 'vbus', GND: 'gnd', 'D+': 'dp', 'D-': 'dm', 'D_P': 'dp', 'D_N': 'dm',
      'D+_1': 'dp', 'D-_1': 'dm' },
    terminals: ['vbus', 'gnd', 'dp', 'dm'],
    _note: 'USB connector imported as usb_a; shield, ID and CC pins have no model' })],
  [/^Conn_(\d+)x(\d+)/i, (v, n) => {
    const m = /Conn_(\d+)x(\d+)/i.exec(n);
    return headerOf(Number(m[1]) * Number(m[2]), null);
  }],
  [/^CONN_(\d+)X(\d+)$/i, (v, n) => {
    const m = /(\d+)X(\d+)/i.exec(n);
    return headerOf(Number(m[1]) * Number(m[2]), null);
  }],
  [/^Conn_\d+$|^CONN_\d+$/i, (v, n) => headerOf(Number(/(\d+)/.exec(n)[1]), null)],
  [/^TestPoint|^TP$/i,
    (v, n) => headerOf(1, `${n} imported as a 1-pin header (a test point exists so a wire can attach)`)],
  [/^(BNC|DB9|DB25|Audio-?Jack|Jack|IEC_|Screw_Terminal|TerminalBlock|Barrel_Jack)/i,
    (v, n) => headerOf(2, `${n} connector imported as a 2-pin header`)],
  [/^PMOD_|^Raspberry_Pi_2_3|^Arduino_/i,
    (v, n) => headerOf(12, `${n} imported as a 12-pin header`)],
];

/**
 * Symbols carrying KiCad's `(power)` flag but matching no rule above. They
 * still connect by name, so guessing wrong here silently ties two rails
 * together; guessing NOTHING loses the supply entirely and leaves every rail
 * floating. Ground is recognised by name because "everything else is a
 * positive rail" is true of every power library and of nothing else.
 */
export function classifyPower(name) {
  return /GND|GROUND|EARTH|VSS|^0V$/i.test(name) ? 'gnd' : 'vcc';
}

/**
 * Map one library reference to an engine part.
 *
 * @param {string} libId    "Device:R", or just "R"
 * @param {string} value    the Value field, e.g. "10k"
 * @param {boolean} isPower the symbol carries KiCad's (power) flag
 * @returns {?object} null when nothing matches -- the caller REPORTS it
 */
export function mapKicadSymbol(libId, value, isPower = false) {
  const s = String(libId);
  const name = s.includes(':') ? s.slice(s.indexOf(':') + 1) : s;
  for (const [re, make] of KICAD_RULES) {
    if (!re.test(name)) continue;
    let r;
    try { r = make(value, name); } catch { continue; }
    if (r) return { params: {}, pins: {}, ...r };
  }
  if (isPower) {
    const kind = classifyPower(name);
    return { kind, params: {}, pins: {}, anyPin: kind,
      _note: `${name} is a power symbol with no rule; imported as ${kind} by name` };
  }
  return null;
}

/**
 * Resolve one pin of a placed symbol to an engine terminal name.
 *
 * @param {object} hit   the mapKicadSymbol result
 * @param {string} num   the pin NUMBER as written in the file
 * @param {string} pname the pin NAME ("~" when the library left it blank)
 * @param {string} [ptype] the pin's electrical type: input, output, power_in...
 */
export function terminalFor(hit, num, pname, ptype) {
  const direct = hit.pins?.[num] ?? (pname ? hit.pins?.[pname] : undefined);
  if (direct) return direct;
  if (hit.anyPin) return hit.anyPin;
  // By electrical TYPE. Only useful where the library leaves the pin unnamed
  // and the type is the only distinguishing mark -- an opamp's output.
  if (hit.byType && ptype && hit.byType[ptype]) return hit.byType[ptype];
  if (hit.byName && pname && pname !== '~') return normalizeEaglePin(pname);
  return undefined;
}

/** Sanitise a KiCad reference into an id, keeping it unique. `#PWR01` becomes `PWR01`. */
export function makeId(ref, used) {
  const base = String(ref || 'U').replace(/[^A-Za-z0-9_]/g, '') || 'U';
  if (!used.has(base)) { used.add(base); return base; }
  let i = 2;
  while (used.has(`${base}_${i}`)) i++;
  used.add(`${base}_${i}`);
  return `${base}_${i}`;
}

/**
 * Turn resolved nets into wires, plus the counts a caller needs to report.
 *
 * Star topology from the first pin of each net, matching eagle.js and
 * kicad-netlist.js: the engine unions terminals per net, so any spanning
 * shape is electrically the same and the star is the cheapest to write.
 *
 * @param {Map<string, Array<{part:string, terminal:string}>>} byNet
 */
export function wiresFromNets(byNet) {
  const wires = [];
  let nets = 0;
  for (const refs of byNet.values()) {
    // De-duplicate: two units of one symbol, or a pin reached both by wire and
    // by name, must not produce a self-wire.
    const seen = new Set(); const uniq = [];
    for (const r of refs) {
      const k = `${r.part} ${r.terminal}`;
      if (seen.has(k)) continue;
      seen.add(k); uniq.push(r);
    }
    if (uniq.length < 2) continue;
    nets++;
    for (let i = 1; i < uniq.length; i++) {
      wires.push({ from: uniq[0].part, fromTerminal: uniq[0].terminal,
        to: uniq[i].part, toTerminal: uniq[i].terminal });
    }
  }
  return { wires, nets };
}
