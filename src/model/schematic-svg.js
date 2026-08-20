/**
 * Headless schematic SVG.
 *
 * projectSchematic() is a pure function of (parts, nets), and SchematicPanel
 * turns its output into JSX. This turns the SAME output into an SVG string,
 * with no DOM, so a schematic can be rendered from a script — over a corpus of
 * hundreds of imported boards, for instance, which is how you find out whether
 * the layout is actually any good.
 *
 * Symbol artwork comes from schematic-symbols.js, shared with the panel.
 *
 * @module
 */

import { projectSchematic } from './schematic-projection.js';
import { shapeFor } from './schematic-symbols.js';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const OHM = 'Ω';
const MICRO = 'µ';
const fmtOhms = (v) => (v >= 1e6 ? (v / 1e6) + 'M' : v >= 1e3 ? (v / 1e3) + 'k' : String(v)) + OHM;
const fmtFarads = (v) => (v >= 1e-6 ? (v * 1e6) + MICRO + 'F' : v >= 1e-9 ? (v * 1e9) + 'nF' : (v * 1e12) + 'pF');

/** Nets from wires — the electrical partition the projection wants. */
export function netsFromWires(wires) {
  const parent = new Map();
  const find = (x) => {
    if (!parent.has(x)) parent.set(x, x);
    while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); }
    return x;
  };
  for (const w of wires || []) {
    const a = find(w.from + ' ' + w.fromTerminal);
    const b = find(w.to + ' ' + w.toTerminal);
    if (a !== b) parent.set(a, b);
  }
  const groups = new Map();
  for (const k of parent.keys()) {
    const r = find(k);
    if (!groups.has(r)) groups.set(r, []);
    const i = k.indexOf(' ');
    groups.get(r).push({ part: k.slice(0, i), terminal: k.slice(i + 1) });
  }
  return [...groups.values()].map((terminals, i) => ({ id: 'n' + (i + 1), terminals }));
}

/**
 * Render a circuit as a schematic SVG string.
 *
 * @param {{parts: Array, wires?: Array, nets?: Array}} circuit
 * @param {{dark?: boolean}} [opts]
 * @returns {{svg: string, symbols: number, generic: number, width: number, height: number}}
 */
export function renderSchematicSvg({ parts = [], wires = [], nets = null }, opts = {}) {
  const netList = (nets && nets.length) ? nets : netsFromWires(wires);
  const p = projectSchematic(parts, netList);
  const STROKE = opts.dark ? '#e2e8f0' : '#1e293b';
  const LABEL = opts.dark ? '#94a3b8' : '#64748b';
  const BG = opts.dark ? '#0f172a' : '#ffffff';

  const out = [];
  let generic = 0;
  const genericKinds = [];
  for (const w of p.wires || []) {
    out.push('<path d="' + esc(w.d || '') + '" fill="none" stroke="' + STROKE + '" stroke-width="1.2"/>');
  }
  for (const j of p.junctions || []) {
    out.push('<circle cx="' + j.x + '" cy="' + j.y + '" r="2.4" fill="' + STROKE + '"/>');
  }
  for (const s of p.symbols || []) {
    const art = shapeFor(s.kind, s.params || {});
    const bits = [];
    if (art) {
      for (const p of art.paths) {
        const d = typeof p === 'string' ? p : p.d;
        const w = typeof p === 'string' ? '' : (p.w ? ' stroke-width="' + p.w + '"' : '');
        // 'currentColor' keeps the symbol table free of theme colours; each
        // renderer substitutes its own stroke.
        const f = typeof p === 'string' || !p.fill ? ''
          : ' fill="' + (p.fill === 'currentColor' ? STROKE : esc(p.fill)) + '"';
        bits.push('<path d="' + esc(d) + '"' + w + f + '/>');
      }
      for (const c of art.circles || []) {
        bits.push('<circle cx="' + c.cx + '" cy="' + c.cy + '" r="' + c.r + '"'
          + (c.fill ? ' fill="' + esc(c.fill) + '"' : '') + '/>');
      }
      for (const t of art.texts || []) {
        bits.push('<text x="' + t.x + '" y="' + t.y + '" text-anchor="middle" font-size="'
          + (t.size || 8) + '" font-family="monospace" fill="' + STROKE + '" stroke="none">'
          + esc(t.s) + '</text>');
      }
      const params = s.params || {};
      let val = '';
      if (art.value === 'ohms' && params.ohms != null) val = fmtOhms(params.ohms);
      else if (art.value === 'farads' && params.farads != null) val = fmtFarads(params.farads);
      else if (art.value === 'volts') val = (params.volts != null ? params.volts : 5) + 'V';
      if (val) {
        bits.push('<text x="0" y="19" text-anchor="middle" font-size="8" font-family="monospace" fill="'
          + LABEL + '" stroke="none">' + esc(val) + '</text>');
      }
    } else {
      // Generic IC box — the same fallback the panel draws, and the reason
      // "incomplete" is fair: most kinds land here.
      generic++;
      genericKinds.push(s.kind);
      const pins = s.pins || [];
      const perSide = Math.max(1, s.pinsPerSide || Math.ceil(pins.length / 2));
      const halfH = Math.max(20, ((perSide - 1) * 18) / 2 + 16);
      bits.push('<rect x="-26" y="' + (-halfH) + '" width="52" height="' + (halfH * 2) + '" rx="2"/>');
      for (const pin of pins) {
        const edgeX = pin.side === 'left' ? -26 : 26;
        const py = pin.y - s.y;
        bits.push('<path d="M ' + edgeX + ' ' + py + ' L ' + (pin.x - s.x) + ' ' + py + '" stroke-width="1.2"/>');
        bits.push('<text x="' + (pin.side === 'left' ? -22 : 22) + '" y="' + (py + 2.5)
          + '" text-anchor="' + (pin.side === 'left' ? 'start' : 'end')
          + '" font-size="6.5" font-family="monospace" fill="' + LABEL + '" stroke="none">'
          + esc(pin.name) + '</text>');
      }
      bits.push('<text x="0" y="' + (-halfH + 9) + '" text-anchor="middle" font-size="7" '
        + 'font-family="monospace" fill="' + STROKE + '" stroke="none">'
        + esc(String(s.kind).slice(0, 9)) + '</text>');
    }
    bits.push('<text x="0" y="-24" text-anchor="middle" font-size="9" font-family="monospace" fill="'
      + LABEL + '" stroke="none">' + esc(s.label || '') + '</text>');
    out.push('<g transform="translate(' + s.x + ' ' + s.y + ')" stroke="' + STROKE
      + '" stroke-width="1.6" fill="none" stroke-linecap="round">' + bits.join('') + '</g>');
  }

  const w = Math.max(1, Math.ceil(p.width || 0));
  const h = Math.max(1, Math.ceil(p.height || 0));
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h
    + '" viewBox="0 0 ' + w + ' ' + h + '"><rect width="' + w + '" height="' + h + '" fill="'
    + BG + '"/>' + out.join('') + '</svg>';
  // genericKinds is what the PROJECTION actually drew as a box — counting
  // circuit.parts instead would blame kinds the projection never draws at
  // all (breadboards and meters are filtered out before layout).
  return { svg, symbols: (p.symbols || []).length, generic, genericKinds, width: w, height: h };
}
