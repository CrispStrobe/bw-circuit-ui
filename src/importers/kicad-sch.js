/**
 * KiCad 6/7/8/9 schematic importer (.kicad_sch, s-expression).
 *
 * The file is a tree, and reading it is the easy half:
 *
 *   (kicad_sch
 *     (lib_symbols (symbol "Device:R" ... (symbol "R_1_1" (pin passive line
 *                                          (at 0 3.81 270) (number "1"))))
 *     (symbol (lib_id "Device:R") (at 120.65 69.85 0) (mirror y)
 *             (property "Reference" "R1") (property "Value" "10k"))
 *     (wire (pts (xy 120.65 66.04) (xy 133.35 66.04)))
 *     (junction (at 133.35 66.04))
 *     (label "SDA" (at 133.35 66.04 0)))
 *
 * The hard half is that NONE of that says R1 pin 1 is on the SDA net. KiCad
 * states connectivity geometrically: a pin belongs to a net when the point it
 * resolves to -- library pin position, transformed by the instance's
 * placement -- lands on a wire endpoint, a junction, or the span of a wire.
 * So this importer must
 *
 *   1. read every lib_symbols definition and keep its pins, PER UNIT;
 *   2. resolve each placed symbol's pins through placePin();
 *   3. union wire segments into nets (NetSolver);
 *   4. merge nets that share a label, a global label, a hierarchical label or
 *      a power-symbol pin name.
 *
 * Step 4 is not a refinement. A typical sheet draws no wire at all between
 * the regulator's output and the MCU's VDD: both carry a +3V3 power symbol
 * and KiCad joins them by name. Skip it and the import is a circuit with no
 * supply, which still draws perfectly.
 *
 * `resolveKicadSch()` is exported separately from `importKicadSch()` because
 * the geometry deserves an oracle of its own. It returns the net partition
 * over KiCad's OWN (reference, pin-number) nodes, before any part mapping,
 * which is exactly the shape of a `.net` file that KiCad itself exported --
 * so the two can be compared node for node. See test/kicad-import.test.js.
 *
 * Deliberately NOT handled, and reported rather than assumed:
 *   - hierarchical sheets. One file is one sheet; a (sheet ...) reference to
 *     a child file is a boundary this importer cannot cross, because the
 *     importer signature is (text) and the child is a different file.
 *   - buses and bus entries. Membership is by name-pattern expansion, and
 *     guessing it wrong invents connections rather than losing them.
 *
 * @module
 */

import { parseSexpr, findAll, findOne } from './sexpr.js';
import {
  NetSolver, placePin, mapKicadSymbol, terminalFor, makeId, wiresFromNets,
  NON_ELECTRICAL, ptKey,
} from './kicad-common.js';

/** `(at x y [rot])` anywhere in a node. */
function atOf(node) {
  const a = findOne(node, 'at');
  return a ? { x: Number(a[1]), y: Number(a[2]), rot: Number(a[3] ?? 0) } : null;
}

/** `(property "Reference" "R1" ...)` reads the second atom. */
function propOf(node, key) {
  for (const p of findAll(node, 'property')) if (p[1] === key) return p[2];
  return undefined;
}

/**
 * Pins of one library symbol, tagged with the unit they belong to.
 *
 * A KiCad library symbol is a wrapper holding sub-symbols named
 * `<NAME>_<unit>_<bodystyle>`; unit 0 is common to every unit. A dual opamp
 * has its two halves in `TL072_1_1` and `TL072_2_1` and its supply pins in
 * `TL072_3_1`, so a reader that ignores the unit gives every placed half all
 * three sets of pins -- which lands pins on wires they do not touch and
 * FABRICATES connections. That is worse than missing them.
 */
function libPins(symNode) {
  const out = [];
  const walk = (node, unit) => {
    for (const p of findAll(node, 'pin')) {
      const a = atOf(p);
      const num = findOne(p, 'number');
      const nam = findOne(p, 'name');
      if (!a || !num) continue;
      // `(pin output line ...)`: the electrical type is the first atom, the
      // graphic style the second. The type is how an opamp's unnamed output
      // is found -- see terminalFor().
      const hideNode = findOne(p, 'hide');
      out.push({ unit, num: String(num[1]), name: nam ? String(nam[1]) : '~',
        type: typeof p[1] === 'string' ? p[1] : '',
        // `(hide yes)` in v7+, a bare `hide` atom before that. A HIDDEN
        // power-input pin is a global net driver in KiCad, which is how a
        // chip's invisible VCC pin reaches the rail with no wire drawn.
        hidden: !!hideNode && hideNode[1] !== 'no', x: a.x, y: a.y });
    }
    for (const sub of findAll(node, 'symbol')) {
      const m = /_(\d+)_(\d+)$/.exec(String(sub[1] || ''));
      walk(sub, m ? Number(m[1]) : unit);
    }
  };
  walk(symNode, 0);
  return out;
}

