/**
 * Schematic projection — the circuit, redrawn as a schematic. A PROJECTION:
 * pure function of (parts, nets), no state of its own, no interaction world.
 * The canvas stays the single editable model; this view renders beside it,
 * regenerated on every change, exactly like the reference simulators'
 * auto-generated schematic.
 *
 * Layout: rank-based. Sources (batteries, supplies, posts) anchor the left;
 * everything else ranks by net-graph distance from a source. Parts become
 * columns of standard symbols; nets route as orthogonal trunk-and-stub wires
 * with junction dots. It will not win beauty contests against a hand-drawn
 * schematic — neither does any auto-generated one — but every connection is
 * faithful and every part is identifiable.
 *
 * @module
 */

import { shapeFor, artReachesPins, artCopper } from './schematic-symbols.js';

const COL_W = 150;
const ROW_H = 110;
const MARGIN_X = 70;
const MARGIN_Y = 55;
const PIN_HALF = 30; // horizontal reach of a symbol's pins
const PIN_PITCH = 18;
const SYMBOL_GAP_Y = 30;

const SOURCE_KINDS = new Set(['vsource', 'isource', 'vcc']);

/**
 * @param {Array<object>} parts - circuit parts (breadboards/meters are skipped)
 * @param {Array<{id: string, terminals: Array<{part: string, terminal: string}>}>} nets
 *   The ENGINE nets — wires and breadboard strips already merged, so the
 *   schematic shows electrical truth, not drawing artifacts.
 */
