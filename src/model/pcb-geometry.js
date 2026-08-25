/**
 * Exact 2-D distance primitives for the PCB layer.
 *
 * This is the EXACT half of the plan's central discipline (§7.1):
 * "approximate generator, exact checker, and never confuse the two." The v1
 * router prototype modelled rect pads as inscribed circles and a real board
 * came out clean by luck of which way the error went. Everything here is
 * exact for the shapes it names, so both the copper netlist and the DRC can
 * gate heuristics instead of echoing them.
 *
 * The unified shape: every piece of copper is a CORE plus an OUTWARD RADIUS.
 *
 *   { kind: 'point',   x, y,          r }   round pad, via
 *   { kind: 'seg',     x1, y1, x2, y2, r }  track segment, oval/stadium pad
 *   { kind: 'poly',    pts: [[x,y]…],  r }  rect pad (r=0), polygon pad, pour
 *
 * distance(a, b) is then coreDistance − r_a − r_b, clamped at 0 when the
 * inflated shapes touch or overlap. Two facts make the clamp safe: clearance
 * rules only ever ask "is the gap smaller than X", and connectivity only
 * ever asks "is the gap zero"; neither needs penetration depth.
 *
 * Polygon cores are treated as FILLED: containment counts as distance 0,
 * checked by point-in-polygon on top of the edge-to-edge minimum — edge
 * distances alone report a hole where one shape swallows the other.
 *
 * @module
 */

/** Squared length helper. */
const sq = (v) => v * v;

/** Distance from point (px,py) to segment (x1,y1)-(x2,y2). Exact. */
export function pointSegDist(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1; const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

/** Do segments (p1,p2) and (p3,p4) properly intersect or touch? Exact. */
export function segsIntersect(x1, y1, x2, y2, x3, y3, x4, y4) {
  const d = (ax, ay, bx, by, cx, cy) => (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const d1 = d(x3, y3, x4, y4, x1, y1);
  const d2 = d(x3, y3, x4, y4, x2, y2);
  const d3 = d(x1, y1, x2, y2, x3, y3);
  const d4 = d(x1, y1, x2, y2, x4, y4);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
      ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  const on = (ax, ay, bx, by, cx, cy) =>
    Math.min(ax, bx) <= cx && cx <= Math.max(ax, bx) &&
    Math.min(ay, by) <= cy && cy <= Math.max(ay, by);
  if (d1 === 0 && on(x3, y3, x4, y4, x1, y1)) return true;
  if (d2 === 0 && on(x3, y3, x4, y4, x2, y2)) return true;
  if (d3 === 0 && on(x1, y1, x2, y2, x3, y3)) return true;
  if (d4 === 0 && on(x1, y1, x2, y2, x4, y4)) return true;
  return false;
}

/** Distance between two segments. 0 when they intersect. Exact. */
export function segSegDist(x1, y1, x2, y2, x3, y3, x4, y4) {
  if (segsIntersect(x1, y1, x2, y2, x3, y3, x4, y4)) return 0;
  return Math.min(
    pointSegDist(x1, y1, x3, y3, x4, y4),
    pointSegDist(x2, y2, x3, y3, x4, y4),
    pointSegDist(x3, y3, x1, y1, x2, y2),
    pointSegDist(x4, y4, x1, y1, x2, y2),
  );
}

/** Is (px,py) inside (or on the edge of) the polygon ring? Ray cast. */
export function pointInPolygon(px, py, pts) {
  let inside = false;
  const n = pts.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [xi, yi] = pts[i]; const [xj, yj] = pts[j];
    // On-edge counts as inside: connectivity must not lose a pad that sits
    // exactly on a fill boundary, which sampled arcs produce all the time.
    if (pointSegDist(px, py, xj, yj, xi, yi) < 1e-9) return true;
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** Distance from a point to a filled polygon (0 inside). Exact. */
export function pointPolyDist(px, py, pts) {
  if (pointInPolygon(px, py, pts)) return 0;
  let min = Infinity;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    min = Math.min(min, pointSegDist(px, py, pts[j][0], pts[j][1], pts[i][0], pts[i][1]));
  }
  return min;
}

/** Distance from a segment to a filled polygon (0 on touch/cross/inside). */
export function segPolyDist(x1, y1, x2, y2, pts) {
  if (pointInPolygon(x1, y1, pts) || pointInPolygon(x2, y2, pts)) return 0;
  let min = Infinity;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const d = segSegDist(x1, y1, x2, y2, pts[j][0], pts[j][1], pts[i][0], pts[i][1]);
    if (d === 0) return 0;
    min = Math.min(min, d);
  }
  return min;
}

/** Distance between two filled polygons (0 on touch/overlap/containment). */
export function polyPolyDist(a, b) {
  // Containment either way: one vertex test suffices once edges are known
  // not to cross, and the edge loop below returns 0 on any crossing first.
  let min = Infinity;
  for (let i = 0, j = a.length - 1; i < a.length; j = i++) {
    const d = segPolyDist(a[j][0], a[j][1], a[i][0], a[i][1], b);
    if (d === 0) return 0;
    min = Math.min(min, d);
  }
  if (a.length && pointInPolygon(a[0][0], a[0][1], b)) return 0;
  if (b.length && pointInPolygon(b[0][0], b[0][1], a)) return 0;
  return min;
}

// ── regions: filled polygons with holes, even-odd ──────────────────

/**
 * Is (px,py) inside an even-odd region {kind:'region', rings:[[..],..]}?
 * A pour fill is its outline MINUS its carve-out holes; parity over the
 * rings is exactly that. On any ring edge counts as inside — the boundary
 * of copper is copper.
 */
export function regionContains(px, py, rings) {
  let parity = false;
  for (const ring of rings) {
    const n = ring.length;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      if (pointSegDist(px, py, ring[j][0], ring[j][1], ring[i][0], ring[i][1]) < 1e-9) return true;
      if ((ring[i][1] > py) !== (ring[j][1] > py) &&
          px < ((ring[j][0] - ring[i][0]) * (py - ring[i][1])) / (ring[j][1] - ring[i][1]) + ring[i][0]) {
        parity = !parity;
      }
    }
  }
  return parity;
}

