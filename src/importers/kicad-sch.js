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
 * Hierarchical sheets are handled for one direct child level when the caller
 * explicitly supplies those child texts.  The parser never reads a path from
 * the schematic itself.  Local and hierarchical names remain instance-local;
 * only an exact parent sheet pin or a global/power name crosses a boundary.
 * Deeper, missing and unsafe references are reported as semantic losses.
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

const safeChildName = (name) => typeof name === 'string' && name.length > 0
  && name === name.split(/[\\/]/).pop()
  && name !== '.' && name !== '..' && !name.includes(':') && !name.includes('\0');

function suppliedFiles(opts) {
  if (!opts || !opts.files) return new Map();
  if (opts.files instanceof Map) return new Map(opts.files);
  return new Map(Object.entries(opts.files));
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
 *   sheets: number, sheetDefs: Array, globalSignals: Array,
 *   hierarchicalSignals: Array, buses: number, labels: number, noConnects: number
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
  const globalSignals = [];
  const hierarchicalSignals = [];
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
      rec = { ref, libId, value, isPower: def.isPower, unit, x: a.x, y: a.y, pins: [] };
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
      if (drives(p)) {
        const nm = nameOf(p);
        if (nm) { net.addName(x, y, nm); globalSignals.push({ name: nm, x, y }); }
      }
    }
  }

  // All three labels name nets within this sheet.  Their scope differs only
  // when the hierarchy combiner below crosses a sheet boundary.
  let labels = 0;
  for (const tag of ['label', 'global_label', 'hierarchical_label']) {
    for (const l of findAll(tree, tag)) {
      const a = atOf(l);
      if (!a || l[1] === undefined) continue;
      labels++;
      const name = String(l[1]);
      net.addName(a.x, a.y, name);
      if (tag === 'global_label') globalSignals.push({ name, x: a.x, y: a.y });
      if (tag === 'hierarchical_label') hierarchicalSignals.push({ name, x: a.x, y: a.y });
      anchors.add(ptKey(a.x, a.y));
    }
  }

  // A parent sheet pin is an electrical endpoint in the parent drawing.  It
  // binds only to a same-named hierarchical label in that particular child
  // instance; the hierarchy combiner performs that union after both sheets
  // have independently solved their geometry.
  const sheetDefs = [];
  let sheetAnon = 0;
  for (const sheet of findAll(tree, 'sheet')) {
    const file = propOf(sheet, 'Sheetfile');
    const name = propOf(sheet, 'Sheetname') || file || `sheet-${++sheetAnon}`;
    const uuidNode = findOne(sheet, 'uuid');
    const pins = [];
    for (const pin of findAll(sheet, 'pin')) {
      const a = atOf(pin);
      if (!a || pin[1] === undefined) continue;
      const pinName = String(pin[1]);
      net.addPoint(a.x, a.y);
      anchors.add(ptKey(a.x, a.y));
      pins.push({ name: pinName, x: a.x, y: a.y });
    }
    sheetDefs.push({ name: String(name), file: file === undefined ? '' : String(file),
      uuid: uuidNode ? String(uuidNode[1]) : `sheet-${sheetAnon}`, pins });
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
    sheets: sheetDefs.length,
    sheetDefs,
    globalSignals,
    hierarchicalSignals,
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

class HierarchyNets {
  constructor() { this.parent = new Map(); }
  find(key) {
    if (!this.parent.has(key)) this.parent.set(key, key);
    let root = key;
    while (this.parent.get(root) !== root) root = this.parent.get(root);
    while (this.parent.get(key) !== root) {
      const next = this.parent.get(key);
      this.parent.set(key, root);
      key = next;
    }
    return root;
  }
  union(a, b) {
    const ra = this.find(a); const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

function sheetFilesOf(text) {
  try {
    const tree = parseSexpr(text);
    if (tree[0] !== 'kicad_sch') return [];
    return findAll(tree, 'sheet').map((sheet) => propOf(sheet, 'Sheetfile'))
      .filter(Boolean).map(String);
  } catch { return []; }
}

/**
 * Find the unique selected file that no other selected file references.
 * A browser FileList has no trustworthy "first selected root" convention.
 *
 * @param {Map<string,string>|Record<string,string>} files
 * @returns {{rootName?:string,error?:string}}
 */
export function pickKicadHierarchyRoot(files) {
  const supplied = files instanceof Map ? files : new Map(Object.entries(files || {}));
  const names = [...supplied.keys()];
  const referenced = new Set();
  for (const text of supplied.values()) {
    for (const name of sheetFilesOf(text)) referenced.add(name);
  }
  const roots = names.filter((name) => !referenced.has(name));
  if (roots.length === 1) return { rootName: roots[0] };
  return { error: roots.length
    ? `Selected KiCad files have ${roots.length} possible roots (${roots.join(', ')})`
    : 'Selected KiCad files contain no unique root (the references may form a cycle)' };
}

function hierarchyLoss(losses, warnings, ref, kind, reason, source = '') {
  losses.push({ ref, kind, source, reason });
  warnings.push(`${ref}: ${reason}; the safe one-level subset was imported, but numeric analysis is blocked.`);
}

/** Import one root plus explicitly supplied direct children. */
function importKicadHierarchy(text, opts) {
  const warnings = []; const losses = []; const unmapped = []; const ignored = []; const parts = [];
  const supplied = suppliedFiles(opts);
  const rootName = String(opts.rootName || '<root>');
  const root = resolveKicadSch(text);
  if (!root.ok) return { parts, wires: [], unmapped, ignored, warnings: [root.error], losses };
  if (!root.sheetDefs.length) return importKicadSch(text);

  const sheets = [{ scope: '/', label: rootName, resolved: root, parentDef: null }];
  const seenScopes = new Set(['/']);
  root.sheetDefs.forEach((def, index) => {
    const ref = def.name || `sheet-${index + 1}`;
    if (!safeChildName(def.file)) {
      hierarchyLoss(losses, warnings, ref, 'unsafe-hierarchical-sheet-path',
        `child Sheetfile ${JSON.stringify(def.file)} is not a direct basename`, def.file);
      return;
    }
    if (def.file === rootName) {
      hierarchyLoss(losses, warnings, ref, 'cyclic-hierarchical-sheet',
        `child Sheetfile ${JSON.stringify(def.file)} refers back to the root`, def.file);
      return;
    }
    const childText = supplied.get(def.file);
    if (typeof childText !== 'string') {
      hierarchyLoss(losses, warnings, ref, 'missing-hierarchical-sheet',
        `child Sheetfile ${JSON.stringify(def.file)} was not supplied`, def.file);
      return;
    }
    const child = resolveKicadSch(childText);
    if (!child.ok) {
      hierarchyLoss(losses, warnings, ref, 'invalid-hierarchical-sheet',
        `child Sheetfile ${JSON.stringify(def.file)} could not be parsed: ${child.error}`, def.file);
      return;
    }
    const rawScope = String(def.uuid || `sheet-${index + 1}`);
    let scope = rawScope; let suffix = 2;
    while (seenScopes.has(scope)) scope = `${rawScope}-${suffix++}`;
    seenScopes.add(scope);
    sheets.push({ scope, label: def.name || def.file, file: def.file,
      resolved: child, parentDef: def });

    for (const nested of child.sheetDefs) {
      const cycle = nested.file === rootName || nested.file === def.file;
      hierarchyLoss(losses, warnings, `${ref}/${nested.name || nested.file || 'sheet'}`,
        cycle ? 'cyclic-hierarchical-sheet' : 'unsupported-hierarchy-depth',
        cycle
          ? `nested Sheetfile ${JSON.stringify(nested.file)} forms a cycle`
          : `nested Sheetfile ${JSON.stringify(nested.file)} exceeds the supported one child level`,
        nested.file);
    }
  });

  const dsu = new HierarchyNets();
  const keyAt = (sheet, x, y) => `${sheet.scope}\0${sheet.resolved.net.netAt(x, y)}`;
  const rootSheet = sheets[0];

  // Global labels and power/hidden-power pins cross every sheet instance.
  const firstGlobal = new Map();
  for (const sheet of sheets) {
    for (const signal of sheet.resolved.globalSignals) {
      const key = keyAt(sheet, signal.x, signal.y);
      if (firstGlobal.has(signal.name)) dsu.union(firstGlobal.get(signal.name), key);
      else firstGlobal.set(signal.name, key);
    }
  }

  // A hierarchical label crosses exactly one boundary: the parent sheet pin
  // of this child instance. Same spelling in a sibling is not enough.
  for (const sheet of sheets.slice(1)) {
    const parentPins = new Map();
    for (const pin of sheet.parentDef.pins) {
      if (!parentPins.has(pin.name)) parentPins.set(pin.name, []);
      parentPins.get(pin.name).push(pin);
    }
    const childLabels = new Map();
    for (const signal of sheet.resolved.hierarchicalSignals) {
      if (!childLabels.has(signal.name)) childLabels.set(signal.name, []);
      childLabels.get(signal.name).push(signal);
    }
    for (const [name, pins] of parentPins) {
      const labels = childLabels.get(name) || [];
      if (!labels.length) {
        hierarchyLoss(losses, warnings, `${sheet.label}:${name}`, 'unmatched-hierarchical-port',
          `parent sheet pin ${JSON.stringify(name)} has no matching child hierarchical label`, sheet.file);
        continue;
      }
      for (const pin of pins) for (const signal of labels) {
        dsu.union(keyAt(rootSheet, pin.x, pin.y), keyAt(sheet, signal.x, signal.y));
      }
    }
    for (const name of childLabels.keys()) {
      if (!parentPins.has(name)) hierarchyLoss(losses, warnings, `${sheet.label}:${name}`,
        'unbound-hierarchical-label',
        `child hierarchical label ${JSON.stringify(name)} has no matching parent sheet pin`, sheet.file);
    }
  }

  const used = new Set(); const byNet = new Map();
  let attached = 0; let floating = 0; let pinCount = 0; let buses = 0; let noConnects = 0;
  sheets.forEach((sheet, sheetIndex) => {
    const resolved = sheet.resolved;
    buses += resolved.buses; noConnects += resolved.noConnects;
    for (const placement of resolved.placements) {
      const name = placement.libId.includes(':')
        ? placement.libId.slice(placement.libId.indexOf(':') + 1) : placement.libId;
      const instanceTag = `${sheet.label}_${sheet.scope}`;
      const scopedRef = sheet.scope === '/' ? placement.ref : `${sheet.label}/${placement.ref}`;
      const idRef = sheet.scope === '/' ? placement.ref : `${instanceTag}_${placement.ref}`;
      if (NON_ELECTRICAL.test(name)) {
        ignored.push({ ref: scopedRef, libsource: placement.libId });
        continue;
      }
      const hit = mapKicadSymbol(placement.libId, placement.value, placement.isPower);
      if (!hit) {
        unmapped.push({ ref: scopedRef, value: placement.value, libsource: placement.libId });
        warnings.push(`Unmapped component: ${scopedRef} (${placement.libId}`
          + `${placement.value ? ` = ${placement.value}` : ''})`);
        continue;
      }
      if (hit._note) warnings.push(`${scopedRef}: ${hit._note}`);
      const params = { ...hit.params };
      if (placement.value) params._value = placement.value;
      const id = makeId(idRef, used);
      parts.push({ id, kind: hit.kind, params,
        x: placement.x + (sheetIndex % 4) * 250,
        y: placement.y + Math.floor(sheetIndex / 4) * 180 });
      const allow = hit.terminals ? new Set(hit.terminals) : null;
      for (const pin of placement.pins) {
        const terminal = terminalFor(hit, pin.num, pin.name, pin.type);
        if (!terminal || (allow && !allow.has(terminal))) continue;
        pinCount++;
        const localNet = resolved.net.netAt(pin.x, pin.y);
        const netId = dsu.find(keyAt(sheet, pin.x, pin.y));
        if (!byNet.has(netId)) byNet.set(netId, []);
        byNet.get(netId).push({ part: id, terminal });
        if (resolved.live.has(localNet)) attached++; else floating++;
      }
    }
  });

  const { wires, nets } = wiresFromNets(byNet);
  warnings.push(`${sheets.length - 1}/${root.sheetDefs.length} direct hierarchical sheet instance(s) read; `
    + 'local names are instance-scoped, parent ports bind exact child hierarchical labels, and global/power names cross sheets');
  if (buses) warnings.push(`${buses} bus segment(s)/entries ignored -- bus membership is by name expansion, `
    + 'and guessing it would invent connections rather than lose them');
  if (ignored.length) warnings.push(`${ignored.length} drawing artifact(s) skipped (mounting holes, fiducials, `
    + 'logos, power flags, net ties) -- not components');
  if (noConnects) warnings.push(`${noConnects} pin(s) marked no-connect by the author`);
  if (parts.length && !wires.length) warnings.push('No connections resolved: every mapped terminal is isolated.');
  if (!parts.length) warnings.push('No mappable components found in the supplied hierarchy.');
  warnings.push(`geometry: ${attached}/${pinCount} mapped pins landed on a net `
    + `(${nets} nets across ${sheets.length} sheet instance(s))`);
  if (floating) warnings.push(`${floating} pin(s) touch no wire, junction or label`);
  return { parts, wires, unmapped, ignored, warnings, losses,
    hierarchy: { root: rootName, suppliedChildren: sheets.length - 1,
      referencedChildren: root.sheetDefs.length, supportedDepth: 1 } };
}

/**
 * @param {string} text  Raw .kicad_sch content
 * @param {object} [opts] `{files, rootName}` enables one-level hierarchy from
 *                         explicitly supplied child texts.
 * @returns {{parts: Array, wires: Array, warnings: string[], unmapped: Array, ignored: Array}}
 */
export function importKicadSch(text, opts = {}) {
  if (opts.files) return importKicadHierarchy(text, opts);
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
