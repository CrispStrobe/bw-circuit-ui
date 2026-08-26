/**
 * EasyEDA PRO PCB reader → board model (both Pro generations).
 *
 * Pro is a different family from EasyEDA Standard, and it is itself two
 * formats:
 *
 *   V2 "array style" — JSON Lines of arrays, `["DOCTYPE","PCB","1.x"]`
 *     first. What `.epro` exports contain and what GitHub actually
 *     carries as bare `.epcb` documents (DOCTYPE 1.4/1.6/1.8 observed).
 *   V3 "log style"  — append-only log lines `{outer}||{inner}|` with a
 *     DOCHEAD per document (`.epcb2` in `.eprj3` folders, `.epru` in
 *     `.epro2` zips). Records dedupe by (type, id) keeping the highest
 *     `ticket` — it is an eventual-consistency log, not a snapshot.
 *
 * Both meet in one collector; the field layouts were decoded from REAL
 * files (an MIT-licensed V2 project export and KiCad's V3 QA sample),
 * because the published spec disagrees with the files in several places
 * (enums are strings, booleans are booleans, LAYER/PAD payload shapes
 * differ). Facts that carry everything:
 *
 *   - 1 unit = 1 mil, EXCEPT the computed pour fills (POURED), which are
 *     stored at 1/10 scale. The spec's "0.01 inch" line is wrong for
 *     ordinary primitives.
 *   - the Y axis points UP — the same direction as this model, so no
 *     flip happens here (KiCad's importer negates Y because pcbnew's
 *     axis points down; ours does not).
 *   - fixed layer ids: 1 top, 2 bottom, 3/4 silk, 5/6 mask, 7/8 paste
 *     (mask and paste are SWAPPED relative to EasyEDA Standard),
 *     11 board outline (Standard uses 10), 12 multi/through.
 *   - there is no TRACK record: a track is a LINE/ARC with a netName on
 *     a copper layer.
 *   - footprints are master/instance: the PCB document's COMPONENT rows
 *     carry position only; the pad geometry lives in separate FOOTPRINT
 *     documents that a BARE .epcb/.epcb2 file does not contain. Such
 *     components import as pad-less parts WITH A WARNING — the copper
 *     (tracks, vias, pours, free pads) is all real, the component
 *     geometry honestly absent. `opts.footprintDocs` can supply the
 *     FOOTPRINT documents (archive imports, later).
 *
 * @module
 */

import { liftBoardToCircuit } from '../model/board-lift.js';

const MM_PER_MIL = 0.0254;

const OUTLINE_LAYER = 11;
const THROUGH_LAYER = 12;
const COPPER_LAYERS = new Set([1, 2, 15, 16, 17, 18, 19, 20, 21, 22]);
const SILK_LAYERS = new Set([3, 4]);

