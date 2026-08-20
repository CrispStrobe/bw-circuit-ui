/**
 * KiCad 4/5 legacy schematic importer (.sch, "EESchema Schematic File").
 *
 * Line-oriented plain text, not s-expressions and not XML:
 *
 *   $Comp
 *   L Device:R R2               <- library reference, then the designator
 *   U 1 1 5EA14BAA              <- unit, body style, timestamp
 *   P 8250 3550                 <- placement, in 1/1000 inch
 *   F 0 "R2" H 8180 3504 ...    <- field 0 is the Reference
 *   F 1 "560 ohm" H ...         <- field 1 is the Value
 *        1    8250 3550
 *        -1   0    0    1       <- the 2x2 orientation matrix
 *   $EndComp
 *   Wire Wire Line
 *        5800 2850 4650 2850
 *   Connection ~ 4300 2850
 *   Text GLabel 5250 2750 2 50 Input ~ 0
 *   RESET                       <- a label's text is on the NEXT line
 *
 * Connectivity is geometric, exactly as in the v6 format, and is solved by
 * the same NetSolver. The orientation matrix replaces v6's rotation-plus-
 * mirror: a pin at library position (px, py) lands at
 *
 *   x = Px + a*px + b*py        with the matrix written  a b c d
 *   y = Py + c*px + d*py
 *
 * The default `1 0 0 -1` is exactly the library-Y-up to sheet-Y-down flip
 * that placePin() applies in the v6 importer, which is the cross-check that
 * the two agree.
 *
 * THE ONE THING THIS FORMAT CANNOT DO ALONE: pin positions live in a separate
 * `.lib`, never in the schematic. KiCad writes a `<project>-cache.lib` beside
 * every legacy project for exactly this reason, and without it a reader knows
 * every part and not one connection. So the importer takes the library text
 * as an option, `bwc` finds the cache automatically, and an import with no
 * library says so LOUDLY rather than returning a wireless circuit that looks
 * fine.
 *
 * @module
 */

import {
  NetSolver, mapKicadSymbol, terminalFor, makeId, wiresFromNets, NON_ELECTRICAL, ptKey,
} from './kicad-common.js';

/**
 * Parse legacy `.lib` text into name -> pins.
 *
 *   DEF Device_R R 0 0 N Y 1 F N
 *   DRAW
 *   X ~ 1 0 150 50 D 50 50 1 1 P
 *   ENDDRAW
 *   ENDDEF
 *
 * The X record is
 *   X name number posx posy length dir name_size num_size unit convert etype
 * and `posx posy` is the CONNECTION end of the pin, the far end from the body
 * -- the same convention the v6 format uses, so both importers can share the
 * downstream code.
 *
 * ALIAS lines let several symbol names share one definition; they are
 * followed here because a schematic may reference the alias.
 */
export function parseLegacyLib(text) {
  const out = new Map();
  let cur = null; let name = null; let aliases = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('DEF ')) {
      const f = line.split(/\s+/);
      name = f[1]; cur = []; aliases = [];
    } else if (line.startsWith('ALIAS ') && cur) {
      aliases = line.split(/\s+/).slice(1);
    } else if (line.startsWith('X ') && cur) {
      const f = line.split(/\s+/);
      // X <name> <num> <x> <y> <len> <dir> <nsz> <numsz> <unit> <convert> <etype>
      // f[9] is the UNIT and f[10] the body style. Reading f[10] as the unit
      // gives every unit of a multi-unit symbol all of the package's pins:
      // a DPDT switch placed as unit 1 then claimed pins 4-6 as well, and
      // shorted the two poles together in a way nothing downstream could see.
      if (f.length < 12) continue;
      // f[11] is the electrical type, a single letter: I input, O output,
      // B bidirectional, P passive, W power-in. Spelled out here so both
      // importers hand terminalFor() the same vocabulary.
      const ETYPE = { I: 'input', O: 'output', B: 'bidirectional', T: 'tri_state',
        P: 'passive', U: 'unspecified', W: 'power_in', w: 'power_out',
        C: 'open_collector', E: 'open_emitter', N: 'no_connect' };
      // f[12], where present, is the pin shape, and a leading N means the pin
      // is INVISIBLE -- which for a power input makes it a global net driver.
      cur.push({ name: f[1], num: f[2], x: Number(f[3]), y: Number(f[4]),
        unit: Number(f[9]), type: ETYPE[f[11]] || '',
        hidden: /^N/.test(f[12] || '') });
    } else if (line === 'ENDDEF' && cur) {
      for (const n of [name, ...aliases]) if (n) out.set(n, cur);
      cur = null; name = null; aliases = [];
    }
  }
  return out;
}

