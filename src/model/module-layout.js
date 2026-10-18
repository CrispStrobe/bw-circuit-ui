/**
 * Generic module layout (B20): where the pins of a part kind with a sidecar
 * but no dedicated renderer sit, and the body drawn around them.
 *
 * One helper for the body, the terminal dots and the wire endpoints, so the
 * three can never disagree. Positions are relative to the body centre, in
 * the part's unrotated frame.
 *
 * Order of authority:
 *   1. `existing` offsets (what the canvas already uses) when they give every
 *      sidecar terminal its own point: those stay exactly where they are.
 *   2. The sidecar's own terminal geometry when every terminal has finite
 *      x/y and no two terminals share a point: kept exactly (centre offsets).
 *   3. Otherwise the terminals are "collapsed" (missing coordinates or all
 *      on one spot), and get a single breakout-header row at a fixed pitch
 *      along the bottom edge, in sidecar order.
 * Terminal names are never changed. Aliases share their twin's point.
 */

export const MODULE_PIN_PITCH = 10;
const MIN_W = 40;
const MIN_H = 24;
const ROW_BODY_H = 26;
const PAD = 6;

const finite = v => typeof v === 'number' && Number.isFinite(v);

function distinct(names, offsets) {
  if (!offsets) return false;
  const seen = new Set();
  for (const name of names) {
    const p = offsets[name];
    if (!p || !finite(p.dx) || !finite(p.dy)) return false;
    const key = `${p.dx},${p.dy}`;
    if (seen.has(key)) return false;
    seen.add(key);
  }
  return true;
}

/** True when the sidecar's own x/y give every terminal a distinct point. */
export function sidecarHasDistinctGeometry(sidecar) {
  const terms = sidecar?.terminals || [];
  if (!terms.length) return false;
  const seen = new Set();
  for (const t of terms) {
    if (!finite(t.x) || !finite(t.y)) return false;
    const key = `${t.x},${t.y}`;
    if (seen.has(key)) return false;
    seen.add(key);
  }
  return true;
}

function withAliases(sidecar, offsets) {
  for (const t of sidecar.terminals) {
    if (Array.isArray(t.aliases) && offsets[t.name]) {
      for (const a of t.aliases) offsets[a] = { ...offsets[t.name] };
    }
  }
  return offsets;
}

function bbox(points) {
  let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
  for (const p of points) {
    l = Math.min(l, p.dx); r = Math.max(r, p.dx);
    t = Math.min(t, p.dy); b = Math.max(b, p.dy);
  }
  return { l, t, r, b };
}

/**
 * @param {{w?:number,h?:number,terminals:Array<{name:string,x?:number,y?:number,aliases?:string[]}>}} sidecar
 * @param {{existing?: Record<string,{dx:number,dy:number}>}} [opts]
 * @returns {{offsets: Record<string,{dx:number,dy:number}>, box:{x:number,y:number,w:number,h:number}, source:'existing'|'sidecar'|'row', collapsed:boolean}}
 */
export function moduleTerminalLayout(sidecar, { existing } = {}) {
  const terms = sidecar?.terminals || [];
  const names = terms.map(t => t.name);
  let offsets, source;
  if (names.length && distinct(names, existing)) {
    offsets = {};
    for (const [name, p] of Object.entries(existing)) offsets[name] = { dx: p.dx, dy: p.dy };
    source = 'existing';
  } else if (sidecarHasDistinctGeometry(sidecar)) {
    const w = finite(sidecar.w) ? sidecar.w : 0, h = finite(sidecar.h) ? sidecar.h : 0;
    offsets = {};
    for (const t of terms) offsets[t.name] = { dx: t.x - w / 2, dy: t.y - h / 2 };
    source = 'sidecar';
  } else {
    const n = names.length;
    const h = ROW_BODY_H;
    offsets = {};
    names.forEach((name, i) => {
      offsets[name] = { dx: (i - (n - 1) / 2) * MODULE_PIN_PITCH, dy: h / 2 };
    });
    const w = Math.max(MIN_W, n * MODULE_PIN_PITCH + PAD);
    return { offsets: withAliases(sidecar, offsets), box: { x: -w / 2, y: -h / 2, w, h }, source: 'row', collapsed: true };
  }
  withAliases(sidecar, offsets);
  // Body: the sidecar's own box when it is centred on the pins' frame and
  // holds them, else the pins' bounding box; never smaller than MIN_W×MIN_H.
  const pts = names.map(n => offsets[n]).filter(Boolean);
  const bb = pts.length ? bbox(pts) : { l: 0, t: 0, r: 0, b: 0 };
  let hw = Math.max(Math.abs(bb.l), Math.abs(bb.r));
  let hh = Math.max(Math.abs(bb.t), Math.abs(bb.b));
  if (source === 'sidecar' && finite(sidecar.w) && finite(sidecar.h)) {
    hw = Math.max(hw, sidecar.w / 2); hh = Math.max(hh, sidecar.h / 2);
  }
  hw = Math.max(MIN_W / 2, hw); hh = Math.max(MIN_H / 2, hh);
  return { offsets, box: { x: -hw, y: -hh, w: 2 * hw, h: 2 * hh }, source, collapsed: false };
}

