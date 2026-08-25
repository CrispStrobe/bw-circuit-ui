/**
 * Board projection: circuit → placed and routed board (plan Phase 3).
 *
 * A PROJECTION, exactly like schematic-projection.js: pure function of
 * (parts, wires) plus a thin overrides layer, no state of its own. The
 * netlist always wins — overrides only ever say where something sits,
 * never what it touches.
 *
 * The output is the SAME board model importEasyEdaPcb produces, which is
 * the whole trick: runPcbDrc gates it, computeCopperNetlist verifies its
 * partition equals the circuit's, and the future exporter reads it —
 * three consumers, zero adapters.
 *
 * Division of honesty (plan §7.1): everything in here is a HEURISTIC —
 * greedy placement, a lattice A* with a turn penalty, endpoint stitching.
 * None of it is trusted. The EXACT checker (pcb-drc on pcb-geometry)
 * gates every projection in the tests, and the router consults the same
 * exact distances for its obstacle queries, so its optimism and the
 * checker's judgement cannot drift apart the way the v1 prototype's
 * inscribed circles did.
 *
 * Net assignment mirrors what real EasyEDA boards do (measured): a
 * multi-pad terminal carries its net on ONE pad — the routed one — and
 * the part's internal metal, not board copper, reaches the others. The
 * pad chosen is the one nearest the net's other endpoints.
 *
 * @module
 */

import { getLandPattern } from './land-patterns.js';
import { extractNetlist } from './netlist.js';
import { wireEndpoint } from './wire-endpoints.js';
import { padShape, trackShapes, viaShape, shapeDist } from './pcb-geometry.js';
import { DEFAULT_CLEARANCE_MM } from './pcb-drc.js';

const RAIL_KINDS = new Set(['vcc', 'gnd']);

export const TRACK_WIDTH_MM = 0.254;
export const VIA_DIAMETER_MM = 0.61;
export const VIA_DRILL_MM = 0.3;
const GRID = 0.635; // quarter inch-pitch: pads on 2.54/1.27 land on it or stitch to it
const EDGE_MARGIN = 2.0;
const COURTYARD_GAP = 1.27;

// ── net extraction ─────────────────────────────────────────────────

class UF {
  constructor() { this.p = new Map(); }
  find(k) { if (!this.p.has(k)) this.p.set(k, k); let r = k; while (this.p.get(r) !== r) r = this.p.get(r); this.p.set(k, r); return r; }
  union(a, b) { this.p.set(this.find(a), this.find(b)); }
}

/**
 * Nets from wires, rails dissolved into named nets. Returns
 * [{name, members: [{partId, terminal}]}] for groups reaching >= 2 members.
 */
export function netsFromCircuit(circuit) {
  const railName = new Map();
  for (const p of circuit.parts) {
    if (RAIL_KINDS.has(p.kind)) railName.set(p.id, p.kind.toUpperCase());
  }
  const uf = new UF();
  const key = (part, terminal) => `${part}\t${terminal}`;
  for (const w of circuit.wires) {
    // The one endpoint reader (wire-endpoints.js); breadboard-hole
    // endpoints have no seat on a bare board and are skipped.
    const fe = wireEndpoint(w, 'from');
    const te = wireEndpoint(w, 'to');
    if (!fe?.part || !te?.part) continue;
    const a = railName.has(fe.part) ? `rail\t${railName.get(fe.part)}\t${fe.part}` : key(fe.part, fe.terminal);
    const b = railName.has(te.part) ? `rail\t${railName.get(te.part)}\t${te.part}` : key(te.part, te.terminal);
    uf.union(a, b);
  }
  const groups = new Map();
  for (const k of uf.p.keys()) {
    const root = uf.find(k);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(k);
  }
  const nets = [];
  let auto = 0;
  for (const keys of groups.values()) {
    const members = [];
    let name = null;
    for (const k of keys) {
      const f = k.split('\t');
      if (f[0] === 'rail') { name = name || f[1]; continue; }
      members.push({ partId: f[0], terminal: f[1] });
    }
    if (members.length < 2 && !name) continue;
    if (members.length < 1) continue;
    nets.push({ name: name || `N${++auto}`, members });
  }
  // Deterministic order: big nets (ground planes-to-be) routed LAST so
  // short two-pad nets are not walled in by a sprawling early net.
  nets.sort((a, b) => (a.members.length - b.members.length) || a.name.localeCompare(b.name));
  return nets;
}