/** V2 gate: JSON-lines starting with the DOCTYPE array. */
export function looksLikeEasyEdaProV2Pcb(text) {
  return /^\s*\["DOCTYPE"\s*,\s*"PCB"/.test(text);
}

/** V3 gate: log lines with a PCB DOCHEAD. */
export function looksLikeEasyEdaProV3Pcb(text) {
  const head = text.slice(0, 4000);
  return /"type"\s*:\s*"DOCHEAD"/.test(head) && /\|\|/.test(head) && /"docType"\s*:\s*"PCB"/.test(text);
}

export function looksLikeEasyEdaProPcb(text) {
  return looksLikeEasyEdaProV2Pcb(text) || looksLikeEasyEdaProV3Pcb(text);
}

// ── the shared collector ───────────────────────────────────────────

function makeCollector() {
  return {
    lines: [], arcs: [], vias: [], pads: [], polys: [], fills: [],
    pours: new Map(), poured: new Map(), blindVia: new Map(), layerKinds: new Map(), strings: [],
    components: new Map(), attrs: [], padNets: [],
  };
}

// ── path mini-language ─────────────────────────────────────────────

/**
 * One Pro path RING → points (units). Grammar (measured): `x y` then
 * runs of `"L" x y [x y …]`, `"ARC" sweepDeg endX endY`, `"C" c1x c1y
 * c2x c2y endX endY`; or the whole ring is `["R", x, y, w, h, rot, ccw
 * (, round)]` / `["CIRCLE", cx, cy, r (, ccw)]`. Arcs bulge by their
 * included angle over the chord; Béziers are sampled.
 */
export function proRingToPoints(ring, warnings) {
  if (!Array.isArray(ring) || !ring.length) return [];
  if (ring[0] === 'R') {
    const [, x, y, w, h] = ring;
    const rot = Number(ring[5] || 0);
    const pts = [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]];
    if (!rot) return pts;
    const cx = x + w / 2; const cy = y + h / 2;
    const th = (rot * Math.PI) / 180;
    return pts.map(([px, py]) => [
      cx + (px - cx) * Math.cos(th) - (py - cy) * Math.sin(th),
      cy + (px - cx) * Math.sin(th) + (py - cy) * Math.cos(th),
    ]);
  }
  if (ring[0] === 'CIRCLE') {
    const [, cx, cy, r] = ring;
    const pts = [];
    for (let i = 0; i <= 24; i++) {
      const th = (2 * Math.PI * i) / 24;
      pts.push([cx + r * Math.cos(th), cy + r * Math.sin(th)]);
    }
    return pts;
  }
  const pts = [];
  let i = 0;
  const num = (v) => (typeof v === 'number' ? v : Number(v));
  if (typeof ring[0] !== 'number') return [];
  pts.push([num(ring[i++]), num(ring[i++])]);
  while (i < ring.length) {
    const op = ring[i];
    if (op === 'L') {
      i += 1;
      while (i + 1 < ring.length + 1 && typeof ring[i] === 'number') {
        pts.push([num(ring[i]), num(ring[i + 1])]);
        i += 2;
      }
    } else if (op === 'ARC' || op === 'CARC') {
      const sweep = num(ring[i + 1]); const ex = num(ring[i + 2]); const ey = num(ring[i + 3]);
      i += 4;
      const [sx, sy] = pts[pts.length - 1];
      pts.push(...sampleProArc(sx, sy, ex, ey, sweep));
    } else if (op === 'C') {
      const [c1x, c1y, c2x, c2y, ex, ey] = ring.slice(i + 1, i + 7).map(num);
      i += 7;
      const [sx, sy] = pts[pts.length - 1];
      for (let k = 1; k <= 12; k++) {
        const t = k / 12; const u = 1 - t;
        pts.push([
          u * u * u * sx + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * ex,
          u * u * u * sy + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * ey,
        ]);
      }
    } else {
      warnings?.push(`unknown path op "${op}" — remainder of the ring skipped`);
      break;
    }
  }
  return pts;
}

/** Arc from (sx,sy) to (ex,ey) bulging by `sweepDeg` included angle. */
function sampleProArc(sx, sy, ex, ey, sweepDeg, steps = 12) {
  const sweep = (sweepDeg * Math.PI) / 180;
  if (!sweep || !Number.isFinite(sweep)) return [[ex, ey]];
  const mx = (sx + ex) / 2; const my = (sy + ey) / 2;
  const half = Math.hypot(ex - sx, ey - sy) / 2;
  if (half < 1e-9) return [[ex, ey]];
  const r = half / Math.sin(Math.abs(sweep) / 2);
  const d = Math.sqrt(Math.max(0, r * r - half * half)) * (sweep > 0 ? 1 : -1);
  const nx = -(ey - sy) / (2 * half); const ny = (ex - sx) / (2 * half);
  const cx = mx + nx * d; const cy = my + ny * d;
  const a0 = Math.atan2(sy - cy, sx - cx);
  const pts = [];
  for (let k = 1; k <= steps; k++) {
    const th = a0 + sweep * (k / steps);
    pts.push([cx + r * Math.cos(th), cy + r * Math.sin(th)]);
  }
  pts[pts.length - 1] = [ex, ey];
  return pts;
}

/**
 * A `path` field is EITHER one flat ring ([x, y, "L", …], the common
 * case for POLY/ARC) or a list of rings ([[…], […]], pours). `path[0]`
 * with ?? destroyed the flat case — a number is not nullish.
 */
function normalizeRings(path) {
  if (!Array.isArray(path) || !path.length) return [];
  return Array.isArray(path[0]) && typeof path[0][0] !== 'undefined' && (Array.isArray(path[0]) && (typeof path[0][0] === 'number' || typeof path[0][0] === 'string'))
    ? path : [path];
}

// ── V2 front-end ───────────────────────────────────────────────────