/**
 * The geometry pass: parse the sheet and solve its connectivity, with no
 * opinion at all about what the parts are.
 *
 * @param {string} text
 * @returns {{
 *   ok: boolean, error?: string,
 *   placements: Array<{ref:string, libId:string, value:string, isPower:boolean,
 *                      unit:number,
 *                      pins:Array<{num:string,name:string,type:string,x:number,y:number}>}>,
 *   net: NetSolver, live: Set<string>,
 *   sheets: number, buses: number, labels: number, noConnects: number
 * }}
 */
export function resolveKicadSch(text) {
  let tree;
  try { tree = parseSexpr(text); } catch (e) {
    return { ok: false, error: `Could not parse s-expression: ${e.message}` };
  }
  if (tree[0] !== 'kicad_sch') {
    return { ok: false, error: 'Not a KiCad 6+ schematic: the root element is not (kicad_sch ...)' };
  }

  const lib = new Map();          // lib_id -> {pins, isPower}
  const libNode = findOne(tree, 'lib_symbols');
  if (libNode) {
    for (const sym of findAll(libNode, 'symbol')) {
      lib.set(String(sym[1]), { pins: libPins(sym), isPower: !!findOne(sym, 'power') });
    }
  }

  // `anchors` is every point the AUTHOR drew: wire ends, junctions, label
  // anchors. A pin is on the circuit only if its net contains one of these.
  // Without that distinction "did the geometry work" is unanswerable, because
  // every pin is trivially a net of its own.
  const net = new NetSolver();
  const anchors = new Set();
  for (const w of findAll(tree, 'wire')) {
    const pts = findOne(w, 'pts');
    if (!pts) continue;
    const xy = findAll(pts, 'xy');
    for (let i = 1; i < xy.length; i++) {
      const x1 = Number(xy[i - 1][1]); const y1 = Number(xy[i - 1][2]);
      const x2 = Number(xy[i][1]); const y2 = Number(xy[i][2]);
      net.addSegment(x1, y1, x2, y2);
      anchors.add(ptKey(x1, y1)); anchors.add(ptKey(x2, y2));
    }
  }
  for (const j of findAll(tree, 'junction')) {
    const a = atOf(j);
    if (a) { net.addPoint(a.x, a.y); anchors.add(ptKey(a.x, a.y)); }
  }
  let noConnects = 0;
  for (const n of findAll(tree, 'no_connect')) if (atOf(n)) noConnects++;

  // Placed symbols. Two instances may share a Reference: they are units of
  // one part (U1A, U1B) and must stay one part, or the engine sees two chips
  // and the net that joined them becomes a wire from a part to itself.
  const placements = new Map();
  let anon = 0;
  for (const inst of findAll(tree, 'symbol')) {
    const libIdNode = findOne(inst, 'lib_id');
    if (!libIdNode) continue;                      // a lib_symbols entry, not a placement
    const libId = String(libIdNode[1]);
    const a = atOf(inst);
    if (!a) continue;
    const mirrorNode = findOne(inst, 'mirror');
    const at = { ...a, mirror: mirrorNode ? String(mirrorNode[1]) : null };
    const unitNode = findOne(inst, 'unit');
    const unit = unitNode ? Number(unitNode[1]) : 1;
    const def = lib.get(libId) || { pins: [], isPower: false };
    const ref = propOf(inst, 'Reference') || `U?${++anon}`;
    const value = propOf(inst, 'Value') || '';
    const symName = libId.includes(':') ? libId.slice(libId.indexOf(':') + 1) : libId;

    let rec = placements.get(ref);
    if (!rec) {
      rec = { ref, libId, value, isPower: def.isPower, unit, pins: [] };
      placements.set(ref, rec);
    }
    // A power symbol connects BY NAME and by nothing else -- that is the only
    // connectivity most rails have. Which string is the name takes three
    // tries, because generators disagree: the stock libraries name the
    // power-input pin "GND"/"+3V3", but circuit-synth writes "~" there and
    // leaves the rail name only in the Value field. Reading just the pin name
    // turned one 100-node ground net into a hundred two-node nets, each of
    // which still drew and wired perfectly.
    //
    // Only a POWER_IN pin names a net, and PWR_FLAG is why. A flag is a power
    // symbol, carries the (power) marker, and has a pin called "pwr" -- and a
    // board scatters one onto every rail it has. Treat that as a rail name and
    // all of them join: +5V, +3V3, +1V8 and GND became ONE net on the
    // tinytapeout board, a dead short that imported without a murmur. KiCad
    // itself does not name nets from a flag; its pin is power_OUT, which is
    // the mark that separates the two.
    // Which pins DRIVE a net name. Two cases, and KiCad has both:
    //
    //   - a symbol marked (power): its power-input pin is the rail. If the
    //     library left that pin unnamed ("~", as circuit-synth writes it) the
    //     name falls back to the Value field, then to the symbol's own name.
    //   - any HIDDEN power-input pin, on any symbol. That is the classic
    //     invisible-power-pin rule: a chip's VCC pin reaches the rail with no
    //     wire drawn. Some project libraries convert their power symbols this
    //     way and never write (power) at all -- pic_programmer's VPP is one,
    //     and without this rule its three VPP symbols were three nets.
    //
    // What must NOT drive a name: a power_OUT pin. PWR_FLAG has one, called
    // "pwr", and a board scatters one onto every rail it has. Reading that as
    // a rail name joined +5V, +3V3, +1V8 and GND into ONE net on the
    // tinytapeout board -- a dead short that imported without a murmur.
    const drives = (p) => p.type === 'power_in'
      && (def.isPower || p.hidden)
      && !NON_ELECTRICAL.test(symName);
    const nameOf = (p) => (p.name && p.name !== '~' ? p.name
      : (def.isPower ? (value || symName) : null));

    for (const p of def.pins) {
      if (p.unit !== 0 && p.unit !== unit) continue;
      const [x, y] = placePin(p.x, p.y, at);
      rec.pins.push({ num: p.num, name: p.name, type: p.type, x, y });
      net.addPoint(x, y);
      // Per PIN, never per symbol: a chip with hidden VCC and GND pins drives
      // two different rails, and an earlier version that applied one rail name
      // to every pin of the symbol shorted them together.
      if (drives(p)) { const nm = nameOf(p); if (nm) net.addName(x, y, nm); }
    }
  }

  // Local, global and hierarchical labels all merge by name here. Within one
  // sheet KiCad treats them the same; the difference only shows across sheet
  // boundaries, which this importer does not cross.
  let labels = 0;
  for (const tag of ['label', 'global_label', 'hierarchical_label']) {
    for (const l of findAll(tree, tag)) {
      const a = atOf(l);
      if (!a || l[1] === undefined) continue;
      labels++;
      net.addName(a.x, a.y, String(l[1]));
      anchors.add(ptKey(a.x, a.y));
    }
  }

  net.solve();
  const live = net.liveRoots();
  for (const k of anchors) {
    const c = k.indexOf(',');
    live.add(net.netAt(Number(k.slice(0, c)), Number(k.slice(c + 1))));
  }

  return {
    ok: true,
    placements: [...placements.values()],
    net,
    live,
    sheets: findAll(tree, 'sheet').length,
    buses: findAll(tree, 'bus').length + findAll(tree, 'bus_entry').length,
    labels,
    noConnects,
  };
}

