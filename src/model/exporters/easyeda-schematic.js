/**
 * Native EasyEDA schematic serializer — the tilde-DSL JSON dialect our
 * own importer (src/importers/easyeda.js) reads. That importer IS the
 * round-trip oracle: export → importEasyEda → the electrical partition
 * must equal the source circuit's resolved nets.
 *
 * ── Why this exists next to the KiCad-netlist shim ──────────────────
 * exporters/easyeda.js routes through a KiCad netlist and asks the user
 * to run the app's KiCad import. Its header once claimed the native
 * format "is not practical to synthesize" — a judgment that aged out:
 * the sidecars carry exact per-terminal geometry, the importer proves
 * the dialect is fully understood, and connectivity-as-geometry can be
 * made SAFE BY CONSTRUCTION (below). Both paths now ship; this one
 * produces a document the app opens natively.
 *
 * ── The geometry rules this router is built on ──────────────────────
 * In this dialect connectivity IS geometry (kicad-common NetSolver):
 *   - endpoints that coincide connect;
 *   - a REGISTERED POINT (pin, wire endpoint, junction, label anchor)
 *     lying ON a segment's span T-connects;
 *   - mere X-crossings do NOT connect;
 *   - names (F flags, labels) merge across any distance.
 * So the only phantom-connection hazards are shared/overlapping
 * endpoints and points-on-spans. The router removes them by
 * construction, not by checking afterwards:
 *   - parts sit in ONE ROW, each with exclusive left/right margin bands;
 *   - every pin escapes OUTWARD from its edge with a per-edge-unique
 *     first leg (unique bend coordinates), then travels on a
 *     per-pin-unique vertical x (a margin slot no other wire uses),
 *   - down to a per-NET-unique horizontal lane y below the row, where
 *     members chain endpoint-to-endpoint.
 * Distinct pins never share a vertical line; distinct nets never share
 * a lane; every remaining contact between different nets is an
 * X-crossing, which does not bind. The round-trip oracle then verifies
 * what the construction promises.
 *
 * ── Honesty bounds, stated ──────────────────────────────────────────
 * - "Imports cleanly into EasyEDA" is verified by (a) round-trip
 *   through our own importer and (b) conformance to the field template
 *   the importer measured against the 8085 vendor reference. The
 *   vendor artefact itself lives on an external volume not always
 *   mounted; when it is absent the template in the importer's parsing
 *   code is the spec of record. An import into the actual application
 *   is a manual step — hand the .json to the owner.
 * - The BREADBOARD exports as NOTHING: a symbol whose strips implied
 *   nets would be a drawing asserting connections, exactly the failure
 *   the schematic-correspondence gate exists to prevent. Its seated
 *   connectivity arrives through resolvedNets and is drawn as real
 *   wires; the omission is named in the report.
 * - vcc/gnd export as F power flags (one per rail NET), the dialect's
 *   own idiom; they import back as one rail part per name.
 * - A document with no parts/wires (a faceplate controller.json) is
 *   REFUSED by name — an empty-but-valid schematic is the worst output
 *   because every downstream check passes it.
 *
 * @module
 */

import { getSidecar } from '../parts-registry.js';