function parseV2(text, col, warnings, ignore) {
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    let row;
    try { row = JSON.parse(t); } catch { ignore('(unparsed line)'); continue; }
    if (!Array.isArray(row)) { ignore('(non-array row)'); continue; }
    const tag = row[0];
    switch (tag) {
      case 'LAYER':
        // ["LAYER", id, kind, title, …] — kind "PLANE" marks a NEGATIVE
        // inner plane: drawn shapes there are splits, and the body FILL
        // is the whole plane, with anti-pads computed only at Gerber
        // time. That matters below.
        if (typeof row[2] === 'string') col.layerKinds.set(Number(row[1]), row[2]);
        break;
      case 'DOCTYPE': case 'HEAD': case 'CANVAS': case 'LAYER_PHYS':
      case 'ACTIVE_LAYER': case 'SILK_OPTS': case 'PREFERENCE': case 'NET':
      case 'RULE_TEMPLATE': case 'RULE_SELECTOR': case 'ITEM_ORDER':
      case 'PANELIZE': case 'PANELIZE_STAMP': case 'PANELIZE_SIDE':
        break; // metadata
      case 'RULE':
        // ["RULE","4","blindVia",1,[[name, fromLayer, toLayer]…]] — the
        // named via spans a 6-layer board's blind vias refer to by name.
        if (row[2] === 'blindVia' && Array.isArray(row[4])) {
          for (const e of row[4]) {
            if (Array.isArray(e) && e.length >= 3) col.blindVia.set(String(e[0]), [Number(e[1]), Number(e[2])]);
          }
        }
        break;
      case 'LINE':
        col.lines.push({ id: row[1], net: row[3] || '', layer: Number(row[4]), x1: row[5], y1: row[6], x2: row[7], y2: row[8], width: row[9] });
        break;
      case 'ARC':
        // ["ARC", id, group, net, layer, width, [path], locked]
        col.arcs.push({ id: row[1], net: row[3] || '', layer: Number(row[4]), width: row[5], ring: row[6] });
        break;
      case 'VIA':
        // field 4 names a blind-via span from the RULE table; '' = through.
        col.vias.push({
          id: row[1], net: row[3] || '', x: row[5], y: row[6], drill: row[7], diameter: row[8],
          spanName: typeof row[4] === 'string' ? row[4] : '',
        });
        break;
      case 'PAD': {
        const hole = Array.isArray(row[9]) ? row[9] : null;
        const shape = Array.isArray(row[10]) ? row[10] : null;
        col.pads.push({
          id: row[1], net: row[3] || '', layer: Number(row[4]), num: String(row[5] ?? ''),
          x: row[6], y: row[7], angle: Number(row[8] || 0),
          holeShape: hole?.[0] || null, holeW: hole?.[1] || 0, holeH: hole?.[2] || 0,
          shape: shape?.[0] || 'ELLIPSE', w: shape?.[1] || 0, h: shape?.[2] || 0,
        });
        break;
      }
      case 'POLY':
        col.polys.push({ id: row[1], net: row[3] || '', layer: Number(row[4]), width: row[5], ring: row[6] });
        break;
      case 'FILL':
        col.fills.push({ id: row[1], net: row[3] || '', layer: Number(row[4]), rings: Array.isArray(row[7]) ? row[7] : [], });
        break;
      case 'POUR':
        col.pours.set(row[1], {
          id: row[1], net: row[3] || '', layer: Number(row[4]),
          rings: Array.isArray(row[8]) ? row[8] : [],
        });
        break;
      case 'POURED':
        // ["POURED", id, pourId, ?, bool, [rings]] — ONE computed fill
        // ISLAND of its pour, at 1/10 scale like V3's. A pour has one
        // POURED record PER ISLAND (113 and 184 on one real board);
        // keeping only the last record threw away the whole plane and
        // left a sliver (measured, sil0074-dp: GND read as 25 islands).
        // Each record's rings are one even-odd group (outer + holes).
        if (Array.isArray(row[5])) {
          if (!col.poured.has(row[2])) col.poured.set(row[2], []);
          col.poured.get(row[2]).push(row[5]);
        }
        break;
      case 'STRING':
        col.strings.push({ id: row[1], layer: Number(row[3]), x: row[4], y: row[5], text: String(row[6] ?? '') });
        break;
      case 'COMPONENT':
        col.components.set(row[1], {
          id: row[1], layer: Number(row[3]), x: row[4], y: row[5],
          angle: Number(row[6] || 0), attrs: row[7] && typeof row[7] === 'object' ? row[7] : {},
        });
        break;
      case 'ATTR':
        col.attrs.push({ parentId: row[3], key: String(row[7] ?? ''), value: String(row[8] ?? '') });
        break;
      case 'PAD_NET':
        col.padNets.push({ componentId: row[1], num: String(row[2] ?? ''), net: String(row[3] ?? '') });
        break;
      default:
        ignore(String(tag));
    }
  }
}

// ── V3 front-end ───────────────────────────────────────────────────

