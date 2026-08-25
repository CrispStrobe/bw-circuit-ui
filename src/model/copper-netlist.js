/**
 * The copper netlist: what the board's copper ACTUALLY joins.
 *
 * One artifact, three consumers (docs/PCB-SUPPORT-PLAN.md, Phase 0.5): the
 * `net-island` DRC rule (declared net ≠ copper island), the export
 * round-trip oracle's comparator, and fault injection — feeding the
 * simulator the board as built instead of the circuit as drawn.
 *
 * Input is the Phase-0 board model (mm, Y up). Connectivity is geometric
 * and EXACT for pads, tracks, arcs (sampled fine) and vias, using
 * pcb-geometry's shape distances. Pours come in two honesties:
 *
 *   - `fillFromFile` pours carry EasyEDA's own computed fill polygons.
 *     Those are real copper with the clearance carve-outs already taken,
 *     so they join ANYTHING they touch, regardless of declared net — a
 *     different-net pad genuinely touching a fill is a genuine short and
 *     must surface as one.
 *   - outline-only pours are an OVER-APPROXIMATION (the real fill is the
 *     outline minus carve-outs we have not computed). They join only
 *     objects DECLARING the pour's net, and every island reached that way
 *     is labelled `approxPour: true`. A known over-approximation is a
 *     tool; a silent one is a lie — the label is the difference (§5
 *     Phase 0.5, §7.3).
 *
 * Declared nets play NO other part in connectivity. The copper decides;
 * comparing copper against declarations is the caller's business.
 *
 * @module
 */

import {
  padShape, trackShapes, viaShape, shapesTouch, shapeListDist,
} from './pcb-geometry.js';

const WILDCARD_LAYER = 0; // vias and through-pads exist on every copper layer

/** Union-find, path halving. */
class UnionFind {
  constructor(n) { this.p = Array.from({ length: n }, (_, i) => i); }
  find(i) { let { p } = this; while (p[i] !== i) { p[i] = p[p[i]]; i = p[i]; } return i; }
  union(a, b) { const ra = this.find(a); const rb = this.find(b); if (ra !== rb) this.p[ra] = rb; }
}

/** Sample an arc model (importer output: segs of line|arc) into polylines. */
function arcToTracks(arc) {
  const points = [];
  for (const s of arc.segs) {
    if (!points.length) points.push([s.x1, s.y1]);
    if (s.type === 'line') { points.push([s.x2, s.y2]); continue; }
    // Fine sampling: 24 steps keeps chord error far below any clearance
    // at PCB arc radii (error r(1-cos(θ/2)), sub-micron for r ≤ 100 mm).
    const steps = 24;
    for (let k = 1; k <= steps; k++) {
      // Reuse the SVG arc math by linear parameter fallback would be wrong;
      // the importer already converted arcs to endpoint form, so sample via
      // the same endpoint parameterisation.
      points.push(sampleArcPoint(s, k / steps));
    }
  }
  return { width: arc.width || 0, points, layerId: arc.layerId, net: arc.net };
}

/** Point at parameter t along an endpoint-parameterised elliptical arc. */
function sampleArcPoint(a, t) {
  const { x1, y1, x2, y2, largeArc, sweep } = a;
  let rx = Math.abs(a.rx); let ry = Math.abs(a.ry);
  if (!rx || !ry) return [x2, y2];
  const phi = ((a.rot || 0) * Math.PI) / 180;
  const cosP = Math.cos(phi); const sinP = Math.sin(phi);
  const dx = (x1 - x2) / 2; const dy = (y1 - y2) / 2;
  const x1p = cosP * dx + sinP * dy; const y1p = -sinP * dx + cosP * dy;
  const lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lam > 1) { const s = Math.sqrt(lam); rx *= s; ry *= s; }
  const sign = largeArc !== sweep ? 1 : -1;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const rad = Math.max(0, (rx * rx * ry * ry - den) / den);
  const co = sign * Math.sqrt(rad);
  const cxp = (co * rx * y1p) / ry; const cyp = (-co * ry * x1p) / rx;
  const cx = cosP * cxp - sinP * cyp + (x1 + x2) / 2;
  const cy = sinP * cxp + cosP * cyp + (y1 + y2) / 2;
  const ang = (ux, uy, vx, vy) => {
    const dot = ux * vx + uy * vy;
    const len = Math.hypot(ux, uy) * Math.hypot(vx, vy);
    let th = Math.acos(Math.min(1, Math.max(-1, dot / len)));
    if (ux * vy - uy * vx < 0) th = -th;
    return th;
  };
  const th1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dth = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && dth > 0) dth -= 2 * Math.PI;
  if (sweep && dth < 0) dth += 2 * Math.PI;
  const th = th1 + dth * t;
  const px = rx * Math.cos(th); const py = ry * Math.sin(th);
  return [cosP * px - sinP * py + cx, sinP * px + cosP * py + cy];
}

const layerIdOf = (name) => (name === 'bottom' ? 2 : name === 'top' ? 1 : WILDCARD_LAYER);

/**
 * @param {object} board  importEasyEdaPcb output
 * @returns {{
 *   islands: Array<{pads: Array<{partId,ref,num,net,layer}>, nets: string[],
 *                   layers: number[], approxPour: boolean}>,
 *   netIslands: Record<string, number[]>,  // declared net -> island indices
 *   approx: boolean,                       // any outline-only pour involved
 *   nodeCount: number,
 * }}
 */