/*
 * Pin labels (B21). Each name sits inside the body next to its pin. A pin on
 * the top or bottom edge keeps a horizontal name while its neighbours on that
 * edge leave room for it; otherwise the name turns perpendicular to the edge
 * and reads inward. Names on the left and right edges run inward
 * horizontally, at a font size their vertical pitch allows. The body grows
 * away from pinless edges to hold turned names and leave the title its own
 * band; pins never move.
 */
export const PIN_LABEL_FONT = 3;
const CHAR_W = 0.62;      // monospace advance per font-size unit
const LABEL_GAP = 4;      // pin centre to the near end of its name
const TITLE_BAND = 12;

function edgeOf(p, ext, pts) {
  const fx = ext.hw ? Math.abs(p.dx) / ext.hw : 0;
  const fy = ext.hh ? Math.abs(p.dy) / ext.hh : 0;
  // A corner pin (equal pull) joins the row or column it lines up with.
  const inRow = pts.filter(q => q.dy === p.dy).length, inCol = pts.filter(q => q.dx === p.dx).length;
  if (fy > fx || (fy === fx && inRow > inCol)) return p.dy >= 0 ? 'bottom' : 'top';
  return p.dx >= 0 ? 'right' : 'left';
}

/**
 * @param {{terminals:Array<{name:string}>}} sidecar
 * @param {{offsets:Record<string,{dx:number,dy:number}>, box:{x:number,y:number,w:number,h:number}}} layout
 * @returns {{labels: Record<string,{x:number,y:number,anchor:'start'|'middle'|'end',rotate:number,size:number}>, box:{x:number,y:number,w:number,h:number}, titleY:number}}
 */
export function moduleLabelLayout(sidecar, { offsets, box }) {
  const terms = (sidecar?.terminals || []).filter(t => offsets[t.name]);
  const byEdge = { top: [], bottom: [], left: [], right: [] };
  // Edges are judged by the pins' own extent: the body may be wider (MIN_W).
  const ext = { hw: 0, hh: 0 };
  for (const t of terms) {
    ext.hw = Math.max(ext.hw, Math.abs(offsets[t.name].dx));
    ext.hh = Math.max(ext.hh, Math.abs(offsets[t.name].dy));
  }
  const pts = terms.map(t => offsets[t.name]);
  for (const t of terms) byEdge[edgeOf(offsets[t.name], ext, pts)].push(t.name);
  const labels = {};
  let topReach = box.y, bottomReach = box.y + box.h; // inner extent of names
  const nearest = (name, list, axis) => {
    let gap = Infinity;
    for (const other of list) {
      if (other === name) continue;
      gap = Math.min(gap, Math.abs(offsets[other][axis] - offsets[name][axis]));
    }
    return gap;
  };
  for (const edge of ['top', 'bottom']) {
    const list = byEdge[edge];
    for (const name of list) {
      const p = offsets[name];
      const size = PIN_LABEL_FONT;
      const width = name.length * size * CHAR_W;
      const gap = nearest(name, list, 'dx');
      if (width <= gap - 1) {
        const y = edge === 'bottom' ? p.dy - LABEL_GAP : p.dy + LABEL_GAP + size;
        labels[name] = { x: p.dx, y, anchor: 'middle', rotate: 0, size };
        if (edge === 'bottom') bottomReach = Math.min(bottomReach, p.dy - LABEL_GAP - size);
        else topReach = Math.max(topReach, y);
      } else {
        const size2 = Math.max(2, Math.min(size, gap - 0.5));
        const len = name.length * size2 * CHAR_W;
        // rotate(-90): text runs upward. Bottom edge: start just above the
        // pin; top edge: end just below it, so both read inward.
        labels[name] = edge === 'bottom'
          ? { x: p.dx + size2 / 3, y: p.dy - LABEL_GAP, anchor: 'start', rotate: -90, size: size2 }
          : { x: p.dx + size2 / 3, y: p.dy + LABEL_GAP, anchor: 'end', rotate: -90, size: size2 };
        if (edge === 'bottom') bottomReach = Math.min(bottomReach, p.dy - LABEL_GAP - len);
        else topReach = Math.max(topReach, p.dy + LABEL_GAP + len);
      }
    }
  }
  for (const edge of ['left', 'right']) {
    const list = byEdge[edge];
    for (const name of list) {
      const p = offsets[name];
      // Names from the left and the right meet in the middle: each gets at
      // most half the span between the two pin columns.
      const half = Math.max(0, ext.hw - LABEL_GAP - 0.5);
      const byLen = half / Math.max(1, name.length * CHAR_W);
      const size = Math.max(1.5, Math.min(PIN_LABEL_FONT, nearest(name, list, 'dy') - 0.5, byLen));
      labels[name] = edge === 'left'
        ? { x: p.dx + LABEL_GAP, y: p.dy + size / 3, anchor: 'start', rotate: 0, size }
        : { x: p.dx - LABEL_GAP, y: p.dy + size / 3, anchor: 'end', rotate: 0, size };
    }
  }
  // Grow away from pinless edges until the title has a band between the
  // names reaching in from the top and from the bottom.
  let { x, y, w, h } = box;
  const free = bottomReach - topReach;
  if (free < TITLE_BAND) {
    const need = TITLE_BAND - free;
    if (!byEdge.top.length) { y -= need; h += need; topReach -= need; }
    else if (!byEdge.bottom.length) { h += need; bottomReach += need; }
  }
  return { labels, box: { x, y, w, h }, titleY: (topReach + bottomReach) / 2 };
}
