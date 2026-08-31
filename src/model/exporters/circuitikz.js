/**
 * Deterministic LaTeX/circuitikz schematic document exporter.
 *
 * The schematic projection owns placement, routing and the visible terminal
 * set.  This writer only translates that projection: it does not infer a
 * second netlist or invent a second layout.  A small conservative set of
 * two-pin parts uses native circuitikz bipoles; every other projected part is
 * rendered completely as a labelled box with one labelled stub per pin.
 *
 * @module
 */

import { projectSchematic } from '../schematic-projection.js';
import { netsFromWires } from '../schematic-svg.js';

const SCALE = 30;
const INFRASTRUCTURE = new Set([
  'breadboard', 'breadboard_full', 'breadboard_half', 'breadboard_mini', 'meter',
]);

// Deliberately conservative: these names are stable circuitikz bipoles and
// the projection gives each of these instances exactly two connection points.
const BIPOLES = new Map([
  ['resistor', 'R'], ['ldr', 'R'], ['ntc', 'R'], ['fuse', 'R'],
  ['capacitor', 'C'], ['polarized_cap', 'C'], ['inductor', 'L'],
  ['diode', 'D'], ['zener', 'D'], ['led', 'leD'],
  ['vsource', 'V'], ['battery', 'battery1'], ['battery_aa', 'battery1'],
  ['battery_9v', 'battery1'], ['coin_cell', 'battery1'],
  ['button', 'nos'], ['switch', 'nos'],
]);