// ── placement ──────────────────────────────────────────────────────

/** Rotate a pattern's pad/silk offsets by an override rotation (90-step). */
function orientPattern(pattern, rotation) {
  const rot = ((rotation % 360) + 360) % 360;
  if (!rot) return pattern;
  const th = (rot * Math.PI) / 180;
  const c = Math.cos(th); const s = Math.sin(th);
  const rp = ([x, y]) => [x * c - y * s, x * s + y * c];
  const swap = rot === 90 || rot === 270;
  return {
    ...pattern,
    rotation: rot,
    pads: pattern.pads.map((pad) => {
      const [x, y] = rp([pad.x, pad.y]);
      const padSwap = pad.w !== pad.h && swap;
      return { ...pad, x, y, w: padSwap ? pad.h : pad.w, h: padSwap ? pad.w : pad.h };
    }),
    courtyard: swap
      ? { w: pattern.courtyard.h, h: pattern.courtyard.w }
      : pattern.courtyard,
    pin1: pattern.pin1 ? (() => { const [x, y] = rp([pattern.pin1.x, pattern.pin1.y]); return { x, y }; })() : undefined,
    silk: (pattern.silk || []).map((el) => {
      if (el.kind === 'circle') { const [x, y] = rp([el.x, el.y]); return { ...el, x, y }; }
      // rects rotate about the origin; for 90/270 the corner walks.
      const corners = [[el.x, el.y], [el.x + el.w, el.y + el.h]].map(rp);
      const xs = corners.map((q) => q[0]); const ys = corners.map((q) => q[1]);
      return { kind: 'rect', x: Math.min(...xs), y: Math.min(...ys), w: Math.abs(xs[1] - xs[0]), h: Math.abs(ys[1] - ys[0]) };
    }),
  };
}

function resolvePattern(part, overrides) {
  const o = overrides?.parts?.[part.id] || {};
  if (RAIL_KINDS.has(part.kind)) return null;
  const orient = (pat) => (pat && o.rotation ? orientPattern(pat, o.rotation) : pat);
  if (o.package) return orient(getLandPattern(part.kind, o.package));
  // Parametric kinds choose their variant from params: a 4-pin header is
  // '1x4', not the default '1x2' — taking the default silently DROPPED
  // two OLED pads on the first full projection and surfaced only as an
  // unfinished-net warning downstream.
  if (part.kind === 'header' && Number.isFinite(part.params?.pins)) {
    const sized = getLandPattern('header', `1x${part.params.pins}`);
    if (sized) return orient(sized);
    return null; // a 1x40 header has no pattern; unplaced-with-warning is honest
  }
  return orient(getLandPattern(part.kind, null));
}

/**
 * Greedy shelf placement in connectivity order: BFS from the most
 * connected part, so neighbours in the net graph become neighbours in
 * space. Overridden parts sit exactly where the override says; auto
 * parts flow around them.
 */
