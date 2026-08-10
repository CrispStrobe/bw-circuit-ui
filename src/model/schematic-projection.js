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

const COL_W = 150;
const ROW_H = 110;
const MARGIN_X = 70;
const MARGIN_Y = 55;
const PIN_HALF = 30; // horizontal reach of a symbol's pins

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
  const rowOf = new Map();
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
    members.forEach((p, i) => rowOf.set(p.id, i));
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
    const col = rank.get(p.id);
    const row = rowOf.get(p.id);
    const x = MARGIN_X + col * COL_W;
    const y = MARGIN_Y + row * ROW_H;
    const allTerms = p.terminals ?? [];
    let terms = allTerms.filter(name => {
      const netId = findPinNet(nets, p.id, name);
      return netId && (netPins.get(netId) ?? []).length >= 2;
    });
    if (terms.length === 0) terms = allTerms.slice(0, 2); // disconnected part: keep its shape
    const perSide = Math.ceil(terms.length / 2);
    const pins = terms.map((name, i) => {
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
        y: y + offset * 18,
      };
    });
    symbols.push({
      id: p.id, kind: p.kind, label: p.declName || p.id,
      params: p.params ?? {}, col, row, x, y, pins,
      pinsPerSide: perSide,
    });
  }

  // Net routing: vertical trunk in the channel right of the leftmost pin
  // column, horizontal stubs to every pin. Distinct trunks in one channel
  // fan out by net index so they never overlap.
  const wires = [];
  const junctions = [];
  const channelUse = new Map(); // channel x-band → count
  const netIds = [...netPins.keys()].sort();
  for (const netId of netIds) {
    const pins = [];
    for (const s of symbols) {
      for (const pin of s.pins) if (pin.netId === netId) pins.push(pin);
    }
    if (pins.length < 2) continue;
    const minX = Math.min(...pins.map(p => p.x));
    const maxX = Math.max(...pins.map(p => p.x));
    const channel = Math.round((minX + maxX) / 2 / 10);
    const used = channelUse.get(channel) ?? 0;
    channelUse.set(channel, used + 1);
    const trunkX = (minX + maxX) / 2 + used * 8;
    const minY = Math.min(...pins.map(p => p.y));
    const maxY = Math.max(...pins.map(p => p.y));
    const points = [];
    for (const pin of pins.sort((a, b) => a.y - b.y || a.x - b.x)) {
      points.push([{ x: pin.x, y: pin.y }, { x: trunkX, y: pin.y }]);
      if (pins.length > 2) junctions.push({ x: trunkX, y: pin.y, netId });
    }
    wires.push({
      netId,
      trunk: { x: trunkX, y1: minY, y2: maxY },
      stubs: points,
    });
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
  for (const w of wires) { touch(w.trunk.x, w.trunk.y1); touch(w.trunk.x, w.trunk.y2); }
  if (!symbols.length) { minX = 0; minY = 0; maxX = 100; maxY = 60; }
  const shiftX = MARGIN_X - minX;
  const shiftY = MARGIN_Y - minY;
  for (const sym of symbols) {
    sym.x += shiftX; sym.y += shiftY;
    for (const pin of sym.pins) { pin.x += shiftX; pin.y += shiftY; }
  }
  for (const w of wires) {
    w.trunk.x += shiftX; w.trunk.y1 += shiftY; w.trunk.y2 += shiftY;
    for (const seg of w.stubs) for (const pt of seg) { pt.x += shiftX; pt.y += shiftY; }
  }
  for (const j of junctions) { j.x += shiftX; j.y += shiftY; }
  const width = (maxX - minX) + MARGIN_X * 2;
  const height = (maxY - minY) + MARGIN_Y * 2;

  return { symbols, wires, junctions, width, height };
}

function findPinNet(nets, partId, terminal) {
  for (const net of nets) {
    for (const t of net.terminals) {
      if (t.part === partId && t.terminal === terminal) return net.id;
    }
  }
  return null;
}
