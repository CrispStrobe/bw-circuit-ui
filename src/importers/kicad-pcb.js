/**
 * KiCad PCB reader (`.kicad_pcb`, v6/v7/v8/v9 s-expressions) → board model.
 *
 * Produces the SAME board model importEasyEdaPcb does — mm, Y up, origin at
 * the outline's bottom-left — so the copper netlist, the DRC, the renderer
 * and the lift consume KiCad boards with zero adapters. KiCad's own frame
 * is mm but Y-DOWN; the flip happens here, exactly as the EasyEDA reader
 * does it, and for the same reason: one model frame, format details stay
 * inside the readers.
 *
 * Grammar knowledge comes from KiCad's published file-format documentation
 * (dev-docs.kicad.org, CC-BY-SA docs — a fact table, recorded in
 * THIRD-PARTY.md) plus measurement of real boards. Load-bearing facts:
 *
 *   - a PAD's (at x y rot) position is in the FOOTPRINT frame and must
 *     be rotated by the footprint's orientation; the pad's own `rot` in
 *     the file is stored ABSOLUTE (footprint angle already added) — the
 *     classic KiCad quirk — and that absolute angle IS the shape's angle
 *     in the board frame. Bottom-side footprints need NO extra mirror
 *     (established with a net-matched track-endpoint oracle over three
 *     real boards, 51/76 vs 9/76 for the mirrored readings).
 *   - internally-joined pads carry the SAME pad number (a 6 mm tact
 *     switch is pads 1,1,2,2) — KiCad footprints self-describe the
 *     terminal map that EasyEDA leaves to the part library.
 *   - zone fills: v6+ writes FRACTURED simple rings, v6-dev and earlier
 *     write carve-out HOLES as separate rings. All of a zone-layer's
 *     rings therefore form ONE even-odd group — disjoint islands keep
 *     parity 1, nested holes get parity 0, one rule serves both eras.
 *   - track arcs and Edge.Cuts arcs are THREE-POINT (start/mid/end) — no
 *     sweep flag to get backwards under a Y flip; the geometry is
 *     sign-proof and converted here to centre form.
 *
 * @module
 */

import { parseSexpr } from './sexpr.js';
import { liftBoardToCircuit } from '../model/board-lift.js';
import { dist } from '../model/exact-hypot.js';

