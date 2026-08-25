/**
 * EasyEDA Standard PCB reader (`docType 3`) — Phase 0 of docs/PCB-SUPPORT-PLAN.md.
 *
 * Reads a board, not a schematic: LIB footprint instances with their PADs,
 * TRACKs on copper layers, VIAs, HOLEs, ARCs, COPPERAREA pours, the board
 * outline on layer 10, and silk on 3/4. The output is the board MODEL the
 * rest of the plan consumes: everything in millimetres, Y up, origin at the
 * board outline's bottom-left. EasyEDA's own unit (1 unit = 10 mil =
 * 0.254 mm) and Y-down axis are format details and stay inside this file.
 *
 * Connectivity is NOT computed here. Pads and tracks carry the net NAMES the
 * file declares; whether the copper actually joins what the names claim is
 * Phase 0.5's copper netlist and Phase 2's `net-island` rule. An importer
 * that resolved connectivity would be a second opinion about the one thing
 * that must have a single authority.
 *
 * Field layouts below were decoded by MEASURING real boards (three of them,
 * 16–24 footprints each) the way `easyeda.js` decoded the schematic DSL —
 * no third-party reader's source was read. Load-bearing findings:
 *
 *   - `head.docType` is a STRING ("3"), and a PCB exported alone may carry
 *     no top-level docType at all — the bare `{head, canvas, shape}` payload.
 *   - LIB header: field 1/2 x,y; field 3 backtick attrs (package, LCSC ids);
 *     field 4 rotation in degrees ('' = 0); field 6 id; field 7 the SIDE
 *     (1 top, 2 bottom). Child shapes are `#@$`-separated and their
 *     coordinates are ABSOLUTE — the transform is already applied, exactly
 *     as the schematic importer found for symbol pins.
 *   - PAD: shape ELLIPSE/RECT/OVAL/POLYGON, x, y, w, h, layer (11 = through),
 *     net, NUMBER (field 8 — the pad number is not the pin slot, see the
 *     terminal-map rule in the plan), hole RADIUS, polygon points, rotation,
 *     id, slot length, slot points, plated Y/N.
 *   - COPPERAREA field 10 is a JSON array of SVG path strings: EasyEDA's own
 *     COMPUTED FILL. When present it is exact pour geometry and Phase 0.5
 *     needs no approximation at all; `fillFromFile` says which case you got.
 *   - TEXT field 1: L = free label, P = the refdes, N = the part name;
 *     field 12 `display` ('none' hides it). The refdes of a footprint lives
 *     in its child TEXT of type P, nowhere else.
 *   - CIRCLE/SOLIDREGION on layers ≥ 99 are 3D-model/courtyard decoration,
 *     counted in `ignored`, never silently dropped.
 *
 * @module
 */

// parseLibAttrs is the schematic importer's; one backtick parser, not two.
import { parseLibAttrs } from './easyeda.js';
import { liftBoardToCircuit } from '../model/board-lift.js';

// 1 EasyEDA unit = 10 mil = 0.254 mm.
export const MM_PER_UNIT = 0.254;

/** EasyEDA layer ids that carry copper. Inner layers (21+) exist on 4+ layer
 *  boards; this reader accepts them and reports them in `copperLayers`. */
const COPPER_LAYERS = new Set([1, 2, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32]);
const SILK_LAYERS = new Set([3, 4]);
const OUTLINE_LAYER = 10;
const THROUGH_LAYER = 11; // "Multi-Layer": through-hole pads and free holes
const DOCUMENT_LAYER = 12;

/**
 * Is this text an EasyEDA Standard PCB document?
 * Cheap: substring gates before any JSON.parse, like looksLikeEasyEda.
 */