// ── kind → dialect classification ───────────────────────────────────
// The inverse of the importer's EASYEDA_RULES/mapSpicePre; the
// round-trip test keeps the two in step (the eagle exporter learned
// this the hard way: a missing inverse entry silently dropped 84 of
// 287 corpus files' parts).
const KIND_TABLE = {
  resistor: { pre: 'R', value: (p) => String(p.ohms ?? 1000), numbered: ['a', 'b'] },
  capacitor: { pre: 'C', value: (p) => String(p.farads ?? 1e-7), numbered: ['a', 'b'] },
  inductor: { pre: 'L', value: (p) => String(p.henrys ?? p.henries ?? 1e-3), numbered: ['a', 'b'] },
  led: { pre: 'D', value: () => 'LED', numbered: ['anode', 'cathode'] },
  diode: { pre: 'D', value: (p) => String(p._value ?? '1N4148'), numbered: ['anode', 'cathode'] },
  zener: { pre: 'D', value: () => 'ZENER', numbered: ['anode', 'cathode'] },
  button: { pre: 'S', value: () => 'SW', numbered: ['a', 'b'] },
  slide_switch: { pre: 'S', value: () => 'SW-SPDT', byName: true },
  potentiometer: { pre: 'R', pkg: 'POT', value: (p) => String(p.ohms ?? 10000), numbered: ['a', 'wiper', 'b'] },
  crystal: { pre: 'X', value: (p) => String(p.frequency ?? p._value ?? '8MHz'), numbered: ['a', 'b'] },
  vsource: { pre: 'V', value: (p) => String(p.volts ?? 0), numbered: ['pos', 'neg'] },
  battery: { pre: 'BT', value: (p) => String(p.volts ?? 9), numbered: ['pos', 'neg'] },
  // byName chips: the pin NAMES are the engine terminals; the importer
  // lowercases them back (normalizeEaglePin), and the descriptor (the
  // `Manufacturer Part` attr) is what EASYEDA_RULES classify.
  ssd1306: { pre: 'U', mp: 'SSD1306', byName: true },
  pi_pico: { pre: 'U', mp: 'RPI-PICO', byName: true },
  keypad_4x4: { pre: 'U', mp: 'KEYPAD-4X4', byName: true },
  seven_seg_4: { pre: 'U', mp: 'SEVENSEG4', byName: true },
  mcu: { pre: 'U', mp: 'BW-MCU', byName: true },
  pcf8574: { pre: 'U', mp: 'PCF8574', byName: true },
  arduino_uno: { pre: 'U', mp: 'ARDUINO-UNO', byName: true },
  switch: { pre: 'S', mp: 'BW-SWITCH', value: () => 'SW-LATCH', numbered: ['a', 'b'] },
  buzzer: { pre: 'U', mp: 'BW-BUZZER', byName: true },
  ldr: { pre: 'R', mp: 'BW-LDR', value: () => 'LDR', numbered: ['a', 'b'] },
  ntc: { pre: 'R', mp: 'BW-NTC', value: () => 'NTC', numbered: ['a', 'b'] },
  npn: { pre: 'Q', value: (p) => String(p._value ?? '2N2222'), numbered: ['base', 'collector', 'emitter'] },
  pnp: { pre: 'Q', value: () => 'S8550', numbered: ['base', 'collector', 'emitter'] },
  555: { pre: 'U', mp: 'NE555', byName: true },
  timer_555: { pre: 'U', mp: 'NE555', byName: true },
  62256: { pre: 'U', mp: 'AS6C62256', byName: true },
  '28c256': { pre: 'U', mp: 'AT28C256', byName: true },
};

/** The 74-series family exports generically (the importer's
 *  family-aware logicKind maps the descriptor straight back), and any
 *  OTHER kind with sidecar geometry rides the universal escape hatch:
 *  Manufacturer Part BW-<KIND>, pins by name — our importer's BW- rule
 *  restores the exact kind. The application still imports it cleanly
 *  as a generic symbol with named pins; only a kind with no geometry
 *  at all is refused by name. */
function kindEntry(kind) {
  if (KIND_TABLE[kind]) return KIND_TABLE[kind];
  if (/^74(hc|hct|ls)\d+$/.test(kind)) {
    return { pre: 'U', mp: kind.toUpperCase(), byName: true };
  }
  return { pre: 'U', mp: `BW-${String(kind).toUpperCase()}`, byName: true };
}

const RAIL_KINDS = new Set(['vcc', 'gnd']);
const STRUCTURAL_KINDS = new Set(['breadboard']);