/** `Device:R` and `Device_R` and `R` are all the same definition. */
function lookupLib(libs, libId) {
  const s = String(libId);
  const bare = s.includes(':') ? s.slice(s.indexOf(':') + 1) : s;
  return libs.get(s.replace(':', '_')) || libs.get(s) || libs.get(bare) || null;
}

/**
 * @param {string} text  Raw legacy .sch content
 * @param {{lib?: string|string[]}} [opts]  `.lib` text (usually the project's
 *        `-cache.lib`), without which no connection can be resolved
 * @returns {{parts: Array, wires: Array, warnings: string[], unmapped: Array,
 *            ignored: Array, needsLibrary: boolean, nodePartition: string[]}}
 */
export function importKicadLegacy(text, opts = {}) {
  const warnings = [];
  const unmapped = [];
  const ignored = [];
  const parts = [];

  if (!/^\s*EESchema Schematic File Version\s+\d+/.test(text)) {
    return { parts, wires: [], unmapped, ignored, needsLibrary: false, nodePartition: [],
      warnings: ['Not a KiCad legacy schematic: no "EESchema Schematic File Version" header'] };
  }
  const version = Number(/EESchema Schematic File Version\s+(\d+)/.exec(text)[1]);

  const libs = new Map();
  const libTexts = opts.lib === undefined ? [] : (Array.isArray(opts.lib) ? opts.lib : [opts.lib]);
  for (const t of libTexts) for (const [k, v] of parseLegacyLib(t)) libs.set(k, v);

  const lines = String(text).split(/\r?\n/);
  const net = new NetSolver();
  const anchors = new Set();
  const used = new Set();
  const byRef = new Map();
  const pinRefs = [];
  const rawPlacements = [];
  let sheets = 0; let labels = 0; let noConnects = 0; let missingDefs = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // -- wires ------------------------------------------------------
    if (/^Wire\s+Wire\s+Line/.test(line)) {
      const c = (lines[++i] || '').trim().split(/\s+/).map(Number);
      if (c.length >= 4 && c.every((n) => Number.isFinite(n))) {
        net.addSegment(c[0], c[1], c[2], c[3]);
        anchors.add(ptKey(c[0], c[1])); anchors.add(ptKey(c[2], c[3]));
      }
      continue;
    }
    // Bus wires and note lines are not electrical connectivity: a note line
    // is decoration, and bus membership is by name expansion.
    if (/^Wire\s+(Bus|Notes)\s+Line/.test(line) || /^Entry\s+/.test(line)) { i++; continue; }

    if (/^Connection\s/.test(line)) {
      const c = line.split(/\s+/);
      const x = Number(c[2]); const y = Number(c[3]);
      if (Number.isFinite(x) && Number.isFinite(y)) { net.addPoint(x, y); anchors.add(ptKey(x, y)); }
      continue;
    }
    if (/^NoConn\s/.test(line)) { noConnects++; continue; }

    // -- labels -----------------------------------------------------
    // `Text Label|GLabel|HLabel x y ...` then the text on the NEXT line.
    // Notes are prose on the sheet and connect nothing.
    const tm = /^Text\s+(Label|GLabel|HLabel)\s+(-?\d+)\s+(-?\d+)\s/.exec(line);
    if (tm) {
      const name = (lines[++i] || '').trim();
      if (name) {
        net.addName(Number(tm[2]), Number(tm[3]), name);
        anchors.add(ptKey(Number(tm[2]), Number(tm[3])));
        labels++;
      }
      continue;
    }
    if (/^Text\s+Notes\s/.test(line)) { i++; continue; }

    if (line === '$Sheet') {
      sheets++;
      while (i < lines.length && lines[i] !== '$EndSheet') i++;
      continue;
    }

    // -- components -------------------------------------------------
    if (line !== '$Comp') continue;
    let libId = ''; let ref = ''; let value = ''; let unit = 1;
    let px = 0; let py = 0; let mat = [1, 0, 0, -1];
    i++;
    for (; i < lines.length && lines[i] !== '$EndComp'; i++) {
      const l = lines[i];
      if (l.startsWith('L ')) {
        const f = l.split(/\s+/);
        libId = f[1]; ref = f[2] || '';
      } else if (l.startsWith('U ')) {
        const u = Number(l.split(/\s+/)[1]);
        if (Number.isFinite(u) && u > 0) unit = u;
      } else if (l.startsWith('P ')) {
        const f = l.split(/\s+/);
        px = Number(f[1]); py = Number(f[2]);
      } else if (/^F\s+0\s+"/.test(l)) {
        ref = /^F\s+0\s+"([^"]*)"/.exec(l)?.[1] ?? ref;
      } else if (/^F\s+1\s+"/.test(l)) {
        value = /^F\s+1\s+"([^"]*)"/.exec(l)?.[1] ?? value;
      } else if (/^\s+-?\d/.test(l)) {
        const n = l.trim().split(/\s+/).map(Number);
        // Three numbers is `unit x y` (a restatement of U and P); four is the
        // orientation matrix. Reading the wrong one as the matrix silently
        // rotates every symbol by an arbitrary amount.
        if (n.length === 4 && n.every(Number.isFinite)) mat = n;
      }
    }
    if (!libId) continue;

    const name = libId.includes(':') ? libId.slice(libId.indexOf(':') + 1) : libId;
    if (NON_ELECTRICAL.test(name)) { ignored.push({ ref, libsource: libId }); continue; }

    const def = lookupLib(libs, libId);
    if (!def) missingDefs++;
    // A power symbol in this format is not flagged; it is recognised by its
    // designator, which KiCad always writes as #PWRnn (and #FLGnn for a power
    // flag). That is the only marker the file carries.
    const isPower = /^#PWR/i.test(ref);

    // Resolve the pins ONCE, geometry only. The rail's name takes the same
    // three tries as in the v6 importer: the library's pin name, then the
    // Value field, then the symbol name. A rail whose name is not found does
    // not connect at all, because a wire is not how rails are drawn.
    const placed = [];
    // Which pins drive a net name, same two rules as the v6 importer: a
    // power symbol's power-input pin, and any HIDDEN power-input pin on any
    // symbol. A power_OUT pin (PWR_FLAG's) drives nothing -- see kicad-sch.js
    // for what happens when it does.
    const drives = (p) => p.type === 'power_in'
      && (isPower || p.hidden)
      && !NON_ELECTRICAL.test(name);
    const nameOf = (p) => (p.name && p.name !== '~' ? p.name
      : (isPower ? (value || name) : null));
    for (const p of def || []) {
      if (p.unit !== 0 && p.unit !== unit) continue;
      const x = px + mat[0] * p.x + mat[1] * p.y;
      const y = py + mat[2] * p.x + mat[3] * p.y;
      placed.push({ num: p.num, name: p.name, type: p.type, x, y });
      net.addPoint(x, y);
      if (drives(p)) { const nm = nameOf(p); if (nm) net.addName(x, y, nm); }
    }
    rawPlacements.push({ ref, pins: placed });

    if (/^#FLG/i.test(ref)) { ignored.push({ ref, libsource: libId }); continue; }

    let entry = byRef.get(ref);
    if (entry === undefined) {
      const hit = mapKicadSymbol(libId, value, isPower);
      if (!hit) {
        unmapped.push({ ref, value, libsource: libId });
        warnings.push(`Unmapped component: ${ref} (${libId}${value ? ` = ${value}` : ''})`);
        byRef.set(ref, null);
        continue;
      }
      if (hit._note) warnings.push(`${ref}: ${hit._note}`);
      const params = { ...hit.params };
      if (value) params._value = value;
      const id = makeId(ref, used);
      parts.push({ id, kind: hit.kind, params, x: 0, y: 0 });
      entry = { id, hit };
      byRef.set(ref, entry);
    }
    if (!entry) continue;

    const allow = entry.hit.terminals ? new Set(entry.hit.terminals) : null;
    for (const p of placed) {
      const term = terminalFor(entry.hit, p.num, p.name, p.type);
      if (!term) continue;
      if (allow && !allow.has(term)) continue;
      pinRefs.push({ x: p.x, y: p.y, part: entry.id, terminal: term });
    }
  }

  net.solve();

  const live = net.liveRoots();
  for (const k of anchors) {
    const c = k.indexOf(',');
    live.add(net.netAt(Number(k.slice(0, c)), Number(k.slice(c + 1))));
  }
  const byNet = new Map();
  let attached = 0; let floating = 0;
  for (const r of pinRefs) {
    const id = net.netAt(r.x, r.y);
    if (!byNet.has(id)) byNet.set(id, []);
    byNet.get(id).push({ part: r.part, terminal: r.terminal });
    if (live.has(id)) attached++; else floating++;
  }
  const { wires, nets } = wiresFromNets(byNet);

  // The net partition over KiCad's OWN (reference, pin-number) nodes, before
  // any part mapping. That is the shape a KiCad-exported .net file carries,
  // which makes the two directly comparable -- the only oracle for geometric
  // connectivity that is not just this code agreeing with itself.
  //
  // `#PWRnn` and `#FLGnn` are dropped because KiCad's own netlister never
  // writes them as nodes. That does not blind the check: a rail whose by-name
  // merge failed collapses into single-node nets, which are dropped in turn,
  // so the net COUNT falls instead of quietly matching.
  const nodeNets = new Map();
  for (const pl of rawPlacements) {
    if (pl.ref.startsWith('#')) continue;
    for (const p of pl.pins) {
      const id = net.netAt(p.x, p.y);
      if (!nodeNets.has(id)) nodeNets.set(id, new Set());
      nodeNets.get(id).add(`${pl.ref}/${p.num}`);
    }
  }
  const nodePartition = [...nodeNets.values()]
    .filter((sn) => sn.size > 1)
    .map((sn) => [...sn].sort().join('|'))
    .sort();

  const needsLibrary = !libs.size || missingDefs > 0;
  if (!libs.size) {
    warnings.push('NO SYMBOL LIBRARY SUPPLIED, so no connection could be resolved: pin positions '
      + 'live in the project\'s .lib, never in the .sch. Pass the project\'s "-cache.lib" as '
      + 'the `lib` option (bwc finds it automatically beside the file).');
  } else if (missingDefs) {
    warnings.push(`${missingDefs} placed symbol(s) have no definition in the supplied library, so `
      + 'their pins could not be located; the parts import, their connections do not');
  }
  if (sheets) {
    warnings.push(`${sheets} hierarchical sheet(s) referenced -- import each child .sch separately; `
      + 'this importer reads one sheet at a time');
  }
  if (ignored.length) {
    warnings.push(`${ignored.length} drawing artifact(s) skipped (mounting holes, power flags, `
      + 'logos) -- not components');
  }
  if (noConnects) warnings.push(`${noConnects} pin(s) marked no-connect by the author`);
  if (!parts.length) warnings.push('No mappable components found in this legacy schematic');
  warnings.push(`geometry: ${attached}/${pinRefs.length} mapped pins landed on a net `
    + `(${nets} nets, ${labels} labels, EESchema version ${version})`);
  if (floating) warnings.push(`${floating} pin(s) touch no wire, junction or label`);

  return { parts, wires, unmapped, ignored, warnings, needsLibrary, nodePartition };
}

/**
 * The net partition over KiCad's own (reference, pin-number) nodes.
 *
 * Mirrors `kicadSchPartition` in kicad-sch.js, and exists for the same
 * reason: it is directly comparable to a `.net` file KiCad itself exported.
 *
 * @param {string} text
 * @param {{lib?: string|string[]}} [opts]
 * @returns {string[]}
 */
export function kicadLegacyPartition(text, opts = {}) {
  return importKicadLegacy(text, opts).nodePartition;
}
