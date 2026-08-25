/**
 * Gerber (RS-274X) + Excellon writer: the fab package, from the board model.
 *
 * The plan deferred this while EasyEDA/KiCad could produce Gerbers from
 * our exports; it exists now so the loop closes without either — a
 * projected or imported board becomes the exact files a fab consumes.
 *
 * Conservative, like every writer here:
 *
 *   - coordinates are %FSLAX46Y46*% / %MOMM*% (mm, 1 nm integer grid);
 *     the model is already mm so the only arithmetic is rounding.
 *   - pads flash standard apertures where the aperture language can say
 *     them exactly (circle C, axis-aligned rect R, oval O drawn as a
 *     stroked stadium); anything rotated or rounded becomes a G36/G37
 *     REGION from the same polygons the DRC measures — the picture the
 *     fab plots cannot disagree with the checker.
 *   - pour fills: ring 0 of each even-odd group plots dark (LPD), the
 *     remaining rings — the carve-out holes — plot clear (LPC). That is
 *     the writers' invariant for both source formats (EasyEDA path
 *     groups and KiCad fills both put the outer boundary first).
 *   - outline arcs are emitted segmented (24 chords) rather than as
 *     G02/G03 — accepted by every fab, immune to centre-format quirks.
 *   - silk TEXT plots as single-stroke polylines (stroke-font.js), on the
 *     same centre anchor the SVG renderer uses — screen and silk agree.
 *   - drills: round PTH + NPTH in one Excellon file (METRIC, 3.3); slot
 *     pads become G85 routs between their end centres, the tool being
 *     the slot width.
 *
 * @module
 */

import { padShape, padOutlinePolygon, arcPointAt } from '../pcb-geometry.js';
import { strokeText } from '../stroke-text.js';

const XY = (x, y) => `X${Math.round(x * 1e6)}Y${Math.round(y * 1e6)}`;

/** Aperture table builder: dedupes, hands out D-codes from 10. */
class Apertures {
  constructor() { this.map = new Map(); this.defs = []; }
  get(def) {
    if (!this.map.has(def)) {
      const code = 10 + this.map.size;
      this.map.set(def, code);
      this.defs.push(`%ADD${code}${def}*%`);
    }
    return this.map.get(def);
  }
}

const fmtMm = (v) => String(Math.round(v * 10000) / 10000);

function gerberFile(fileFunction, body, apertures) {
  return [
    `%TF.GenerationSoftware,BrickWright,bw-circuit-ui*%`,
    `%TF.FileFunction,${fileFunction}*%`,
    '%FSLAX46Y46*%',
    '%MOMM*%',
    '%LPD*%',
    ...apertures.defs,
    ...body,
    'M02*',
  ].join('\n') + '\n';
}

/** One layer's copper (or mask/silk) as Gerber body lines. */
function drawLayer({ pads = [], tracks = [], arcs = [], pours = [], circles = [], sizeGrow = 0 }, ap, warnings) {
  const body = [];
  const flashOps = [];
  const regionOps = [];
  const drawOps = [];

  for (const pad of pads) {
    const grow = sizeGrow;
    const w = pad.w + grow; const h = pad.h + grow;
    if (pad.shape === 'circle' || (pad.w === pad.h && pad.shape !== 'rect' && !pad.points)) {
      const d = ap.get(`C,${fmtMm(w)}`);
      flashOps.push([d, `${XY(pad.x, pad.y)}D03*`]);
    } else if (pad.shape === 'oval') {
      // A stadium is a stroked line as wide as its short axis — exact.
      const s = padShape({ ...pad, w, h });
      const d = ap.get(`C,${fmtMm(s.r * 2)}`);
      drawOps.push([d, `${XY(s.x1, s.y1)}D02*`, `${XY(s.x2, s.y2)}D01*`]);
    } else if (pad.shape === 'rect' && !(pad.rotation % 180) && !(pad.cornerRadius > 0)) {
      const d = ap.get(`R,${fmtMm(w)}X${fmtMm(h)}`);
      flashOps.push([d, `${XY(pad.x, pad.y)}D03*`]);
    } else if (pad.shape === 'rect' && !((pad.rotation + 90) % 180) && !(pad.cornerRadius > 0)) {
      const d = ap.get(`R,${fmtMm(h)}X${fmtMm(w)}`);
      flashOps.push([d, `${XY(pad.x, pad.y)}D03*`]);
    } else {
      // Rotated, rounded, or polygon pads: the exact region.
      const pts = pad.points && pad.points.length >= 3
        ? pad.points
        : pad.cornerRadius > 0
          ? padOutlinePolygon({ ...pad, w, h })
          : padShape({ ...pad, w, h }).pts;
      if (!pts || pts.length < 3) { warnings.push(`pad ${pad.id || pad.num}: no printable shape`); continue; }
      regionOps.push(ringRegion(pts));
    }
  }
  for (const t of tracks) {
    const d = ap.get(`C,${fmtMm(t.width)}`);
    const ops = [`${XY(t.points[0][0], t.points[0][1])}D02*`];
    for (let i = 1; i < t.points.length; i++) ops.push(`${XY(t.points[i][0], t.points[i][1])}D01*`);
    drawOps.push([d, ...ops]);
  }
  for (const a of arcs) {
    const d = ap.get(`C,${fmtMm(a.width || 0.254)}`);
    for (const s of a.segs || []) {
      const ops = [`${XY(s.x1, s.y1)}D02*`];
      if (s.type === 'arc') {
        for (let i = 1; i <= 24; i++) {
          const [px, py] = arcPointAt(s, i / 24);
          ops.push(`${XY(px, py)}D01*`);
        }
      } else {
        ops.push(`${XY(s.x2, s.y2)}D01*`);
      }
      drawOps.push([d, ...ops]);
    }
  }
  for (const c of circles) {
    const d = ap.get(`C,${fmtMm(c.strokeWidth || 0.2)}`);
    const ops = [];
    for (let i = 0; i <= 32; i++) {
      const th = (2 * Math.PI * i) / 32;
      ops.push(`${XY(c.cx + c.r * Math.cos(th), c.cy + c.r * Math.sin(th))}D0${i ? 1 : 2}*`);
    }
    drawOps.push([d, ...ops]);
  }

  // Group by aperture to keep the file small and deterministic.
  const byAperture = new Map();
  for (const [d, ...ops] of [...flashOps, ...drawOps]) {
    if (!byAperture.has(d)) byAperture.set(d, []);
    byAperture.get(d).push(...ops);
  }
  for (const [d, ops] of [...byAperture.entries()].sort((a, b) => a[0] - b[0])) {
    body.push(`D${d}*`, ...ops);
  }

  // Pours last: dark outer boundaries, clear holes.
  for (const z of pours) {
    const groups = z.fillFromFile && z.fills ? z.fills
      : (z.outline?.length >= 3 ? [[z.outline]] : []);
    if (!z.fillFromFile && groups.length) {
      warnings.push(`pour ${z.id || z.net}: outline-only (no fill in the model) — plotted as its outline, an over-approximation.`);
    }
    for (const rings of groups) {
      if (!rings.length) continue;
      body.push('%LPD*%', ...ringRegion(rings[0]));
      for (const hole of rings.slice(1)) {
        body.push('%LPC*%', ...ringRegion(hole));
      }
      body.push('%LPD*%');
    }
  }
  return body;
}