function parseV3(text, col, warnings, ignore) {
  // Dedupe: (docIndex, type, id) → highest ticket. Only the PCB
  // document's records reach the collector.
  let docType = null;
  let docIndex = -1;
  const latest = new Map();
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    const sep = t.indexOf('||');
    if (sep < 0) { ignore('(no separator)'); continue; }
    let outer; let inner;
    try {
      outer = JSON.parse(t.slice(0, sep));
      const tail = t.slice(sep + 2).replace(/\|\s*$/, '');
      inner = tail === '""' || tail === '' ? null : JSON.parse(tail);
    } catch { ignore('(unparsed line)'); continue; }
    if (outer.type === 'DOCHEAD') {
      docIndex += 1;
      docType = inner?.docType ?? null;
      continue;
    }
    if (docType !== 'PCB') continue;
    const key = `${docIndex} ${outer.type} ${outer.id ?? ''}`;
    const prev = latest.get(key);
    if (!prev || (outer.ticket ?? 0) >= (prev.ticket ?? 0)) {
      latest.set(key, { ticket: outer.ticket ?? 0, type: outer.type, id: outer.id, data: inner });
    }
  }

  for (const { type, id, data } of latest.values()) {
    if (data == null) continue; // deleted record
    switch (type) {
      case 'META': case 'CANVAS': case 'LAYER': case 'LAYER_PHYS': case 'ACTIVE_LAYER':
      case 'SILK_OPTS': case 'PREFERENCE': case 'NET': case 'RULE': case 'RULE_TEMPLATE':
      case 'RULE_SELECTOR': case 'ITEM_ORDER': case 'ELE_PLACEHOLDER': case 'PROP':
      case 'CONNECT': case 'GROUP': case 'EQLEN_GRP': case 'TEARDROP':
        break;
      case 'LINE':
        col.lines.push({ id, net: data.netName || '', layer: Number(data.layerId), x1: data.startX, y1: data.startY, x2: data.endX, y2: data.endY, width: data.width });
        break;
      case 'ARC': case 'CARC': {
        // V3 arcs are endpoint pairs plus an included angle — no path.
        col.arcs.push({
          id, net: data.netName || '', layer: Number(data.layerId), width: data.width,
          ring: [data.startX, data.startY, 'ARC', data.angle, data.endX, data.endY],
        });
        break;
      }
      case 'VIA':
        col.vias.push({ id, net: data.netName || '', x: data.centerX, y: data.centerY, drill: data.holeDiameter, diameter: data.viaDiameter });
        break;
      case 'PAD': {
        const dp = data.defaultPad || {};
        col.pads.push({
          id, net: data.netName || '', layer: Number(data.layerId), num: String(data.num ?? ''),
          x: data.centerX, y: data.centerY, angle: Number(data.padAngle || 0),
          holeShape: data.hole ? (data.hole.holeType || 'ROUND') : null,
          holeW: data.hole?.width ?? data.hole?.diameter ?? 0,
          holeH: data.hole?.height ?? data.hole?.diameter ?? 0,
          shape: dp.padType || 'ELLIPSE', w: dp.width || 0, h: dp.height || 0,
        });
        break;
      }
      case 'POLY':
        col.polys.push({ id, net: data.netName || '', layer: Number(data.layerId), width: data.width, ring: normalizeRings(data.path)[0] || [] });
        break;
      case 'FILL':
        col.fills.push({ id, net: data.netName || '', layer: Number(data.layerId), rings: normalizeRings(data.path) });
        break;
      case 'POUR':
        col.pours.set(id, { id, net: data.netName || '', layer: Number(data.layerId), rings: normalizeRings(data.path) });
        break;
      case 'POURED': {
        // id is a stringified ["POURED", pourId]; fills are at 1/10
        // scale. One record per fill island, accumulated like V2's.
        let pourId = data.targetId;
        try { const arr = JSON.parse(id); if (Array.isArray(arr)) pourId = arr[1]; } catch { /* keep */ }
        const rings = (data.pourFill || []).flatMap((f) => f.path || []);
        if (rings.length) {
          if (!col.poured.has(pourId)) col.poured.set(pourId, []);
          col.poured.get(pourId).push(rings);
        }
        break;
      }
      case 'STRING':
        col.strings.push({ id, layer: Number(data.layerId), x: data.x, y: data.y, text: String(data.text ?? data.string ?? '') });
        break;
      case 'COMPONENT':
        col.components.set(id, {
          id, layer: Number(data.layerId), x: data.x, y: data.y,
          angle: Number(data.angle || 0), attrs: data.attrs || {},
        });
        break;
      case 'ATTR':
        col.attrs.push({ parentId: data.parentId, key: String(data.key ?? ''), value: String(data.value ?? '') });
        break;
      case 'PAD_NET': {
        let componentId = null; let num = '';
        try { const arr = JSON.parse(id); componentId = arr?.[1]; num = String(arr?.[2] ?? ''); } catch { /* keep */ }
        col.padNets.push({ componentId, num, net: String(data.padNet ?? '') });
        break;
      }
      default:
        ignore(String(type));
    }
  }
}

// ── the importer ───────────────────────────────────────────────────

/**
 * @param {string} text  bare V2 `.epcb` or V3 `.epcb2`/`.epru` content
 * @param {object} [opts] reserved: {footprintDocs} for archive imports
 * @returns board model (importEasyEdaPcb shape)
 */