function eachRingEdge(rings, fn) {
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const r = fn(ring[j][0], ring[j][1], ring[i][0], ring[i][1]);
      if (r === 0) return 0;
    }
  }
  return undefined;
}

function pointRegionDist(px, py, rings) {
  if (regionContains(px, py, rings)) return 0;
  let min = Infinity;
  eachRingEdge(rings, (x1, y1, x2, y2) => {
    min = Math.min(min, pointSegDist(px, py, x1, y1, x2, y2));
    return min === 0 ? 0 : undefined;
  });
  return min;
}

function segRegionDist(sx1, sy1, sx2, sy2, rings) {
  if (regionContains(sx1, sy1, rings) || regionContains(sx2, sy2, rings)) return 0;
  let min = Infinity;
  const hit = eachRingEdge(rings, (x1, y1, x2, y2) => {
    const d = segSegDist(sx1, sy1, sx2, sy2, x1, y1, x2, y2);
    if (d === 0) return 0;
    min = Math.min(min, d);
    return undefined;
  });
  return hit === 0 ? 0 : min;
}

function polyRegionDist(pts, rings) {
  for (const [x, y] of pts) if (regionContains(x, y, rings)) return 0;
  // A ring vertex inside the polygon means the copper boundary crosses or
  // sits in the pad — a touch even when no pad vertex is in copper (the
  // pad may cover a hole edge).
  for (const ring of rings) for (const [x, y] of ring) if (pointInPolygon(x, y, pts)) return 0;
  let min = Infinity;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const d = segRegionDist(pts[j][0], pts[j][1], pts[i][0], pts[i][1], rings);
    if (d === 0) return 0;
    min = Math.min(min, d);
  }
  return min;
}

function regionRegionDist(a, b) {
  for (const ring of a) for (const [x, y] of ring) if (regionContains(x, y, b)) return 0;
  for (const ring of b) for (const [x, y] of ring) if (regionContains(x, y, a)) return 0;
  let min = Infinity;
  for (const ring of a) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const d = segRegionDist(ring[j][0], ring[j][1], ring[i][0], ring[i][1], b);
      if (d === 0) return 0;
      min = Math.min(min, d);
    }
  }
  return min;
}