export function looksLikeEasyEdaPcb(text) {
  if (!/^\s*\{/.test(text)) return false;
  if (!/"docType"\s*:\s*"?(3|14)"?/.test(text)) return false;
  return /"shape"\s*:/.test(text);
}

/**
 * Is this an EasyEDA PRO export? Different format family entirely
 * (`.epcb2`/`.esch2` JSON-lines inside `.eprj3` folders, other coordinate
 * scaling, inverted Y). Detected only to say so helpfully — reading Pro is
 * explicitly out of scope (plan §4).
 */
export function looksLikeEasyEdaPro(text) {
  const head = text.slice(0, 2000);
  // Pro documents are JSON Lines whose rows are arrays and whose first rows
  // carry a DOCTYPE marker; Standard is a single JSON object.
  if (/^\s*\[\s*"DOCTYPE"/.test(head)) return true;
  return /"editorVersion"\s*:\s*"?2\./.test(head) && /"docType"\s*:\s*"?(PCB|SCH)/i.test(head);
}

// ── tokenizing ─────────────────────────────────────────────────────

/** "4137.8 3098.1 4113.4,3122.5" -> [[4137.8,3098.1],[4113.4,3122.5]] */
function pairs(s) {
  const n = String(s || '').trim().split(/[\s,]+/).map(Number);
  const out = [];
  for (let i = 0; i + 1 < n.length; i += 2) {
    if (Number.isFinite(n[i]) && Number.isFinite(n[i + 1])) out.push([n[i], n[i + 1]]);
  }
  return out;
}

/**
 * A minimal SVG path reader for the subset EasyEDA writes into boards:
 * M/L (with implicit repeats, commas optional, letters glued to numbers,
 * both `L4015,3669.5` and `L 4015 3669.5` occur in one real file), A, Z.
 *
 * Returns subpaths: { segs: [{type:'line'|'arc', x1,y1,x2,y2, rx,ry,rot,
 * largeArc,sweep}], closed }. Coordinates stay in EasyEDA units and Y-down;
 * the caller converts, because the sweep flag flips with the Y axis and only
 * the caller knows whether it is converting.
 */
export function parsePath(d) {
  const tokens = String(d || '').match(/[MLAZmlaz]|-?\d*\.?\d+(?:e-?\d+)?/gi) || [];
  const subpaths = [];
  let cur = null; let cx = 0; let cy = 0; let cmd = null;
  const num = (i) => Number(tokens[i]);
  for (let i = 0; i < tokens.length;) {
    const t = tokens[i];
    if (/^[MLAZmlaz]$/.test(t)) { cmd = t.toUpperCase(); i += 1; if (cmd === 'Z') { if (cur) cur.closed = true; cur = null; } continue; }
    if (cmd === 'M') {
      cx = num(i); cy = num(i + 1); i += 2;
      cur = { segs: [], closed: false };
      subpaths.push(cur);
      cmd = 'L'; // SVG: coordinate pairs after a moveto are implicit linetos
    } else if (cmd === 'L') {
      const x = num(i); const y = num(i + 1); i += 2;
      if (cur) cur.segs.push({ type: 'line', x1: cx, y1: cy, x2: x, y2: y });
      cx = x; cy = y;
    } else if (cmd === 'A') {
      const rx = num(i); const ry = num(i + 1); const rot = num(i + 2);
      const largeArc = num(i + 3); const sweep = num(i + 4);
      const x = num(i + 5); const y = num(i + 6); i += 7;
      if (cur) cur.segs.push({ type: 'arc', x1: cx, y1: cy, x2: x, y2: y, rx, ry, rot, largeArc, sweep });
      cx = x; cy = y;
    } else {
      i += 1; // stray number with no command: skip rather than loop forever
    }
  }
  return subpaths;
}

/**
 * Flatten one parsed subpath to a polygon ring (units, Y-down). Arcs are
 * sampled; pour fills in real files are already tessellated so this is the
 * rare path, but a copper arc must not vanish.
 */
export function subpathToRing(sp, arcSteps = 16) {
  const ring = [];
  for (const s of sp.segs) {
    if (!ring.length) ring.push([s.x1, s.y1]);
    if (s.type === 'line') {
      ring.push([s.x2, s.y2]);
    } else {
      for (const p of sampleArc(s, arcSteps)) ring.push(p);
    }
  }
  return ring;
}

/** Sample an SVG elliptical arc (endpoint parameterisation, F.6.5). */
function sampleArc(a, steps) {
  const { x1, y1, x2, y2, largeArc, sweep } = a;
  let { rx, ry } = a;
  const phi = (a.rot || 0) * Math.PI / 180;
  if (!rx || !ry) return [[x2, y2]];
  rx = Math.abs(rx); ry = Math.abs(ry);
  const cosP = Math.cos(phi); const sinP = Math.sin(phi);
  const dx = (x1 - x2) / 2; const dy = (y1 - y2) / 2;
  const x1p = cosP * dx + sinP * dy; const y1p = -sinP * dx + cosP * dy;
  const lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lam > 1) { const s = Math.sqrt(lam); rx *= s; ry *= s; }
  const sign = largeArc !== sweep ? 1 : -1;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const rad = Math.max(0, (rx * rx * ry * ry - den) / den);
  const co = sign * Math.sqrt(rad);
  const cxp = co * rx * y1p / ry; const cyp = -co * ry * x1p / rx;
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
  const pts = [];
  for (let i = 1; i <= steps; i++) {
    const th = th1 + dth * (i / steps);
    const px = rx * Math.cos(th); const py = ry * Math.sin(th);
    pts.push([cosP * px - sinP * py + cx, sinP * px + cosP * py + cy]);
  }
  return pts;
}

// ── shape parsers (raw units, Y-down) ──────────────────────────────

const PAD_SHAPES = { ELLIPSE: 'circle', RECT: 'rect', OVAL: 'oval', POLYGON: 'polygon' };

function parsePad(f, warnings) {
  const shape = PAD_SHAPES[f[1]] || 'circle';
  if (!PAD_SHAPES[f[1]]) warnings.push(`PAD ${f[12] || '?'}: unknown shape "${f[1]}", read as circle`);
  const layer = Number(f[6]);
  return {
    shape,
    x: Number(f[2]), y: Number(f[3]),
    w: Number(f[4]), h: Number(f[5]),
    layerId: layer,
    net: f[7] || '',
    num: f[8] || '',
    holeRadius: Number(f[9]) || 0,
    points: f[10] ? pairs(f[10]) : null,
    rotation: Number(f[11]) || 0,
    id: f[12] || '',
    slotLength: Number(f[13]) || 0,
    slotPoints: f[14] ? pairs(f[14]) : null,
    plated: (f[15] || 'Y') !== 'N',
  };
}

function parseTrack(f) {
  return {
    width: Number(f[1]),
    layerId: Number(f[2]),
    net: f[3] || '',
    points: pairs(f[4]),
    id: f[5] || '',
  };
}

function parseVia(f) {
  return {
    x: Number(f[1]), y: Number(f[2]),
    diameter: Number(f[3]),
    net: f[4] || '',
    holeRadius: Number(f[5]) || 0,
    id: f[6] || '',
  };
}

function parseHole(f) {
  return { x: Number(f[1]), y: Number(f[2]), radius: Number(f[3]), id: f[4] || '' };
}

function parseArcShape(f) {
  return {
    width: Number(f[1]),
    layerId: Number(f[2]),
    net: f[3] || '',
    path: f[4] || '',
    id: f[6] || '',
  };
}

function parseText(f) {
  return {
    kind: f[1] || 'L', // L free label, P refdes, N name
    x: Number(f[2]), y: Number(f[3]),
    strokeWidth: Number(f[4]) || 0,
    rotation: Number(f[5]) || 0,
    mirror: f[6] === '1',
    layerId: Number(f[7]),
    text: f[10] || '',
    display: f[12] !== 'none',
    id: f[13] || '',
  };
}

function parseCopperArea(f, warnings) {
  // Field 10 is EasyEDA's own computed fill: a JSON array of SVG path
  // strings. ONE PATH STRING IS ONE EVEN-ODD REGION — its subpaths are the
  // filled outline plus its carve-out HOLES (the clearance around other
  // nets). Flattening the subpaths into independent rings would turn every
  // hole back into copper and short the pour to everything it was carved
  // AWAY from. So fills is an array of GROUPS: one array of rings per path
  // string, even-odd semantics, never flattened.
  let fills = null;
  if (f[10]) {
    try {
      const raw = JSON.parse(f[10]);
      if (Array.isArray(raw)) {
        fills = [];
        for (const entry of raw) {
          const paths = Array.isArray(entry) ? entry : [entry];
          for (const p of paths) {
            if (typeof p !== 'string') continue;
            const rings = parsePath(p).map((sp) => subpathToRing(sp)).filter((r) => r.length >= 3);
            if (rings.length) fills.push(rings);
          }
        }
      }
    } catch {
      warnings.push(`COPPERAREA ${f[7] || '?'}: fill data present but unreadable; outline over-approximation applies`);
    }
  }
  const outlineRings = parsePath(f[4]).map((sp) => subpathToRing(sp));
  return {
    width: Number(f[1]),
    layerId: Number(f[2]),
    net: f[3] || '',
    outline: outlineRings[0] || [],
    clearance: Number(f[5]) || 0,
    fillStyle: f[6] || 'solid',
    id: f[7] || '',
    thermal: f[8] || '',
    keepIsland: f[9] || '',
    fills, // rings in raw units, null when the file carried no fill
  };
}

function parseCircle(f) {
  return {
    cx: Number(f[1]), cy: Number(f[2]), r: Number(f[3]),
    strokeWidth: Number(f[4]) || 0, layerId: Number(f[5]), id: f[6] || '',
  };
}

function parseRect(f) {
  return {
    x: Number(f[1]), y: Number(f[2]), w: Number(f[3]), h: Number(f[4]),
    layerId: Number(f[5]), id: f[6] || '',
  };
}

function parseSolidRegion(f) {
  return { layerId: Number(f[1]), net: f[2] || '', path: f[3] || '', type: f[4] || '', id: f[5] || '' };
}

// ── the importer ───────────────────────────────────────────────────

/**
 * @param {string} text  Raw .json content
 * @returns board model (see module doc), never throws on foreign input:
 *          malformed files come back as { parts: [], …, warnings: [why] }.
 */
export function importEasyEdaPcb(text) {
  const warnings = [];
  const empty = () => ({
    format: 'easyeda-pcb', parts: [], freePads: [], tracks: [], vias: [], holes: [],
    arcs: [], pours: [], outline: [], silk: { tracks: [], arcs: [], texts: [], circles: [], rects: [] },
    texts: [], nets: [], copperLayers: [], bbox: { w: 0, h: 0 }, origin: null,
    warnings, ignored: [],
  });

  let doc;
  try { doc = JSON.parse(text); } catch (e) {
    warnings.push(`Not an EasyEDA file: the JSON did not parse (${e.message})`);
    return empty();
  }

  const dt = String(doc?.docType ?? doc?.head?.docType ?? '');
  if (dt === '5' || dt === '1' || dt === '2') {
    warnings.push(`This is an EasyEDA SCHEMATIC document (docType ${dt}) — import it as a circuit; the board reader wants docType 3.`);
    return empty();
  }
  if (dt === '14') {
    warnings.push('docType 14 is a PCB MODULE, not a full board. Its shapes are read, but a board that *uses* modules will import with holes where the module instances are.');
  } else if (dt !== '3' && dt !== '4') {
    warnings.push(`Unrecognised docType "${dt}" — attempting to read shapes anyway.`);
  }
  const shapes = Array.isArray(doc?.shape) ? doc.shape : [];
  if (!shapes.length) {
    warnings.push('No shapes found: the document has no `shape` array.');
    return empty();
  }

  // Pass 1: raw parse, units and Y-down kept.
  const raw = {
    parts: [], freePads: [], tracks: [], vias: [], holes: [], arcs: [], pours: [],
    outlineShapes: [], silkTracks: [], silkArcs: [], texts: [], circles: [], rects: [],
  };
  const ignoredCount = new Map();
  const ignore = (type) => ignoredCount.set(type, (ignoredCount.get(type) || 0) + 1);

  const routeShape = (s, into, partWarnings) => {
    const f = s.split('~');
    const type = f[0];
    switch (type) {
      case 'PAD': into.pads.push(parsePad(f, partWarnings)); break;
      case 'TRACK': {
        const t = parseTrack(f);
        if (COPPER_LAYERS.has(t.layerId)) into.tracks.push(t);
        else if (t.layerId === OUTLINE_LAYER) into.outlineShapes.push({ kind: 'track', ...t });
        else if (SILK_LAYERS.has(t.layerId)) into.silkTracks.push(t);
        else ignore(`TRACK@layer${t.layerId}`);
        break;
      }
      case 'VIA': into.vias.push(parseVia(f)); break;
      case 'HOLE': into.holes.push(parseHole(f)); break;
      case 'ARC': {
        const a = parseArcShape(f);
        if (COPPER_LAYERS.has(a.layerId)) into.arcs.push(a);
        else if (a.layerId === OUTLINE_LAYER) into.outlineShapes.push({ kind: 'arc', ...a });
        else if (SILK_LAYERS.has(a.layerId)) into.silkArcs.push(a);
        else ignore(`ARC@layer${a.layerId}`);
        break;
      }
      case 'COPPERAREA': into.pours.push(parseCopperArea(f, warnings)); break;
      case 'TEXT': into.texts.push(parseText(f)); break;
      case 'CIRCLE': {
        const c = parseCircle(f);
        if (c.layerId >= 99) ignore(`CIRCLE@layer${c.layerId}`);
        else into.circles.push(c);
        break;
      }
      case 'RECT': into.rects.push(parseRect(f)); break;
      case 'SOLIDREGION': {
        const r = parseSolidRegion(f);
        if (COPPER_LAYERS.has(r.layerId)) {
          // Copper solid region: connectivity-relevant. Kept as a pour with
          // no clearance semantics so Phase 0.5 sees the copper.
          into.pours.push({
            width: 0, layerId: r.layerId, net: r.net,
            outline: (parsePath(r.path).map((sp) => subpathToRing(sp)))[0] || [],
            clearance: 0, fillStyle: 'solid', id: r.id, thermal: '', keepIsland: '', fills: null,
          });
        } else ignore(`SOLIDREGION@layer${r.layerId || r.type}`);
        break;
      }
      case 'SVGNODE': ignore('SVGNODE'); break;
      default: ignore(type || '(empty)');
    }
  };

  for (const s of shapes) {
    if (typeof s !== 'string') { ignore('(non-string shape)'); continue; }
    if (s.startsWith('LIB')) {
      const segs = s.split('#@$');
      const h = segs[0].split('~');
      const attrs = parseLibAttrs(h[3]);
      const partWarnings = [];
      const part = {
        id: h[6] || '',
        ref: '',
        name: '',
        package: attrs.package || '',
        attrs,
        x: Number(h[1]), y: Number(h[2]),
        rotation: Number(h[4]) || 0,
        side: String(h[7]) === '2' ? 'bottom' : 'top',
        pads: [],
        // Child decoration is kept per-part so rendering can draw the
        // footprint and DRC can find its silk legend.
        tracks: [], outlineShapes: [], silkTracks: [], silkArcs: [],
        vias: [], holes: [], arcs: [], pours: [], texts: [], circles: [], rects: [],
        warnings: partWarnings,
      };
      for (const child of segs.slice(1)) routeShape(child, part, partWarnings);
      for (const t of part.texts) {
        if (t.kind === 'P' && t.text) part.ref = t.text;
        if (t.kind === 'N' && t.text) part.name = t.text;
      }
      // A footprint's stray copper (its own tracks/regions) still counts as
      // board copper; hoist references so board-level consumers see one list.
      raw.tracks.push(...part.tracks);
      raw.vias.push(...part.vias);
      raw.holes.push(...part.holes);
      raw.arcs.push(...part.arcs);
      raw.pours.push(...part.pours);
      raw.outlineShapes.push(...part.outlineShapes);
      raw.parts.push(part);
    } else {
      const before = raw.texts.length;
      routeShape(s, { ...raw, pads: raw.freePads }, warnings);
      void before;
    }
  }

  // Pass 2: establish the mm frame. Origin = outline bbox bottom-left
  // (Y-down max), else bbox of all copper; Y flips.
  const xs = []; const ys = [];
  const eat = (x, y) => { if (Number.isFinite(x) && Number.isFinite(y)) { xs.push(x); ys.push(y); } };
  const outlinePts = [];
  for (const o of raw.outlineShapes) {
    if (o.kind === 'track') for (const [x, y] of o.points) outlinePts.push([x, y]);
    else {
      for (const sp of parsePath(o.path)) for (const [x, y] of subpathToRing(sp)) outlinePts.push([x, y]);
    }
  }
  if (outlinePts.length) for (const [x, y] of outlinePts) eat(x, y);
  else {
    for (const p of raw.parts) for (const pad of p.pads) eat(pad.x, pad.y);
    for (const t of raw.tracks) for (const [x, y] of t.points) eat(x, y);
    for (const v of raw.vias) eat(v.x, v.y);
    if (!xs.length) { warnings.push('Board has no outline and no copper; nothing to place.'); }
  }
  const minX = xs.length ? Math.min(...xs) : 0;
  const maxY = ys.length ? Math.max(...ys) : 0;
  const maxX = xs.length ? Math.max(...xs) : 0;
  const minY = ys.length ? Math.min(...ys) : 0;
  if (!outlinePts.length && xs.length) {
    warnings.push('Board outline (layer 10) is missing — origin taken from the copper bounding box.');
  }

  const mmX = (x) => (x - minX) * MM_PER_UNIT;
  const mmY = (y) => (maxY - y) * MM_PER_UNIT;
  const mmLen = (v) => v * MM_PER_UNIT;
  const mmPts = (pts) => pts.map(([x, y]) => [mmX(x), mmY(y)]);

  const cvPad = (p) => ({
    num: p.num, net: p.net, shape: p.shape,
    x: mmX(p.x), y: mmY(p.y),
    w: mmLen(p.w), h: mmLen(p.h),
    rotation: p.rotation,
    drill: p.holeRadius ? mmLen(p.holeRadius) * 2 : 0,
    slotLength: p.slotLength ? mmLen(p.slotLength) : 0,
    // EasyEDA slots run along the pad's LONG axis; angles are
    // model-positive as stored (the kusba measurement).
    slotRotation: p.slotLength ? (p.rotation || 0) + (p.w >= p.h ? 0 : 90) : 0,
    plated: p.plated,
    through: p.layerId === THROUGH_LAYER,
    layer: p.layerId === THROUGH_LAYER ? 'through' : (p.layerId === 2 ? 'bottom' : 'top'),
    points: p.points ? mmPts(p.points) : null,
    id: p.id,
  });
  const cvTrack = (t) => ({
    layer: t.layerId === 2 ? 'bottom' : (t.layerId === 1 ? 'top' : `inner${t.layerId}`),
    layerId: t.layerId, net: t.net, width: mmLen(t.width), points: mmPts(t.points), id: t.id,
  });
  const cvText = (t) => ({
    kind: t.kind, x: mmX(t.x), y: mmY(t.y), rotation: t.rotation, mirror: t.mirror,
    layerId: t.layerId, text: t.text, display: t.display, id: t.id,
  });
  const cvArc = (a) => {
    const segs = [];
    for (const sp of parsePath(a.path)) {
      for (const s of sp.segs) {
        segs.push(s.type === 'arc'
          ? { type: 'arc', x1: mmX(s.x1), y1: mmY(s.y1), x2: mmX(s.x2), y2: mmY(s.y2), rx: mmLen(s.rx), ry: mmLen(s.ry), rot: s.rot, largeArc: s.largeArc, sweep: s.sweep ? 0 : 1 }
          : { type: 'line', x1: mmX(s.x1), y1: mmY(s.y1), x2: mmX(s.x2), y2: mmY(s.y2) });
      }
    }
    return { layerId: a.layerId, net: a.net, width: mmLen(a.width), segs, id: a.id };
  };

  const model = empty();
  model.origin = { x: minX, y: maxY, mmPerUnit: MM_PER_UNIT };
  model.bbox = { w: (maxX - minX) * MM_PER_UNIT, h: (maxY - minY) * MM_PER_UNIT };

  for (const p of raw.parts) {
    model.parts.push({
      id: p.id, ref: p.ref, name: p.name, package: p.package, attrs: p.attrs,
      x: mmX(p.x), y: mmY(p.y), rotation: p.rotation, side: p.side,
      pads: p.pads.map(cvPad),
      silk: {
        tracks: p.silkTracks.map(cvTrack),
        arcs: p.silkArcs.map(cvArc),
        texts: p.texts.map(cvText),
        circles: p.circles.map((c) => ({ cx: mmX(c.cx), cy: mmY(c.cy), r: mmLen(c.r), layerId: c.layerId, id: c.id })),
        rects: p.rects.map((r) => ({ x: mmX(r.x), y: mmY(r.y + r.h), w: mmLen(r.w), h: mmLen(r.h), layerId: r.layerId, id: r.id })),
      },
      warnings: p.warnings,
    });
  }
  model.freePads = raw.freePads.map(cvPad);
  model.tracks = raw.tracks.map(cvTrack);
  model.vias = raw.vias.map((v) => ({
    x: mmX(v.x), y: mmY(v.y), diameter: mmLen(v.diameter),
    drill: mmLen(v.holeRadius) * 2, net: v.net, id: v.id,
  }));
  model.holes = raw.holes.map((h) => ({ x: mmX(h.x), y: mmY(h.y), diameter: mmLen(h.radius) * 2, id: h.id }));
  model.arcs = raw.arcs.map(cvArc);
  model.pours = raw.pours.map((c) => ({
    layer: c.layerId === 2 ? 'bottom' : (c.layerId === 1 ? 'top' : `inner${c.layerId}`),
    layerId: c.layerId, net: c.net,
    outline: mmPts(c.outline),
    clearance: mmLen(c.clearance),
    fillStyle: c.fillStyle, thermal: c.thermal, keepIsland: c.keepIsland,
    fills: c.fills ? c.fills.map((group) => group.map(mmPts)) : null,
    fillFromFile: !!(c.fills && c.fills.length),
    id: c.id,
  }));
  model.outline = raw.outlineShapes.flatMap((o) => {
    if (o.kind === 'track') {
      const segs = [];
      for (let i = 0; i + 1 < o.points.length; i++) {
        const [x1, y1] = o.points[i]; const [x2, y2] = o.points[i + 1];
        segs.push({ type: 'line', x1: mmX(x1), y1: mmY(y1), x2: mmX(x2), y2: mmY(y2), id: o.id });
      }
      return segs;
    }
    return cvArc(o).segs.map((s) => ({ ...s, id: o.id }));
  });
  model.silk.tracks = raw.silkTracks.map(cvTrack);
  model.silk.arcs = raw.silkArcs.map(cvArc);
  model.silk.texts = raw.texts.filter((t) => SILK_LAYERS.has(t.layerId)).map(cvText);
  model.silk.circles = raw.circles.filter((c) => SILK_LAYERS.has(c.layerId))
    .map((c) => ({ cx: mmX(c.cx), cy: mmY(c.cy), r: mmLen(c.r), layerId: c.layerId, id: c.id }));
  model.silk.rects = raw.rects.filter((r) => SILK_LAYERS.has(r.layerId))
    .map((r) => ({ x: mmX(r.x), y: mmY(r.y + r.h), w: mmLen(r.w), h: mmLen(r.h), layerId: r.layerId, id: r.id }));
  model.texts = raw.texts.filter((t) => !SILK_LAYERS.has(t.layerId)).map(cvText);

  const nets = new Set();
  const addNet = (n) => { if (n) nets.add(n); };
  for (const p of model.parts) for (const pad of p.pads) addNet(pad.net);
  for (const pad of model.freePads) addNet(pad.net);
  for (const t of model.tracks) addNet(t.net);
  for (const v of model.vias) addNet(v.net);
  for (const c of model.pours) addNet(c.net);
  model.nets = [...nets].sort();

  const copper = new Set();
  for (const t of model.tracks) copper.add(t.layerId);
  for (const a of model.arcs) copper.add(a.layerId);
  for (const c of model.pours) copper.add(c.layerId);
  for (const p of [...model.parts.flatMap((q) => q.pads), ...model.freePads]) {
    if (!p.through) copper.add(p.layer === 'bottom' ? 2 : 1);
  }
  model.copperLayers = [...copper].sort((a, b) => a - b);
  if (model.copperLayers.some((l) => l >= 21)) {
    warnings.push(`Inner copper layers present (${model.copperLayers.filter((l) => l >= 21).join(', ')}) — read, but the stackup beyond 2 layers is untested territory.`);
  }

  model.ignored = [...ignoredCount.entries()].map(([type, count]) => ({ type, count }));
  return model;
}

/**
 * The importCircuit-contract wrapper: `{parts, wires, warnings, unmapped}`
 * like every other importer, with the board model riding along as `board`.
 * parts/wires come from the Phase-0.5 LIFT: kinds recognised from package
 * strings, wires from the COPPER netlist — the circuit the board actually
 * implements, shorts and all. `report` carries the lift's accounting.
 */
export function importEasyEdaPcbAsCircuit(text) {
  const board = importEasyEdaPcb(text);
  const summary = board.parts.length
    ? `Opened as a board: ${board.parts.length} footprints, ${board.nets.length} nets, ` +
      `${board.tracks.length} tracks on ${board.copperLayers.length} copper layers.`
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

/** The named refusal for EasyEDA Pro documents (detect.js sends them here). */
export function importEasyEdaProStub() {
  return {
    parts: [], wires: [],
    warnings: [
      'This is an EasyEDA Pro export. Pro is a different format family from EasyEDA '
      + 'Standard (JSON-lines documents, other coordinate scaling) and is not supported. '
      + 'In EasyEDA Pro use File → Export → EasyEDA Standard, or export the schematic '
      + 'as a Standard .json, and import that.',
    ],
    unmapped: [],
  };
}
