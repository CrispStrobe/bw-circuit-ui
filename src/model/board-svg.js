/**
 * Headless board renderer: board model → SVG string (plan Phase 4).
 *
 * One renderer for both consumers: BoardPanel mounts this string, the
 * baseline test byte-compares it. Coordinates are millimetres straight
 * from the board model; the Y flip happens HERE (SVG is Y-down) by
 * emitting y' = H − y, so no transform attribute ever flips text.
 *
 * Exactness where it is free: rect and polygon pads are drawn from
 * pcb-geometry's padShape() polygons — the same corners the DRC measures,
 * so the picture cannot disagree with the checker about where copper is.
 * An oval pad is its stadium: a line with round caps and the short axis
 * as stroke width, which is exact, not an approximation.
 *
 * Layer visibility is CSS, not re-rendering: every group carries a stable
 * class (`bw-pcb-copper-top`, `-copper-bottom`, `-silk`, `-pads`,
 * `-drills`, `-outline`, `-labels`) and the panel toggles them with
 * style rules. One DOM, any view.
 *
 * An outline-only pour (no file fill) renders DASHED at lower opacity —
 * the over-approximation stays visibly labelled all the way to the
 * screen (plan §5 Phase 0.5).
 *
 * @module
 */

import { padShape } from './pcb-geometry.js';

export const BOARD_THEME = {
  substrate: '#123a24',
  substrateEdge: '#0c2b1a',
  outline: '#e8e8e8',
  copperTop: '#e05a4b',
  copperBottom: '#4d7fe0',
  pad: '#e2b95c',
  drill: '#0d0d0d',
  via: '#c9a44a',
  silk: '#f2f2f2',
  label: '#f2f2f2',
  pourTopFill: 'rgba(224, 90, 75, 0.30)',
  pourBottomFill: 'rgba(77, 127, 224, 0.30)',
};

const fmt = (n) => {
  const r = Math.round(n * 1000) / 1000;
  return Object.is(r, -0) ? '0' : String(r);
};

/**
 * @param {object} board  board model (importer or projection output)
 * @param {object} [opts] {theme}
 * @returns {string} a complete <svg> element
 */