// ── the unified shape ──────────────────────────────────────────────

/** Core-to-core distance for the four core kinds. */
function coreDist(a, b) {
  const A = a.kind; const B = b.kind;
  if (A === 'point' && B === 'point') return Math.hypot(a.x - b.x, a.y - b.y);
  if (A === 'point' && B === 'seg') return pointSegDist(a.x, a.y, b.x1, b.y1, b.x2, b.y2);
  if (A === 'seg' && B === 'point') return coreDist(b, a);
  if (A === 'seg' && B === 'seg') return segSegDist(a.x1, a.y1, a.x2, a.y2, b.x1, b.y1, b.x2, b.y2);
  if (A === 'point' && B === 'poly') return pointPolyDist(a.x, a.y, b.pts);
  if (A === 'poly' && B === 'point') return coreDist(b, a);
  if (A === 'seg' && B === 'poly') return segPolyDist(a.x1, a.y1, a.x2, a.y2, b.pts);
  if (A === 'poly' && B === 'seg') return coreDist(b, a);
  if (A === 'poly' && B === 'poly') return polyPolyDist(a.pts, b.pts);
  if (B === 'region') {
    if (A === 'point') return pointRegionDist(a.x, a.y, b.rings);
    if (A === 'seg') return segRegionDist(a.x1, a.y1, a.x2, a.y2, b.rings);
    if (A === 'poly') return polyRegionDist(a.pts, b.rings);
    if (A === 'region') return regionRegionDist(a.rings, b.rings);
  }
  if (A === 'region') return coreDist(b, a);
  throw new Error(`unknown shape kinds ${A}/${B}`);
}

/**
 * Gap between two shapes: core distance minus both outward radii,
 * clamped at 0. Touching or overlapping is 0 by definition.
 */
export function shapeDist(a, b) {
  return Math.max(0, coreDist(a, b) - (a.r || 0) - (b.r || 0));
}

/** Do two shapes touch, within tolerance? */
export function shapesTouch(a, b, tol = 1e-6) {
  return shapeDist(a, b) <= tol;
}

// ── pads and tracks as shapes ──────────────────────────────────────

/** Rotate (x,y) about (cx,cy) by deg. Screen-independent: pure math axes. */
export function rotateAbout(x, y, cx, cy, deg) {
  const th = (deg * Math.PI) / 180;
  const c = Math.cos(th); const s = Math.sin(th);
  const dx = x - cx; const dy = y - cy;
  return [cx + dx * c - dy * s, cy + dx * s + dy * c];
}

/**
 * A pad (importer output: shape/x/y/w/h/rotation/points) as a unified shape.
 *
 * - circle: point core, r = w/2
 * - rect:   4-point poly core, rotated about the pad centre
 * - oval:   stadium — seg core along the long axis, r = short/2
 * - polygon: poly core from its points (already absolute mm)
 *
 * Rotation signs are exactly the kind that read plausibly both ways; the
 * convention above was pinned by measurement, not derivation.
 */