function placeParts(placeable, nets, overrides) {
  const degree = new Map(placeable.map((p) => [p.id, 0]));
  const adj = new Map(placeable.map((p) => [p.id, new Set()]));
  for (const net of nets) {
    const ids = net.members.map((m) => m.partId).filter((id) => degree.has(id));
    for (const id of ids) degree.set(id, degree.get(id) + 1);
    for (const a of ids) for (const b of ids) if (a !== b) adj.get(a).add(b);
  }
  const order = [];
  const seen = new Set();
  const byDegree = [...placeable].sort((a, b) => (degree.get(b.id) - degree.get(a.id)) || a.id.localeCompare(b.id));
  for (const seed of byDegree) {
    if (seen.has(seed.id)) continue;
    const queue = [seed.id];
    seen.add(seed.id);
    while (queue.length) {
      const id = queue.shift();
      order.push(placeable.find((p) => p.id === id));
      const next = [...(adj.get(id) || [])].filter((n) => !seen.has(n)).sort();
      for (const n of next) { seen.add(n); queue.push(n); }
    }
  }

  // Shelf rows. Row width target ~ sqrt of the total footprint area.
  const areas = order.map((p) => {
    const c = p.pattern.courtyard;
    return (c.w + COURTYARD_GAP) * (c.h + COURTYARD_GAP);
  });
  const total = areas.reduce((a, b) => a + b, 0);
  const rowWidth = Math.max(30, Math.ceil(Math.sqrt(total * 1.8)));

  const placed = [];
  let cx = EDGE_MARGIN; let cy = EDGE_MARGIN; let rowH = 0;
  for (const part of order) {
    const o = overrides?.parts?.[part.id];
    const c = part.pattern.courtyard;
    if (o && Number.isFinite(o.x) && Number.isFinite(o.y)) {
      placed.push({ ...part, x: o.x, y: o.y, fixed: true });
      continue;
    }
    if (cx + c.w > EDGE_MARGIN + rowWidth && rowH > 0) {
      cx = EDGE_MARGIN; cy += rowH + COURTYARD_GAP; rowH = 0;
    }
    placed.push({ ...part, x: cx + c.w / 2, y: cy + c.h / 2, fixed: false });
    cx += c.w + COURTYARD_GAP;
    rowH = Math.max(rowH, c.h);
  }

  // Push auto-placed parts off any overridden courtyard they landed on.
  const fixed = placed.filter((p) => p.fixed);
  for (const p of placed) {
    if (p.fixed) continue;
    for (const f of fixed) {
      const overlapX = Math.abs(p.x - f.x) < (p.pattern.courtyard.w + f.pattern.courtyard.w) / 2 + COURTYARD_GAP;
      const overlapY = Math.abs(p.y - f.y) < (p.pattern.courtyard.h + f.pattern.courtyard.h) / 2 + COURTYARD_GAP;
      if (overlapX && overlapY) {
        p.y = f.y + (f.pattern.courtyard.h + p.pattern.courtyard.h) / 2 + COURTYARD_GAP;
      }
    }
  }
  return placed;
}

// ── routing ────────────────────────────────────────────────────────

class Obstacles {
  constructor(clearance) {
    this.clearance = clearance;
    this.byLayer = { 1: [], 2: [] };
  }
  add(shape, net, layer) {
    const entry = { shape, net, bbox: bboxOf(shape) };
    if (layer === 0) { this.byLayer[1].push(entry); this.byLayer[2].push(entry); }
    else this.byLayer[layer].push(entry);
  }
  /** Is a track point (with halfwidth r) at (x,y,layer) clear of foreign copper? */
  clear(x, y, layer, net, r) {
    const need = this.clearance + r;
    const probe = { kind: 'point', x, y, r: 0 };
    for (const o of this.byLayer[layer]) {
      if (o.net === net) continue;
      if (x < o.bbox.minX - need || x > o.bbox.maxX + need ||
          y < o.bbox.minY - need || y > o.bbox.maxY + need) continue;
      if (shapeDist(probe, o.shape) < need) return false;
    }
    return true;
  }

  /**
   * Is the whole SEGMENT clear? Cells are not enough: two diagonal moves
   * of different nets can cross between lattice points with every endpoint
   * in the clear — measured as 20 overlapping pairs on the first full
   * board this router produced. The edge is what carries copper, so the
   * edge is what gets checked.
   */
  clearSeg(x1, y1, x2, y2, layer, net, r) {
    const need = this.clearance + r;
    const probe = { kind: 'seg', x1, y1, x2, y2, r: 0 };
    const bMinX = Math.min(x1, x2); const bMaxX = Math.max(x1, x2);
    const bMinY = Math.min(y1, y2); const bMaxY = Math.max(y1, y2);
    for (const o of this.byLayer[layer]) {
      if (o.net === net) continue;
      if (bMaxX < o.bbox.minX - need || bMinX > o.bbox.maxX + need ||
          bMaxY < o.bbox.minY - need || bMinY > o.bbox.maxY + need) continue;
      if (shapeDist(probe, o.shape) < need) return false;
    }
    return true;
  }
}

