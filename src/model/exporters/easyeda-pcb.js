/**
 * EasyEDA Standard PCB writer (`docType 3`) — Phase 5 of the PCB plan.
 *
 * Symmetric to easyeda-schematic.js and built to the same rule: SAFE BY
 * CONSTRUCTION, verified by the round-trip oracle. Acceptance is never
 * eyeballing — export → importEasyEdaPcb → computeCopperNetlist, and the
 * copper partition must equal the source board's, pad for pad. The same
 * oracle covers re-export of an IMPORTED board: the DRC verdict of the
 * re-imported copy must equal the original's, finding for finding.
 *
 * Coordinate contract (the mirror of the importer's): the model is mm,
 * Y up, origin at the outline's bottom-left; the file is EasyEDA units
 * (1 = 10 mil = 0.254 mm), Y down, at a conventional canvas origin of
 * (4000, 3000). fileX = 4000 + x/0.254, fileY = 3000 + (H − y)/0.254.
 * The Y flip inverts arc sweep flags — the importer flipped them coming
 * in, so they flip back going out, and a re-imported arc is bit-equal.
 *
 * Gerbers are deliberately NOT here (plan §5): EasyEDA produces them
 * from any board it can open, so this file already unblocks fabrication.
 *
 * @module
 */

import { padOutlinePolygon } from '../pcb-geometry.js';
import { dist } from '../exact-hypot.js';

const U = 0.254; // mm per EasyEDA unit
const OX = 4000; // canvas origin, file units
const OY = 3000;

const fmt = (n) => {
  const r = Math.round(n * 10000) / 10000;
  return Object.is(r, -0) ? '0' : String(r);
};

const PAD_SHAPE_NAMES = { circle: 'ELLIPSE', rect: 'RECT', oval: 'OVAL', polygon: 'POLYGON' };

const LAYERS_TABLE = [
  '1~TopLayer~#FF0000~true~true~true~',
  '2~BottomLayer~#0000FF~true~false~true~',
  '3~TopSilkLayer~#FFCC00~true~false~true~',
  '4~BottomSilkLayer~#66CC33~true~false~true~',
  '5~TopPasteMaskLayer~#808080~false~false~true~',
  '6~BottomPasteMaskLayer~#800000~false~false~true~',
  '7~TopSolderMaskLayer~#800080~false~false~true~0.3',
  '8~BottomSolderMaskLayer~#AA00FF~false~false~true~0.3',
  '9~Ratlines~#6464FF~true~false~true~',
  '10~BoardOutLine~#FF00FF~true~false~true~',
  '11~Multi-Layer~#C0C0C0~true~false~true~',
  '12~Document~#FFFFFF~true~false~true~',
];

/**
 * @param {object} board  the board model (importEasyEdaPcb or projectBoard output)
 * @param {object} [opts] {title}
 * @returns {string} EasyEDA Standard PCB JSON
 */