export function computeCopperNetlist(board, opts = {}) {
  const onUnion = opts.onUnion || null;
  // ── nodes ────────────────────────────────────────────────────────
  const nodes = [];
  const addNode = (n) => { nodes.push(n); return nodes.length - 1; };

  const allPads = [];
  for (const part of board.parts) {
    for (const pad of part.pads) allPads.push({ pad, partId: part.id, ref: part.ref });
  }
  for (const pad of board.freePads) allPads.push({ pad, partId: '', ref: '' });

  for (const { pad, partId, ref } of allPads) {
    addNode({
      type: 'pad',
      layer: pad.through ? WILDCARD_LAYER : layerIdOf(pad.layer),
      net: pad.net,
      shapes: [padShape(pad)],
      pad: { partId, ref, num: pad.num, net: pad.net, layer: pad.layer },
    });
  }
  for (const t of board.tracks) {
    addNode({ type: 'track', layer: t.layerId, net: t.net, shapes: trackShapes(t) });
  }
  for (const a of board.arcs) {
    addNode({ type: 'arc', layer: a.layerId, net: a.net, shapes: trackShapes(arcToTracks(a)) });
  }
  for (const v of board.vias) {
    addNode({ type: 'via', layer: WILDCARD_LAYER, net: v.net, shapes: [viaShape(v)] });
  }
  for (const c of board.pours) {
    const exact = !!c.fillFromFile;
    // One even-odd REGION per fill group: a group's later rings are the
    // carve-out holes around other nets, and holes are not copper. The
    // outline fallback is a single-ring region (the over-approximation).
    const groups = exact ? c.fills : (c.outline.length >= 3 ? [[c.outline]] : []);
    addNode({
      type: 'pour', layer: c.layerId, net: c.net, exact,
      shapes: groups.map((rings) => ({ kind: 'region', rings, r: 0 })),
    });
  }

  // ── edges ────────────────────────────────────────────────────────
  const uf = new UnionFind(nodes.length);
  const sameLayer = (a, b) =>
    a.layer === WILDCARD_LAYER || b.layer === WILDCARD_LAYER || a.layer === b.layer;

  // Cheap bbox prefilter so the pairwise pass stays honest but not slow.
  const bboxOf = (n) => {
    let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
    for (const s of n.shapes) {
      const pts = s.kind === 'poly' ? s.pts
        : s.kind === 'seg' ? [[s.x1, s.y1], [s.x2, s.y2]] : [[s.x, s.y]];
      const r = s.r || 0;
      for (const [x, y] of pts) {
        minX = Math.min(minX, x - r); maxX = Math.max(maxX, x + r);
        minY = Math.min(minY, y - r); maxY = Math.max(maxY, y + r);
      }
    }
    return { minX, minY, maxX, maxY };
  };
  const boxes = nodes.map(bboxOf);
  const boxesApart = (a, b) =>
    a.minX > b.maxX || b.minX > a.maxX || a.minY > b.maxY || b.minY > a.maxY;

  const touch = (a, b) => {
    for (const sa of a.shapes) {
      if (shapeListDist(sa, b.shapes) === 0) return true;
    }
    return false;
  };

  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i]; const b = nodes[j];
      if (!sameLayer(a, b)) continue;
      if (boxesApart(boxes[i], boxes[j])) continue;
      const pour = a.type === 'pour' ? a : b.type === 'pour' ? b : null;
      const other = pour === a ? b : a;
      if (pour && !pour.exact) {
        // Over-approximation: only what DECLARES the pour's net may join,
        // and the join is labelled. An unlabelled approximation would
        // manufacture connectivity a later exact fill might not have.
        if (!pour.net || other.net !== pour.net) continue;
        if (touch(a, b)) {
          uf.union(i, j); pour.usedApprox = true; other.viaApprox = true;
          if (onUnion) onUnion(a, b);
        }
        continue;
      }
      if (touch(a, b)) { uf.union(i, j); if (onUnion) onUnion(a, b); }
    }
  }

  // ── islands ──────────────────────────────────────────────────────
  const groups = new Map();
  for (let i = 0; i < nodes.length; i++) {
    const root = uf.find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(i);
  }

  const islands = [];
  let anyApprox = false;
  for (const members of groups.values()) {
    const pads = [];
    const netSet = new Set();
    const layerSet = new Set();
    let approxPour = false;
    for (const idx of members) {
      const n = nodes[idx];
      if (n.pad) { pads.push(n.pad); if (n.pad.net) netSet.add(n.pad.net); }
      if (n.layer !== WILDCARD_LAYER) layerSet.add(n.layer);
      if ((n.type === 'pour' && !n.exact && n.usedApprox) || n.viaApprox) approxPour = true;
    }
    if (!pads.length) continue; // copper with no pad: dead copper, not an island of the netlist
    anyApprox = anyApprox || approxPour;
    islands.push({
      pads,
      nets: [...netSet].sort(),
      layers: [...layerSet].sort((x, y) => x - y),
      approxPour,
    });
  }

  const netIslands = {};
  islands.forEach((isl, i) => {
    for (const net of isl.nets) {
      (netIslands[net] = netIslands[net] || []).push(i);
    }
  });

  return { islands, netIslands, approx: anyApprox, nodeCount: nodes.length };
}