function bboxOf(s) {
  const pts = s.kind === 'poly' ? s.pts : s.kind === 'seg' ? [[s.x1, s.y1], [s.x2, s.y2]] : [[s.x, s.y]];
  const r = s.r || 0;
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const [x, y] of pts) {
    minX = Math.min(minX, x - r); maxX = Math.max(maxX, x + r);
    minY = Math.min(minY, y - r); maxY = Math.max(maxY, y + r);
  }
  return { minX, minY, maxX, maxY };
}

const DIRS = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
];

/**
 * A* from a start point to ANY of a set of target points, on the lattice,
 * two layers, via cost. Returns {points: [[x,y,layer]…]} or null.
 */
/* targets: [{x, y, layers}] where layers is 0 (both copper layers: a
 * through pad, a via, or a point on both) or 1|2. The first version kept
 * bare points and a top-layer path happily "connected" to bottom-layer
 * copper 5 um away in XY — the copper netlist caught it as a net split. */
function route(startPt, targets, net, obstacles, bounds, opts) {
  const r = TRACK_WIDTH_MM / 2;
  const viaR = VIA_DIAMETER_MM / 2;
  const { minX, minY, maxX, maxY } = bounds;
  const cols = Math.floor((maxX - minX) / GRID) + 1;
  const keyOf = (ix, iy, layer) => (layer - 1) * 1e9 + iy * cols + ix;
  const toXY = (ix, iy) => [minX + ix * GRID, minY + iy * GRID];
  const targetCells = new Set();
  for (const t of targets) {
    const ix = Math.round((t.x - minX) / GRID); const iy = Math.round((t.y - minY) / GRID);
    for (let dx = -2; dx <= 2; dx++) {
      for (let dy = -2; dy <= 2; dy++) {
        targetCells.add(iy + dy + ':' + (ix + dx));
      }
    }
  }
  const h = (x, y) => {
    let best = Infinity;
    for (const t of targets) best = Math.min(best, Math.hypot(t.x - x, t.y - y));
    return best;
  };
  const startIx = Math.round((startPt[0] - minX) / GRID);
  const startIy = Math.round((startPt[1] - minY) / GRID);

  const open = []; // simple binary heap
  const push = (node) => {
    open.push(node);
    let i = open.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (open[p].f <= open[i].f) break; [open[p], open[i]] = [open[i], open[p]]; i = p; }
  };
  const pop = () => {
    const top = open[0]; const last = open.pop();
    if (open.length) {
      open[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1; const rr = l + 1; let m = i;
        if (l < open.length && open[l].f < open[m].f) m = l;
        if (rr < open.length && open[rr].f < open[m].f) m = rr;
        if (m === i) break;
        [open[m], open[i]] = [open[i], open[m]]; i = m;
      }
    }
    return top;
  };

  const gScore = new Map();
  const seedLayers = opts.startLayers || [1, 2];
  for (const layer of seedLayers) {
    // Stitch the (possibly off-lattice) pad centre onto nearby cells.
    for (let dx = -2; dx <= 2; dx++) {
      for (let dy = -2; dy <= 2; dy++) {
        const ix = startIx + dx; const iy = startIy + dy;
        if (ix < 0 || iy < 0 || ix >= cols) continue;
        const [x, y] = toXY(ix, iy);
        if (!obstacles.clear(x, y, layer, net, r)) continue;
        const d = Math.hypot(x - startPt[0], y - startPt[1]);
        if (d > GRID * 2.2) continue;
        // The stitch from the (off-lattice) pad centre is itself copper.
        if (!obstacles.clearSeg(startPt[0], startPt[1], x, y, layer, net, r)) continue;
        const k = keyOf(ix, iy, layer);
        if (!gScore.has(k) || gScore.get(k) > d) {
          gScore.set(k, d);
          push({ ix, iy, layer, g: d, f: d + h(x, y), parent: null, dir: -1 });
        }
      }
    }
  }

  const closed = new Map();
  let expansions = 0;
  const LIMIT = opts.expansionLimit || 200000;
  while (open.length) {
    if (++expansions > LIMIT) return null;
    const cur = pop();
    const k = keyOf(cur.ix, cur.iy, cur.layer);
    if (closed.has(k)) continue;
    closed.set(k, cur);
    const [cx, cy] = toXY(cur.ix, cur.iy);

    // Goal: near a target point and the closing segment is clear.
    if (targetCells.has(cur.iy + ':' + cur.ix)) {
      for (const t of targets) {
        if (t.layers !== 0 && t.layers !== cur.layer) continue;
        const tx = t.x; const ty = t.y;
        if (Math.hypot(tx - cx, ty - cy) <= GRID * 2.2
            && obstacles.clearSeg(cx, cy, tx, ty, cur.layer, net, r)) {
          const path = [];
          let n = cur;
          while (n) { path.push([minX + n.ix * GRID, minY + n.iy * GRID, n.layer]); n = n.parent; }
          path.reverse();
          return { points: path, entry: startPt, exit: [tx, ty] };
        }
      }
    }

    for (let d = 0; d < DIRS.length; d++) {
      const [dx, dy] = DIRS[d];
      const ix = cur.ix + dx; const iy = cur.iy + dy;
      if (ix < 0 || iy < 0 || ix >= cols) continue;
      const [nx, ny] = toXY(ix, iy);
      if (nx < minX || nx > maxX || ny < minY || ny > maxY) continue;
      if (!obstacles.clearSeg(cx, cy, nx, ny, cur.layer, net, r)) continue;
      const step = Math.hypot(dx, dy) * GRID;
      const turn = cur.dir >= 0 && cur.dir !== d ? 0.05 : 0;
      const g = cur.g + step + turn;
      const nk = keyOf(ix, iy, cur.layer);
      if (gScore.has(nk) && gScore.get(nk) <= g) continue;
      gScore.set(nk, g);
      push({ ix, iy, layer: cur.layer, g, f: g + h(nx, ny), parent: cur, dir: d });
    }
    // Layer change via a via.
    const other = cur.layer === 1 ? 2 : 1;
    if (obstacles.clear(cx, cy, 1, net, viaR) && obstacles.clear(cx, cy, 2, net, viaR)) {
      const g = cur.g + 3.0;
      const nk = keyOf(cur.ix, cur.iy, other);
      if (!gScore.has(nk) || gScore.get(nk) > g) {
        gScore.set(nk, g);
        push({ ix: cur.ix, iy: cur.iy, layer: other, g, f: g + h(cx, cy), parent: cur, dir: -1 });
      }
    }
  }
  return null;
}

