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
  const symbols = [];
  for (const p of electrical) {
    const col = rank.get(p.id);
    const row = rowOf.get(p.id);
    const x = MARGIN_X + col * COL_W;
    const y = MARGIN_Y + row * ROW_H;
    const terms = p.terminals ?? [];
    const pins = terms.map((name, i) => {
      let side, offset;
      if (terms.length <= 2) {
        side = i === 0 ? 'left' : 'right';
        offset = 0;
      } else {
        const perSide = Math.ceil(terms.length / 2);
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

  const width = MARGIN_X * 2 + (maxRank + 2) * COL_W;
  let maxRow = 0;
  for (const s of symbols) maxRow = Math.max(maxRow, s.row);
  const height = MARGIN_Y * 2 + (maxRow + 1) * ROW_H;

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
