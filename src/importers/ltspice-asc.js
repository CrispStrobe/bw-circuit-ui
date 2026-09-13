/**
 * LTspice ASCII schematic importer (.asc), bounded static subset.
 *
 * Pin coordinates comes from the standard symbols shipped in Analog Devices'
 * LTspice 26.0.2 installer (downloaded 2026-09-13, MSI SHA-256
 * 485dabd2d7d8293de733a399719f6538efda4a54b48b181a14e07271186984d3):
 *
 *   res.asy     228e75e8...  PIN (16,16) order 1; (16,96) order 2
 *   cap.asy     fcc7190e...  PIN (16,0)  order 1; (16,64) order 2
 *   voltage.asy 940d0db2...  PIN (0,16)  +/order 1; (0,96) -/order 2
 *   current.asy d36a9bf0...  PIN (0,0)   +/order 1; (0,80) -/order 2
 *
 * The bounded subset maps only the exact standard `res`, `cap`, `voltage`,
 * and `current` symbols. For current sources, LTspice/SPICE current flows from
 * SpiceOrder 1 to 2 while the native source injects from `neg` to `pos`, so
 * that pin order deliberately maps to `neg,pos`. Unknown/custom symbols are
 * explicit `unmapped[]` entries; unsupported orientations and non-static
 * values are explicit `losses[]`. No external symbol file is followed and no
 * TEXT directive is executed.
 */

import { NetSolver, makeId, wiresFromNets } from './kicad-common.js';
import { parseSpiceValue } from '../model/si.js';

const SYMBOLS = new Map([
  ['res', {
    kind: 'resistor', parameter: 'ohms', terminals: ['a', 'b'],
    pins: [[16, 16], [16, 96]],
    sourceSha256: '228e75e841b1b239fbe8cea04c9ae86e84eac492faf88501fa21bbee88d7eb96',
  }],
  ['cap', {
    kind: 'capacitor', parameter: 'farads', terminals: ['a', 'b'],
    pins: [[16, 0], [16, 64]],
    sourceSha256: 'fcc7190ea1110f612453b86c02facc3ac46441a06f04274054ed021746e79fac',
  }],
  ['voltage', {
    kind: 'vsource', parameter: 'volts', terminals: ['pos', 'neg'],
    pins: [[0, 16], [0, 96]],
    sourceSha256: '940d0db25631013b23b4fcac00f5d55815616d853036fa1b810c47b7556f36c2',
  }],
  ['current', {
    kind: 'isource', parameter: 'amps', terminals: ['neg', 'pos'],
    pins: [[0, 0], [0, 80]],
    sourceSha256: 'd36a9bf0f6b504326a64ac0011986cf7484a57f5499d7ca6faca049076dab74c',
  }],
]);

export function looksLikeLtspiceAsc(text) {
  if (typeof text !== 'string') return false;
  return /^\s*Version\s+4\s*$/im.test(text)
    && /^\s*SHEET\s+\d+\s+[-+]?\d+\s+[-+]?\d+\s*$/im.test(text)
    && /^\s*(?:WIRE|SYMBOL|FLAG)\b/im.test(text);
}

/** Apply LTspice's instance orientation in its native Y-down coordinate frame. */
export function placeLtspicePin(px, py, instance) {
  let u; let v;
  switch (String(instance.orientation || '').toUpperCase()) {
    case 'R0': u = px; v = py; break;
    case 'R90': u = -py; v = px; break;
    case 'R180': u = -px; v = -py; break;
    case 'R270': u = py; v = -px; break;
    default: return null;
  }
  return [instance.x + u, instance.y + v];
}

function parse(text) {
  const wires = [];
  const flags = [];
  const symbols = [];
  const directives = [];
  const unknownLines = [];
  const ignoredLines = [];
  let current = null;
  const lines = String(text).replace(/\r\n/g, '\n').split('\n');
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trim();
    if (!line || /^Version\s+4$/i.test(line) || /^SHEET\b/i.test(line)) continue;
    let match;
    if ((match = /^WIRE\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)$/i.exec(line))) {
      wires.push(match.slice(1).map(Number)); current = null;
    } else if ((match = /^FLAG\s+(-?\d+)\s+(-?\d+)\s+(.+)$/i.exec(line))) {
      flags.push({ x: Number(match[1]), y: Number(match[2]), name: match[3].trim() }); current = null;
    } else if ((match = /^SYMBOL\s+(\S+)\s+(-?\d+)\s+(-?\d+)\s+(\S+)$/i.exec(line))) {
      current = { source: line, lib: match[1], x: Number(match[2]), y: Number(match[3]),
        orientation: match[4], attrs: {}, line: index + 1 };
      symbols.push(current);
    } else if ((match = /^SYMATTR\s+(\S+)\s*(.*)$/i.exec(line)) && current) {
      current.attrs[match[1].toLowerCase()] = match[2];
    } else if ((match = /^TEXT\s+.*?\s!(.*)$/i.exec(line))) {
      directives.push(match[1].trim()); current = null;
    } else if (/^(?:WINDOW|DATAFLAG)\b/i.test(line)) {
      ignoredLines.push({ line: index + 1, source: line,
        reason: 'display/measurement annotation is not part of the bounded circuit projection' });
      current = null;
    } else {
      unknownLines.push({ line: index + 1, source: line }); current = null;
    }
  }
  return { wires, flags, symbols, directives, unknownLines, ignoredLines };
}