/** Compress a lattice path into per-layer polylines plus via positions. */
function pathToTracks(path, entry, exit) {
  const tracks = [];
  const vias = [];
  let cur = { layer: path[0][2], points: [[entry[0], entry[1]]] };
  const pushPoint = (x, y) => {
    const last = cur.points[cur.points.length - 1];
    if (last[0] !== x || last[1] !== y) cur.points.push([x, y]);
  };
  for (let i = 0; i < path.length; i++) {
    const [x, y, layer] = path[i];
    if (layer !== cur.layer) {
      vias.push([x, y]);
      if (cur.points.length >= 2) tracks.push(cur);
      cur = { layer, points: [[x, y]] };
      continue;
    }
    pushPoint(x, y);
  }
  pushPoint(exit[0], exit[1]);
  if (cur.points.length >= 2) tracks.push(cur);
  // Drop collinear midpoints.
  for (const t of tracks) {
    const out = [t.points[0]];
    for (let i = 1; i + 1 < t.points.length; i++) {
      const [ax, ay] = out[out.length - 1]; const [bx, by] = t.points[i]; const [cx2, cy2] = t.points[i + 1];
      const cross = (bx - ax) * (cy2 - ay) - (by - ay) * (cx2 - ax);
      if (Math.abs(cross) > 1e-9) out.push(t.points[i]);
    }
    out.push(t.points[t.points.length - 1]);
    t.points = out;
  }
  return { tracks, vias };
}

// ── the projection ─────────────────────────────────────────────────