export function exportEasyEdaPcb(board, opts = {}) {
  const H = board.bbox?.h ?? 0;
  const fx = (x) => fmt(OX + x / U);
  const fy = (y) => fmt(OY + (H - y) / U);
  const fl = (v) => fmt(v / U); // lengths
  let seq = 0;
  const id = (prefix = 'gge') => `${prefix}${++seq}`;

  // EasyEDA Standard inner copper is layer ids 21..24 (Inner1..4). Model
  // ids 21+ pass through; Pro's 15..18 renumber by stack position.
  const innerIds = [...new Set(((board.copperLayers || []).filter((id) => id > 2)))].sort((a, b) => a - b);
  const innerOut = new Map(innerIds.map((id, i) => [id, 21 + i]));
  const layerIdOut = (t) => (t.layerId === 2 || t.layer === 'bottom' ? 2
    : innerOut.get(t.layerId) || 1);

  const shape = [];

  // ── outline (layer 10) ───────────────────────────────────────────
  // Chained line segments become polyline TRACKs; arcs become ARCs with
  // the sweep flipped back for the Y-down file.
  const outLines = (board.outline || []).filter((s) => s.type === 'line');
  const outArcs = (board.outline || []).filter((s) => s.type === 'arc');
  if (outLines.length) {
    const chains = chainSegments(outLines);
    for (const chain of chains) {
      const pts = chain.map(([x, y]) => `${fx(x)} ${fy(y)}`).join(' ');
      shape.push(`TRACK~1~10~~${pts}~${id()}~0`);
    }
  }
  for (const a of outArcs) shape.push(arcShape(a, 10, '', fx, fy, fl, id));

  // ── footprints ───────────────────────────────────────────────────
  for (const part of board.parts || []) {
    const subs = [];
    for (const pad of part.pads) {
      subs.push(padShapeString(pad, fx, fy, fl, id));
    }
    for (const t of part.silk?.tracks || []) {
      const pts = t.points.map(([x, y]) => `${fx(x)} ${fy(y)}`).join(' ');
      subs.push(`TRACK~${fl(t.width || 0.254)}~3~~${pts}~${id()}~0`);
    }
    for (const c of part.silk?.circles || []) {
      subs.push(`CIRCLE~${fx(c.cx)}~${fy(c.cy)}~${fl(c.r)}~0.8~3~${id()}~0~~`);
    }
    for (const rc of part.silk?.rects || []) {
      // A silk rect draws as a closed 5-point silk TRACK: RECT on silk is
      // FILLED in EasyEDA, which is not what an outline means.
      const pts = [
        [rc.x, rc.y], [rc.x + rc.w, rc.y], [rc.x + rc.w, rc.y + rc.h], [rc.x, rc.y + rc.h], [rc.x, rc.y],
      ].map(([x, y]) => `${fx(x)} ${fy(y)}`).join(' ');
      subs.push(`TRACK~0.8~3~~${pts}~${id()}~0`);
    }
    for (const t of part.silk?.texts || []) {
      subs.push(`TEXT~${t.kind || 'P'}~${fx(t.x)}~${fy(t.y)}~0.6~${fmt(t.rotation || 0)}~0~3~~4.5~${sanitize(t.text)}~~${t.display === false ? 'none' : ''}~${id()}~~0`);
    }
    const attrs = `package\`${sanitize(part.package || '')}\``;
    const side = part.side === 'bottom' ? 2 : 1;
    shape.push(
      `LIB~${fx(part.x)}~${fy(part.y)}~${attrs}~${part.rotation ? fmt(part.rotation) : ''}~~${id('gge_lib')}~${side}~${id('uuid')}~0~~yes~~`
      + subs.map((s) => `#@$${s}`).join(''),
    );
  }

  // ── free copper ──────────────────────────────────────────────────
  for (const pad of board.freePads || []) shape.push(padShapeString(pad, fx, fy, fl, id));
  for (const t of board.tracks || []) {
    const pts = t.points.map(([x, y]) => `${fx(x)} ${fy(y)}`).join(' ');
    shape.push(`TRACK~${fl(t.width)}~${layerIdOut(t)}~${sanitize(t.net)}~${pts}~${id()}~0`);
  }
  for (const a of board.arcs || []) shape.push(arcShape(a, a.layerId || 1, a.net || '', fx, fy, fl, id));
  for (const v of board.vias || []) {
    shape.push(`VIA~${fx(v.x)}~${fy(v.y)}~${fl(v.diameter)}~${sanitize(v.net)}~${fl(v.drill / 2)}~${id()}~0`);
  }
  for (const h of board.holes || []) {
    shape.push(`HOLE~${fx(h.x)}~${fy(h.y)}~${fl(h.diameter / 2)}~${id()}~0`);
  }
  for (const c of board.pours || []) {
    const ring = (pts) => {
      if (!pts.length) return '';
      return 'M ' + pts.map(([x, y], i) => (i ? `L ${fx(x)} ${fy(y)}` : `${fx(x)} ${fy(y)}`)).join(' ') + ' Z';
    };
    const outlinePath = ring(c.outline || []);
    const fillsJson = c.fills
      ? JSON.stringify(c.fills.map((group) => group.map((r) => ring(r)).join(' ')))
      : '[]';
    shape.push(`COPPERAREA~1~${c.layerId || layerIdOut(c)}~${sanitize(c.net)}~${outlinePath}~${fl(c.clearance || 0.2)}~${c.fillStyle || 'solid'}~${id()}~${c.thermal || 'spoke'}~${c.keepIsland || 'none'}~${fillsJson}~0`);
  }
  for (const t of board.silk?.texts || []) {
    shape.push(`TEXT~${t.kind || 'L'}~${fx(t.x)}~${fy(t.y)}~0.6~${fmt(t.rotation || 0)}~0~${t.layerId || 3}~~8~${sanitize(t.text)}~~${t.display === false ? 'none' : ''}~${id()}~~0`);
  }

  const W = board.bbox?.w ?? 0;
  const doc = {
    editorVersion: '6.5.5',
    docType: '3',
    title: opts.title ?? 'brickwright-board',
    head: { docType: '3', editorVersion: '6.5.5' },
    canvas: `CA~1000~1000~#000000~yes~#FFFFFF~10~1000~1000~line~0.5~mm~1~45~visible~0.5~${OX}~${OY}~0~yes`,
    layers: LAYERS_TABLE,
    shape,
    objects: [],
    BBox: { x: OX, y: OY, width: Math.round(W / U), height: Math.round(H / U) },
    preference: { hideFootprints: '', hideNets: '' },
  };
  return JSON.stringify(doc, null, 0);
}