export function importEasyEdaProPcb(text, opts = {}) {
  void opts;
  const warnings = [];
  const empty = () => ({
    format: 'easyeda-pro-pcb', parts: [], freePads: [], tracks: [], vias: [], holes: [],
    arcs: [], pours: [], outline: [], silk: { tracks: [], arcs: [], texts: [], circles: [], rects: [] },
    texts: [], nets: [], copperLayers: [], bbox: { w: 0, h: 0 }, origin: null,
    warnings, ignored: [],
  });

  const isV2 = looksLikeEasyEdaProV2Pcb(text);
  if (!isV2 && !looksLikeEasyEdaProV3Pcb(text)) {
    warnings.push('Not an EasyEDA Pro PCB document (no V2 DOCTYPE array and no V3 PCB DOCHEAD).');
    return empty();
  }

  const ignoredCount = new Map();
  const ignore = (t) => ignoredCount.set(t, (ignoredCount.get(t) || 0) + 1);
  const col = makeCollector();
  (isV2 ? parseV2 : parseV3)(text, col, warnings, ignore);

  // ── frame: outline (layer 11) bbox, else copper; Y stays up ──────
  const outlineRings = [];
  const outlineSegs = [];
  for (const p of col.polys) {
    if (p.layer !== OUTLINE_LAYER) continue;
    const pts = proRingToPoints(p.ring, warnings);
    if (pts.length >= 2) outlineRings.push(pts);
  }
  for (const l of col.lines) {
    if (l.layer === OUTLINE_LAYER) outlineSegs.push([[l.x1, l.y1], [l.x2, l.y2]]);
  }
  for (const a of col.arcs) {
    if (a.layer !== OUTLINE_LAYER) continue;
    const pts = proRingToPoints(a.ring, warnings);
    if (pts.length >= 2) outlineRings.push(pts);
  }

  const xs = []; const ys = [];
  const eat = (x, y) => { if (Number.isFinite(x) && Number.isFinite(y)) { xs.push(x); ys.push(y); } };
  for (const ring of outlineRings) for (const [x, y] of ring) eat(x, y);
  for (const [[x1, y1], [x2, y2]] of outlineSegs) { eat(x1, y1); eat(x2, y2); }
  const hadOutline = xs.length > 0;
  if (!hadOutline) {
    for (const l of col.lines) { eat(l.x1, l.y1); eat(l.x2, l.y2); }
    for (const p of col.pads) eat(p.x, p.y);
    for (const v of col.vias) eat(v.x, v.y);
    if (xs.length) warnings.push('Board outline (layer 11) is missing — origin taken from the copper bounding box.');
    else warnings.push('Board has no outline and no copper; nothing to place.');
  }
  const minX = xs.length ? Math.min(...xs) : 0;
  const minY = ys.length ? Math.min(...ys) : 0;
  const maxX = xs.length ? Math.max(...xs) : 0;
  const maxY = ys.length ? Math.max(...ys) : 0;
  const X = (x) => (x - minX) * MM_PER_MIL;
  const Y = (y) => (y - minY) * MM_PER_MIL;
  const L = (v) => (Number(v) || 0) * MM_PER_MIL;

  const model = empty();
  model.origin = { x: minX, y: minY, frame: 'easyeda-pro-mil' };
  model.bbox = { w: (maxX - minX) * MM_PER_MIL, h: (maxY - minY) * MM_PER_MIL };

  const layerName = (id) => (id === 2 ? 'bottom' : id === 1 ? 'top' : `inner${id}`);
  const copperId = (id) => id; // inner layers keep their own id — collapsing
  // them onto top invented 40 cross-net overlaps on a real 6-layer board.
  const PRO_PAD_SHAPES = { ELLIPSE: 'circle', ROUND: 'circle', RECT: 'rect', OVAL: 'oval', OBLONG: 'oval', RECTANGLE: 'rect', POLYGON: 'polygon' };

  const cvPad = (p) => {
    const round = p.shape === 'ELLIPSE' && p.w === p.h;
    const through = p.layer === THROUGH_LAYER || (p.holeW > 0);
    const slot = p.holeShape && p.holeW !== p.holeH && p.holeW > 0 && p.holeH > 0;
    return {
      num: p.num, net: p.net,
      shape: round ? 'circle' : (PRO_PAD_SHAPES[p.shape] || 'rect'),
      x: X(p.x), y: Y(p.y), w: L(p.w), h: L(p.h),
      rotation: p.angle || 0,
      drill: p.holeW ? Math.min(L(p.holeW), L(p.holeH || p.holeW)) : 0,
      slotLength: slot ? Math.max(L(p.holeW), L(p.holeH)) : 0,
      slotRotation: slot ? (p.angle || 0) + (p.holeW >= p.holeH ? 0 : 90) : 0,
      plated: true,
      through,
      layer: through ? 'through' : layerName(p.layer),
      points: null, id: `pro-${p.id}`,
    };
  };

  model.freePads = col.pads.map(cvPad);
  model.tracks = col.lines
    .filter((l) => COPPER_LAYERS.has(l.layer))
    .map((l) => ({
      layer: layerName(l.layer), layerId: copperId(l.layer),
      net: l.net, width: L(l.width),
      points: [[X(l.x1), Y(l.y1)], [X(l.x2), Y(l.y2)]], id: `pro-${l.id}`,
    }));
  model.silk.tracks = col.lines
    .filter((l) => SILK_LAYERS.has(l.layer))
    .map((l) => ({
      layer: l.layer === 4 ? 'bottom' : 'top', layerId: l.layer, net: '',
      width: L(l.width), points: [[X(l.x1), Y(l.y1)], [X(l.x2), Y(l.y2)]], id: `pro-${l.id}`,
    }));
  for (const a of col.arcs) {
    const pts = proRingToPoints(a.ring, warnings).map(([x, y]) => [X(x), Y(y)]);
    if (pts.length < 2) continue;
    const target = COPPER_LAYERS.has(a.layer) ? model.tracks
      : SILK_LAYERS.has(a.layer) ? model.silk.tracks : null;
    if (!target) { ignore(`ARC@layer${a.layer}`); continue; }
    target.push({
      layer: a.layer === 4 ? 'bottom' : layerName(a.layer),
      layerId: a.layer, net: a.net || '', width: L(a.width), points: pts, id: `pro-${a.id}`,
    });
  }
  // Copper POLY/FILL: solid copper shapes — modelled as exact pours.
  for (const p of col.polys) {
    if (SILK_LAYERS.has(p.layer)) {
      const pts = proRingToPoints(p.ring, warnings).map(([x, y]) => [X(x), Y(y)]);
      if (pts.length >= 2) {
        model.silk.tracks.push({
          layer: p.layer === 4 ? 'bottom' : 'top', layerId: p.layer, net: '',
          width: L(p.width), points: pts, id: `pro-${p.id}`,
        });
      }
      continue;
    }
    if (!COPPER_LAYERS.has(p.layer)) { if (p.layer !== OUTLINE_LAYER) ignore(`POLY@layer${p.layer}`); continue; }
    const pts = proRingToPoints(p.ring, warnings).map(([x, y]) => [X(x), Y(y)]);
    if (pts.length < 2) continue;
    model.tracks.push({
      layer: layerName(p.layer), layerId: copperId(p.layer),
      net: p.net, width: L(p.width), points: pts, id: `pro-${p.id}`,
    });
  }
  let planeWarned = false;
  for (const f of col.fills) {
    if (!COPPER_LAYERS.has(f.layer)) { ignore(`FILL@layer${f.layer}`); continue; }
    const rings = f.rings.map((r) => proRingToPoints(r, warnings).map(([x, y]) => [X(x), Y(y)]))
      .filter((r) => r.length >= 3);
    if (!rings.length) continue;
    // A FILL on a NEGATIVE plane layer is the plane BODY: its anti-pads
    // around other nets' through-holes exist only at Gerber time, so as
    // exact copper it would weld every through pad on the board to the
    // plane net (measured, a real 6-layer board's 36-net island). It
    // goes through the labelled outline-only over-approximation instead.
    const negative = col.layerKinds.get(f.layer) === 'PLANE';
    if (negative && !planeWarned) {
      planeWarned = true;
      warnings.push('Negative plane layer(s) present: plane copper is over-approximated by its border '
        + '(same-net joins only, labelled) — anti-pads are not in the file.');
    }
    model.pours.push({
      layer: layerName(f.layer), layerId: copperId(f.layer), net: f.net,
      outline: rings[0], clearance: 0, fillStyle: 'solid', thermal: '', keepIsland: '',
      fills: negative ? null : [rings], fillFromFile: !negative, id: `pro-${f.id}`,
    });
  }
  // Pro copper stack order by layer id: 1 (top), 15..18 (Inner1..4), 2
  // (bottom). A blind via's named span from the RULE table expands to
  // the contiguous slice of that stack — treating it as through-all
  // shorted a bottom track against a top→Inner2 via right under it
  // (measured, a real 6-layer V2 board).
  const PRO_STACK = [1, 15, 16, 17, 18, 2];
  model.vias = col.vias.map((v) => {
    let layers = null;
    const span = v.spanName ? col.blindVia.get(v.spanName) : null;
    if (span) {
      const i0 = PRO_STACK.indexOf(span[0]); const i1 = PRO_STACK.indexOf(span[1]);
      if (i0 >= 0 && i1 >= 0) layers = PRO_STACK.slice(Math.min(i0, i1), Math.max(i0, i1) + 1);
    }
    return {
      x: X(v.x), y: Y(v.y), diameter: L(v.diameter), drill: L(v.drill), net: v.net, id: `pro-${v.id}`,
      ...(layers ? { layers } : {}),
    };
  });

  // Pours: POURED (×10 scale) is exact; a bare POUR border is the
  // labelled over-approximation this model already knows how to carry.
  for (const [id, pour] of col.pours) {
    const pouredRings = col.poured.get(id);
    const outline = pour.rings.length
      ? proRingToPoints(pour.rings[0], warnings).map(([x, y]) => [X(x), Y(y)])
      : [];
    let fills = null;
    if (pouredRings && pouredRings.length) {
      // pouredRings = one entry PER ISLAND; each entry's rings are one
      // even-odd group (outer boundary + its carve-out holes). TWO-POINT
      // entries mixed in are the THERMAL SPOKES bridging a pad's anti-pad
      // gap (10 mil stubs on a real board) — as degenerate regions they
      // vanished and every relieved pad read as its own island. They are
      // copper segments: emitted as same-net tracks.
      const groups = [];
      for (const group of pouredRings) {
        const rings = [];
        for (const r of group) {
          const pts = proRingToPoints(r, warnings).map(([x, y]) => [X(x * 10), Y(y * 10)]);
          if (pts.length >= 3) rings.push(pts);
          else if (pts.length === 2) {
            model.tracks.push({
              layer: layerName(pour.layer), layerId: copperId(pour.layer), net: pour.net,
              width: 0.2, points: pts, id: `pro-${id}-spoke${model.tracks.length}`,
            });
          }
        }
        if (rings.length) groups.push(rings);
      }
      if (groups.length) fills = groups;
    }
    model.pours.push({
      layer: layerName(pour.layer), layerId: copperId(pour.layer), net: pour.net,
      outline, clearance: 0, fillStyle: 'solid', thermal: '', keepIsland: '',
      fills, fillFromFile: !!fills, id: `pro-${id}`,
    });
  }

  // Outline segments.
  for (const [[x1, y1], [x2, y2]] of outlineSegs) {
    model.outline.push({ type: 'line', x1: X(x1), y1: Y(y1), x2: X(x2), y2: Y(y2), id: 'edge' });
  }
  for (const ring of outlineRings) {
    for (let i = 0; i + 1 < ring.length; i++) {
      model.outline.push({
        type: 'line',
        x1: X(ring[i][0]), y1: Y(ring[i][1]), x2: X(ring[i + 1][0]), y2: Y(ring[i + 1][1]), id: 'edge',
      });
    }
    // A POLY is a POLYGON: the closing edge from last back to first is
    // implied, not drawn (a real board's straight left edge existed only
    // as this implicit edge). Emit it when the ring is not already closed.
    const [fx, fy] = ring[0]; const [lx, ly] = ring[ring.length - 1];
    if (ring.length >= 3 && Math.hypot(fx - lx, fy - ly) > 1e-9) {
      model.outline.push({ type: 'line', x1: X(lx), y1: Y(ly), x2: X(fx), y2: Y(fy), id: 'edge' });
    }
  }

  // Components: position + attrs; pad geometry lives in FOOTPRINT
  // documents a bare file does not carry — said plainly, never guessed.
  const refOf = new Map();
  for (const at of col.attrs) {
    if (at.key === 'Designator' && at.value) refOf.set(at.parentId, at.value);
  }
  const netsOfComponent = new Map();
  for (const pn of col.padNets) {
    if (!pn.componentId) continue;
    if (!netsOfComponent.has(pn.componentId)) netsOfComponent.set(pn.componentId, {});
    netsOfComponent.get(pn.componentId)[pn.num] = pn.net;
  }
  for (const [id, comp] of col.components) {
    model.parts.push({
      id, ref: refOf.get(id) || comp.attrs.Designator || '',
      name: comp.attrs.Name || comp.attrs.Value || '',
      package: comp.attrs.Footprint || '',
      attrs: { ...comp.attrs, padNets: netsOfComponent.get(id) || {} },
      x: X(comp.x), y: Y(comp.y), rotation: comp.angle,
      side: comp.layer === 2 ? 'bottom' : 'top',
      pads: [],
      silk: { tracks: [], arcs: [], texts: [], circles: [], rects: [] },
      warnings: [],
    });
  }
  if (col.components.size) {
    warnings.push(`${col.components.size} component(s) imported without pad geometry: a bare Pro PCB `
      + 'document does not carry its FOOTPRINT masters (Pro is master/instance). Copper, vias, '
      + 'pours and free pads are complete; component pads need the project archive.');
  }
  for (const s of col.strings) {
    const entry = {
      kind: 'L', x: X(s.x), y: Y(s.y), rotation: 0, mirror: false,
      layerId: SILK_LAYERS.has(s.layer) ? s.layer : 12, text: s.text, display: true, id: `pro-${s.id}`,
    };
    if (SILK_LAYERS.has(s.layer)) model.silk.texts.push(entry);
    else model.texts.push(entry);
  }

  const nets = new Set();
  for (const t of model.tracks) if (t.net) nets.add(t.net);
  for (const v of model.vias) if (v.net) nets.add(v.net);
  for (const z of model.pours) if (z.net) nets.add(z.net);
  for (const p of model.freePads) if (p.net) nets.add(p.net);
  for (const m of netsOfComponent.values()) for (const n of Object.values(m)) if (n) nets.add(n);
  model.nets = [...nets].sort();

  const copper = new Set();
  for (const t of model.tracks) copper.add(t.layerId);
  for (const z of model.pours) copper.add(z.layerId);
  model.copperLayers = [...copper].sort((a, b) => a - b);

  model.ignored = [...ignoredCount.entries()].map(([type, count]) => ({ type, count }));
  return model;
}