/**
 * @param {object} circuit  {parts: [{id, kind, params}], wires}
 * @param {object} [opts]
 * @param {object} [opts.overrides]  circuit.pcb: {parts: {id: {x,y,package}}}
 * @param {number} [opts.clearance]
 * @returns {{board, unplaced: string[], unrouted: string[], warnings: string[]}}
 */
export function projectBoard(circuit, opts = {}) {
  const warnings = [];
  const overrides = opts.overrides || null;
  const clearance = opts.clearance ?? DEFAULT_CLEARANCE_MM;

  const placeable = [];
  const unplaced = [];
  for (const part of circuit.parts) {
    if (RAIL_KINDS.has(part.kind)) continue;
    const pattern = resolvePattern(part, overrides);
    if (!pattern) {
      unplaced.push(part.id);
      warnings.push(`${part.id}: no land pattern for kind "${part.kind}" — not placed.`);
      continue;
    }
    placeable.push({ id: part.id, kind: part.kind, pattern });
  }

  const nets = netsFromCircuit(circuit)
    .map((n) => ({ ...n, members: n.members.filter((m) => placeable.some((p) => p.id === m.partId)) }))
    .filter((n) => n.members.length >= 2);

  const placed = placeParts(placeable, nets, overrides);

  // Choose ONE pad per (part, terminal): the one closest to the net's
  // centroid, so the routed pad is the natural one.
  const partById = new Map(placed.map((p) => [p.id, p]));
  const netOfPad = new Map(); // `${partId}\t${padNum}` -> net name
  const netPoints = new Map(); // net name -> [[x, y]]
  for (const net of nets) {
    const centroid = [0, 0];
    let n = 0;
    for (const m of net.members) {
      const part = partById.get(m.partId);
      for (const pad of part.pattern.pads) {
        if (pad.terminal !== m.terminal) continue;
        centroid[0] += part.x + pad.x; centroid[1] += part.y + pad.y; n++;
      }
    }
    centroid[0] /= n; centroid[1] /= n;
    const pts = [];
    for (const m of net.members) {
      const part = partById.get(m.partId);
      let best = null;
      for (const pad of part.pattern.pads) {
        if (pad.terminal !== m.terminal) continue;
        const d = Math.hypot(part.x + pad.x - centroid[0], part.y + pad.y - centroid[1]);
        if (!best || d < best.d) best = { pad, d };
      }
      if (!best) continue;
      netOfPad.set(`${m.partId}\t${best.pad.num}`, net.name);
      pts.push({
        x: part.x + best.pad.x, y: part.y + best.pad.y,
        layers: (best.pad.drill || 0) > 0 ? 0 : 1, // through pads live on both layers
      });
    }
    netPoints.set(net.name, pts);
  }

  // Board frame.
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const p of placed) {
    minX = Math.min(minX, p.x - p.pattern.courtyard.w / 2);
    maxX = Math.max(maxX, p.x + p.pattern.courtyard.w / 2);
    minY = Math.min(minY, p.y - p.pattern.courtyard.h / 2);
    maxY = Math.max(maxY, p.y + p.pattern.courtyard.h / 2);
  }
  if (!placed.length) { minX = 0; minY = 0; maxX = 10; maxY = 10; }
  const ox = minX - EDGE_MARGIN; const oy = minY - EDGE_MARGIN;
  const W = maxX + EDGE_MARGIN - ox; const H = maxY + EDGE_MARGIN - oy;

  // Board parts in model space (origin bottom-left of outline).
  const modelParts = placed.map((p) => ({
    id: p.id, ref: p.id, name: p.kind,
    // kind:variant — our own package vocabulary, recognised by
    // recognizePackage, so a PROJECTED board lifts and DRCs (terminal
    // maps!) exactly like an imported one. A bare variant name was
    // unrecognisable and silently disabled terminal-short on every
    // projected board (found by the MNA fault demo).
    package: `${p.kind}:${p.pattern.variant}`, attrs: {},
    x: p.x - ox, y: p.y - oy, rotation: 0, side: 'top',
    pads: p.pattern.pads.map((pad) => ({
      num: pad.num,
      net: netOfPad.get(`${p.id}\t${pad.num}`) || '',
      shape: pad.shape, x: p.x + pad.x - ox, y: p.y + pad.y - oy,
      w: pad.w, h: pad.h, rotation: 0,
      drill: pad.drill || 0, slotLength: 0, plated: true,
      through: (pad.drill || 0) > 0,
      layer: (pad.drill || 0) > 0 ? 'through' : 'top',
      points: null, id: `${p.id}-p${pad.num}`,
    })),
    silk: {
      tracks: [], arcs: [],
      texts: [
        { kind: 'P', x: p.x - ox, y: p.y + p.pattern.courtyard.h / 2 + 1 - oy, rotation: 0, mirror: false, layerId: 3, text: p.id, display: true, id: `${p.id}-ref` },
        // A connector without a pin legend earns a DRC warning for good
        // reason (a reversed rail kills the module) — so the projection
        // marks pin 1 wherever the pattern declares one.
        ...(p.pattern.pin1 ? [{
          kind: 'L', x: p.x + p.pattern.pin1.x - ox, y: p.y + p.pattern.pin1.y - 1.7 - oy,
          rotation: 0, mirror: false, layerId: 3, text: '1', display: true, id: `${p.id}-pin1`,
        }] : []),
      ],
      circles: (p.pattern.silk || []).filter((s) => s.kind === 'circle')
        .map((s, i) => ({ cx: p.x + s.x - ox, cy: p.y + s.y - oy, r: s.r, layerId: 3, id: `${p.id}-sc${i}` })),
      rects: (p.pattern.silk || []).filter((s) => s.kind === 'rect')
        .map((s, i) => ({ x: p.x + s.x - ox, y: p.y + s.y - oy, w: s.w, h: s.h, layerId: 3, id: `${p.id}-sr${i}` })),
    },
    warnings: [],
  }));

  // ── route ────────────────────────────────────────────────────────
  const obstacles = new Obstacles(clearance);
  for (const mp of modelParts) {
    for (const pad of mp.pads) {
      obstacles.add(padShape(pad), pad.net, pad.through ? 0 : 1);
    }
  }

  const bounds = { minX: EDGE_MARGIN / 2, minY: EDGE_MARGIN / 2, maxX: W - EDGE_MARGIN / 2, maxY: H - EDGE_MARGIN / 2 };
  const modelTracks = [];
  const modelVias = [];
  const unrouted = [];
  let trackSeq = 0;

  for (const net of nets) {
    const pts = (netPoints.get(net.name) || []).map((p) => ({ x: p.x - ox, y: p.y - oy, layers: p.layers }));
    if (pts.length < 2) continue;
    // Nearest-first spanning: grow the routed set point by point. Every
    // entry in `done` knows WHICH LAYERS its copper occupies (0 = both):
    // a goal is only a goal on a matching layer.
    const done = [pts[0]];
    const todo = pts.slice(1);
    let failed = false;
    while (todo.length) {
      todo.sort((a, b) => {
        const da = Math.min(...done.map((q) => Math.hypot(a.x - q.x, a.y - q.y)));
        const db = Math.min(...done.map((q) => Math.hypot(b.x - q.x, b.y - q.y)));
        return da - db;
      });
      const next = todo.shift();
      const result = route([next.x, next.y], done, net.name, obstacles, bounds,
        { ...opts, startLayers: next.layers === 0 ? [1, 2] : [next.layers] });
      if (!result) { failed = true; break; }
      const { tracks, vias } = pathToTracks(result.points, result.entry, result.exit);
      for (const t of tracks) {
        const track = {
          layer: t.layer === 2 ? 'bottom' : 'top', layerId: t.layer,
          net: net.name, width: TRACK_WIDTH_MM, points: t.points, id: `rt${++trackSeq}`,
        };
        modelTracks.push(track);
        for (const s of trackShapes(track)) obstacles.add(s, net.name, t.layer);
        for (const p of t.points) done.push({ x: p[0], y: p[1], layers: t.layer });
      }
      for (const [x, y] of vias) {
        const via = { x, y, diameter: VIA_DIAMETER_MM, drill: VIA_DRILL_MM, net: net.name, id: `rv${++trackSeq}` };
        modelVias.push(via);
        obstacles.add(viaShape(via), net.name, 0);
        done.push({ x, y, layers: 0 });
      }
      done.push(next);
    }
    if (failed) {
      unrouted.push(net.name);
      warnings.push(`Net ${net.name}: no route found; left as ratsnest.`);
    }
  }

  const board = {
    format: 'projected-board',
    parts: modelParts,
    freePads: [],
    tracks: modelTracks,
    vias: modelVias,
    holes: [], arcs: [], pours: [],
    outline: [
      { type: 'line', x1: 0, y1: 0, x2: W, y2: 0, id: 'edge' },
      { type: 'line', x1: W, y1: 0, x2: W, y2: H, id: 'edge' },
      { type: 'line', x1: W, y1: H, x2: 0, y2: H, id: 'edge' },
      { type: 'line', x1: 0, y1: H, x2: 0, y2: 0, id: 'edge' },
    ],
    silk: { tracks: [], arcs: [], texts: [], circles: [], rects: [] },
    texts: [],
    nets: nets.map((n) => n.name).sort(),
    copperLayers: [1, 2],
    bbox: { w: W, h: H },
    origin: null,
    warnings,
    ignored: [],
  };
  return { board, unplaced, unrouted, warnings };
}

