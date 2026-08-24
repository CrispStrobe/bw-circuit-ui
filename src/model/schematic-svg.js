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

import { wireEndpoint, isBoardEndpoint } from './wire-endpoints.js';

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
  // Through the ONE canonical dialect reader. This was a private copy —
  // the eighth — and computed member access (`wire[`${side}Terminal`]`) is
  // why the adoption gate could not see it; that blind spot is closed in
  // test/wire-endpoint-adoption.test.js.
  //
  // A breadboard hole still returns null: resolving a hole to a strip needs
  // the circuit model, which a headless renderer does not have. Turning every
  // object endpoint into one "[object Object] undefined" node merged the VCC
  // and GND rails into a fictional short in CLI renders, so an unresolvable
  // endpoint drops its wire and shows as a gap instead.
  const endpoint = (wire, side) => {
    const e = wireEndpoint(wire, side);
    if (!e || isBoardEndpoint(e)) return null;
    return `${e.part} ${e.terminal}`;
  };
  for (const w of wires || []) {
    const ak = endpoint(w, 'from');
    const bk = endpoint(w, 'to');
    if (!ak || !bk) continue;
    const a = find(ak);
    const b = find(bk);
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
  // Older gallery circuits omit `part.terminals`; the interactive loader
  // normalizes them before projection, but a headless renderer has no model
  // layer to do that work. Infer exactly the terminals the authored nets use
  // so CLI and UI render the same connections.
  const normalizedParts = parts.map(part => {
    if (Array.isArray(part.terminals) && part.terminals.length) return part;
    const terminals = [];
    for (const net of netList) {
      for (const terminal of net.terminals || []) {
        if (terminal.part === part.id && !terminals.includes(terminal.terminal)) {
          terminals.push(terminal.terminal);
        }
      }
    }
    return {...part, terminals};
  });
  const p = projectSchematic(normalizedParts, netList);
  const boundsFor = s => {
    if (!s.generic && shapeFor(s.kind, s.params || {})) {
      return {left: s.x - 25, right: s.x + 25, top: s.y - 22, bottom: s.y + 22};
    }
    const halfH = Math.max(20, ((Math.max(1, s.pinsPerSide || 1) - 1) * 18) / 2 + 16);
    return {left: s.x - 26, right: s.x + 26, top: s.y - halfH, bottom: s.y + halfH};
  };
  const crosses = (a, b, box) => a.y === b.y
    ? a.y > box.top && a.y < box.bottom && Math.max(a.x, b.x) > box.left && Math.min(a.x, b.x) < box.right
    : a.x === b.x && a.x > box.left && a.x < box.right && Math.max(a.y, b.y) > box.top && Math.min(a.y, b.y) < box.bottom;
  const wireSymbolCrossings = [];
  for (const wire of p.wires || []) {
    const segments = wire.segments || [[{x: wire.trunk.x, y: wire.trunk.y1}, {x: wire.trunk.x, y: wire.trunk.y2}], ...(wire.stubs || [])];
    for (const symbol of p.symbols || []) {
      if (segments.some(([a, b]) => crosses(a, b, boundsFor(symbol)))) {
        wireSymbolCrossings.push({netId: wire.netId, symbol: symbol.id});
      }
    }
  }
  const symbolOverlaps = [];
  for (let i = 0; i < (p.symbols || []).length; i++) {
    const a = p.symbols[i], ab = boundsFor(a);
    for (let j = i + 1; j < p.symbols.length; j++) {
      const b = p.symbols[j], bb = boundsFor(b);
      if (ab.left < bb.right && ab.right > bb.left && ab.top < bb.bottom && ab.bottom > bb.top) {
        symbolOverlaps.push([a.id, b.id]);
      }
    }
  }
  const STROKE = opts.dark ? '#e2e8f0' : '#1e293b';
  const LABEL = opts.dark ? '#94a3b8' : '#64748b';
  const BG = opts.dark ? '#0f172a' : '#ffffff';

  const out = [];
  let generic = 0;
  const genericKinds = [];
  for (const w of p.wires || []) {
    // projectSchematic exposes orthogonal trunk/stub geometry. The original
    // CLI expected a prebuilt `d` string that the projection has never
    // returned, producing valid-looking SVG files with every wire omitted.
    const segments = w.segments || [
      [{x: w.trunk.x, y: w.trunk.y1}, {x: w.trunk.x, y: w.trunk.y2}], ...(w.stubs || []),
    ];
    out.push('<g fill="none" stroke="' + STROKE + '" stroke-width="1.2">'
      + segments.map(seg => '<line x1="' + seg[0].x + '" y1="' + seg[0].y
        + '" x2="' + seg[1].x + '" y2="' + seg[1].y + '"/>').join('')
      + '</g>');
  }
  for (const j of p.junctions || []) {
    out.push('<circle cx="' + j.x + '" cy="' + j.y + '" r="2.4" fill="' + STROKE + '"/>');
  }
  for (const label of p.netLabels || []) {
    out.push('<g><line x1="' + label.x1 + '" y1="' + label.y1 + '" x2="' + label.x2
      + '" y2="' + label.y2 + '" stroke="' + STROKE + '" stroke-width="1.2"/>'
      + '<text x="' + label.x + '" y="' + label.y + '" text-anchor="' + label.anchor
      + '" font-size="6.5" font-family="monospace" fill="' + LABEL + '">'
      + esc(label.text) + '</text></g>');
  }
  for (const s of p.symbols || []) {
    // `s.generic` is the projection's ruling that this kind's artwork does
    // not reach this instance's pins; see artReachesPins.
    const art = s.generic ? null : shapeFor(s.kind, s.params || {});
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
  return { svg, symbols: (p.symbols || []).length, generic, genericKinds,
    wires: (p.wires || []).length, netLabels: (p.netLabels || []).length,
    collisionRoutedNets: p.collisionRoutedNets || [], wireSymbolCrossings,
    detouredRoutingNets: p.detouredRoutingNets || [], symbolOverlaps, width: w, height: h };
}