/**
 * The net partition over KiCad's own (reference, pin-number) nodes.
 *
 * This is the same shape a KiCad-exported `.net` file carries, which makes it
 * directly comparable to one -- the only oracle for geometric connectivity
 * that is not just this code agreeing with itself.
 *
 * References beginning with `#` are omitted: `#PWR nn` and `#FLG nn` are
 * KiCad's own pseudo-components for power symbols and power flags, and its
 * netlist exporter never writes them as nodes. Keeping them would make every
 * comparison differ for a reason that is about presentation, not wiring. The
 * check does not go blind as a result -- a rail whose by-name merge failed
 * collapses to a pile of single-node nets, which are dropped, so the net
 * count falls instead of matching.
 *
 * @param {string} text
 * @returns {string[]} one sorted "REF/PIN|REF/PIN|..." string per net with two
 *                     or more nodes, itself sorted. Single-node nets are
 *                     dropped, as a netlist exporter drops them.
 */
export function kicadSchPartition(text) {
  const r = resolveKicadSch(text);
  if (!r.ok) return [];
  const byNet = new Map();
  for (const pl of r.placements) {
    if (pl.ref.startsWith('#')) continue;
    for (const p of pl.pins) {
      const id = r.net.netAt(p.x, p.y);
      if (!byNet.has(id)) byNet.set(id, new Set());
      byNet.get(id).add(`${pl.ref}/${p.num}`);
    }
  }
  return [...byNet.values()]
    .filter((s) => s.size > 1)
    .map((s) => [...s].sort().join('|'))
    .sort();
}