/**
 * The importCircuit-contract wrapper, like the other board importers:
 * lifted circuit (which for a bare Pro document means the copper and the
 * free pads — components carry no pad geometry) plus the board model.
 */
export function importEasyEdaProPcbAsCircuit(text) {
  const board = importEasyEdaProPcb(text);
  const summary = `Opened as an EasyEDA Pro board: ${board.parts.length} components, `
    + `${board.nets.length} nets, ${board.tracks.length} track segments on `
    + `${board.copperLayers.length} copper layers.`;
  const lift = liftBoardToCircuit(board);
  return {
    parts: lift.parts, wires: lift.wires,
    warnings: [summary, ...board.warnings, ...lift.warnings],
    unmapped: lift.unmapped,
    board,
    report: lift.report,
  };
}

/**
 * Open an EasyEDA Pro PROJECT ARCHIVE (`.epro`, `.epro2`, `.eprj3`) and
 * import the PCB document inside it.
 *
 * Until now a `.epro` could not be opened at all: only the bare
 * documents were readable, and the archive is what people actually
 * export. This finds the board and hands it to the reader above.
 *
 * What it deliberately does NOT do yet is apply FOOTPRINT masters to
 * components. Pro is master/instance, so component pads live in separate
 * FOOTPRINT documents, and this function reports how many it found — but
 * how a COMPONENT row names its master is not something I have a real
 * archive to establish, and inventing that mapping would put pads on a
 * board at coordinates nobody verified. The count is surfaced so the gap
 * is visible rather than silent.
 *
 * @param {ArrayBuffer|Uint8Array} buf
 * @returns {Promise<{board: object|null, documents: object[], warnings: string[]}>}
 */