export function renderBoardSvg(board, opts = {}) {
  const T = { ...BOARD_THEME, ...(opts.theme || {}) };
  const H = board.bbox?.h ?? 0;
  const W = board.bbox?.w ?? 0;
  const X = (x) => fmt(x);
  const Y = (y) => fmt(H - y);
  const out = [];
  const open = (cls) => out.push(`<g class="${cls}">`);
  const close = () => out.push('</g>');

  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1 -1 ${fmt(W + 2)} ${fmt(H + 2)}" `
    + `width="100%" height="100%" data-board-w="${fmt(W)}" data-board-h="${fmt(H)}">`);

  // ── substrate ────────────────────────────────────────────────────
  open('bw-pcb-substrate');
  const outlinePath = outlineToPath(board.outline || [], X, Y);
  if (outlinePath) {
    out.push(`<path d="${outlinePath}" fill="${T.substrate}" stroke="none"/>`);
  } else {
    out.push(`<rect x="0" y="0" width="${fmt(W)}" height="${fmt(H)}" fill="${T.substrate}"/>`);
  }
  close();

  // ── pours (under tracks, over substrate) ─────────────────────────
  open('bw-pcb-pours');
  for (const c of board.pours || []) {
    const fill = c.layerId === 2 || c.layer === 'bottom' ? T.pourBottomFill : T.pourTopFill;
    if (c.fillFromFile && c.fills) {
      for (const group of c.fills) {
        const d = group.map((ring) => ringToPath(ring, X, Y)).join(' ');
        out.push(`<path d="${d}" fill="${fill}" fill-rule="evenodd" stroke="none"/>`);
      }
    } else if (c.outline?.length >= 3) {
      // The over-approximation, visibly labelled: dashed edge, half fill.
      out.push(`<path d="${ringToPath(c.outline, X, Y)}" fill="${fill}" opacity="0.5" `
        + `stroke="${T.outline}" stroke-width="0.15" stroke-dasharray="1 1"/>`);
    }
  }
  close();

  // ── copper ───────────────────────────────────────────────────────
  for (const [cls, layerId, color] of [
    ['bw-pcb-copper-bottom', 2, T.copperBottom],
    ['bw-pcb-copper-top', 1, T.copperTop],
  ]) {
    open(cls);
    for (const t of board.tracks || []) {
      if ((t.layerId ?? (t.layer === 'bottom' ? 2 : 1)) !== layerId) continue;
      const pts = t.points.map(([x, y]) => `${X(x)},${Y(y)}`).join(' ');
      out.push(`<polyline points="${pts}" fill="none" stroke="${color}" `
        + `stroke-width="${fmt(t.width)}" stroke-linecap="round" stroke-linejoin="round"/>`);
    }
    for (const a of board.arcs || []) {
      if ((a.layerId ?? 1) !== layerId) continue;
      out.push(`<path d="${segsToPath(a.segs, X, Y)}" fill="none" stroke="${color}" `
        + `stroke-width="${fmt(a.width || 0.254)}" stroke-linecap="round"/>`);
    }
    close();
  }

  // ── pads ─────────────────────────────────────────────────────────
  open('bw-pcb-pads');
  const allPads = [
    ...(board.parts || []).flatMap((p) => p.pads),
    ...(board.freePads || []),
  ];
  for (const pad of allPads) out.push(padSvg(pad, T, X, Y));
  for (const v of board.vias || []) {
    out.push(`<circle cx="${X(v.x)}" cy="${Y(v.y)}" r="${fmt(v.diameter / 2)}" fill="${T.via}"/>`
      + `<circle cx="${X(v.x)}" cy="${Y(v.y)}" r="${fmt(v.drill / 2)}" fill="${T.drill}"/>`);
  }
  close();

  // ── drills ───────────────────────────────────────────────────────
  open('bw-pcb-drills');
  for (const pad of allPads) {
    if (!(pad.drill > 0)) continue;
    if (pad.slotLength > pad.drill) {
      const half = (pad.slotLength - pad.drill) / 2;
      const th = ((pad.slotRotation ?? pad.rotation ?? 0) * Math.PI) / 180;
      const dx = half * Math.cos(th); const dy = half * Math.sin(th);
      out.push(`<line x1="${X(pad.x - dx)}" y1="${Y(pad.y - dy)}" x2="${X(pad.x + dx)}" y2="${Y(pad.y + dy)}" `
        + `stroke="${T.drill}" stroke-width="${fmt(pad.drill)}" stroke-linecap="round"/>`);
    } else {
      out.push(`<circle cx="${X(pad.x)}" cy="${Y(pad.y)}" r="${fmt(pad.drill / 2)}" fill="${T.drill}"/>`);
    }
  }
  for (const h of board.holes || []) {
    out.push(`<circle cx="${X(h.x)}" cy="${Y(h.y)}" r="${fmt(h.diameter / 2)}" `
      + `fill="${T.drill}" stroke="${T.pad}" stroke-width="0.2"/>`);
  }
  close();

  // ── silk ─────────────────────────────────────────────────────────
  open('bw-pcb-silk');
  const silkSources = [
    board.silk || {},
    ...(board.parts || []).map((p) => p.silk || {}),
  ];
  for (const silk of silkSources) {
    for (const t of silk.tracks || []) {
      const pts = t.points.map(([x, y]) => `${X(x)},${Y(y)}`).join(' ');
      out.push(`<polyline points="${pts}" fill="none" stroke="${T.silk}" `
        + `stroke-width="${fmt(Math.max(t.width || 0.2, 0.15))}" stroke-linejoin="round"/>`);
    }
    for (const c of silk.circles || []) {
      out.push(`<circle cx="${X(c.cx)}" cy="${Y(c.cy)}" r="${fmt(c.r)}" fill="none" `
        + `stroke="${T.silk}" stroke-width="0.2"/>`);
    }
    for (const rc of silk.rects || []) {
      out.push(`<rect x="${X(rc.x)}" y="${Y(rc.y + rc.h)}" width="${fmt(rc.w)}" height="${fmt(rc.h)}" `
        + `fill="none" stroke="${T.silk}" stroke-width="0.2"/>`);
    }
    for (const a of silk.arcs || []) {
      out.push(`<path d="${segsToPath(a.segs, X, Y)}" fill="none" stroke="${T.silk}" stroke-width="0.2"/>`);
    }
  }
  close();

  // ── labels (refdes) ──────────────────────────────────────────────
  open('bw-pcb-labels');
  for (const silk of silkSources) {
    for (const t of silk.texts || []) {
      if (t.display === false || !t.text) continue;
      out.push(`<text x="${X(t.x)}" y="${Y(t.y)}" fill="${T.label}" font-size="1.6" `
        + `font-family="monospace" text-anchor="middle">${escapeXml(t.text)}</text>`);
    }
  }
  close();

  // ── outline on top ───────────────────────────────────────────────
  open('bw-pcb-outline');
  if (outlinePath) {
    out.push(`<path d="${outlinePath}" fill="none" stroke="${T.outline}" stroke-width="0.2"/>`);
  }
  close();

  // ── hit targets (transparent, editors only) ──────────────────────
  // One rect per part over its pad bounding box, carrying data-part-id:
  // BoardPanel's drag/select gestures dispatch on these. Transparent fill
  // still receives pointer events; a selected part gets its outline via
  // the .bw-pcb-selected CSS class the panel injects.
  open('bw-pcb-hit');
  for (const part of board.parts || []) {
    if (!part.pads.length) continue;
    let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
    for (const pad of part.pads) {
      minX = Math.min(minX, pad.x - pad.w / 2); maxX = Math.max(maxX, pad.x + pad.w / 2);
      minY = Math.min(minY, pad.y - pad.h / 2); maxY = Math.max(maxY, pad.y + pad.h / 2);
    }
    const m = 0.6;
    out.push(`<rect data-part-id="${escapeXml(part.ref || part.id)}" x="${fmt(minX - m)}" y="${fmt(H - maxY - m)}" `
      + `width="${fmt(maxX - minX + 2 * m)}" height="${fmt(maxY - minY + 2 * m)}" `
      + 'fill="transparent" stroke="none" style="cursor:grab"/>');
  }
  close();

  out.push('</svg>');
  return out.join('');
}

