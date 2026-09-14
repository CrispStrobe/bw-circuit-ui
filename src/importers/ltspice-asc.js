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
 *   ind.asy     9f8b8372...  PIN (16,16) A/order 1; (16,96) B/order 2
 *
 * The bounded subset maps only the exact standard `res`, `cap`, `voltage`,
 * `current`, and `ind` symbols. Voltage sources additionally retain exact
 * three-argument `SINE(offset amplitude frequency)` and strict seven-argument
 * `PULSE(V1 V2 TD TR TF PW PER)` values. For current
 * sources, LTspice/SPICE current flows from
 * SpiceOrder 1 to 2 while the native source injects from `neg` to `pos`, so
 * that pin order deliberately maps to `neg,pos`. Unknown/custom symbols are
 * explicit `unmapped[]` entries; unsupported orientations and non-static
 * values are explicit `losses[]`. Source-declared `.op/.ac/.tran/.dc` cards
 * are retained separately from parameter, model, and metadata directives;
 * the shared analysis adapter, not this importer, decides which exact source
 * conditions it can run. Unsupported directive semantics remain losses.
 * Mirrored transforms use LTspice's Y-down
 * instance matrices, cross-checked against paired ASC/netlist connectivity.
 * No external symbol file is followed and no TEXT directive is executed.
 * A caller may opt in to supplied ASY text through import options. The ASY
 * reader is synchronous and bounded; it opens no path or URL. Supplied pin
 * geometry can replace the built-in geometry only for the same exact standard
 * electrical symbols. Parsed custom definitions remain document metadata and
 * an explicit unmapped component, never a manufactured engine model.
 */

import { NetSolver, makeId, wiresFromNets } from './kicad-common.js';
import { parseSpiceValue } from '../model/si.js';
import { parseStrictSpicePulse, parseStrictSpiceSine } from '../model/spice-source.js';
import { evaluateConstantExpression, resolveConstantParameters } from '../model/spice-constant.js';
import { annotateImportedSingletonTerminals } from '../model/import-singleton-nets.js';
import { normalizeLtspiceSymbolName, parseLtspiceAsy } from './ltspice-asy.js';

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
  ['ind', {
    kind: 'inductor', parameter: 'henrys', terminals: ['a', 'b'],
    pins: [[16, 16], [16, 96]],
    sourceSha256: '9f8b83724e9b7147cef39529ec31da234ed0427d870bb3e5b42004afc23f63f2',
  }],
]);

const STANDARD_PREFIX = Object.freeze({
  resistor: 'R', capacitor: 'C', inductor: 'L', vsource: 'V', isource: 'I',
});

function symbolAsset(lib, options, cache) {
  const normalizedName = normalizeLtspiceSymbolName(lib);
  if (!normalizedName) return { supplied: true, error: 'unsafe symbol library name' };
  if (cache.has(normalizedName)) return cache.get(normalizedName);
  let value;
  const bundle = options?.symbols;
  if (bundle instanceof Map) value = bundle.get(normalizedName);
  else if (bundle && typeof bundle === 'object'
      && Object.prototype.hasOwnProperty.call(bundle, normalizedName)) value = bundle[normalizedName];
  if (value == null && typeof options?.resolveSymbol === 'function') {
    try {
      value = options.resolveSymbol(Object.freeze({ name: String(lib), normalizedName }));
    } catch (error) {
      const resolved = { supplied: true, normalizedName,
        error: `caller symbol resolver failed: ${String(error?.message || error)}` };
      cache.set(normalizedName, resolved);
      return resolved;
    }
  }
  if (value == null) {
    const resolved = { supplied: false, normalizedName };
    cache.set(normalizedName, resolved);
    return resolved;
  }
  const text = typeof value === 'string' ? value : value?.text;
  const declaredSha256 = typeof value === 'object' && value ? value.sha256 : null;
  if (typeof text !== 'string') {
    const resolved = { supplied: true, normalizedName,
      error: 'caller symbol asset must be text or {text, sha256}' };
    cache.set(normalizedName, resolved);
    return resolved;
  }
  const document = parseLtspiceAsy(text, options?.asy);
  const resolved = { supplied: true, normalizedName,
    declaredSha256: declaredSha256 || null, document };
  cache.set(normalizedName, resolved);
  return resolved;
}