/** Escape text for a LaTeX argument without re-processing inserted macros. */
export function escapeTex(value) {
  const map = {
    '\\': '\\textbackslash{}', '{': '\\{', '}': '\\}', '$': '\\$', '&': '\\&',
    '#': '\\#', '%': '\\%', '_': '\\_', '^': '\\textasciicircum{}',
    '~': '\\textasciitilde{}', 'Ω': '\\ensuremath{\\Omega}', 'μ': '\\ensuremath{\\mu}',
    'µ': '\\ensuremath{\\mu}',
  };
  return String(value ?? '').replace(/[\\{}$&#%_^~Ωμµ]/g, ch => map[ch])
    .replace(/[\r\n\t]+/g, ' ');
}

const coord = value => {
  const n = Math.abs(value / SCALE) < 0.0005 ? 0 : value / SCALE;
  return Number(n.toFixed(3)).toString();
};
const point = (x, y) => `(${coord(x)},${coord(-y)})`;

function normalizeParts(parts, nets) {
  return parts.map(part => {
    if (Array.isArray(part.terminals) && part.terminals.length) return part;
    const terminals = [];
    for (const net of nets) for (const terminal of net.terminals || []) {
      if (terminal.part === part.id && !terminals.includes(terminal.terminal)) {
        terminals.push(terminal.terminal);
      }
    }
    return {...part, terminals};
  });
}

function selectedNets(circuit) {
  // A real Circuit has already resolved breadboard strips and seated leads.
  // netsFromWires cannot do that and is only the plain-document fallback.
  const resolved = circuit.resolvedNets;
  if (Array.isArray(resolved)) return resolved;
  if (Array.isArray(circuit.nets)) return circuit.nets;
  return netsFromWires(circuit.wires || []);
}

function partValue(symbol) {
  const p = symbol.params || {};
  for (const [key, suffix] of [
    ['ohms', ' ohm'], ['farads', ' F'], ['henrys', ' H'], ['volts', ' V'],
    ['voltage', ' V'],
  ]) {
    if (p[key] != null) return `${p[key]}${suffix}`;
  }
  return '';
}

function routeSegments(route) {
  if (route.segments) return route.segments;
  return [
    [{x: route.trunk.x, y: route.trunk.y1}, {x: route.trunk.x, y: route.trunk.y2}],
    ...(route.stubs || []),
  ];
}

function emitBox(symbol, out) {
  const perSide = Math.max(1, symbol.pinsPerSide || Math.ceil(symbol.pins.length / 2));
  const halfH = Math.max(20, ((perSide - 1) * 18) / 2 + 16);
  out.push(`\\draw ${point(symbol.x - 26, symbol.y - halfH)} rectangle `
    + `${point(symbol.x + 26, symbol.y + halfH)};`);
  out.push(`\\node[font=\\scriptsize,align=center] at ${point(symbol.x, symbol.y)} `
    + `{\\shortstack{${escapeTex(symbol.label || symbol.id)}\\\\${escapeTex(symbol.kind)}}};`);
  for (const pin of symbol.pins) {
    const edgeX = pin.side === 'left' ? symbol.x - 26 : symbol.x + 26;
    out.push(`\\draw ${point(edgeX, pin.y)} -- ${point(pin.x, pin.y)};`);
    const anchor = pin.side === 'left' ? 'west' : 'east';
    const labelX = pin.side === 'left' ? symbol.x - 22 : symbol.x + 22;
    out.push(`\\node[font=\\tiny,anchor=${anchor}] at ${point(labelX, pin.y)} `
      + `{${escapeTex(pin.name)}};`);
  }
}

/**
 * Export a complete, independently compileable LaTeX document.
 *
 * @param {{parts?: Array, wires?: Array, nets?: Array, resolvedNets?: Array}} circuit
 * @param {{title?: string}} [opts]
 * @returns {{text:string, warnings:string[], substituted:string[], unsupported:string[]}}
 */
export function toCircuitikz(circuit, opts = {}) {
  const parts = circuit.parts || [];
  const nets = selectedNets(circuit);
  const projection = projectSchematic(normalizeParts(parts, nets), nets);
  const substituted = [];
  const unsupported = [];
  const omitted = parts.filter(p => INFRASTRUCTURE.has(p.kind))
    .map(p => `${p.id} (${p.kind})`).sort();

  const body = [];
  for (const route of projection.wires || []) {
    for (const [a, b] of routeSegments(route)) body.push(`\\draw ${point(a.x, a.y)} -- ${point(b.x, b.y)};`);
  }
  for (const label of projection.netLabels || []) {
    body.push(`\\draw ${point(label.x1, label.y1)} -- ${point(label.x2, label.y2)};`);
    const anchor = label.anchor === 'end' ? 'east' : label.anchor === 'start' ? 'west' : 'center';
    body.push(`\\node[font=\\tiny,anchor=${anchor}] at ${point(label.x, label.y)} `
      + `{${escapeTex(label.text)}};`);
  }
  for (const junction of projection.junctions || []) {
    body.push(`\\fill ${point(junction.x, junction.y)} circle[radius=0.07];`);
  }

  for (const symbol of projection.symbols || []) {
    const bipole = BIPOLES.get(symbol.kind);
    if (bipole && symbol.pins.length === 2 && !symbol.generic) {
      const label = [symbol.label || symbol.id, partValue(symbol)].filter(Boolean)
        .map(escapeTex).join('\\\\');
      body.push(`\\draw ${point(symbol.pins[0].x, symbol.pins[0].y)} `
        + `to[${bipole},l={\\shortstack{${label}}}] ${point(symbol.pins[1].x, symbol.pins[1].y)};`);
    } else {
      substituted.push(`${symbol.id} (${symbol.kind}): labelled box`);
      emitBox(symbol, body);
    }
  }

  const comments = [
    '% Generated by BrickWright. Readable deterministic projection; not a hand-routed drawing.',
    `% Native bipoles: ${projection.symbols.length - substituted.length}; labelled boxes: ${substituted.length}.`,
    ...substituted.map(s => `% Substituted: ${s.replace(/[\r\n%]/g, ' ')}`),
    ...omitted.map(s => `% Omitted infrastructure: ${s.replace(/[\r\n%]/g, ' ')}`),
    ...unsupported.map(s => `% Unsupported: ${s.replace(/[\r\n%]/g, ' ')}`),
  ];
  const title = escapeTex(opts.title || 'BrickWright schematic');
  const text = [
    '\\documentclass{article}',
    '\\usepackage{circuitikz}',
    '\\pagestyle{empty}',
    ...comments,
    '\\begin{document}',
    `\\begin{circuitikz}[american] % ${title}`,
    ...body,
    '\\end{circuitikz}',
    '\\end{document}',
    '',
  ].join('\n');
  return {text, warnings: [], substituted, unsupported, omitted, projection};
}