/**
 * @param {string} text  Raw .kicad_sch content
 * @returns {{parts: Array, wires: Array, warnings: string[], unmapped: Array, ignored: Array}}
 */
export function importKicadSch(text) {
  const warnings = [];
  const unmapped = [];
  const ignored = [];
  const parts = [];

  const r = resolveKicadSch(text);
  if (!r.ok) return { parts, wires: [], unmapped, ignored, warnings: [r.error] };

  const used = new Set();
  const byNet = new Map();
  let attached = 0; let floating = 0; let pinCount = 0;

  for (const pl of r.placements) {
    const name = pl.libId.includes(':') ? pl.libId.slice(pl.libId.indexOf(':') + 1) : pl.libId;
    if (NON_ELECTRICAL.test(name)) { ignored.push({ ref: pl.ref, libsource: pl.libId }); continue; }

    const hit = mapKicadSymbol(pl.libId, pl.value, pl.isPower);
    if (!hit) {
      unmapped.push({ ref: pl.ref, value: pl.value, libsource: pl.libId });
      warnings.push(`Unmapped component: ${pl.ref} (${pl.libId}${pl.value ? ` = ${pl.value}` : ''})`);
      continue;
    }
    if (hit._note) warnings.push(`${pl.ref}: ${hit._note}`);
    const params = { ...hit.params };
    if (pl.value) params._value = pl.value;
    const id = makeId(pl.ref, used);
    parts.push({ id, kind: hit.kind, params, x: 0, y: 0 });

    const allow = hit.terminals ? new Set(hit.terminals) : null;
    for (const p of pl.pins) {
      const term = terminalFor(hit, p.num, p.name, p.type);
      if (!term) continue;                         // a pin our model has no home for
      if (allow && !allow.has(term)) continue;     // narrower engine model; see eagle.js
      pinCount++;
      const netId = r.net.netAt(p.x, p.y);
      // Kept even when no anchor is on the net: two pins may abut directly
      // with no wire between them, and KiCad joins those. `live` measures only
      // how much of the geometry the AUTHOR drew we managed to land on.
      if (!byNet.has(netId)) byNet.set(netId, []);
      byNet.get(netId).push({ part: id, terminal: term });
      if (r.live.has(netId)) attached++; else floating++;
    }
  }

  const { wires, nets } = wiresFromNets(byNet);

  if (r.sheets) {
    warnings.push(`${r.sheets} hierarchical sheet(s) referenced -- import each child .kicad_sch `
      + 'separately; this importer reads one sheet at a time');
  }
  if (r.buses) {
    warnings.push(`${r.buses} bus segment(s)/entries ignored -- bus membership is by name `
      + 'expansion, and guessing it would invent connections rather than lose them');
  }
  if (ignored.length) {
    warnings.push(`${ignored.length} drawing artifact(s) skipped (mounting holes, fiducials, `
      + 'logos, power flags, net ties) -- not components');
  }
  if (r.noConnects) warnings.push(`${r.noConnects} pin(s) marked no-connect by the author`);
  if (parts.length && !wires.length) {
    warnings.push('No connections resolved: every pin came out floating. Either the sheet really '
      + 'is unwired, or its symbols carry pin geometry this importer could not resolve.');
  }
  if (!parts.length) warnings.push('No mappable components found -- is this a KiCad 6+ schematic?');

  warnings.push(`geometry: ${attached}/${pinCount} mapped pins landed on a net `
    + `(${nets} nets, ${r.labels} labels)`);
  if (floating) warnings.push(`${floating} pin(s) touch no wire, junction or label`);

  return { parts, wires, unmapped, ignored, warnings };
}