export function padShape(pad) {
  // pad.rotation is CCW-positive in the MODEL (Y-up) frame; importers
  // convert their file conventions to it. EasyEDA stores angles that are
  // model-positive as-is (established at 135 deg on a fabbed board whose
  // castellated pads overlap under the opposite sign); KiCad's CCW-in-
  // Y-down angles negate on the Y flip (importer's duty).
  const rot = pad.rotation || 0;
  if (pad.shape === 'circle' || (!pad.points && pad.w === pad.h && pad.shape !== 'rect')) {
    return { kind: 'point', x: pad.x, y: pad.y, r: pad.w / 2 };
  }
  if (pad.shape === 'polygon' && pad.points && pad.points.length >= 3) {
    return { kind: 'poly', pts: pad.points, r: 0 };
  }
  if (pad.shape === 'oval') {
    // Stadium along the longer axis.
    const long = Math.max(pad.w, pad.h); const short = Math.min(pad.w, pad.h);
    const half = (long - short) / 2;
    let x1; let y1; let x2; let y2;
    if (pad.w >= pad.h) { x1 = pad.x - half; y1 = pad.y; x2 = pad.x + half; y2 = pad.y; }
    else { x1 = pad.x; y1 = pad.y - half; x2 = pad.x; y2 = pad.y + half; }
    [x1, y1] = rotateAbout(x1, y1, pad.x, pad.y, rot);
    [x2, y2] = rotateAbout(x2, y2, pad.x, pad.y, rot);
    return { kind: 'seg', x1, y1, x2, y2, r: short / 2 };
  }
  // rect (and the fallback for anything else with w×h). A roundrect is
  // EXACTLY a rect shrunk by its corner radius with that radius put back
  // as the outward r — the unified-shape model's Minkowski trick. Modelling
  // it as a sharp rect bulges each corner by r(√2−1) ≈ 0.15 mm at KiCad's
  // default rratio, which touched a tightly-hugging pour on a real board.
  const cr = Math.min(pad.cornerRadius || 0, pad.w / 2, pad.h / 2);
  const hw = pad.w / 2 - cr; const hh = pad.h / 2 - cr;
  const pts = [
    [pad.x - hw, pad.y - hh], [pad.x + hw, pad.y - hh],
    [pad.x + hw, pad.y + hh], [pad.x - hw, pad.y + hh],
  ].map(([x, y]) => rotateAbout(x, y, pad.x, pad.y, rot));
  return { kind: 'poly', pts, r: cr };
}

/** One track polyline as an array of stadium shapes (seg core, r = w/2). */
export function trackShapes(track) {
  const out = [];
  const r = track.width / 2;
  for (let i = 0; i + 1 < track.points.length; i++) {
    const [x1, y1] = track.points[i]; const [x2, y2] = track.points[i + 1];
    out.push({ kind: 'seg', x1, y1, x2, y2, r });
  }
  return out;
}

/** A via as a shape (round, present on every copper layer). */
export function viaShape(via) {
  return { kind: 'point', x: via.x, y: via.y, r: via.diameter / 2 };
}

/** Minimum gap between a shape and a LIST of shapes. */
export function shapeListDist(a, list) {
  let min = Infinity;
  for (const s of list) {
    const d = shapeDist(a, s);
    if (d === 0) return 0;
    min = Math.min(min, d);
  }
  return min;
}

/**
 * Point at parameter t (0..1) along an endpoint-parameterised elliptical
 * arc segment {x1,y1,x2,y2,rx,ry,rot,largeArc,sweep}. Shared by the copper
 * netlist (fine arc sampling) and the KiCad exporter (3-point arcs need
 * the true midpoint, t = 0.5).
 */
export function arcPointAt(a, t) {
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

/**
 * The outline polygon of a roundrect pad (cornerRadius > 0), sampled at
 * `arcSteps` points per corner. Used by exporters whose target format has
 * no roundrect pad (EasyEDA writes these as POLYGON pads). Chord error is
 * r(1 − cos(π/2/steps)) — under 10 µm at KiCad's default radii.
 */
export function padOutlinePolygon(pad, arcSteps = 6) {
  const cr = Math.min(pad.cornerRadius || 0, pad.w / 2, pad.h / 2);
  const hw = pad.w / 2 - cr; const hh = pad.h / 2 - cr;
  const corners = [
    [hw, hh, 0], [-hw, hh, Math.PI / 2], [-hw, -hh, Math.PI], [hw, -hh, 3 * Math.PI / 2],
  ];
  const pts = [];
  for (const [cx, cy, a0] of corners) {
    for (let i = 0; i <= arcSteps; i++) {
      const a = a0 + (Math.PI / 2) * (i / arcSteps);
      pts.push([cx + cr * Math.cos(a), cy + cr * Math.sin(a)]);
    }
  }
  return pts.map(([x, y]) => rotateAbout(pad.x + x, pad.y + y, pad.x, pad.y, pad.rotation || 0));
}