function ringRegion(pts) {
  const ops = ['G36*', `${XY(pts[0][0], pts[0][1])}D02*`];
  for (let i = 1; i < pts.length; i++) ops.push(`${XY(pts[i][0], pts[i][1])}D01*`);
  ops.push(`${XY(pts[0][0], pts[0][1])}D01*`, 'G37*');
  return ops;
}

/**
 * @param {object} board  board model (importer or projection output)
 * @param {object} [opts] {maskGrow = 0.05} solder-mask opening growth per side
 * @returns {{files: Record<string, string>, warnings: string[]}}
 */
export function exportGerbers(board, opts = {}) {
  const warnings = [];
  const maskGrow = (opts.maskGrow ?? 0.05) * 2;
  const files = {};
  const layerPads = (side) => {
    const pads = [];
    for (const part of board.parts || []) {
      for (const pad of part.pads) {
        if (pad.through || pad.layer === side) pads.push(pad);
      }
    }
    for (const pad of board.freePads || []) {
      if (pad.through || pad.layer === side) pads.push(pad);
    }
    return pads;
  };
  const layerTracks = (id) => (board.tracks || []).filter((t) => (t.layerId ?? (t.layer === 'bottom' ? 2 : 1)) === id);
  const layerArcs = (id) => (board.arcs || []).filter((a) => (a.layerId ?? 1) === id);
  const layerPours = (id) => (board.pours || []).filter((z) => (z.layerId ?? (z.layer === 'bottom' ? 2 : 1)) === id);
  const vias = (board.vias || []).map((v) => ({
    shape: 'circle', x: v.x, y: v.y, w: v.diameter, h: v.diameter, rotation: 0, id: v.id,
  }));

  for (const [side, id, cuName, maskName] of [
    ['top', 1, 'Copper,L1,Top', 'Soldermask,Top'],
    ['bottom', 2, 'Copper,L2,Bot', 'Soldermask,Bot'],
  ]) {
    {
      const ap = new Apertures();
      const body = drawLayer({
        pads: [...layerPads(side), ...vias],
        tracks: layerTracks(id), arcs: layerArcs(id), pours: layerPours(id),
      }, ap, warnings);
      files[side === 'top' ? 'copper-top.gtl' : 'copper-bottom.gbl'] = gerberFile(cuName, body, ap);
    }
    {
      // Mask = OPENINGS (negative plot at the fab): pads grown, vias tented.
      const ap = new Apertures();
      const body = drawLayer({ pads: layerPads(side), sizeGrow: maskGrow }, ap, warnings);
      files[side === 'top' ? 'mask-top.gts' : 'mask-bottom.gbs'] = gerberFile(maskName, body, ap);
    }
  }

  // Silk: part + board silk tracks/circles/rects; texts are reported.
  for (const [side, layerId, name, file] of [
    ['top', 3, 'Legend,Top', 'silk-top.gto'],
    ['bottom', 4, 'Legend,Bot', 'silk-bottom.gbo'],
  ]) {
    const tracks = [];
    const circles = [];
    const eatSilk = (silk) => {
      for (const t of silk?.tracks || []) if ((t.layerId ?? 3) === layerId) tracks.push(t);
      for (const rc of silk?.rects || []) {
        if ((rc.layerId ?? 3) !== layerId) continue;
        tracks.push({ width: 0.15, points: [
          [rc.x, rc.y], [rc.x + rc.w, rc.y], [rc.x + rc.w, rc.y + rc.h], [rc.x, rc.y + rc.h], [rc.x, rc.y],
        ] });
      }
      for (const c of silk?.circles || []) if ((c.layerId ?? 3) === layerId) circles.push({ cx: c.cx, cy: c.cy, r: c.r, strokeWidth: 0.15 });
      // Text plots as SINGLE-STROKE polylines (stroke-font.js): the same
      // centre anchor the SVG renderer uses, so screen and silk agree.
      for (const t of silk?.texts || []) {
        if (t.display === false || !t.text || (t.layerId ?? 3) !== layerId) continue;
        for (const stroke of strokeText(t.text, { x: t.x, y: t.y, size: 1.2, rotation: t.rotation || 0 })) {
          tracks.push({ width: 0.15, points: stroke });
        }
      }
    };
    eatSilk(board.silk);
    for (const part of board.parts || []) eatSilk(part.silk);
    const ap = new Apertures();
    files[file] = gerberFile(name, drawLayer({ tracks, circles }, ap, warnings), ap);
  }

  // Outline.
  {
    const ap = new Apertures();
    const d = ap.get('C,0.1');
    const body = [`D${d}*`];
    for (const s of board.outline || []) {
      body.push(`${XY(s.x1, s.y1)}D02*`);
      if (s.type === 'arc') {
        for (let i = 1; i <= 24; i++) {
          const [px, py] = arcPointAt(s, i / 24);
          body.push(`${XY(px, py)}D01*`);
        }
      } else {
        body.push(`${XY(s.x2, s.y2)}D01*`);
      }
    }
    files['outline.gko'] = gerberFile('Profile,NP', body, ap);
  }

  // Excellon drills: plated pads + vias, then unplated holes.
  {
    const hits = new Map(); // diameter -> {plated, points}
    const add = (dia, x, y, plated) => {
      const key = `${fmtMm(dia)}|${plated ? 'P' : 'N'}`;
      if (!hits.has(key)) hits.set(key, { dia, plated, points: [] });
      hits.get(key).points.push([x, y]);
    };
    const slots = new Map(); // like hits, but [x1,y1,x2,y2] rout pairs
    const addSlot = (pad) => {
      const key = `${fmtMm(pad.drill)}|${pad.plated === false ? 'N' : 'P'}`;
      if (!slots.has(key)) slots.set(key, { dia: pad.drill, plated: pad.plated !== false, spans: [] });
      const half = (pad.slotLength - pad.drill) / 2;
      const th = ((pad.slotRotation ?? pad.rotation ?? 0) * Math.PI) / 180;
      const dx = half * Math.cos(th); const dy = half * Math.sin(th);
      slots.get(key).spans.push([pad.x - dx, pad.y - dy, pad.x + dx, pad.y + dy]);
    };
    const eat = (pad) => {
      if (!(pad.drill > 0)) return;
      if (pad.slotLength > pad.drill) addSlot(pad);
      else add(pad.drill, pad.x, pad.y, pad.plated !== false);
    };
    for (const part of board.parts || []) for (const pad of part.pads) eat(pad);
    for (const pad of board.freePads || []) eat(pad);
    for (const v of board.vias || []) add(v.drill, v.x, v.y, true);
    for (const h of board.holes || []) add(h.diameter, h.x, h.y, false);

    const tools = [
      ...[...hits.values()].map((t) => ({ ...t, spans: null })),
      ...[...slots.values()].map((t) => ({ ...t, points: null })),
    ].sort((a, b) => a.dia - b.dia);
    const lines = ['M48', 'METRIC,TZ'];
    tools.forEach((t, i) => lines.push(`T${i + 1}C${fmtMm(t.dia)}`));
    lines.push('%', 'G90', 'G05');
    const co = (v) => (Math.round(v * 1000) / 1000).toFixed(3);
    tools.forEach((t, i) => {
      lines.push(`T${i + 1}`);
      for (const [x, y] of t.points || []) lines.push(`X${co(x)}Y${co(y)}`);
      // A slot is one G85 rout between its two end centres — the tool's
      // diameter is the slot width.
      for (const [x1, y1, x2, y2] of t.spans || []) {
        lines.push(`X${co(x1)}Y${co(y1)}G85X${co(x2)}Y${co(y2)}`);
      }
    });
    lines.push('T0', 'M30');
    files['drill.drl'] = lines.join('\n') + '\n';
  }

  return { files, warnings };
}