const esc = (s) => String(s).replace(/~/g, '-').replace(/`/g, "'");

/**
 * @param {import('../circuit.js').Circuit} circuit - a live Circuit
 *   (resolvedNets present). Raw JSON goes through exportEasyEdaJson.
 * @param {{ title?: string }} [opts]
 * @returns {{ text: string, report: {
 *   exported: string[], rails: string[],
 *   skipped: Array<{id: string, kind: string, reason: string}>,
 *   nets: number, wires: number } }}
 */
export function toEasyEdaSchematic(circuit, opts = {}) {
  const parts = circuit.parts ?? [];
  const nets = circuit.resolvedNets ?? [];
  if (!Array.isArray(parts) || parts.length === 0) {
    throw new Error('EasyEDA export refused: the document has no parts — '
      + 'an empty-but-valid schematic would pass every downstream check '
      + 'while containing nothing (faceplate controller.json files are '
      + 'UI descriptions, not circuits)');
  }

  const report = { exported: [], rails: [], skipped: [], nets: 0, wires: 0 };
  const shape = [];
  let gge = 1000;
  const id = () => `gge${gge++}`;

  // ── classify parts ──────────────────────────────────────────────
  const libParts = [];
  const railPartIds = new Map(); // part id -> 'vcc' | 'gnd'
  for (const p of parts) {
    if (RAIL_KINDS.has(p.kind)) { railPartIds.set(p.id, p.kind); continue; }
    if (STRUCTURAL_KINDS.has(p.kind)) {
      report.skipped.push({ id: p.id, kind: p.kind,
        reason: 'structural: connectivity-as-geometry forbids a symbol whose strips imply nets; its seated joins are drawn as wires' });
      continue;
    }
    const t = kindEntry(p.kind);
    if (!t) {
      report.skipped.push({ id: p.id, kind: p.kind, reason: 'no EasyEDA mapping (KIND_TABLE) — add the inverse entry or accept the loss BY NAME' });
      continue;
    }
    let sc = getSidecar(p.kind);
    // A sidecar that exists but does not COVER the terminals the
    // resolved nets actually use (the generic mcu's dynamic PinIds vs
    // its generic sidecar) would silently drop those pins from the
    // routing — the corpus property test caught 76-multimeter's mcu
    // pins vanishing exactly this way. Whole-part synthesis from usage
    // is the deterministic fix; partial grafting would perturb the box.
    if (sc && Array.isArray(sc.terminals)) {
      const have = new Set(sc.terminals.map((tm) => tm.name));
      for (const n of nets) {
        for (const tm of (n.terminals ?? [])) {
          if (tm.part === p.id && !have.has(tm.terminal)
            && !have.has(String(tm.terminal).toLowerCase())) { sc = null; break; }
        }
        if (!sc) break;
      }
    }
    if (!sc || !Array.isArray(sc.terminals) || sc.terminals.length === 0) {
      // Kinds with DYNAMIC terminals (the generic mcu's PinIds) have no
      // sidecar; synthesize a deterministic box from the terminals the
      // resolved nets actually use — pins stacked left/right, unique y.
      const used = new Set();
      for (const n of nets) {
        for (const tm of (n.terminals ?? [])) if (tm.part === p.id) used.add(tm.terminal);
      }
      const names = [...used].sort();
      if (names.length === 0) {
        report.skipped.push({ id: p.id, kind: p.kind, reason: 'no sidecar geometry and no connected terminals — nothing to draw' });
        continue;
      }
      const half = Math.ceil(names.length / 2);
      const h = Math.max(20, (half + 1) * 5 + 10);
      sc = { w: 60, h, terminals: names.map((nm, i) => (i < half
        ? { name: nm, x: 0, y: 8 + i * 5 }
        : { name: nm, x: 60, y: 8 + (i - half) * 5 })) };
    }
    libParts.push({ p, t, sc });
  }

  // ── placement: one row, exclusive margins ───────────────────────
  const PY0 = 100;               // parts row top
  const ESC0 = 6;                // first escape length
  const ESC_STEP = 3;            // per-slot growth → unique bend coords
  // NOTE: a right-edge pin at x = w−4 cannot collide with a top/bottom
  // escape's vertical only because eLen differences are multiples of
  // ESC_STEP (3) while the pin inset is 4 — a coincidence, not a design.
  // Revisit if ESC_STEP or the sidecar inset ever changes.
  let maxBottom = PY0;
  let maxEscBottom = PY0;
  let cursor = 60;
  const placed = []; // { p, t, sc, x0, y0, pinAbs: Map(term -> {x,y,edge}) }
  for (const lp of libParts) {
    const { sc } = lp;
    const leftPins = sc.terminals.filter((tm) => tm.x === 0).length;
    const rightPins = sc.terminals.length - leftPins; // right/top/bottom share the right band
    const ml = ESC0 + leftPins * ESC_STEP + 8;
    const mr = ESC0 + rightPins * ESC_STEP + 8;
    const x0 = cursor + ml;
    lp.x0 = x0; lp.y0 = PY0; lp.ml = ml; lp.mr = mr;
    lp.pinAbs = new Map();
    for (const tm of sc.terminals) {
      // NEAREST edge, not exact-edge equality: module sidecars (the
      // Pico's castellated rows sit at x = 4 and w−4, not 0 and w)
      // otherwise all classified 'bottom', and each pin's first escape
      // leg ran straight down its own column THROUGH every sibling pin
      // below it — the 70-calculator round-trip collapsed into one net
      // (found by the oracle, pinned by the culprit-wire bisection).
      const dl = tm.x; const dr = (sc.w ?? 40) - tm.x;
      const dt = tm.y; const db = (sc.h ?? 40) - tm.y;
      const min = Math.min(dl, dr, dt, db);
      const edge = min === dl ? 'left' : (min === dr ? 'right' : (min === dt ? 'top' : 'bottom'));
      lp.pinAbs.set(tm.name, { x: x0 + tm.x, y: PY0 + tm.y, edge });
    }
    maxBottom = Math.max(maxBottom, PY0 + (sc.h ?? 40));
    // The lane band must clear the DEEPEST POSSIBLE bottom escape, not
    // merely the tallest part: a bottom-edge pin's horizontal leg sits at
    // y0 + h + ESC0 + slot·ESC_STEP, unbounded below, and with a fixed
    // LANE0 = maxBottom + 40 it reaches the first lane at slot 12 and
    // lands EXACTLY on one at slot ≡ 2 (mod 4). Only arduino_mega (78
    // right-band pins) walked that far — both mega retro-console variants
    // exported a two-net short, found by an independent reader of the
    // shape stream, not by the shared-assumption round trip. Clearing the
    // whole escape region is the invariant; making ESC_STEP and LANE_STEP
    // coprime would only dodge the exact-hit case and leave a lane
    // endpoint free to land on an escape's vertical leg.
    //
    // The bound is an UPPER bound only because exact-left implies
    // nearest-left: rightPins counts every tm.x !== 0 pin, while slots
    // are taken by NEAREST-edge classification — and a tm.x === 0 pin
    // has dl = 0, the minimum by construction, so it can never classify
    // top/bottom and steal a right-band slot beyond the count. Verified
    // over all 243 sidecars (strictly conservative for 20, e.g. the
    // Pico's inset rows). If the edge classifier changes — which already
    // happened once — this bound must be re-derived with it.
    maxEscBottom = Math.max(maxEscBottom,
      PY0 + (sc.h ?? 40) + ESC0 + Math.max(0, rightPins - 1) * ESC_STEP);
    cursor = x0 + (sc.w ?? 40) + mr;
  }
  const LANE0 = Math.max(maxBottom, maxEscBottom) + 40;
  const LANE_STEP = 4;

  // ── emit LIB shapes ─────────────────────────────────────────────
  void placed;
  for (const lp of libParts) {
    const { p, t, sc, x0, y0 } = lp;
    // Backtick attr string: key`value` pairs, taken by position. Both
    // proven readers take pairs the same way; KiCad's parser
    // additionally consumes `pre` as the reference-designator prefix
    // (sch_easyeda_parser.cpp), so it ships alongside spicePre.
    const attrStr = `package\`${esc(t.pkg ?? p.kind.toUpperCase())}\``
      + `Manufacturer Part\`${esc(t.mp ?? '')}\``
      + `pre\`${t.pre}?\``
      + `spicePre\`${t.pre}\``;
    const head = `LIB~${x0}~${y0}~${attrStr}~~0~${id()}~${id()}~0~`;
    const subs = [];
    const val = t.value ? t.value(p.params ?? {}) : (p.params?._value ?? '');
    subs.push(`T~N~${x0}~${y0 - 12}~0~#000000~Arial~7pt~normal~normal~0~comment~${esc(val)}~1~end~${id()}~0~`);
    subs.push(`T~P~${x0}~${y0 - 20}~0~#000000~Arial~7pt~normal~normal~0~comment~${esc(p.id)}~1~end~${id()}~0~`);
    let seq = 0;
    for (const tm of sc.terminals) {
      // Pin NUMBERS must follow the importer's numeric pin maps
      // (1:a, 2:b — or 1:a, 2:wiper, 3:b), not the sidecar's drawing
      // order; byName kinds fall back to sequence, their names carry
      // the binding.
      seq += 1;
      const num = (t.numbered && t.numbered.indexOf(tm.name) !== -1)
        ? t.numbered.indexOf(tm.name) + 1 : seq;
      const a = lp.pinAbs.get(tm.name);
      const pname = t.byName ? tm.name.toUpperCase() : '';
      // Head: P~show~display~electric~NUMBER~x~y~rot~id~locked
      // ^^ sections: [1] dot x~y  [2] path  [3] name row (name at field 4).
      // First ^^section fields the importer reads: f[3]=NUMBER, f[4]=x, f[5]=y.
      subs.push(`P~show~0~${num}~${a.x}~${a.y}~0~${id()}~0`
        + `^^${a.x}~${a.y}`
        + `^^M ${a.x} ${a.y} h -10`
        + `^^0~${a.x}~${a.y}~0~${esc(pname)}~start~~~#000000`);
    }
    shape.push(head + subs.map((s) => `#@$${s}`).join(''));
    report.exported.push(p.id);
  }

  // ── route nets ──────────────────────────────────────────────────
  // Escape-slot allocation: per part, per band (left | right+top+bottom).
  const slotOf = new Map(); // part id -> { left: n, right: n }
  const drops = new Map();  // netIdx -> [{x, y: laneY}] drop points
  const partById = new Map(libParts.map((lp) => [lp.p.id, lp]));

  const wireShapes = [];
  const laneOf = new Map();
  let laneIdx = 0;
  const exportableNets = [];
  for (const n of nets) {
    const members = (n.terminals ?? []).filter((tm) => partById.has(tm.part));
    const railKinds = new Set((n.terminals ?? [])
      .filter((tm) => railPartIds.has(tm.part))
      .map((tm) => railPartIds.get(tm.part)));
    if (members.length === 0 && railKinds.size === 0) continue;
    exportableNets.push({ n, members, railKinds });
  }
  report.nets = exportableNets.length;

  for (const { n, members, railKinds } of exportableNets) {
    const laneY = LANE0 + laneIdx * LANE_STEP;
    laneOf.set(n.id ?? laneIdx, laneY);
    laneIdx += 1;
    const dropXs = [];
    for (const tm of members) {
      const lp = partById.get(tm.part);
      const a = lp.pinAbs.get(tm.terminal)
        ?? lp.pinAbs.get(String(tm.terminal).toLowerCase());
      if (!a) continue;
      const s = slotOf.get(tm.part) ?? { left: 0, right: 0 };
      slotOf.set(tm.part, s);
      const band = a.edge === 'left' ? 'left' : 'right';
      const slot = s[band]++;
      const eLen = ESC0 + slot * ESC_STEP;
      const pts = [[a.x, a.y]];
      let ex;
      if (a.edge === 'left') {
        ex = a.x - eLen;
        pts.push([ex, a.y]);
      } else if (a.edge === 'right') {
        ex = a.x + eLen;
        pts.push([ex, a.y]);
      } else {
        // top/bottom: outward vertical first (unique length → unique
        // bend y), then horizontal into the right band. ONE slot serves
        // both the bend depth and the drop x — a second allocation here
        // once overflowed the exclusive band onto the NEXT part's pin
        // column, and the drop vertical T-connected through its pin
        // (found by the 78-a2 round-trip oracle: two nets merged at
        // x=695, kp1's own pin column).
        const by = a.edge === 'top' ? lp.y0 - eLen : lp.y0 + (lp.sc.h ?? 40) + eLen;
        ex = lp.x0 + (lp.sc.w ?? 40) + eLen;
        pts.push([a.x, by], [ex, by]);
      }
      pts.push([ex, laneY]);
      dropXs.push(ex);
      // The net index rides in the gge id — both parsers ignore the
      // suffix, and a collision audit can name the nets involved.
      for (let i = 0; i + 1 < pts.length; i++) {
        wireShapes.push(`W~${pts[i][0]} ${pts[i][1]} ${pts[i + 1][0]} ${pts[i + 1][1]}~#008800~1~0~none~${id()}_n${laneIdx - 1}~0`);
      }
    }
    dropXs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < dropXs.length; i++) {
      wireShapes.push(`W~${dropXs[i]} ${laneY} ${dropXs[i + 1]} ${laneY}~#008800~1~0~none~${id()}_n${laneIdx - 1}~0`);
    }
    for (const rk of railKinds) {
      const name = rk === 'vcc' ? 'VCC' : 'GND';
      const fx = dropXs.length ? dropXs[0] : 40 + laneIdx;
      if (!dropXs.length) {
        // A rail net with no exportable pins still needs an anchor point.
        wireShapes.push(`W~${fx} ${laneY} ${fx + 2} ${laneY}~#008800~1~0~none~${id()}~0`);
      }
      // F flag: name anchored AT a lane endpoint — merges by name AND
      // by geometry. Field template per BOTH proven readers: our
      // importer takes f[2]=x, f[3]=y and sections[2][0] as the name;
      // KiCad additionally interprets arr[1] as the FLAG TYPE and draws
      // the matching power symbol — so the type must match the rail
      // (a VCC flag typed gnD imports as a ground symbol there).
      const ftype = rk === 'gnd' ? 'part_netLabel_gnD' : 'part_netLabel_VCC';
      shape.push(`F~${ftype}~${fx}~${laneY}~0~${id()}~0`
        + `^^${fx}~${laneY}`
        + `^^${name}~#000000~Arial~9pt~start~~${id()}`);
      if (!report.rails.includes(name)) report.rails.push(name);
    }
  }
  shape.push(...wireShapes);
  report.wires = wireShapes.length;

  const doc = {
    editorVersion: '6.5.5',
    docType: '5',
    title: opts.title ?? 'brickwright-export',
    schematics: [{
      docType: '1',
      dataStr: {
        head: { docType: '1', editorVersion: '6.5.5', title: opts.title ?? 'brickwright-export' },
        canvas: 'CA~1000~1000~#FFFFFF~yes~#CCCCCC~5~1000~1000~line~5~pixel~5~0~0',
        shape,
        BBox: { x: 0, y: 0, width: cursor + 100, height: LANE0 + laneIdx * LANE_STEP + 60 },
      },
    }],
  };
  return { text: JSON.stringify(doc), report };
}

/**
 * File-level entry: parse a circuit JSON string, refuse non-circuit
 * documents BY NAME, build a live Circuit, export.
 * @param {string} jsonText
 * @param {new (json: any) => any} CircuitClass - Circuit (injected to
 *   avoid a model→exporter→model cycle; callers pass Circuit).
 */
export function exportEasyEdaJson(jsonText, CircuitClass, opts = {}) {
  let json;
  try { json = JSON.parse(jsonText); } catch (e) {
    throw new Error(`EasyEDA export refused: not JSON (${e.message})`);
  }
  if (json && Array.isArray(json.widgets) && !Array.isArray(json.parts)) {
    throw new Error('EasyEDA export refused: this is a faceplate controller '
      + 'document ({version, widgets}) — a UI description, not a circuit. '
      + 'Exporting it would produce a structurally valid but EMPTY schematic.');
  }
  if (!json || !Array.isArray(json.parts)) {
    throw new Error('EasyEDA export refused: no parts array — not a circuit document');
  }
  const c = CircuitClass.fromJSON(json);
  return toEasyEdaSchematic(c, opts);
}