function staticValue(raw) {
  const text = String(raw || '').trim().replace(/^DC\s+/i, '');
  const value = parseSpiceValue(text);
  return Number.isFinite(value) ? value : null;
}

export function importLtspiceAsc(text) {
  const parts = [];
  const warnings = [];
  const unmapped = [];
  const losses = [];
  const ignored = [];
  const analyses = [];
  if (!looksLikeLtspiceAsc(text)) {
    return { parts, wires: [], warnings: ['Not an LTspice Version 4 ASCII schematic.'],
      unmapped, losses, ignored, analyses };
  }

  const drawing = parse(text);
  const net = new NetSolver();
  const segmentAnchors = [];
  for (const [x1, y1, x2, y2] of drawing.wires) {
    net.addSegment(x1, y1, x2, y2);
    segmentAnchors.push([x1, y1], [x2, y2]);
  }
  for (const flag of drawing.flags) {
    net.addName(flag.x, flag.y, flag.name === '0' ? '__LTSPICE_GND__' : flag.name.toLowerCase());
  }

  const placements = [];
  const used = new Set();
  for (const symbol of drawing.symbols) {
    const lib = symbol.lib.replace(/\\/g, '/').split('/').at(-1).toLowerCase();
    const spec = SYMBOLS.get(lib);
    const ref = symbol.attrs.instname || '?';
    if (!spec) {
      unmapped.push({ ref, value: symbol.attrs.value || '',
        libsource: `${symbol.lib}: no verified standard-symbol rule in the bounded ASC importer` });
      warnings.push(`Unmapped LTspice symbol: ${ref} (${symbol.lib})`);
      continue;
    }
    const pins = spec.pins.map(([px, py]) => placeLtspicePin(px, py, symbol));
    if (pins.some(pin => pin === null)) {
      unmapped.push({ ref, value: symbol.attrs.value || '',
        libsource: `${symbol.lib}: unsupported orientation ${symbol.orientation}` });
      warnings.push(`${ref}: unsupported LTspice orientation ${symbol.orientation}`);
      continue;
    }
    if (!symbol.attrs.instname) {
      unmapped.push({ ref, value: symbol.attrs.value || '', libsource: `${symbol.lib}: missing InstName` });
      warnings.push(`${symbol.lib} at line ${symbol.line}: missing InstName`);
      continue;
    }
    const id = makeId(ref, used);
    const value = staticValue(symbol.attrs.value);
    const params = value === null ? {} : { [spec.parameter]: value };
    if (value === null) {
      losses.push({ ref: id, kind: 'unsupported-or-missing-static-value', source: symbol.source,
        reason: `Value "${symbol.attrs.value || ''}" is not a finite static scalar`, fallback: null });
      warnings.push(`${id}: non-static or missing value is not approximated`);
    }
    for (const [name, authored] of Object.entries(symbol.attrs)) {
      if (name === 'instname' || name === 'value') continue;
      losses.push({ ref: id, kind: 'unsupported-symbol-attribute',
        source: `SYMATTR ${name} ${authored}`,
        reason: `the bounded ASC importer does not interpret ${name}`, fallback: null });
      warnings.push(`${id}: unsupported LTspice symbol attribute ${name} is retained as a loss`);
    }
    parts.push({ id, kind: spec.kind, params, x: symbol.x, y: symbol.y });
    pins.forEach(([x, y], index) => net.addPoint(x, y));
    placements.push({ id, spec, pins });
  }

  for (const directive of drawing.directives) {
    analyses.push(directive);
    if (!/^\.op(?:\s|$)/i.test(directive)) {
      losses.push({ ref: 'TEXT', kind: 'unsupported-asc-directive', source: directive,
        reason: 'the bounded ASC importer does not execute or reinterpret this directive', fallback: null });
    }
  }
  for (const line of drawing.unknownLines) {
    ignored.push(line);
    warnings.push(`Unrecognised LTspice ASC record at line ${line.line}: ${line.source}`);
  }
  ignored.push(...drawing.ignoredLines);

  net.solve();
  const live = net.liveRoots();
  for (const [x, y] of segmentAnchors) live.add(net.netAt(x, y));
  const byNet = new Map();
  let attached = 0;
  let floating = 0;
  const join = (netId, part, terminal) => {
    if (!byNet.has(netId)) byNet.set(netId, []);
    byNet.get(netId).push({ part, terminal });
  };
  for (const placement of placements) {
    placement.pins.forEach(([x, y], index) => {
      const netId = net.netAt(x, y);
      join(netId, placement.id, placement.spec.terminals[index]);
      if (live.has(netId)) attached++; else floating++;
    });
  }
  if (drawing.flags.some(flag => flag.name === '0')) {
    const id = makeId('GND1', used);
    parts.push({ id, kind: 'gnd', params: {}, x: 0, y: 0 });
    join(net.netOfName('__LTSPICE_GND__'), id, 'gnd');
  }
  const resolved = wiresFromNets(byNet);
  warnings.push(`geometry: ${attached}/${placements.length * 2} mapped pins landed on a wire or flag `
    + `(${resolved.nets} connected nets, ${drawing.flags.length} flags)`);
  if (floating) warnings.push(`${floating} mapped pin(s) are electrically floating`);
  if (!parts.length) warnings.push('No mappable components found in LTspice ASC schematic.');
  return { parts, wires: resolved.wires, warnings, unmapped, losses, ignored, analyses };
}