function suppliedPins(spec, asset) {
  if (!asset.supplied) return { pins: spec.pins, defaults: {} };
  if (asset.error) return { error: asset.error };
  const document = asset.document;
  if (!document?.ok) return { error: 'supplied ASY definition is not structurally valid' };
  if (String(document.symbolType).toUpperCase() !== 'CELL') {
    return { error: 'supplied ASY SymbolType must be CELL' };
  }
  const expectedPrefix = STANDARD_PREFIX[spec.kind];
  if (!expectedPrefix || String(document.attrs.prefix || '').toUpperCase() !== expectedPrefix) {
    return { error: `supplied ASY Prefix must be ${expectedPrefix || 'a verified standard prefix'}` };
  }
  if (document.pins.length !== spec.terminals.length) {
    return { error: `supplied ASY definition has ${document.pins.length} pins; ${spec.terminals.length} required` };
  }
  const ordered = [...document.pins].sort((a, b) => a.spiceOrder - b.spiceOrder);
  if (ordered.some((pin, index) => pin.spiceOrder !== index + 1)) {
    return { error: `supplied ASY SpiceOrder must be exactly 1..${spec.terminals.length}` };
  }
  return { pins: ordered.map(pin => [pin.x, pin.y]), defaults: document.attrs };
}

function sourceSymbolMetadata(asset, requestedName) {
  return {
    library: asset.normalizedName || String(requestedName), requestedName: String(requestedName),
    status: asset.error ? 'refused' : asset.document?.ok ? 'parsed' : 'refused',
    ...(asset.declaredSha256 ? { declaredSha256: asset.declaredSha256 } : {}),
    ...(asset.error ? { error: asset.error } : {}),
    ...(asset.document ? { document: asset.document } : {}),
    instances: [],
  };
}

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
    case 'M0': u = -px; v = py; break;
    case 'M90': u = py; v = px; break;
    case 'M180': u = px; v = -py; break;
    case 'M270': u = -py; v = -px; break;
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
    } else if (/^WINDOW\b/i.test(line)) {
      ignoredLines.push({ line: index + 1, source: line,
        reason: 'symbol display annotation is not part of the bounded circuit projection' });
      // WINDOW records belong to the active SYMBOL and commonly precede or
      // separate its SYMATTR records. They do not end the symbol record.
    } else if (/^DATAFLAG\b/i.test(line)) {
      ignoredLines.push({ line: index + 1, source: line,
        reason: 'measurement annotation is not part of the bounded circuit projection' });
      current = null;
    } else {
      unknownLines.push({ line: index + 1, source: line }); current = null;
    }
  }
  return { wires, flags, symbols, directives, unknownLines, ignoredLines };
}

function staticValue(raw, constants = new Map()) {
  const text = String(raw || '').trim().replace(/^DC\s+/i, '');
  const value = parseSpiceValue(text);
  if (Number.isFinite(value)) return { ok: true, value };
  try {
    return { ok: true, value: evaluateConstantExpression(text, name => constants.get(name)) };
  } catch (error) {
    return { ok: false, reason: error.message };
  }
}

/** Strict LTspice Value projection for the bounded source subset. */
function authoredParams(raw, spec, constants) {
  const text = String(raw || '').trim();
  const sine = parseStrictSpiceSine(text, { allowSinAlias: false });
  if (sine && spec.kind === 'vsource') {
    return sine.ok ? { params: sine.params, reason: null } : { params: {}, reason: sine.reason };
  }
  const pulse = parseStrictSpicePulse(text);
  if (pulse) {
    if (pulse.ok && spec.kind === 'vsource') return { params: pulse.params, reason: null };
    return { params: {}, reason: pulse.ok
      ? 'time-varying current PULSE sources are not modelled'
      : pulse.reason };
  }
  const resolved = staticValue(text, constants);
  return !resolved.ok
    ? { params: {}, reason: `Value "${text}" is not a resolved finite static scalar: ${resolved.reason}` }
    : { params: { [spec.parameter]: resolved.value }, reason: null };
}