/** `~` and backtick corrupt the tilde DSL; strip them from free text. */
function sanitize(s) {
  return String(s ?? '').replace(/[~`#$]/g, '_');
}

function padShapeString(pad, fx, fy, fl, id) {
  // EasyEDA has no roundrect pad; a cornerRadius pad goes out as a POLYGON
  // sampled from the true outline (sub-10 um chord error). Writing it as a
  // sharp RECT re-grew the corners and a pour-hugging pad touched the fill
  // again after the round trip (measured, dvi-sock).
  const cr = pad.cornerRadius || 0;
  const effShape = cr > 0 ? 'polygon' : pad.shape;
  const effPoints = cr > 0 ? padOutlinePolygon(pad) : pad.points;
  const name = PAD_SHAPE_NAMES[effShape] || 'ELLIPSE';
  const layer = pad.through ? 11 : (pad.layer === 'bottom' ? 2 : 1);
  const holeR = pad.drill ? fl(pad.drill / 2) : '0';
  const points = effPoints ? effPoints.map(([x, y]) => `${fx(x)} ${fy(y)}`).join(' ') : '';
  const holeLen = pad.slotLength > 0 ? fl(pad.slotLength) : '0';
  return `PAD~${name}~${fx(pad.x)}~${fy(pad.y)}~${fl(pad.w)}~${fl(pad.h)}~${layer}~${sanitize(pad.net)}~${sanitize(pad.num)}~${holeR}~${points}~${fmt(pad.rotation || 0)}~${id()}~${holeLen}~~${pad.plated === false ? 'N' : 'Y'}~0~0~0.2~${fx(pad.x)},${fy(pad.y)}`;
}

function arcShape(a, layerId, net, fx, fy, fl, id) {
  const segs = a.segs || [a];
  const parts = [];
  for (const s of segs) {
    if (s.type === 'line') {
      parts.push(`M ${fx(s.x1)} ${fy(s.y1)} L ${fx(s.x2)} ${fy(s.y2)}`);
    } else {
      // The importer flipped sweep with the Y axis; flip it back.
      const sweep = s.sweep ? 0 : 1;
      parts.push(`M ${fx(s.x1)} ${fy(s.y1)} A ${fl(s.rx)} ${fl(s.ry)} ${fmt(s.rot || 0)} ${s.largeArc || 0} ${sweep} ${fx(s.x2)} ${fy(s.y2)}`);
    }
  }
  return `ARC~${fl(a.width || 0.254)}~${layerId}~${sanitize(net)}~${parts.join(' ')}~~${id()}~0`;
}

/** Join loose line segments into ordered chains (endpoint matching, 10 µm). */
function chainSegments(segs) {
  const TOL = 0.01;
  const remaining = segs.map((s) => [[s.x1, s.y1], [s.x2, s.y2]]);
  const chains = [];
  while (remaining.length) {
    const chain = remaining.shift();
    let grew = true;
    while (grew) {
      grew = false;
      for (let i = 0; i < remaining.length; i++) {
        const [a, b] = remaining[i];
        const head = chain[0]; const tail = chain[chain.length - 1];
        const eq = (p, q) => dist(p[0] - q[0], p[1] - q[1]) <= TOL;
        if (eq(tail, a)) { chain.push(b); remaining.splice(i, 1); grew = true; break; }
        if (eq(tail, b)) { chain.push(a); remaining.splice(i, 1); grew = true; break; }
        if (eq(head, a)) { chain.unshift(b); remaining.splice(i, 1); grew = true; break; }
        if (eq(head, b)) { chain.unshift(a); remaining.splice(i, 1); grew = true; break; }
      }
    }
    chains.push(chain);
  }
  return chains;
}
