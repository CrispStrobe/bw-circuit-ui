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