export function importLtspiceAsc(text, options = {}) {
  const parts = [];
  const warnings = [];
  const unmapped = [];
  const losses = [];
  const ignored = [];
  const analyses = [];
  const sourceDirectives = [];
  const symbolAssets = new Map();
  const sourceSymbols = [];
  const sourceSymbolRecords = new Map();
  if (!looksLikeLtspiceAsc(text)) {
    return { parts, wires: [], warnings: ['Not an LTspice Version 4 ASCII schematic.'],
      unmapped, losses, ignored, analyses, sourceDirectives, netNames: [], sourceSymbols };
  }

  const drawing = parse(text);
  const constantParameters = resolveConstantParameters(
    drawing.directives.filter(directive => /^\.params?\b/i.test(directive)));
  for (const finding of constantParameters.losses) {
    losses.push({ ref: finding.name || 'TEXT', kind: 'unsupported-constant-parameter',
      source: finding.source, reason: finding.reason, fallback: null });
  }
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
    const asset = symbolAsset(symbol.lib, options, symbolAssets);
    let sourceSymbolRecord = null;
    if (asset.supplied) {
      const key = asset.normalizedName || symbol.lib;
      if (!sourceSymbolRecords.has(key)) {
        const record = sourceSymbolMetadata(asset, symbol.lib);
        sourceSymbolRecords.set(key, record);
        sourceSymbols.push(record);
      }
      sourceSymbolRecord = sourceSymbolRecords.get(key);
      sourceSymbolRecord.instances.push({
        ref: symbol.attrs.instname || null, x: symbol.x, y: symbol.y,
        orientation: symbol.orientation, attrs: { ...symbol.attrs }, line: symbol.line,
      });
    }
    const definition = spec ? suppliedPins(spec, asset) : null;
    if (sourceSymbolRecord) sourceSymbolRecord.electricalStatus = !spec
      ? 'unmapped-no-native-kind' : definition.error ? 'refused-definition' : 'existing-standard-kind';
    const effectiveAttrs = {
      ...(definition?.defaults || (asset.document?.ok ? asset.document.attrs : {})),
      ...symbol.attrs,
    };
    if (!symbol.attrs.instname) delete effectiveAttrs.instname;
    const ref = symbol.attrs.instname || '?';
    if (!spec) {
      unmapped.push({ ref, value: effectiveAttrs.value || '',
        libsource: `${symbol.lib}: no verified standard-symbol electrical rule in the bounded ASC importer`,
        ...(asset.supplied ? { sourceSymbol: asset.normalizedName || String(symbol.lib) } : {}) });
      warnings.push(`Unmapped LTspice symbol: ${ref} (${symbol.lib})`);
      continue;
    }
    if (definition.error) {
      unmapped.push({ ref, value: effectiveAttrs.value || '',
        libsource: `${symbol.lib}: ${definition.error}`,
        ...(asset.supplied ? { sourceSymbol: asset.normalizedName || String(symbol.lib) } : {}) });
      warnings.push(`${ref}: supplied LTspice symbol definition refused: ${definition.error}`);
      continue;
    }
    const expectedPrefix = STANDARD_PREFIX[spec.kind];
    if (effectiveAttrs.prefix != null
        && String(effectiveAttrs.prefix).toUpperCase() !== expectedPrefix) {
      unmapped.push({ ref, value: effectiveAttrs.value || '',
        libsource: `${symbol.lib}: effective Prefix must be ${expectedPrefix}; instance attributes take precedence`,
        ...(asset.supplied ? { sourceSymbol: asset.normalizedName || String(symbol.lib) } : {}) });
      warnings.push(`${ref}: LTspice Prefix ${effectiveAttrs.prefix} does not match ${expectedPrefix}`);
      continue;
    }
    const pins = definition.pins.map(([px, py]) => placeLtspicePin(px, py, symbol));
    if (pins.some(pin => pin === null)) {
      unmapped.push({ ref, value: symbol.attrs.value || '',
        libsource: `${symbol.lib}: unsupported orientation ${symbol.orientation}` });
      warnings.push(`${ref}: unsupported LTspice orientation ${symbol.orientation}`);
      continue;
    }
    if (!effectiveAttrs.instname) {
      unmapped.push({ ref, value: effectiveAttrs.value || '', libsource: `${symbol.lib}: missing InstName` });
      warnings.push(`${symbol.lib} at line ${symbol.line}: missing InstName`);
      continue;
    }
    const id = makeId(ref, used);
    const authored = authoredParams(effectiveAttrs.value, spec, constantParameters.values);
    if (!authored.reason && spec.kind === 'inductor' && !(authored.params.henrys > 0)) {
      authored.reason = 'inductor Value must resolve to a positive finite scalar';
      authored.params = {};
    }
    const params = authored.params;
    const partBlockers = [];
    if (authored.reason) {
      const loss = { ref: id, kind: 'unsupported-or-missing-static-value', source: symbol.source,
        reason: authored.reason, fallback: null };
      losses.push(loss);
      partBlockers.push({ type: 'semantic-import-loss', ...loss });
      warnings.push(`${id}: non-static or missing value is not approximated`);
    }
    for (const [name, attributeValue] of Object.entries(effectiveAttrs)) {
      if (name === 'instname' || name === 'value' || name === 'prefix') continue;
      const loss = { ref: id, kind: 'unsupported-symbol-attribute',
        source: `${Object.prototype.hasOwnProperty.call(symbol.attrs, name) ? 'SYMATTR' : 'ASY SYMATTR'} ${name} ${attributeValue}`,
        reason: `the bounded ASC importer does not interpret ${name}`, fallback: null };
      losses.push(loss);
      partBlockers.push({ type: 'semantic-import-loss', ...loss });
      warnings.push(`${id}: unsupported LTspice symbol attribute ${name} is retained as a loss`);
    }
    parts.push({ id, kind: spec.kind, params, x: symbol.x, y: symbol.y,
      ...(partBlockers.length ? { analysisBlockers: partBlockers } : {}) });
    pins.forEach(([x, y], index) => net.addPoint(x, y));
    placements.push({ id, spec, pins });
  }

  for (const directive of drawing.directives) {
    if (/^\.(?:op|ac|tran|dc)\b/i.test(directive)) {
      analyses.push(directive);
      sourceDirectives.push({ source: directive, kind: 'analysis', handling: 'source-analysis' });
      continue;
    }
    if (/^\.params?\b/i.test(directive)) {
      sourceDirectives.push({ source: directive, kind: 'parameter-definition',
        handling: 'constant-expression' });
      continue;
    }
    if (/^\.(?:backanno|end)\b/i.test(directive)) {
      sourceDirectives.push({ source: directive, kind: 'metadata', handling: 'retained-ignored' });
      ignored.push({ source: directive, reason: 'non-electrical LTspice metadata directive' });
      continue;
    }
    if (/^\.func\b/i.test(directive)) {
      sourceDirectives.push({ source: directive, kind: 'function-definition', handling: 'unsupported' });
      losses.push({ ref: 'TEXT', kind: 'unsupported-constant-function', source: directive,
        reason: '.func definitions are not executed by the constant parameter evaluator', fallback: null });
    } else {
      sourceDirectives.push({ source: directive,
        kind: /^\.(?:model|include|inc|lib)\b/i.test(directive) ? 'model-definition' : 'unsupported',
        handling: 'unsupported' });
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
  const namesByNet = new Map();
  for (const flag of drawing.flags) {
    const netId = net.netAt(flag.x, flag.y);
    if (netId == null) continue;
    if (!namesByNet.has(netId)) namesByNet.set(netId, []);
    namesByNet.get(netId).push(flag.name === '0' ? '0' : flag.name);
  }
  const usedNetNames = new Set(drawing.flags.map(flag =>
    String(flag.name === '0' ? '0' : flag.name).toLowerCase()));
  let anonymous = 0;
  const anonymousName = () => {
    let name;
    do { name = `$asc$${anonymous++}`; } while (usedNetNames.has(name.toLowerCase()));
    usedNetNames.add(name.toLowerCase());
    return name;
  };
  const netNames = [...byNet.entries()].map(([netId, members]) => {
    const authored = namesByNet.get(netId) || [];
    const name = authored.includes('0') ? '0' : authored[0] || anonymousName();
    return { name, terminals: members.map(member => ({ partId: member.part, terminal: member.terminal })) };
  });
  annotateImportedSingletonTerminals(parts, byNet.values());
  const resolved = wiresFromNets(byNet);
  warnings.push(`geometry: ${attached}/${placements.length * 2} mapped pins landed on a wire or flag `
    + `(${resolved.nets} connected nets, ${drawing.flags.length} flags)`);
  if (floating) warnings.push(`${floating} mapped pin(s) are electrically floating`);
  if (!parts.length) warnings.push('No mappable components found in LTspice ASC schematic.');
  return { parts, wires: resolved.wires, warnings, unmapped, losses, ignored,
    analyses, sourceDirectives, netNames, sourceSymbols };
}
