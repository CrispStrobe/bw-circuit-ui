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

import { shapeFor } from './schematic-symbols.js';

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

  const connectedTerms = p => {
    const all = p.terminals ?? [];
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
  const symbols = [];
  for (const p of electrical) {
    const col = layoutCol.get(p.id);
    const row = rowOf.get(p.id);
    const x = MARGIN_X + col * COL_W;
    const y = yOf.get(p.id) ?? (MARGIN_Y + row * ROW_H);
    const allTerms = p.terminals ?? [];
    let terms = allTerms.filter(name => {
      const netId = findPinNet(nets, p.id, name);
      return netId && (netPins.get(netId) ?? []).length >= 2;
    });
    if (terms.length === 0) terms = allTerms.slice(0, 2); // disconnected part: keep its shape
    const perSide = Math.ceil(terms.length / 2);
    const art = shapeFor(p.kind, p.params ?? {});
    const pins = terms.map((name, i) => {
      const anchor = art?.anchors?.[String(name).toLowerCase()];
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
    symbols.push({
      id: p.id, kind: p.kind, label: p.declName || p.id,
      params: p.params ?? {}, col, row, x, y, pins,
      pinsPerSide: perSide,
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
  const labelPin = (r, text, pin) => {
    const vectors = {
      left: [-1, 0, 'end'], right: [1, 0, 'start'],
      top: [0, -1, 'middle'], bottom: [0, 1, 'middle'],
    };
    const [dx, dy, anchor] = vectors[pin.side] || vectors.right;
    netLabels.push({netId: r.netId, text,
      x1: pin.x, y1: pin.y, x2: pin.x + dx * 13, y2: pin.y + dy * 13,
      x: pin.x + dx * 16, y: pin.y + dy * 16 + (dy === 0 ? 2.5 : (dy < 0 ? -2 : 7)),
      anchor});
  };
  const bodyBounds = (s) => {
    const art = shapeFor(s.kind, s.params);
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
      !segmentHitsForeignPin(a, b, netId);
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
          wires.push({netId: r.netId, segments});
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