export function projectSchematic(parts, nets) {
  const electrical = parts.filter(p => p.kind !== 'breadboard' && p.kind !== 'meter');
  const partById = new Map(electrical.map(p => [p.id, p]));

  // part → its nets, net → its member pins (only for known parts)
  const partNets = new Map(electrical.map(p => [p.id, new Set()]));
  const netPins = new Map();
  for (const net of nets) {
    const pins = net.terminals.filter(t => partById.has(t.part));
    if (pins.length === 0) continue;
    netPins.set(net.id, pins);
    for (const t of pins) partNets.get(t.part).add(net.id);
  }

  // Rank by BFS from sources through shared nets.
  const rank = new Map();
  const queue = [];
  for (const p of electrical) {
    if (SOURCE_KINDS.has(p.kind)) { rank.set(p.id, 0); queue.push(p.id); }
  }
  while (queue.length > 0) {
    const id = queue.shift();
    for (const netId of partNets.get(id) ?? []) {
      for (const t of netPins.get(netId) ?? []) {
        if (!rank.has(t.part)) {
          rank.set(t.part, (rank.get(id) ?? 0) + 1);
          queue.push(t.part);
        }
      }
    }
  }
  let maxRank = 0;
  for (const r of rank.values()) maxRank = Math.max(maxRank, r);
  for (const p of electrical) {
    if (!rank.has(p.id)) rank.set(p.id, maxRank + 1); // disconnected: far right
  }

  // Columns, rows within column ordered by (barycenter of neighbours, id).
  const cols = new Map();
  for (const p of electrical) {
    const c = rank.get(p.id);
    if (!cols.has(c)) cols.set(c, []);
    cols.get(c).push(p);
  }

  // A part's DECLARED terminal list and the RESOLVED NETS are two different
  // truths about the same part, and in the shipped corpus they disagree. A
  // seated MCU ships `terminals: ["pb0"]` — only the terminal an explicit wire
  // names — while its `seat.leadMap` drops 28 leads into breadboard holes, so
  // the strips resolve nets that attribute `vcc`, `avcc` and `gnd` to that same
  // part. Drawing the declared list alone renders an ATtiny88 as a one-pin
  // symbol with no supply and no ground, which is a teaching falsehood: the
  // chip is powered, and the drawing says it is not.
  //
  // Measured before this union existed: 763 connected terminals across 365 of
  // 2,098 shipped circuits had no drawn pin. The correspondence gate could not
  // see it, because it restricts the SOLVER side of the comparison to terminals
  // the projection chose to draw — so a terminal the projection omits leaves
  // both sides of the equation at once and the gate stays green. That is the
  // same shape of blind spot as the two already recorded in the audit.
  const netTerms = new Map(electrical.map(p => [p.id, new Map()]));
  for (const pins of netPins.values()) {
    for (const t of pins) {
      const m = netTerms.get(t.part);
      const lc = String(t.terminal).toLowerCase();
      if (m && !m.has(lc)) m.set(lc, t.terminal);
    }
  }
  const declaredAndWired = p => {
    const all = [...(p.terminals ?? [])];
    const seen = new Set(all.map(n => String(n).toLowerCase()));
    for (const [lc, name] of netTerms.get(p.id) ?? []) {
      if (!seen.has(lc)) { seen.add(lc); all.push(name); }
    }
    return all;
  };
  const connectedTerms = p => {
    const all = declaredAndWired(p);
    const used = all.filter(name => {
      const netId = findPinNet(nets, p.id, name);
      return netId && (netPins.get(netId) ?? []).length >= 2;
    });
    return used.length ? used : all.slice(0, 2);
  };
  const halfHeight = p => {
    const perSide = Math.max(1, Math.ceil(connectedTerms(p).length / 2));
    return Math.max(20, ((perSide - 1) * PIN_PITCH) / 2 + 16);
  };
  const rowOf = new Map();
  const layoutCol = new Map();
  // A graph rank can contain dozens of parallel LEDs, bus devices or display
  // segments. One unbounded rank column produced 390×3356 schematics which
  // looked empty at fit scale and were impractical to pan. Preserve rank
  // order, but wrap large ranks into adjacent visual columns.
  // Eight also matches common 8-bit buses/LED banks, keeping one logical
  // bank in one column instead of splitting it 6+2 and making unrelated
  // horizontal nets appear as a daisy chain.
  const maxRows = Math.max(8, Math.ceil(Math.sqrt(Math.max(1, electrical.length) * 1.5)));
  let nextLayoutCol = 0;
  for (const c of [...cols.keys()].sort((a, b) => a - b)) {
    const members = cols.get(c);
    const bary = (p) => {
      let sum = 0, n = 0;
      for (const netId of partNets.get(p.id)) {
        for (const t of netPins.get(netId)) {
          if (t.part !== p.id && rowOf.has(t.part)) { sum += rowOf.get(t.part); n++; }
        }
      }
      return n > 0 ? sum / n : Number.POSITIVE_INFINITY;
    };
    members.sort((a, b) => (bary(a) - bary(b)) || a.id.localeCompare(b.id));
    let subcol = 0;
    let rowsInSubcol = 0;
    let subcolHeight = 0;
    for (const p of members) {
      const itemHeight = halfHeight(p) * 2 + SYMBOL_GAP_Y;
      if (rowsInSubcol > 0 && (rowsInSubcol >= maxRows || subcolHeight + itemHeight > 820)) {
        subcol++;
        rowsInSubcol = 0;
        subcolHeight = 0;
      }
      layoutCol.set(p.id, nextLayoutCol + subcol);
      rowOf.set(p.id, rowsInSubcol++);
      subcolHeight += itemHeight;
    }
    nextLayoutCol += subcol + 1;
  }

  // A fixed 110px row only works for two-pin parts. A DIP with twenty
  // connected pins is roughly 180px tall, so neighbouring packages used to
  // overlap before routing even began. Pack each visual column using the
  // actual connected-pin height instead.
  const yOf = new Map();
  const visualCols = new Map();
  for (const p of electrical) {
    const col = layoutCol.get(p.id);
    if (!visualCols.has(col)) visualCols.set(col, []);
    visualCols.get(col).push(p);
  }
  for (const members of visualCols.values()) {
    members.sort((a, b) => rowOf.get(a.id) - rowOf.get(b.id));
    let cursor = MARGIN_Y;
    for (const p of members) {
      const half = halfHeight(p);
      yOf.set(p.id, cursor + half);
      cursor += half * 2 + SYMBOL_GAP_Y;
    }
  }

  // Symbols with pin geometry: 2-pin parts run left→right; more pins split
  // across the two sides in terminal order.
  //
  // ONLY CONNECTED terminals get pins. A DIP-40 MCU on a bench uses three
  // of its forty terminals; laying out all forty spread its connection
  // points ±170px beyond the little box — wires attached to invisible
  // spots far outside the symbol (and above the canvas), which read as
  // "the chip is connected to nothing" (owner screenshots, 2026-08-10).
  // ── pin names must not collide, and the box cannot always grow ──────────
  //
  // A labelled box is 52px wide (±26) and its pin names are drawn INWARD from
  // ±22, left-anchored on the left side and right-anchored on the right. Two
  // long names facing each other across one row therefore meet in the middle
  // and neither can be read — which loses the one thing the labelled box
  // exists to provide. Measured over 2,098 shipped circuits: 105 such pairs,
  // in three kinds (555 ×57, rgb_led ×28, relay ×20).
  //
  // Widening the box is the conventional answer and is not available here:
  // the worst pair (`trigger` + `discharge`, sixteen characters) needs an
  // inset of 31.2px while the PINS sit at 30, so a box wide enough to hold
  // the names would swallow its own pins, and pushing the pins out moves the
  // routing band that COL_W/PIN_HALF/BAND are all derived from.
  //
  // So the NAMES shrink instead, per symbol, only as far as that symbol needs
  // and never below PIN_NAME_MIN. At the floor a row can hold 44/(0.6·4.5) ≈
  // 16 characters, which covers the widest pair in the corpus with 0.4px to
  // spare. A symbol that needs less keeps more: the median case lands at
  // 5.2px, not at the floor. If a future part needs MORE than the floor
  // allows, the corpus gate says so rather than the drawing silently
  // overlapping again.
  //
  // TEXT_ADVANCE duplicates a constant in scripts/schematic-audit.mjs on
  // purpose: the audit measures this drawing with its own copy, so if the two
  // ever disagree the gate goes red instead of the fix and the check agreeing
  // with each other about a model neither of them checks.
  const TEXT_ADVANCE = 0.6;      // monospace advance, em per character
  const PIN_NAME_SIZE = 6.5;
  const PIN_NAME_MIN = 4.5;
  const PIN_NAME_INSET = 22;     // where a name starts, measured from the symbol centre
  const pinNameSize = (pins) => {
    const byRow = new Map();
    for (const pin of pins) {
      const k = Math.round(pin.y);
      if (!byRow.has(k)) byRow.set(k, {left: 0, right: 0});
      const row = byRow.get(k);
      const chars = String(pin.name ?? '').length;
      if (pin.side === 'left') row.left = Math.max(row.left, chars);
      else row.right = Math.max(row.right, chars);
    }
    let size = PIN_NAME_SIZE;
    for (const {left, right} of byRow.values()) {
      if (!left || !right) continue;                 // one side only: nothing to meet
      const chars = left + right;
      if (!chars) continue;
      // Both names together may span at most 2 · PIN_NAME_INSET, less a 1px
      // margin: at exactly 2 · INSET the two boxes TOUCH, which the detector
      // (a strict overlap) forgives and a reader does not.
      const fits = (2 * PIN_NAME_INSET - 1) / (TEXT_ADVANCE * chars);
      if (fits < size) size = fits;
    }
    return Math.max(PIN_NAME_MIN, Math.min(PIN_NAME_SIZE, size));
  };

  const symbols = [];
  for (const p of electrical) {
    const col = layoutCol.get(p.id);
    const row = rowOf.get(p.id);
    const x = MARGIN_X + col * COL_W;
    const y = yOf.get(p.id) ?? (MARGIN_Y + row * ROW_H);
    // ONE definition of "which terminals get pins", shared with halfHeight
    // above. It used to be written twice; two copies of a rule are two rules.
    const terms = connectedTerms(p);
    const perSide = Math.ceil(terms.length / 2);
    const art = shapeFor(p.kind, p.params ?? {});
    const layOut = (useAnchors) => terms.map((name, i) => {
      const anchor = useAnchors ? art?.anchors?.[String(name).toLowerCase()] : null;
      if (anchor) {
        return {
          name,
          netId: findPinNet(nets, p.id, name),
          side: anchor.side,
          x: x + anchor.x,
          y: y + anchor.y,
        };
      }
      let side, offset;
      if (terms.length <= 2) {
        side = i === 0 ? 'left' : 'right';
        offset = 0;
      } else {
        side = i < perSide ? 'left' : 'right';
        offset = (i % perSide) - (perSide - 1) / 2;
      }
      const netId = findPinNet(nets, p.id, name);
      return {
        name,
        netId,
        side,
        x: x + (side === 'left' ? -PIN_HALF : PIN_HALF),
        y: y + offset * PIN_PITCH,
      };
    });
    // Artwork is used only if it REACHES every pin. A symbol description
    // carries its leads at fixed local coordinates; the projection places
    // pins on its own grid, and the two coincide only for a two-terminal
    // part with leads at y=0 or where the art declares `anchors`. Where they
    // do not, the drawing lands a wire on blank space beside the part —
    // measured at 403 pins across 109 shipped circuits — so the labelled
    // generic box takes over, which draws a lead to every pin by
    // construction. See artReachesPins in schematic-symbols.js.
    let pins = layOut(true);
    const generic = !art || !artReachesPins(art, pins.map(pin => ({x: pin.x - x, y: pin.y - y})));
    if (generic && art) pins = layOut(false);
    symbols.push({
      id: p.id, kind: p.kind, label: p.declName || p.id,
      params: p.params ?? {}, col, row, x, y, pins,
      pinsPerSide: perSide, generic,
      pinNameSize: generic ? pinNameSize(pins) : PIN_NAME_SIZE,
    });
  }

  // Implicit ground: if there is no explicit GND post, the negative terminal
  // of the first voltage source is the reference node. The schematic must show
  // that fact instead of silently dropping the ground symbol.
  const hasExplicitGround = electrical.some(p => p.kind === 'gnd');
  if (!hasExplicitGround) {
    let groundNetId = null;
    for (const net of nets) {
      if (net.terminals.some(t => t.terminal === 'neg' &&
          electrical.some(p => p.id === t.part && p.kind === 'vsource'))) {
        groundNetId = net.id;
        break;
      }
    }
    if (groundNetId) {
      const col = symbols.length ? Math.max(...symbols.map(s => s.col)) + 1 : 1;
      const x = MARGIN_X + col * COL_W;
      const y = MARGIN_Y;
      symbols.push({
        id: '__implicit_gnd__', kind: 'gnd', label: 'GND', params: {}, col, row: 0,
        x, y,
        pins: [{name: 'gnd', netId: groundNetId, side: 'left', x: x - PIN_HALF, y}],
        pinsPerSide: 1,
        generic: !artReachesPins(shapeFor('gnd', {}), [{x: -PIN_HALF, y: 0}]),
      });
    }
  }

  // Net routing: every trunk lives in a GAP between symbol columns, never
  // inside one — a trunk snapped to a pin midpoint used to run straight
  // through neighbouring symbols, and two nets in the same band drew as
  // near-parallel lines 8px apart that read as one blurred wire (owner
  // screenshots, 2026-08-10). Nets sharing a gap fan out on an even grid.
  const wires = [];
  const junctions = [];
  const netLabels = [];
  // A label's TEXT is opaque ink, and it is placed DURING routing, so a route
  // committed later can land on a text that was already drawn. The leader
  // never had this problem because it is registered as a conductor and later
  // routes avoid it; the text was registered as nothing at all. Boxes
  // accumulate here and the router treats a foreign net's text like a symbol
  // body — something to route around rather than through.
  const labelBoxes = [];
  const netIds = [...netPins.keys()].sort();
  // First pass: pick each net's gap (between column g-1 and g).
  const routed = [];
  const gapUse = new Map(); // gap index → nets in it
  for (const netId of netIds) {
    const pins = [];
    for (const s of symbols) {
      for (const pin of s.pins) if (pin.netId === netId) pins.push(pin);
    }
    if (pins.length < 2) continue;
    const midX = (Math.min(...pins.map(p => p.x)) + Math.max(...pins.map(p => p.x))) / 2;
    // Gap g sits at MARGIN_X + g*COL_W - COL_W/2; choose the nearest.
    const gap = Math.max(0, Math.round((midX - MARGIN_X + COL_W / 2) / COL_W));
    if (!gapUse.has(gap)) gapUse.set(gap, []);
    gapUse.get(gap).push(netId);
    routed.push({ netId, pins, gap });
  }
  // Dense digital machines become less truthful, not more, when every bus
  // bit is drawn as a full-height trunk. Conventional schematics use repeated
  // net labels for exactly this case. Small teaching circuits retain direct
  // wires; dense circuits get short labelled stubs with stable N01... names.
  const pinCount = routed.reduce((n, r) => n + r.pins.length, 0);
  const labelledRouting = routed.length > 18 || pinCount > 52;
  const netName = (r, index) => {
    const terms = netPins.get(r.netId) || [];
    if (terms.some(t => partById.get(t.part)?.kind === 'gnd' || /^gnd$/i.test(t.terminal))) return 'GND';
    if (terms.some(t => partById.get(t.part)?.kind === 'vcc' || /^(vcc|5v|3v3)$/i.test(t.terminal))) return 'VCC';
    return `N${String(index + 1).padStart(2, '0')}`;
  };
  // A label text IS the connection when routing falls back to labels: a
  // reader has nothing else to go on. So the text must identify the net
  // uniquely. netName's GND/VCC heuristics are not injective — a board with
  // a power switch has VBUS and VSYS nets that both look like "VCC", and
  // drawing both as "VCC" renders the switch shorted. Disambiguate the
  // second and later claimants; the first keeps the plain name, so circuits
  // without a collision render byte-identically.
  const routeName = new Map(); // netId -> label text
  {
    const used = new Map(); // text -> how many nets have claimed it
    for (const [i, r] of routed.entries()) {
      const base = netName(r, i);
      const seen = used.get(base) ?? 0;
      used.set(base, seen + 1);
      routeName.set(r.netId, seen === 0 ? base : `${base}${seen + 1}`);
    }
  }
  // A label's LEADER is drawn in the same stroke as copper, so it obeys the
  // same rule: it may cross another net's conductor and must not touch one. It
  // used to be neither checked nor registered, so a route could end exactly on
  // one — 43 of 2,098 circuits, e.g. in 46-port-overcurrent net b40's wire
  // ended at (305,117), which is a point on net b27's VCC leader spanning
  // x=300..313 at y=117. Shorten the leader until it is clear; the text
  // follows it, and a leader is only there to join a pin to its own text.
  // Short first: a leader is only there to join a pin to its own text, and
  // the shortest clear one is the tidiest. The two LONG candidates are tried
  // last and exist for one measured case — a foreign trunk parked ~17px out
  // sits inside the reach of every short length, and a vertical nudge cannot
  // help because the trunk spans the whole column. Reaching PAST it puts the
  // text in clear space; the leader then crosses that trunk, which is a
  // legal X crossing and what the contact rule has always allowed.
  const LEADER_LENGTHS = [13, 10, 8, 6, 4, 18, 22];
  // The text may also be nudged along the leader's PERPENDICULAR when no
  // leader length puts it in clear space. A label is read by its proximity to
  // its own pin, and 7px against an 18px pin pitch keeps that unambiguous
  // while moving the glyphs off another net's wire. Zero first, so a drawing
  // that needs no nudge renders byte-identically.
  const LABEL_NUDGES = [0, -7, 7, -12, 12];
  const LABEL_TEXT_SIZE = 6.5;
  const labelPin = (r, text, pin) => {
    const vectors = {
      left: [-1, 0, 'end'], right: [1, 0, 'start'],
      top: [0, -1, 'middle'], bottom: [0, 1, 'middle'],
    };
    const primary = vectors[pin.side] || vectors.right;
    // The pin's OTHER side, as a last resort. A pin points AWAY from its
    // symbol, so the flip points the label back INTO it — which is why the
    // flipped candidates carry a clearance test the primary ones never
    // needed: the leader and the text must clear every symbol BODY as well as
    // foreign copper. Without that, flipping would trade a label lying on
    // another net's wire for a label lying across a chip, and call it
    // progress. (Label text over a body is its own defect and measured
    // separately: 8 occurrences across the corpus before this change, in
    // char_lcd_i2c and lm358, none of them caused here.)
    const flipped = [-primary[0], -primary[1],
      primary[2] === 'end' ? 'start' : primary[2] === 'start' ? 'end' : primary[2]];
    // Measured: for the eight cases this exists for, the straight flip NEVER
    // lands. The pin is 30px from its symbol centre and the body reaches 26,
    // so a flipped leader crosses the body at every length but the shortest,
    // and at the shortest the TEXT lands on the body instead. So the search
    // also goes round the pin rather than only through it: up and down are
    // the other two sides available, they are already in `vectors`, and they
    // clear the body by leaving the row entirely. Same rule as the flip —
    // any direction that is not the pin's own must clear the body.
    const AROUND = [flipped, vectors.top, vectors.bottom];
    const crossesAnyBody = (a, b) => symbols.some(sym => segmentCrossesBody(a, b, bodyBounds(sym)));
    const boxCrossesAnyBody = (bx) => symbols.some(sym => {
      const box = bodyBounds(sym);
      return bx.x1 < box.right && box.left < bx.x2 && bx.y1 < box.bottom && box.top < bx.y2;
    });
    const [dx, dy, anchor] = primary;
    // The drawn text box, for a given leader length and perpendicular nudge.
    // Mirrors what both renderers emit: monospace at LABEL_TEXT_SIZE, the
    // anchor deciding which edge `x` is, and 0.7em of cap height above the
    // baseline.
    const textBox = (len, nudge, [vx, vy, va]) => {
      const tx = pin.x + vx * (len + 3) + (vy === 0 ? 0 : nudge);
      const ty = pin.y + vy * (len + 3) + (vy === 0 ? 2.5 + nudge : (vy < 0 ? -2 : 7));
      const w = TEXT_ADVANCE * LABEL_TEXT_SIZE * String(text).length;
      const h = 0.7 * LABEL_TEXT_SIZE;
      const x1 = va === 'end' ? tx - w : va === 'middle' ? tx - w / 2 : tx;
      return {x: tx, y: ty, x1, x2: x1 + w, y1: ty - h, y2: ty};
    };
    // Primary direction first and unchanged, so every drawing that already
    // had a clear position renders byte-identically; the flip is reached only
    // where no length and no nudge on the pin's own side is clear.
    let chosen = null;
    for (const dir of [primary, ...AROUND]) {
      const isFlip = dir !== primary;
      const [vx, vy] = dir;
      for (const nudge of LABEL_NUDGES) {
        for (const l of LEADER_LENGTHS) {
          const a = {x: pin.x, y: pin.y};
          const b2 = {x: pin.x + vx * l, y: pin.y + vy * l};
          if (segmentTouchesForeignConductor(a, b2, r.netId)) continue;
          if (isFlip && crossesAnyBody(a, b2)) continue;
          const b = textBox(l, nudge, dir);
          if (boxTouchesForeignConductor(b.x1, b.y1, b.x2, b.y2, r.netId)) continue;
          if (isFlip && boxCrossesAnyBody(b)) continue;
          chosen = {len: l, box: b, dir};
          break;
        }
        if (chosen) break;
      }
      if (chosen) break;
    }
    // Nothing clear: keep the leader rule's answer, which is the one that
    // matters for connectivity, and let the corpus ratchet record the text.
    if (!chosen) {
      const l = LEADER_LENGTHS.find(len => !segmentTouchesForeignConductor(
        {x: pin.x, y: pin.y}, {x: pin.x + dx * len, y: pin.y + dy * len}, r.netId)) ?? 13;
      chosen = {len: l, box: textBox(l, 0, primary), dir: primary};
    }
    const [cx, cy, canchor] = chosen.dir;
    const x2 = pin.x + cx * chosen.len, y2 = pin.y + cy * chosen.len;
    netLabels.push({netId: r.netId, text,
      x1: pin.x, y1: pin.y, x2, y2,
      x: chosen.box.x, y: chosen.box.y,
      anchor: canchor});
    registerConductor({x: pin.x, y: pin.y}, {x: x2, y: y2}, r.netId);
    labelBoxes.push({netId: r.netId, left: chosen.box.x1, right: chosen.box.x2,
      top: chosen.box.y1, bottom: chosen.box.y2});
  };
  const bodyBounds = (s) => {
    const art = s.generic ? null : shapeFor(s.kind, s.params);
    if (art) return {left: s.x - 25, right: s.x + 25, top: s.y - 22, bottom: s.y + 22};
    const halfH = Math.max(20, ((Math.max(1, s.pinsPerSide) - 1) * PIN_PITCH) / 2 + 16);
    return {left: s.x - 26, right: s.x + 26, top: s.y - halfH, bottom: s.y + halfH};
  };
  // A conductor may run through its OWN net's pins — that is what a stub does.
  // Through ANOTHER net's pin it must not: a line touching a pin reads as
  // attached to it, and `bodyBounds` above stops 26px from a symbol's centre
  // while its pins reach 30px, so a trunk placed in that 4px band ran straight
  // down a whole column of DIP pins. Measured before this check existed: 799 of
  // 2,107 shipped circuits drew at least one such conductor, 4,213 pin
  // incidences in all — 46-port-overcurrent drew one trunk through four MCU
  // port pins on four different nets, which reads as those four pins shorted.
  // The rendered-netlist gate could not see it: it excludes trunk-side vertices
  // from connectivity on the stated ground that they "sit in free space", which
  // is an assumption about geometry rather than a check of it.
  const PIN_CLEARANCE = 2; // a conductor within 2px of a pin reads as touching it
  const allPins = [];
  for (const s of symbols) for (const pin of s.pins) allPins.push(pin);
  const segmentHitsForeignPin = (a, b, netId) => {
    const horizontal = Math.abs(a.y - b.y) < 0.5;
    const vertical = Math.abs(a.x - b.x) < 0.5;
    if (!horizontal && !vertical) return false;
    for (const pin of allPins) {
      if (pin.netId && pin.netId === netId) continue;
      if (horizontal) {
        if (Math.abs(pin.y - a.y) >= PIN_CLEARANCE) continue;
        if (pin.x >= Math.min(a.x, b.x) && pin.x <= Math.max(a.x, b.x)) return true;
      } else {
        if (Math.abs(pin.x - a.x) >= PIN_CLEARANCE) continue;
        if (pin.y >= Math.min(a.y, b.y) && pin.y <= Math.max(a.y, b.y)) return true;
      }
    }
    return false;
  };

  // A conductor may CROSS another net's conductor — two lines meeting at a
  // proper X with no dot is the schematic convention for "not connected", and
  // orthogonal routing cannot avoid it. What it may NOT do is TOUCH one:
  //
  //   * end ON another net's line (a T), or share a corner vertex with it (an
  //     L). Convention reads a T as a branch — there is no reason to draw one
  //     otherwise — so a foreign T asserts a connection the solver denies.
  //   * run COLLINEAR with one within a few px over any shared span. Two lines
  //     that close together are one line to a reader.
  //
  // The router had no notion of another net's copper at all: it avoided symbol
  // bodies and (since the previous lane) foreign pins, and nothing else. Worse,
  // obstacleRoute derives its candidate coordinates from box edges, so every
  // net detouring around the same column proposes the SAME x, and the cheapest
  // candidate wins for all of them. Measured before this check existed, on
  // 2,098 shipped circuits:
  //
  //     foreign T, no dot          426 circuits / 3,461 incidences
  //     foreign shared corner       85 circuits /   218 incidences
  //     collinear within 4px       426 circuits / 1,807 incidences
  //
  // In arduino-05-arrays five different column nets ran down x=385 at dx=0,
  // overlapping 38-116px: five nets drawn as one wire. The existing class-H
  // gate was aimed at exactly this and reported 0, because it inspects only
  // `w.trunk` wires and every one of these is a `segments` detour.
  const MERGE_CLEARANCE = 4;  // two lines closer than this read as one
  const TOUCH = 0.75;
  // Committed foreign conductors, indexed four ways so the check stays cheap:
  // by the fixed axis (collinear tests) and by endpoint (contact tests).
  const hByY = new Map(), vByX = new Map(), hByEndX = new Map(), vByEndY = new Map();
  const push = (map, key, value) => {
    const k = Math.round(key);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(value);
  };
  const bucket = (map, key, span = 0) => {
    const out = [];
    for (let k = Math.round(key) - span; k <= Math.round(key) + span; k++) {
      const hit = map.get(k);
      if (hit) out.push(...hit);
    }
    return out;
  };
  /**
   * Does an axis-aligned BOX overlap a foreign net's conductor?
   *
   * A net label is a leader plus a TEXT, and `labelPin` used to clear only the
   * leader. The text is the other four fifths of the same mark and it is the
   * half a reader actually reads — "same text = same net" is the whole
   * contract once routing falls back to labels, so a label text lying across
   * another net's wire invites reading that wire as carrying that name.
   * Measured before this check existed: 172 label texts on foreign copper
   * across 104 of 2,098 circuits.
   *
   * Bucketed like the segment queries beside it; a text box is a handful of
   * rows and a few dozen columns, so this stays cheap at 22,000 labels.
   */
  const boxTouchesForeignConductor = (bx1, by1, bx2, by2, netId) => {
    for (let k = Math.floor(by1) - 1; k <= Math.ceil(by2) + 1; k++) {
      for (const seg of hByY.get(k) || []) {
        if (seg.netId === netId) continue;
        if (seg.x1 <= bx2 && bx1 <= seg.x2 && seg.y1 >= by1 - TOUCH && seg.y1 <= by2 + TOUCH) return true;
      }
    }
    for (let k = Math.floor(bx1) - 1; k <= Math.ceil(bx2) + 1; k++) {
      for (const seg of vByX.get(k) || []) {
        if (seg.netId === netId) continue;
        if (seg.y1 <= by2 && by1 <= seg.y2 && seg.x1 >= bx1 - TOUCH && seg.x1 <= bx2 + TOUCH) return true;
      }
    }
    return false;
  };
  const registerConductor = (a, b, netId) => {
    const seg = {netId, x1: Math.min(a.x, b.x), x2: Math.max(a.x, b.x),
      y1: Math.min(a.y, b.y), y2: Math.max(a.y, b.y)};
    if (Math.abs(a.y - b.y) < 0.5) {
      push(hByY, seg.y1, seg);
      push(hByEndX, seg.x1, seg); push(hByEndX, seg.x2, seg);
    } else if (Math.abs(a.x - b.x) < 0.5) {
      push(vByX, seg.x1, seg);
      push(vByEndY, seg.y1, seg); push(vByEndY, seg.y2, seg);
    }
  };
  // A SYMBOL's own copper is a conductor too, and until now the router could
  // not see any of it: everything it avoided came out of `projection.wires`,
  // and a symbol's strokes are drawn by the two renderers straight from
  // schematic-symbols.js. So a route could END on one. Measured over the
  // 2,098 shipped circuits: 7 do, all the same shape — `74-ammeter` draws a
  // potentiometer whose `b` terminal is UNCONNECTED, so its zigzag lead ends
  // at (300,163) with no pin, and another net's wire ends on exactly that
  // point. A reader sees that net joined to the pot's third terminal; the
  // solver has them apart.
  //
  // Only the parts of a symbol that stick OUT of its body box are registered:
  // interior strokes are already unreachable, because every route avoids the
  // box. A lead that ends at one of the symbol's own pins is registered under
  // that pin's net, so the net's own stub may meet it (that is what a stub is
  // for); a lead that ends at no pin gets a sentinel net id, which matches
  // nothing and is therefore foreign to everyone.
  const SYMBOL_NET = '\u0000symbol';
  const symbolLeads = (s) => {
    const art = s.generic ? null : shapeFor(s.kind, s.params);
    const box = bodyBounds(s);
    const out = [];
    const consider = (a, b) => {
      const outside = (p) => p.x < box.left - 0.5 || p.x > box.right + 0.5 ||
        p.y < box.top - 0.5 || p.y > box.bottom + 0.5;
      if (!outside(a) && !outside(b)) return;
      let netId = SYMBOL_NET;
      for (const pin of s.pins) {
        if (Math.hypot(pin.x - a.x, pin.y - a.y) <= 1.5 || Math.hypot(pin.x - b.x, pin.y - b.y) <= 1.5) {
          netId = pin.netId || SYMBOL_NET;
          break;
        }
      }
      out.push([a, b, netId]);
    };
    if (art) {
      for (const [a, b] of artCopper(art)) {
        consider({x: s.x + a.x, y: s.y + a.y}, {x: s.x + b.x, y: s.y + b.y});
      }
    } else {
      for (const pin of s.pins) {
        const edgeX = pin.side === 'left' ? s.x - 26 : s.x + 26;
        consider({x: edgeX, y: pin.y}, {x: pin.x, y: pin.y});
      }
    }
    return out;
  };
  for (const s of symbols) {
    for (const [a, b, netId] of symbolLeads(s)) registerConductor(a, b, netId);
  }

  const registerRoute = (route) => {
    const segments = route.segments || [
      [{x: route.trunk.x, y: route.trunk.y1}, {x: route.trunk.x, y: route.trunk.y2}],
      ...route.stubs,
    ];
    for (const [a, b] of segments) registerConductor(a, b, route.netId);
  };
  const inSpan = (v, lo, hi) => v >= lo - TOUCH && v <= hi + TOUCH;
  const segmentTouchesForeignConductor = (a, b, netId) => {
    const horizontal = Math.abs(a.y - b.y) < 0.5;
    const vertical = Math.abs(a.x - b.x) < 0.5;
    if (!horizontal && !vertical) return false;
    const lo = horizontal ? Math.min(a.x, b.x) : Math.min(a.y, b.y);
    const hi = horizontal ? Math.max(a.x, b.x) : Math.max(a.y, b.y);
    const fixed = horizontal ? a.y : a.x;
    // 1. collinear and close: two parallel lines that read as one
    for (const o of bucket(horizontal ? hByY : vByX, fixed, MERGE_CLEARANCE + 1)) {
      if (o.netId === netId) continue;
      if (Math.abs((horizontal ? o.y1 : o.x1) - fixed) >= MERGE_CLEARANCE) continue;
      const olo = horizontal ? o.x1 : o.y1, ohi = horizontal ? o.x2 : o.y2;
      if (Math.min(hi, ohi) - Math.max(lo, olo) > TOUCH) return true;
    }
    // 2. THIS segment's endpoint lands on a foreign perpendicular line
    for (const end of [lo, hi]) {
      for (const o of bucket(horizontal ? vByX : hByY, end, 1)) {
        if (o.netId === netId) continue;
        const operp = horizontal ? o.x1 : o.y1;
        if (Math.abs(operp - end) > TOUCH) continue;
        if (inSpan(fixed, horizontal ? o.y1 : o.x1, horizontal ? o.y2 : o.x2)) return true;
      }
    }
    // 3. a foreign perpendicular line's endpoint lands on THIS segment
    for (const o of bucket(horizontal ? vByEndY : hByEndX, fixed, 1)) {
      if (o.netId === netId) continue;
      const oFixed = horizontal ? o.x1 : o.y1;
      const oEnds = horizontal ? [o.y1, o.y2] : [o.x1, o.x2];
      if (!oEnds.some(e => Math.abs(e - fixed) <= TOUCH)) continue;
      if (inSpan(oFixed, lo, hi)) return true;
    }
    return false;
  };

  const segmentCrossesBody = (a, b, box) => {
    if (a.y === b.y) {
      return a.y > box.top && a.y < box.bottom &&
        Math.max(a.x, b.x) > box.left && Math.min(a.x, b.x) < box.right;
    }
    if (a.x === b.x) {
      return a.x > box.left && a.x < box.right &&
        Math.max(a.y, b.y) > box.top && Math.min(a.y, b.y) < box.bottom;
    }
    return false;
  };
  const routeCollisions = (route) => {
    const segments = route.segments || [
      [{x: route.trunk.x, y: route.trunk.y1}, {x: route.trunk.x, y: route.trunk.y2}],
      ...route.stubs,
    ];
    const hits = [];
    for (const s of symbols) {
      const box = bodyBounds(s);
      if (segments.some(([a, b]) => segmentCrossesBody(a, b, box))) hits.push(s.id);
    }
    if (segments.some(([a, b]) => segmentHitsForeignPin(a, b, route.netId))) hits.push('__foreign_pin__');
    if (segments.some(([a, b]) => segmentTouchesForeignConductor(a, b, route.netId))) hits.push('__foreign_conductor__');
    if (segments.some(([a, b]) => labelBoxes.some(bx => bx.netId !== route.netId
      && segmentCrossesBody(a, b, bx)))) hits.push('__label_text__');
    return hits;
  };
  const collisionRoutedNets = [];
  const detouredRoutingNets = [];
  const obstacleRoute = (start, end, netId) => {
    // Route geometry owns its points. Reusing pin objects here would shift
    // endpoints twice when projection bounds translate symbols and wires.
    start = {x: start.x, y: start.y};
    end = {x: end.x, y: end.y};
    const boxes = symbols.map(bodyBounds);
    const clear = ([a, b]) => (a.x === b.x || a.y === b.y) &&
      !boxes.some(box => segmentCrossesBody(a, b, box)) &&
      !segmentHitsForeignPin(a, b, netId) &&
      !segmentTouchesForeignConductor(a, b, netId) &&
      !labelBoxes.some(bx => bx.netId !== netId && segmentCrossesBody(a, b, bx));
    const xs = new Set([start.x, end.x]);
    const ys = new Set([start.y, end.y]);
    for (const box of boxes) {
      xs.add(box.left - 10); xs.add(box.right + 10);
      ys.add(box.top - 10); ys.add(box.bottom + 10);
    }
    const compact = points => {
      const out = [];
      for (const point of points) {
        const last = out[out.length - 1];
        if (!last || last.x !== point.x || last.y !== point.y) out.push(point);
      }
      for (let i = 1; i < out.length - 1;) {
        const a = out[i - 1], b = out[i], c = out[i + 1];
        if ((a.x === b.x && b.x === c.x) || (a.y === b.y && b.y === c.y)) out.splice(i, 1);
        else i++;
      }
      return out;
    };
    const candidates = [
      [start, end],
      [start, {x: end.x, y: start.y}, end],
      [start, {x: start.x, y: end.y}, end],
    ];
    for (const x of xs) candidates.push([start, {x, y: start.y}, {x, y: end.y}, end]);
    for (const y of ys) candidates.push([start, {x: start.x, y}, {x: end.x, y}, end]);
    for (const x of xs) for (const y of ys) {
      candidates.push([start, {x: start.x, y}, {x, y}, {x, y: end.y}, end]);
      candidates.push([start, {x, y: start.y}, {x, y}, {x: end.x, y}, end]);
    }
    let best = null, bestCost = Infinity;
    for (const raw of candidates) {
      const points = compact(raw);
      // Each segment owns endpoint objects; shared corner references would be
      // translated once per adjoining segment during bounds normalization.
      const segments = points.slice(1).map((point, i) => [
        {x: points[i].x, y: points[i].y}, {x: point.x, y: point.y},
      ]);
      if (!segments.every(clear)) continue;
      const length = segments.reduce((n, [a, b]) => n + Math.abs(a.x - b.x) + Math.abs(a.y - b.y), 0);
      const cost = length + Math.max(0, segments.length - 1) * 12;
      if (cost < bestCost) { best = segments; bestCost = cost; }
    }
    return best;
  };

  // Second pass: spread the nets of each gap across its usable band.
  const BAND = COL_W - 2 * PIN_HALF - 24; // free space between column pin tips
  for (const [routeIndex, r] of routed.entries()) {
    if (labelledRouting) {
      const text = routeName.get(r.netId);
      for (const pin of r.pins) labelPin(r, text, pin);
      continue;
    }
    const mates = gapUse.get(r.gap);
    const slot = mates.indexOf(r.netId);
    const gapCenter = MARGIN_X + r.gap * COL_W - COL_W / 2;
    const spread = mates.length > 1 ? (slot - (mates.length - 1) / 2) * Math.min(18, BAND / mates.length) : 0;
    const trunkX = gapCenter + spread;
    const minY = Math.min(...r.pins.map(p => p.y));
    const maxY = Math.max(...r.pins.map(p => p.y));
    const points = [];
    for (const pin of r.pins.sort((a, b) => a.y - b.y || a.x - b.x)) {
      points.push([{ x: pin.x, y: pin.y }, { x: trunkX, y: pin.y }]);
    }
    const route = {
      netId: r.netId,
      trunk: { x: trunkX, y1: minY, y2: maxY },
      stubs: points,
    };
    const collisions = routeCollisions(route);
    if (collisions.length) {
      if (r.pins.length === 2) {
        const segments = obstacleRoute(r.pins[0], r.pins[1], r.netId);
        if (segments) {
          const detour = {netId: r.netId, segments};
          wires.push(detour);
          registerRoute(detour);
          detouredRoutingNets.push(r.netId);
          continue;
        }
      }
      collisionRoutedNets.push({netId: r.netId, symbols: collisions});
      const text = routeName.get(r.netId);
      for (const pin of r.pins) labelPin(r, text, pin);
      continue;
    }
    wires.push(route);
    registerRoute(route);
    if (r.pins.length > 2) {
      for (const pin of r.pins) junctions.push({ x: trunkX, y: pin.y, netId: r.netId });
    }
  }

  // Canvas bounds from the GEOMETRY, not the grid: multi-pin symbols and
  // fanned-out trunks extend past the nominal rows/columns, and anything
  // outside the viewBox was silently clipped — the wire running off the top
  // edge in the owner's screenshot.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const touch = (x, y) => {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  };
  for (const sym of symbols) {
    touch(sym.x - PIN_HALF - 20, sym.y - Math.max(28, ((sym.pinsPerSide || 1) - 1) * 9 + 24));
    touch(sym.x + PIN_HALF + 20, sym.y + Math.max(28, ((sym.pinsPerSide || 1) - 1) * 9 + 24));
    for (const pin of sym.pins) touch(pin.x, pin.y);
  }
  for (const w of wires) {
    if (w.segments) for (const seg of w.segments) for (const pt of seg) touch(pt.x, pt.y);
    else { touch(w.trunk.x, w.trunk.y1); touch(w.trunk.x, w.trunk.y2); }
  }
  for (const l of netLabels) { touch(l.x1, l.y1); touch(l.x, l.y); }
  if (!symbols.length) { minX = 0; minY = 0; maxX = 100; maxY = 60; }
  const shiftX = MARGIN_X - minX;
  const shiftY = MARGIN_Y - minY;
  for (const sym of symbols) {
    sym.x += shiftX; sym.y += shiftY;
    for (const pin of sym.pins) { pin.x += shiftX; pin.y += shiftY; }
  }
  for (const w of wires) {
    if (w.segments) {
      for (const seg of w.segments) for (const pt of seg) { pt.x += shiftX; pt.y += shiftY; }
    } else {
      w.trunk.x += shiftX; w.trunk.y1 += shiftY; w.trunk.y2 += shiftY;
      for (const seg of w.stubs) for (const pt of seg) { pt.x += shiftX; pt.y += shiftY; }
    }
  }
  for (const j of junctions) { j.x += shiftX; j.y += shiftY; }
  for (const l of netLabels) {
    l.x1 += shiftX; l.x2 += shiftX; l.x += shiftX;
    l.y1 += shiftY; l.y2 += shiftY; l.y += shiftY;
  }
  const width = (maxX - minX) + MARGIN_X * 2;
  const height = (maxY - minY) + MARGIN_Y * 2;

  return { symbols, wires, junctions, netLabels, labelledRouting, collisionRoutedNets,
    detouredRoutingNets, width, height };
}

function findPinNet(nets, partId, terminal) {
  for (const net of nets) {
    for (const t of net.terminals) {
      // Board sidecars use lowercase terminal names (d13/gp0),
      // while engine nets use canonical uppercase (D13/GP0).
      if (t.part === partId && (t.terminal === terminal ||
          String(t.terminal).toLowerCase() === String(terminal).toLowerCase())) {
        return net.id;
      }
    }
  }
  return null;
}