/** Cheap gate for detect.js. */
export function looksLikeKicadPcb(text) {
  return /^\s*\(kicad_pcb\b/.test(text);
}

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** First child list with the given tag. */
const child = (node, tag) => node.find((c) => Array.isArray(c) && c[0] === tag);
/** All child lists with the given tag. */
const children = (node, tag) => node.filter((c) => Array.isArray(c) && c[0] === tag);

/** (at x y [rot]) → {x, y, rot} */
function atOf(node) {
  const at = child(node, 'at');
  if (!at) return { x: 0, y: 0, rot: 0 };
  return { x: num(at[1]), y: num(at[2]), rot: num(at[3] || 0) };
}

/**
 * (pts …) → [[x,y]…]. Entries are (xy x y) — and, from v7 on, fill and
 * polygon points may be (arc (start …) (mid …) (end …)). Dropping the arcs
 * replaced them with chords that cut ACROSS a fill, deforming the region
 * onto pads of other nets (measured, a v9 board). Arcs are sampled here.
 */
function ptsOf(node) {
  const pts = child(node, 'pts');
  if (!pts) return [];
  const out = [];
  for (const p of pts) {
    if (!Array.isArray(p)) continue;
    if (p[0] === 'xy') out.push([num(p[1]), num(p[2])]);
    else if (p[0] === 'arc') {
      const s = child(p, 'start'); const m = child(p, 'mid'); const e = child(p, 'end');
      if (!s || !m || !e) continue;
      out.push([num(s[1]), num(s[2])]);
      out.push(...sampleThreePointArc(num(s[1]), num(s[2]), num(m[1]), num(m[2]), num(e[1]), num(e[2]), 12));
    }
  }
  return out;
}

/** Sample a 3-point arc into `steps` points ending at (ex,ey). */
function sampleThreePointArc(sx, sy, mx, my, ex, ey, steps) {
  const d = 2 * (sx * (my - ey) + mx * (ey - sy) + ex * (sy - my));
  if (Math.abs(d) < 1e-12) return [[ex, ey]];
  const s2 = sx * sx + sy * sy; const m2 = mx * mx + my * my; const e2 = ex * ex + ey * ey;
  const cx = (s2 * (my - ey) + m2 * (ey - sy) + e2 * (sy - my)) / d;
  const cy = (s2 * (ex - mx) + m2 * (sx - ex) + e2 * (mx - sx)) / d;
  const r = dist(sx - cx, sy - cy);
  const a0 = Math.atan2(sy - cy, sx - cx);
  const a1 = Math.atan2(my - cy, mx - cx);
  const a2 = Math.atan2(ey - cy, ex - cx);
  const norm = (a) => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const ccw = norm(a1 - a0) <= norm(a2 - a0);
  const span = ccw ? norm(a2 - a0) : norm(a2 - a0) - 2 * Math.PI;
  const outPts = [];
  for (let i = 1; i <= steps; i++) {
    const th = a0 + (span * i) / steps;
    outPts.push([cx + r * Math.cos(th), cy + r * Math.sin(th)]);
  }
  return outPts;
}

const LAYER_IDS = {
  'F.Cu': 1, 'B.Cu': 2, 'F.SilkS': 3, 'B.SilkS': 4,
  'F.Silkscreen': 3, 'B.Silkscreen': 4, 'Edge.Cuts': 10,
};
const layerIdOf = (name) => LAYER_IDS[name] ?? 12; // everything else: document-ish

function layersOfPad(node, cuOf) {
  const layers = child(node, 'layers');
  if (!layers) return { through: true, layer: 'through' };
  const names = layers.slice(1).map(String);
  if (names.some((n) => n.startsWith('*.Cu'))) return { through: true, layer: 'through' };
  const cu = names.map((n) => cuOf(n)).filter(Boolean);
  if (cu.length >= 2) return { through: true, layer: 'through' };
  if (cu.length === 1) return { through: false, layer: cu[0].layer };
  // Mask- or paste-only apertures (QFN stencil windows, cap-touch
  // soldermask-removal pads) carry NO copper. Defaulting them to top
  // copper bridged two cap-sense combs through their shared mask window
  // on a fabbed board (measured, tomu XX1).
  return { through: false, layer: null };
}

const PAD_SHAPES = { circle: 'circle', rect: 'rect', roundrect: 'rect', oval: 'oval', trapezoid: 'rect', custom: 'polygon' };

/** Rotate (x,y) by deg (KiCad: positive = CCW in its Y-down frame). */
function rot2(x, y, deg) {
  const th = (deg * Math.PI) / 180;
  const c = Math.cos(th); const s = Math.sin(th);
  // Y-down frame: CCW-positive rotation matrix carries a sign flip vs the
  // Y-up convention; measured against real boards (a footprint at 90° puts
  // pad 1 where pcbnew draws it, not mirrored).
  return [x * c + y * s, -x * s + y * c];
}

/** 3-point arc → endpoint form {rx, ry, largeArc, sweep} (raw frame, Y-down). */
function threePointArc(sx, sy, mx, my, ex, ey) {
  // Circumcentre of the three points.
  const d = 2 * (sx * (my - ey) + mx * (ey - sy) + ex * (sy - my));
  if (Math.abs(d) < 1e-12) return null; // collinear: a line
  const s2 = sx * sx + sy * sy; const m2 = mx * mx + my * my; const e2 = ex * ex + ey * ey;
  const cx = (s2 * (my - ey) + m2 * (ey - sy) + e2 * (sy - my)) / d;
  const cy = (s2 * (ex - mx) + m2 * (sx - ex) + e2 * (mx - sx)) / d;
  const r = dist(sx - cx, sy - cy);
  const a0 = Math.atan2(sy - cy, sx - cx);
  const a1 = Math.atan2(my - cy, mx - cx);
  const a2 = Math.atan2(ey - cy, ex - cx);
  const norm = (a) => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  // Does going CCW from start pass through mid before end?
  const ccwMid = norm(a1 - a0); const ccwEnd = norm(a2 - a0);
  const ccw = ccwMid <= ccwEnd;
  const span = ccw ? ccwEnd : 2 * Math.PI - ccwEnd;
  return { rx: r, ry: r, rot: 0, largeArc: span > Math.PI ? 1 : 0, sweep: ccw ? 1 : 0 };
}

/**
 * @param {string} text  Raw .kicad_pcb content
 * @returns board model (importEasyEdaPcb shape); malformed input comes
 *          back as an empty model with the reason in warnings.
 */
export function importKicadPcb(text) {
  const warnings = [];
  const empty = () => ({
    format: 'kicad-pcb', parts: [], freePads: [], tracks: [], vias: [], holes: [],
    arcs: [], pours: [], outline: [], silk: { tracks: [], arcs: [], texts: [], circles: [], rects: [] },
    texts: [], nets: [], copperLayers: [], bbox: { w: 0, h: 0 }, origin: null,
    warnings, ignored: [],
  });

  let tree;
  try { tree = parseSexpr(text); } catch (e) {
    warnings.push(`Not a KiCad board: s-expression parse failed (${e.message})`);
    return empty();
  }
  const root = Array.isArray(tree) && tree[0] === 'kicad_pcb' ? tree
    : Array.isArray(tree) && Array.isArray(tree[0]) && tree[0][0] === 'kicad_pcb' ? tree[0] : null;
  if (!root) {
    warnings.push('Not a KiCad board: no (kicad_pcb …) root.');
    return empty();
  }

  const ignoredCount = new Map();
  const ignore = (t) => ignoredCount.set(t, (ignoredCount.get(t) || 0) + 1);

  // ── the copper table: the file NAMES its own layers ──────────────
  // (layers (0 "F.Cu" signal) (1 "In1.Cu" signal) … (31 "B.Cu" signal)).
  // Copper = the entries typed signal/power/mixed; ordinal 0 is the top,
  // the highest ordinal the bottom, everything between an inner layer —
  // uniform from v4 through v9 in the corpus. Boards RENAME copper
  // (C1F/C2/C3/C4B, Front/Back, Top/Bottom: three of fifteen corpus
  // boards) and 4/6-layer stacks are common; matching the literal string
  // 'B.Cu' put renamed back copper and every inner plane on the top
  // layer — one giant multi-net island on a healthy board.
  const cuTable = new Map(); // name → { layer, layerId }
  {
    const layersNode = child(root, 'layers');
    const entries = (layersNode ? layersNode.slice(1) : []).filter(Array.isArray)
      .map((e) => ({ ord: num(e[0]), name: String(e[1]), type: String(e[2] ?? '') }))
      .filter((e) => e.type === 'signal' || e.type === 'power' || e.type === 'mixed')
      .sort((a, b) => a.ord - b.ord);
    entries.forEach((e, i) => {
      cuTable.set(e.name, i === 0 ? { layer: 'top', layerId: 1, ord: e.ord }
        : i === entries.length - 1 ? { layer: 'bottom', layerId: 2, ord: e.ord }
          : { layer: `inner${i}`, layerId: 20 + i, ord: e.ord });
    });
    // Canonical names always resolve, table or no table.
    if (!cuTable.has('F.Cu')) cuTable.set('F.Cu', { layer: 'top', layerId: 1, ord: 0 });
    if (!cuTable.has('B.Cu')) cuTable.set('B.Cu', { layer: 'bottom', layerId: 2, ord: 31 });
  }
  const unknownCu = new Set();
  const cuOf = (name) => cuTable.get(name) || null;
  // For records that are copper BY CONSTRUCTION (segments, track arcs):
  // an unresolved name falls back to top, said out loud once.
  const cuOfTrack = (name) => {
    const cu = cuOf(name);
    if (cu) return cu;
    unknownCu.add(name);
    return { layer: 'top', layerId: 1 };
  };

  // ── raw parse (KiCad frame: mm, Y down) ──────────────────────────
  const raw = {
    parts: [], tracks: [], vias: [], arcs: [], pours: [],
    outlineSegs: [], silkTracks: [], texts: [], circles: [], rects: [],
  };

  const grLine = (node, into) => {
    const s = child(node, 'start'); const e = child(node, 'end');
    if (!s || !e) return null;
    const layerNode = child(node, 'layer');
    const layer = layerNode ? String(layerNode[1]) : '';
    const stroke = child(node, 'stroke');
    const width = stroke ? num(child(stroke, 'width')?.[1]) : num(child(node, 'width')?.[1]);
    into.push({ x1: num(s[1]), y1: num(s[2]), x2: num(e[1]), y2: num(e[2]), layer, width });
    return into[into.length - 1];
  };

  for (const node of root) {
    if (!Array.isArray(node)) continue;
    const tag = node[0];
    if (tag === 'footprint' || tag === 'module') {
      raw.parts.push(parseFootprint(node, warnings, ignore, cuOf));
    } else if (tag === 'segment') {
      const s = child(node, 'start'); const e = child(node, 'end');
      raw.tracks.push({
        x1: num(s?.[1]), y1: num(s?.[2]), x2: num(e?.[1]), y2: num(e?.[2]),
        width: num(child(node, 'width')?.[1]),
        layer: String(child(node, 'layer')?.[1] || 'F.Cu'),
        net: num(child(node, 'net')?.[1]),
      });
    } else if (tag === 'via') {
      const { x, y } = atOf(node);
      // Blind/micro vias ((via micro …), (via blind …)) span only the
      // copper between the two names in their (layers A B) — treating
      // them as through-all shorted a bottom-side pad against a top→inner
      // microvia tucked under it (measured, fomu-pvt). A through via's
      // (layers F.Cu B.Cu) expands to every copper layer, so the same
      // expansion serves both; absent layers = through (older files).
      const partial = node[1] === 'micro' || node[1] === 'blind';
      let span = null;
      const vl = child(node, 'layers');
      if (partial && vl) {
        const ords = vl.slice(1).map((n) => cuTable.get(String(n))?.ord).filter((o) => o !== undefined);
        if (ords.length === 2) {
          const [lo, hi] = [Math.min(...ords), Math.max(...ords)];
          span = [...cuTable.values()].filter((e) => e.ord >= lo && e.ord <= hi).map((e) => e.layerId);
          span = [...new Set(span)].sort((a, b) => a - b);
        }
      }
      raw.vias.push({
        x, y,
        size: num(child(node, 'size')?.[1]),
        drill: num(child(node, 'drill')?.[1]),
        net: num(child(node, 'net')?.[1]),
        span,
      });
    } else if (tag === 'arc') { // track arc
      const s = child(node, 'start'); const m = child(node, 'mid'); const e = child(node, 'end');
      if (s && m && e) {
        raw.arcs.push({
          sx: num(s[1]), sy: num(s[2]), mx: num(m[1]), my: num(m[2]), ex: num(e[1]), ey: num(e[2]),
          width: num(child(node, 'width')?.[1]),
          layer: String(child(node, 'layer')?.[1] || 'F.Cu'),
          net: num(child(node, 'net')?.[1]),
        });
      }
    } else if (tag === 'zone') {
      if (child(node, 'keepout')) {
        // A keepout / rule area is a CONSTRAINT, not copper. Importing it
        // as a pour manufactured phantom copper spanning everything under
        // it (tomu's two touch-button keepouts shorted the MCU's opposite
        // cap-sense pins on a fabbed, working board).
        ignore('zone:keepout');
        continue;
      }
      const netName = String(child(node, 'net_name')?.[1] ?? '');
      const layerNode = child(node, 'layer') || child(node, 'layers');
      // A zone may span several layers ((layers "F.Cu" "B.Cu")); each
      // filled_polygon then SAYS which layer it fills. Lumping every fill
      // onto one layer merged a healthy board's front fill into its back
      // pads — one giant multi-net island on the first real corpus board.
      const zoneLayers = layerNode ? layerNode.slice(1).map(String) : ['F.Cu'];
      const polygon = child(node, 'polygon');
      const outline = polygon ? ptsOf(polygon) : [];
      const byLayer = new Map();
      for (const fp of children(node, 'filled_polygon')) {
        const fl = String(child(fp, 'layer')?.[1] || zoneLayers[0]);
        if (!byLayer.has(fl)) byLayer.set(fl, []);
        byLayer.get(fl).push(ptsOf(fp));
      }
      if (byLayer.size === 0) {
        for (const l of zoneLayers) byLayer.set(l, []);
      }
      for (const [l, fills] of byLayer) {
        raw.pours.push({ net: netName, layer: l, outline, fills });
      }
    } else if (tag === 'gr_line') {
      const g = grLine(node, []);
      if (!g) continue;
      if (g.layer === 'Edge.Cuts') raw.outlineSegs.push({ type: 'line', ...g });
      else if (g.layer.includes('Silk')) raw.silkTracks.push(g);
      else ignore(`gr_line@${g.layer}`);
    } else if (tag === 'gr_rect') {
      const s = child(node, 'start'); const e = child(node, 'end');
      const layer = String(child(node, 'layer')?.[1] || '');
      if (s && e && layer === 'Edge.Cuts') {
        const [x1, y1, x2, y2] = [num(s[1]), num(s[2]), num(e[1]), num(e[2])];
        raw.outlineSegs.push(
          { type: 'line', x1, y1, x2, y2: y1 }, { type: 'line', x1: x2, y1, x2, y2 },
          { type: 'line', x1: x2, y1: y2, x2: x1, y2 }, { type: 'line', x1, y1: y2, x2: x1, y2: y1 },
        );
      } else ignore(`gr_rect@${layer}`);
    } else if (tag === 'gr_arc') {
      const s = child(node, 'start'); const m = child(node, 'mid'); const e = child(node, 'end');
      const angle = child(node, 'angle');
      const layer = String(child(node, 'layer')?.[1] || '');
      if (layer !== 'Edge.Cuts') { ignore(`gr_arc@${layer}`); continue; }
      if (s && m && e) {
        raw.outlineSegs.push({
          type: 'arc',
          sx: num(s[1]), sy: num(s[2]), mx: num(m[1]), my: num(m[2]), ex: num(e[1]), ey: num(e[2]),
        });
      } else if (s && e && angle) {
        // v5 spelling: (start = CENTRE) (end = a point on the arc)
        // (angle = sweep in degrees, positive clockwise on screen). Convert
        // to the 3-point form by rotating the end point about the centre.
        const cx = num(s[1]); const cy = num(s[2]);
        const ax = num(e[1]); const ay = num(e[2]);
        const sweep = (num(angle[1]) * Math.PI) / 180;
        const rotAbout = (px, py, th) => [
          cx + (px - cx) * Math.cos(th) - (py - cy) * Math.sin(th),
          cy + (px - cx) * Math.sin(th) + (py - cy) * Math.cos(th),
        ];
        const [mx2, my2] = rotAbout(ax, ay, sweep / 2);
        const [ex2, ey2] = rotAbout(ax, ay, sweep);
        raw.outlineSegs.push({ type: 'arc', sx: ax, sy: ay, mx: mx2, my: my2, ex: ex2, ey: ey2 });
      } else ignore('gr_arc@Edge.Cuts(malformed)');
    } else if (tag === 'gr_circle') {
      const c = child(node, 'center'); const e = child(node, 'end');
      const layer = String(child(node, 'layer')?.[1] || '');
      if (c && e && layer === 'Edge.Cuts') {
        // A circular board outline (or a round cutout) as ONE record.
        // Two half-circle arcs: a closed ring for the closure check, and
        // endpoints the renderer's arc path can actually draw (a single
        // full-circle arc would have coincident endpoints — degenerate).
        const cx = num(c[1]); const cy = num(c[2]);
        const r = dist(num(e[1]) - cx, num(e[2]) - cy);
        raw.outlineSegs.push(
          { type: 'arc', sx: cx + r, sy: cy, mx: cx, my: cy + r, ex: cx - r, ey: cy },
          { type: 'arc', sx: cx - r, sy: cy, mx: cx, my: cy - r, ex: cx + r, ey: cy },
        );
      } else if (c && e && layer.includes('Silk')) {
        const cx = num(c[1]); const cy = num(c[2]);
        raw.circles.push({ cx, cy, r: dist(num(e[1]) - cx, num(e[2]) - cy) });
      } else ignore(`gr_circle@${layer}`);
    } else if (tag === 'gr_text') {
      const t = String(node[1] ?? '');
      const { x, y, rot } = atOf(node);
      const layer = String(child(node, 'layer')?.[1] || '');
      raw.texts.push({ kind: 'L', text: t, x, y, rot, layer });
    } else if (tag === 'net' || tag === 'general' || tag === 'layers' || tag === 'version'
      || tag === 'generator' || tag === 'generator_version' || tag === 'paper' || tag === 'setup'
      || tag === 'title_block' || tag === 'net_class' || tag === 'property' || tag === 'embedded_fonts') {
      // structural/metadata nodes, consumed elsewhere or irrelevant
    } else {
      ignore(tag);
    }
  }

  // Net number → name table.
  const netName = new Map();
  for (const n of children(root, 'net')) netName.set(num(n[1]), String(n[2] ?? ''));
  const nameOfNet = (id) => (id ? (netName.get(id) ?? `NET${id}`) : '');

  // ── frame: origin from Edge.Cuts bbox (else copper), Y flip ──────
  const xs = []; const ys = [];
  const eat = (x, y) => { xs.push(x); ys.push(y); };
  for (const s of raw.outlineSegs) {
    if (s.type === 'line') { eat(s.x1, s.y1); eat(s.x2, s.y2); }
    else { eat(s.sx, s.sy); eat(s.mx, s.my); eat(s.ex, s.ey); }
  }
  const hadOutline = xs.length > 0;
  if (!hadOutline) {
    for (const p of raw.parts) for (const pad of p.pads) eat(pad.absX, pad.absY);
    for (const t of raw.tracks) { eat(t.x1, t.y1); eat(t.x2, t.y2); }
    for (const v of raw.vias) eat(v.x, v.y);
    if (xs.length) warnings.push('Board outline (Edge.Cuts) is missing — origin taken from the copper bounding box.');
    else warnings.push('Board has no outline and no copper; nothing to place.');
  }
  const minX = xs.length ? Math.min(...xs) : 0;
  const maxY = ys.length ? Math.max(...ys) : 0;
  const maxX = xs.length ? Math.max(...xs) : 0;
  const minY = ys.length ? Math.min(...ys) : 0;
  const X = (x) => x - minX;
  const Y = (y) => maxY - y;

  const model = empty();
  model.origin = { x: minX, y: maxY, frame: 'kicad-mm' };
  model.bbox = { w: maxX - minX, h: maxY - minY };

  for (const p of raw.parts) {
    for (const h of p.holes || []) {
      model.holes.push({ x: X(h.x), y: Y(h.y), diameter: h.diameter, id: `hole${model.holes.length}` });
    }
  }

  for (const p of raw.parts) {
    model.parts.push({
      id: p.id, ref: p.ref, name: p.value, package: p.package, attrs: { package: p.package },
      x: X(p.x), y: Y(p.y), rotation: p.rot, side: p.side,
      pads: p.pads.map((pad, padIdx) => ({
        num: pad.num, net: nameOfNet(pad.net), shape: pad.shape,
        cornerRadius: pad.cornerRadius || 0,
        x: X(pad.absX), y: Y(pad.absY),
        w: pad.w, h: pad.h,
        // KiCad file angles carry through to the model UN-negated, both
        // sides. The position matrix used here (validated by net-matched
        // track endpoints, 445/652 vs 30/652 on rotated bottom parts) is
        // rotation by -angle in math convention — i.e. file angles are
        // CW-positive in the Y-down frame — so the Y flip to the model's
        // CCW-positive Y-up frame restores +angle. Measured shape-side
        // too: odd-angle cross-net pad pairs in one footprint overlap
        // 425/0 (top) and 93/0 (bottom) under -angle vs +angle.
        rotation: pad.shapeRot,
        drill: pad.drill,
        slotLength: pad.slotLength || 0,
        // Model slot axis: same sign rule as the shape angle; a drill
        // oval taller than wide adds the quarter turn.
        slotRotation: pad.slotLength ? (pad.shapeRot || 0) + (pad.slotAlongX ? 0 : 90) : 0,
        plated: true,
        through: pad.through, layer: pad.layer,
        // Index-suffixed: KiCad's duplicate pad numbers would collide on
        // a num-keyed id, and the internal-terminal merge keys on pad ids.
        points: pad.primLocal
          ? pad.primLocal.map(([px, py]) => {
            const [rx, ry] = rot2(px, py, pad.shapeRot || 0);
            return [X(pad.absX + rx), Y(pad.absY + ry)];
          })
          : null,
        id: `${p.ref || p.id}-${pad.num}-${padIdx}`,
      })),
      silk: {
        tracks: p.silkLines.map((l) => ({
          layer: 'top', layerId: layerIdOf(l.layer), net: '', width: l.width || 0.12,
          points: [[X(l.x1), Y(l.y1)], [X(l.x2), Y(l.y2)]], id: '',
        })),
        arcs: [],
        texts: p.texts.map((t) => ({
          kind: t.kind, x: X(t.x), y: Y(t.y), rotation: t.rot, mirror: false,
          layerId: 3, text: t.text, display: !t.hide, id: '',
        })),
        circles: p.silkCircles.map((c) => ({ cx: X(c.cx), cy: Y(c.cy), r: c.r, layerId: 3, id: '' })),
        rects: [],
      },
      warnings: [],
    });
  }

  // KiCad tracks are per-SEGMENT; chain contiguous same-net segments back
  // into polylines. Cosmetics is not the reason — granularity changes the
  // DRC's accounting: a polyline that passes a via twice below clearance
  // is ONE finding under one label, but two labelled segments make two,
  // and a cross-format round trip must keep the verdict, not just the
  // copper (measured: one extra near-miss warning appeared on the FIXED
  // board before this chaining).
  model.tracks = chainTracks(raw.tracks).map((t, i) => ({
    ...cuOfTrack(t.layer),
    net: nameOfNet(t.net), width: t.width,
    points: t.points.map(([x, y]) => [X(x), Y(y)]), id: `seg${i}`,
  }));
  model.vias = raw.vias.map((v, i) => ({
    x: X(v.x), y: Y(v.y), diameter: v.size, drill: v.drill, net: nameOfNet(v.net), id: `via${i}`,
    ...(v.span ? { layers: v.span } : {}),
  }));
  model.arcs = raw.arcs.map((a, i) => {
    const arc = threePointArc(a.sx, a.sy, a.mx, a.my, a.ex, a.ey);
    const seg = arc
      ? {
        type: 'arc', x1: X(a.sx), y1: Y(a.sy), x2: X(a.ex), y2: Y(a.ey),
        rx: arc.rx, ry: arc.ry, rot: 0, largeArc: arc.largeArc,
        // The Y flip inverts the winding sense of the 3-point construction.
        sweep: arc.sweep ? 0 : 1,
      }
      : { type: 'line', x1: X(a.sx), y1: Y(a.sy), x2: X(a.ex), y2: Y(a.ey) };
    return {
      layerId: cuOfTrack(a.layer).layerId, net: nameOfNet(a.net),
      width: a.width, segs: [seg], id: `arc${i}`,
    };
  });
  model.pours = raw.pours.flatMap((z, i) => {
    const cu = cuOf(z.layer);
    if (!cu) { ignore(`zone@${z.layer}`); return []; }
    return [{
    layer: cu.layer,
    layerId: cu.layerId,
    net: z.net,
    outline: z.outline.map(([x, y]) => [X(x), Y(y)]),
    clearance: 0, fillStyle: 'solid', thermal: '', keepIsland: '',
    // ALL of a zone-layer's rings form ONE even-odd group: fractured fills
    // (v6+) are disjoint outer rings — parity 1 each — and pre-fracture
    // fills (v6-dev and earlier) write carve-out HOLES as separate rings
    // nested inside the outline — parity 0. One rule serves both; a ring
    // per group turned those holes back into copper on a 2021 board.
    fills: z.fills.length ? [z.fills.map((ring) => ring.map(([x, y]) => [X(x), Y(y)]))] : null,
    fillFromFile: z.fills.length > 0,
    id: `zone${i}`,
    }];
  });
  model.outline = raw.outlineSegs.map((s) => {
    if (s.type === 'line') {
      return { type: 'line', x1: X(s.x1), y1: Y(s.y1), x2: X(s.x2), y2: Y(s.y2), id: 'edge' };
    }
    const arc = threePointArc(s.sx, s.sy, s.mx, s.my, s.ex, s.ey);
    if (!arc) return { type: 'line', x1: X(s.sx), y1: Y(s.sy), x2: X(s.ex), y2: Y(s.ey), id: 'edge' };
    return {
      type: 'arc', x1: X(s.sx), y1: Y(s.sy), x2: X(s.ex), y2: Y(s.ey),
      rx: arc.rx, ry: arc.ry, rot: 0, largeArc: arc.largeArc, sweep: arc.sweep ? 0 : 1, id: 'edge',
    };
  });
  model.silk.circles = raw.circles.map((c, i) => ({
    cx: X(c.cx), cy: Y(c.cy), r: c.r, layerId: 3, id: `gcirc${i}`,
  }));
  model.silk.tracks = raw.silkTracks.map((l, i) => ({
    layer: l.layer.startsWith('B') ? 'bottom' : 'top', layerId: layerIdOf(l.layer), net: '',
    width: l.width || 0.12, points: [[X(l.x1), Y(l.y1)], [X(l.x2), Y(l.y2)]], id: `silk${i}`,
  }));
  model.texts = raw.texts.map((t) => ({
    kind: 'L', x: X(t.x), y: Y(t.y), rotation: t.rot, mirror: false,
    layerId: layerIdOf(t.layer), text: t.text, display: true, id: '',
  }));
  // Silk texts live in model.silk.texts when on a silk layer.
  model.silk.texts = model.texts.filter((t) => t.layerId === 3 || t.layerId === 4);
  model.texts = model.texts.filter((t) => t.layerId !== 3 && t.layerId !== 4);

  const nets = new Set();
  for (const p of model.parts) for (const pad of p.pads) if (pad.net) nets.add(pad.net);
  for (const t of model.tracks) if (t.net) nets.add(t.net);
  for (const v of model.vias) if (v.net) nets.add(v.net);
  for (const z of model.pours) if (z.net) nets.add(z.net);
  model.nets = [...nets].sort();

  const copper = new Set();
  for (const t of model.tracks) copper.add(t.layerId);
  for (const z of model.pours) copper.add(z.layerId);
  for (const p of model.parts) {
    for (const pad of p.pads) {
      if (pad.through) { copper.add(1); copper.add(2); } else if (pad.layer === 'bottom') copper.add(2);
      else if (pad.layer) copper.add(1);
    }
  }
  model.copperLayers = [...copper].sort((a, b) => a - b);

  if (unknownCu.size) {
    warnings.push(`Copper record(s) on layer name(s) not in the layers table — taken as top: ${[...unknownCu].join(', ')}.`);
  }
  model.ignored = [...ignoredCount.entries()].map(([type, count]) => ({ type, count }));
  return model;
}

let anonSeq = 0;

function parseFootprint(node, warnings, ignore, cuOf) {
  const libName = String(node[1] ?? '');
  const { x, y, rot } = atOf(node);
  const layerNode = child(node, 'layer');
  const side = cuOf(String(layerNode?.[1] || 'F.Cu'))?.layer === 'bottom' ? 'bottom' : 'top';

  let ref = '';
  let value = '';
  const texts = [];
  // v8+: (property "Reference" "R1" (at …)); v6/v7: (fp_text reference "R1" (at …))
  for (const prop of children(node, 'property')) {
    const key = String(prop[1] ?? ''); const val = String(prop[2] ?? '');
    if (key === 'Reference') { ref = val; texts.push({ kind: 'P', text: val, ...atOf(prop), hide: !!child(prop, 'hide') }); }
    if (key === 'Value') { value = val; texts.push({ kind: 'N', text: val, ...atOf(prop), hide: !!child(prop, 'hide') }); }
  }
  for (const ft of children(node, 'fp_text')) {
    const kind = String(ft[1]); const val = String(ft[2] ?? '');
    if (kind === 'reference') { ref = ref || val; texts.push({ kind: 'P', text: val, ...atOf(ft), hide: !!child(ft, 'hide') }); }
    else if (kind === 'value') { value = value || val; texts.push({ kind: 'N', text: val, ...atOf(ft), hide: !!child(ft, 'hide') }); }
    else texts.push({ kind: 'L', text: val, ...atOf(ft), hide: !!child(ft, 'hide') });
  }
  // Footprint-frame texts → board frame.
  for (const t of texts) {
    const [dx, dy] = rot2(t.x, t.y, rot);
    t.x = x + dx; t.y = y + dy;
  }

  const pads = [];
  const holes = [];
  for (const p of children(node, 'pad')) {
    const padNum = String(p[1] ?? '');
    const padType = String(p[2] ?? 'thru_hole');
    const padShapeName = String(p[3] ?? 'circle');
    const at = atOf(p);
    const size = child(p, 'size');
    const drillNode = child(p, 'drill');
    // (drill D), (drill oval W H), optionally (offset OX OY). The pad's
    // (at) is the HOLE position; the COPPER SHAPE sits at (at) + offset —
    // pcbnew's "offset shape from hole". Reading the offset as decoration
    // put a castellated connector's copper 0.7 mm from where the fab
    // plates it, and a GND stitching via appeared to short a signal pad
    // on a working board (dvi-sock, measured).
    let drillD = 0; let offX = 0; let offY = 0; let slotLength = 0; let slotAlongX = true;
    if (drillNode) {
      if (String(drillNode[1]) === 'oval') {
        // (drill oval W H): a SLOT — width is the rout diameter, the long
        // dimension the rout length, its axis in the pad's own frame.
        const ow = num(drillNode[2]); const oh = num(drillNode[3] ?? drillNode[2]);
        drillD = Math.min(ow, oh);
        if (Math.max(ow, oh) > drillD) { slotLength = Math.max(ow, oh); slotAlongX = ow >= oh; }
      } else drillD = num(drillNode[1]);
      const off = child(drillNode, 'offset');
      if (off) {
        // The offset lives in the PAD's own frame and the pad's file angle
        // is ABSOLUTE — rotating it by the footprint angle alone flipped a
        // 180°-rotated XIAO pad's copper 2 mm the wrong way and it "touched"
        // a track a healthy board keeps clear of (measured, orpheuspad).
        [offX, offY] = rot2(num(off[1]), num(off[2]), at.rot || 0);
      }
    }
    // A custom pad's copper is its (primitives …) polygon, in the pad's
    // own frame like the drill offset. Without it the pad imports as its
    // anchor — often a 0.01 mm dot — and the pour that really joins it
    // reads as a separate island (measured, bitaxe Q1.5 on /5V).
    let primLocal = null;
    if (padShapeName === 'custom') {
      const prims = child(p, 'primitives');
      if (prims) {
        const polys = children(prims, 'gr_poly').map((g) => ptsOf(g)).filter((r) => r.length >= 3);
        if (polys.length) {
          primLocal = polys[0];
          if (polys.length > 1) warnings.push('custom pad with several polygons: first one taken');
        }
      }
    }
    const [dx, dy] = rot2(at.x, at.y, rot);
    if (padType === 'np_thru_hole') {
      // An unplated hole is a HOLE, not copper — KiCad just spells
      // mounting holes as np_thru_hole pads inside a footprint.
      holes.push({ x: x + dx, y: y + dy, diameter: drillD || num(size?.[1]) });
      continue;
    }
    const { through, layer } = layersOfPad(p, cuOf);
    if (!through && layer === null) { ignore('pad:mask-or-paste-aperture'); continue; }
    const rratio = padShapeName === 'roundrect'
      ? num(child(p, 'roundrect_rratio')?.[1] ?? 0.25) : 0;
    pads.push({
      num: padNum,
      shape: PAD_SHAPES[padShapeName] || 'rect',
      cornerRadius: rratio ? rratio * Math.min(num(size?.[1]), num(size?.[2] ?? size?.[1])) : 0,
      absX: x + dx + offX, absY: y + dy + offY,
      w: num(size?.[1]), h: num(size?.[2] ?? size?.[1]),
      // The file angle is ABSOLUTE, and it is the angle of the pad SHAPE
      // in the board frame — that is exactly why KiCad stores it with the
      // footprint angle added. Subtracting the footprint angle back out
      // (the first version's 'residual') turned a rotated connector's
      // 2.5 mm slot pads 90 degrees wrong, and one reached into a
      // neighbouring capacitor (measured, fpx J1.S1 x C1.1).
      shapeRot: at.rot || 0,
      drill: drillD,
      slotLength,
      slotAlongX,
      through, layer,
      net: num(child(p, 'net')?.[1]),
      primLocal,
    });
    if (PAD_SHAPES[padShapeName] === undefined) {
      warnings.push(`pad ${padNum} of ${ref || libName}: shape "${padShapeName}" read as rect.`);
    }
  }

  const silkLines = [];
  const silkCircles = [];
  for (const fl of children(node, 'fp_line')) {
    const s = child(fl, 'start'); const e = child(fl, 'end');
    const layerName = String(child(fl, 'layer')?.[1] || '');
    if (!s || !e) continue;
    if (!layerName.includes('Silk')) { ignore(`fp_line@${layerName}`); continue; }
    const [x1, y1] = rot2(num(s[1]), num(s[2]), rot);
    const [x2, y2] = rot2(num(e[1]), num(e[2]), rot);
    const stroke = child(fl, 'stroke');
    silkLines.push({
      x1: x + x1, y1: y + y1, x2: x + x2, y2: y + y2, layer: layerName,
      width: stroke ? num(child(stroke, 'width')?.[1]) : num(child(fl, 'width')?.[1]),
    });
  }
  for (const fc of children(node, 'fp_circle')) {
    const c = child(fc, 'center'); const e = child(fc, 'end');
    const layerName = String(child(fc, 'layer')?.[1] || '');
    if (!c || !e || !layerName.includes('Silk')) { ignore(`fp_circle@${layerName}`); continue; }
    const [cx, cy] = rot2(num(c[1]), num(c[2]), rot);
    silkCircles.push({ cx: x + cx, cy: y + cy, r: dist(num(e[1]) - num(c[1]), num(e[2]) - num(c[2])) });
  }

  return {
    id: ref || `fp${++anonSeq}`,
    ref, value, package: libName, x, y, rot, side,
    pads, holes, silkLines, silkCircles, texts,
  };
}

/**
 * The importCircuit-contract wrapper, identical in shape to the EasyEDA
 * one: lifted circuit + the board model riding along as `board`.
 */
export function importKicadPcbAsCircuit(text) {
  const board = importKicadPcb(text);
  const summary = board.parts.length
    ? `Opened as a board: ${board.parts.length} footprints, ${board.nets.length} nets, `
      + `${board.tracks.length} track segments on ${board.copperLayers.length} copper layers.`
    : 'Opened as a board, but it contained no footprints.';
  const lift = liftBoardToCircuit(board);
  return {
    parts: lift.parts, wires: lift.wires,
    warnings: [summary, ...board.warnings, ...lift.warnings],
    unmapped: lift.unmapped,
    board,
    report: lift.report,
  };
}

/** Chain contiguous segments of the same (net, layer, width) into polylines. */
function chainTracks(segments) {
  const TOL = 1e-6;
  const groups = new Map();
  for (const s of segments) {
    const key = `${s.net}\u0001${s.layer}\u0001${s.width}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(s);
  }
  const out = [];
  for (const segs of groups.values()) {
    const remaining = segs.map((s) => [[s.x1, s.y1], [s.x2, s.y2]]);
    const meta = segs[0];
    while (remaining.length) {
      const chain = remaining.shift();
      let grew = true;
      while (grew) {
        grew = false;
        for (let i = 0; i < remaining.length; i++) {
          const [a, b] = remaining[i];
          const head = chain[0]; const tail = chain[chain.length - 1];
          const eq = (p, r) => dist(p[0] - r[0], p[1] - r[1]) <= TOL;
          if (eq(tail, a)) { chain.push(b); remaining.splice(i, 1); grew = true; break; }
          if (eq(tail, b)) { chain.push(a); remaining.splice(i, 1); grew = true; break; }
          if (eq(head, a)) { chain.unshift(b); remaining.splice(i, 1); grew = true; break; }
          if (eq(head, b)) { chain.unshift(a); remaining.splice(i, 1); grew = true; break; }
        }
      }
      out.push({ net: meta.net, layer: meta.layer, width: meta.width, points: chain });
    }
  }
  return out;
}