/**
 * Project a live Circuit instance: the REAL netlist extractor dissolves
 * breadboards and rails, so a breadboarded canvas circuit projects the
 * same board its schematic shows. Overrides default to circuit.pcb.
 */
export function projectBoardFromCircuit(circuit, opts = {}) {
  const netlist = extractNetlist(circuit);
  const parts = netlist.parts.map((p) => {
    const src = circuit.parts.find((q) => q.id === p.partId);
    return { id: p.partId, kind: p.kind, params: src?.params || p.params || {} };
  });
  const wires = [];
  for (const net of netlist.nets) {
    const nodes = net.nodes;
    for (let i = 1; i < nodes.length; i++) {
      wires.push({
        from: nodes[0].partId, fromTerminal: nodes[0].pin,
        to: nodes[i].partId, toTerminal: nodes[i].pin,
      });
    }
  }
  // The canvas powers circuits through rail SYMBOLS; a board needs the
  // connector those rails stand for. Two recoveries here, both measured
  // as losses before the fix: (a) extractNetlist strips rail NODES from
  // its nets, so rail-to-part edges come from the raw wires instead;
  // (b) one power header is synthesized, pin 1 = VCC, then one pin per
  // further rail, so the power nets have a physical landing.
  const rails = circuit.parts.filter((q) => q.kind === 'vcc' || q.kind === 'gnd');
  const railIds = new Set(rails.map((q) => q.id));
  for (const w of circuit.wires || []) {
    const fe = wireEndpoint(w, 'from');
    const te = wireEndpoint(w, 'to');
    if (!fe?.part || !te?.part) continue;
    const railEnd = railIds.has(fe.part) ? fe : railIds.has(te.part) ? te : null;
    const other = railEnd === fe ? te : fe;
    if (!railEnd || railIds.has(other.part)) continue;
    wires.push({ from: railEnd.part, fromTerminal: railEnd.terminal, to: other.part, toTerminal: other.terminal });
  }
  if (rails.length && !parts.some((q) => q.id === 'J_PWR')) {
    const seen = new Set();
    const railPins = [];
    for (const rail of rails.sort((a, b) => (a.kind === 'vcc' ? -1 : 1))) {
      if (seen.has(rail.kind)) continue;
      seen.add(rail.kind);
      railPins.push(rail);
    }
    parts.push({ id: 'J_PWR', kind: 'header', params: { pins: Math.max(2, railPins.length) } });
    railPins.forEach((rail, i) => {
      // The rail marker parts ride along so netsFromCircuit can dissolve
      // them into their NAMED nets (the netlist extractor had already
      // stripped them from `parts`).
      parts.push({ id: rail.id, kind: rail.kind, params: {} });
      wires.push({ from: rail.id, fromTerminal: rail.kind, to: 'J_PWR', toTerminal: `p${i + 1}` });
    });
  }
  return projectBoard({ parts, wires }, { overrides: circuit.pcb || null, ...opts });
}