export async function importEasyEdaProArchive(buf) {
  const { readZipText } = await import('./zip.js');
  const { files, warnings } = await readZipText(buf,
    (n) => /\.(epcb|epcb2|epru|esch|efoo|esym|json)$/i.test(n) || !/\.\w+$/.test(n));

  const documents = [];
  for (const [name, text] of Object.entries(files)) {
    const head = text.slice(0, 400);
    // Both generations announce themselves in their first record.
    const v2 = /^\s*\[\s*"DOCTYPE"\s*,\s*"([A-Z_]+)"/.exec(head);
    const v3 = /"docType"\s*:\s*"([A-Z_]+)"/.exec(head);
    const docType = (v2 || v3) ? (v2 ? v2[1] : v3[1]) : null;
    if (docType) documents.push({ name, docType, text });
  }

  const pcbDoc = documents.find((d) => d.docType === 'PCB');
  const footprints = documents.filter((d) => d.docType === 'FOOTPRINT');
  const out = { board: null, documents: documents.map(({ name, docType }) => ({ name, docType })), warnings };

  if (!pcbDoc) {
    out.warnings.push(documents.length
      ? `Archive holds ${documents.length} document(s) but no PCB: ${documents.map((d) => d.docType).join(', ')}.`
      : 'No EasyEDA Pro documents found inside this archive.');
    return out;
  }
  out.board = importEasyEdaProPcb(pcbDoc.text);
  out.warnings.push(...out.board.warnings);
  if (footprints.length) {
    out.warnings.push(`${footprints.length} FOOTPRINT master(s) ship in this archive. Applying them to `
      + 'components is not implemented — how a COMPONENT row names its master has not been established '
      + 'against a real archive, so component pads stay absent rather than being placed on a guess.');
  }
  return out;
}