function padSvg(pad, T, X, Y) {
  const shape = padShape(pad);
  if (shape.kind === 'point') {
    return `<circle cx="${X(shape.x)}" cy="${Y(shape.y)}" r="${fmt(shape.r)}" fill="${T.pad}"/>`;
  }
  if (shape.kind === 'seg') {
    // A stadium is exactly a round-capped line as wide as its short axis.
    return `<line x1="${X(shape.x1)}" y1="${Y(shape.y1)}" x2="${X(shape.x2)}" y2="${Y(shape.y2)}" `
      + `stroke="${T.pad}" stroke-width="${fmt(shape.r * 2)}" stroke-linecap="round"/>`;
  }
  const pts = shape.pts.map(([x, y]) => `${X(x)},${Y(y)}`).join(' ');
  return `<polygon points="${pts}" fill="${T.pad}"/>`;
}

function ringToPath(ring, X, Y) {
  if (!ring.length) return '';
  return 'M' + ring.map(([x, y]) => `${X(x)} ${Y(y)}`).join(' L') + ' Z';
}

function outlineToPath(outline, X, Y) {
  if (!outline.length) return '';
  const parts = [];
  let cursor = null;
  for (const s of outline) {
    const from = `${X(s.x1)} ${Y(s.y1)}`;
    if (cursor !== from) parts.push(`M${from}`);
    if (s.type === 'arc') {
      // The model flipped sweep for Y-up; the renderer flips Y again, so
      // the ORIGINAL sense returns.
      parts.push(`A${fmt(s.rx)} ${fmt(s.ry)} ${fmt(s.rot || 0)} ${s.largeArc || 0} ${s.sweep ? 0 : 1} ${X(s.x2)} ${Y(s.y2)}`);
    } else {
      parts.push(`L${X(s.x2)} ${Y(s.y2)}`);
    }
    cursor = `${X(s.x2)} ${Y(s.y2)}`;
  }
  return parts.join(' ');
}

function segsToPath(segs, X, Y) {
  const parts = [];
  let cursor = null;
  for (const s of segs || []) {
    const from = `${X(s.x1)} ${Y(s.y1)}`;
    if (cursor !== from) parts.push(`M${from}`);
    if (s.type === 'arc') {
      parts.push(`A${fmt(s.rx)} ${fmt(s.ry)} ${fmt(s.rot || 0)} ${s.largeArc || 0} ${s.sweep ? 0 : 1} ${X(s.x2)} ${Y(s.y2)}`);
    } else {
      parts.push(`L${X(s.x2)} ${Y(s.y2)}`);
    }
    cursor = `${X(s.x2)} ${Y(s.y2)}`;
  }
  return parts.join(' ');
}

function escapeXml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
