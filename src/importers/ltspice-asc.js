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
 *   diode.asy   a7177f6c...  PIN (16,0)  +/order 1; (16,64) -/order 2
 *
 * The native fast path maps exact standard R/C/L/V/I/D symbols and a small set
 * of electrically identical, exact-name LTspice variants. A separate pin-only
 * contract covers common Q/M/E/G families: those coordinates recover the source
 * graph but do not assert model support. The shared SPICE importer decides which
 * instances can become native parts and attaches blockers for unsupported physics.
 * Voltage sources additionally retain exact
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
 * geometry overrides a built-in contract for that instance. A caller-supplied
 * custom CELL may project ordinary SPICE R/C/L/V/I/D/Q/M/E/G/X cards only when
 * its explicit Prefix, contiguous SpiceOrder and local model/subcircuit text are
 * sufficient; no kind is inferred from geometry or arity.
 */

import { NetSolver, makeId, wiresFromNets } from './kicad-common.js';
import { parseSpiceValue } from '../model/si.js';
import { parseStrictSpicePulse, parseStrictSpiceSine } from '../model/spice-source.js';
import { evaluateConstantExpression, resolveConstantParameters } from '../model/spice-constant.js';
import { annotateImportedSingletonTerminals } from '../model/import-singleton-nets.js';
import { normalizeLtspiceSymbolName, parseLtspiceAsy } from './ltspice-asy.js';
import { classifyShockleyThermal, validateExplicitShockley } from '../model/spice-diode.js';
import { parseSpiceModelDeclaration } from '../model/spice-model.js';
import { importSpice } from './spice.js';
import { sourceDocumentProjection } from '../model/source-document-projection.js';

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
  ['diode', {
    kind: 'diode', terminals: ['anode', 'cathode'],
    pins: [[16, 0], [16, 64]],
    sourceSha256: 'a7177f6cc9730376390e2b0f0a67de1050b6452aba3049351dcd64a68dfd0d70',
  }],
]);

// Exact-name aliases whose electrical primitive and terminal order are the same
// as a native standard symbol. Only pin interfaces are recorded; no vendor
// drawing or symbol payload is bundled. Nonlinear variants still pass through
// the strict model validator, so a zener/Schottky/varactor model with unsupported
// fields remains analysis-blocking instead of becoming an ordinary diode.
const NATIVE_SYMBOL_ALIASES = new Map([
  ['polcap', { canonical: 'cap' }],
  ['ind2', { canonical: 'ind' }],
  ['schottky', { canonical: 'diode' }],
  ['zener', { canonical: 'diode' }],
  ['led', { canonical: 'diode' }],
  ['varactor', { canonical: 'diode' }],
  ['tvsdiode', { canonical: 'diode' }],
  ['misc/europeanresistor', { canonical: 'res' }],
  ['misc/battery', { canonical: 'voltage' }],
  ['misc/signal', { canonical: 'voltage' }],
  ['misc/cell', { canonical: 'voltage', pins: [[0, 0], [0, 64]] }],
]);

// Common built-in pin contracts, sorted by SpiceOrder. These are deliberately
// separate from SYMBOLS: knowing where a MOSFET pin lands is not a claim that
// its .model is within bw-board's equations. Exact pin facts were manually
// checked against LTspice 26.0.2 and then differentially checked against the
// fixed paired ASC/SPICE corpus; the vendor symbol drawings are not copied.
const PIN_ONLY_SYMBOLS = new Map([
  ['nmos', { family: 'mosfet-implicit-bulk', names: ['drain', 'gate', 'source'],
    pins: [[48, 0], [0, 80], [48, 96]] }],
  ['pmos', { family: 'mosfet-implicit-bulk', names: ['drain', 'gate', 'source'],
    pins: [[48, 0], [0, 80], [48, 96]] }],
  ['nmos4', { family: 'mosfet-explicit-bulk', names: ['drain', 'gate', 'source', 'bulk'],
    pins: [[48, 0], [0, 80], [48, 96], [48, 48]] }],
  ['pmos4', { family: 'mosfet-explicit-bulk', names: ['drain', 'gate', 'source', 'bulk'],
    pins: [[48, 0], [0, 80], [48, 96], [48, 48]] }],
  ['npn', { family: 'bjt', names: ['collector', 'base', 'emitter'],
    pins: [[64, 0], [0, 48], [64, 96]] }],
  ['pnp', { family: 'bjt', names: ['collector', 'base', 'emitter'],
    pins: [[64, 0], [0, 48], [64, 96]] }],
  ['e', { family: 'vcvs', names: ['outp', 'outn', 'inp', 'inn'],
    pins: [[0, 16], [0, 96], [-48, 32], [-48, 80]] }],
  ['e2', { family: 'vcvs-reversed-control-drawing', names: ['outp', 'outn', 'inp', 'inn'],
    pins: [[0, 16], [0, 96], [-48, 80], [-48, 32]] }],
  ['g', { family: 'vccs', names: ['outn', 'outp', 'inp', 'inn'],
    pins: [[0, 96], [0, 16], [-48, 32], [-48, 80]] }],
  ['g2', { family: 'vccs-reversed-control-drawing', names: ['outn', 'outp', 'inp', 'inn'],
    pins: [[0, 96], [0, 16], [-48, 80], [-48, 32]] }],
  ['misc/xtal', { family: 'unsupported-crystal', names: ['1', '2'], pins: [[16, 0], [16, 64]] }],
  ['misc/jumper', { family: 'unsupported-jumper', names: ['1', '2'], pins: [[-32, 64], [32, 64]] }],
]);

function libraryKeys(name) {
  const basename = String(name || '').replace(/\\/g, '/').split('/').at(-1).toLowerCase();
  const normalized = normalizeLtspiceSymbolName(name);
  return { basename, normalized };
}

function nativeSymbolSpec(name) {
  const { basename, normalized } = libraryKeys(name);
  // A path-qualified symbol is caller/library-owned even when its basename is
  // `res` or another standard spelling. Only the unqualified LTspice built-in
  // name may use the native contract without an ASY; reviewed path-qualified
  // built-ins are listed explicitly below.
  const direct = normalized === basename ? SYMBOLS.get(basename) : null;
  if (direct) return direct;
  const alias = NATIVE_SYMBOL_ALIASES.get(normalized || basename);
  if (!alias) return null;
  const canonical = SYMBOLS.get(alias.canonical);
  return { ...canonical, ...(alias.pins ? { pins: alias.pins } : {}), aliasOf: alias.canonical };
}

function pinOnlySymbolSpec(name) {
  const { basename, normalized } = libraryKeys(name);
  return PIN_ONLY_SYMBOLS.get(normalized || basename) || null;
}

const STANDARD_PREFIX = Object.freeze({
  resistor: 'R', capacitor: 'C', inductor: 'L', vsource: 'V', isource: 'I', diode: 'D',
});

const ASC_LIMITS = Object.freeze({
  maxBytes: 8 * 1024 * 1024,
  maxLines: 100000,
  maxRecords: 100000,
  maxSymbols: 20000,
});

const ascByteLength = text => typeof TextEncoder === 'function'
  ? new TextEncoder().encode(text).byteLength : text.length;

/** Decode caller-owned ASC bytes without guessing beyond BOM/NUL evidence. */
export function decodeLtspiceText(input) {
  if (typeof input === 'string') {
    const value = input.startsWith('\ufeff') ? input.slice(1) : input;
    return { text: value, encoding: 'string' };
  }
  let bytes = null;
  if (input instanceof Uint8Array) bytes = input;
  else if (typeof ArrayBuffer !== 'undefined' && input instanceof ArrayBuffer) bytes = new Uint8Array(input);
  if (!bytes) return { text: '', encoding: 'invalid' };
  let encoding = 'utf-8';
  if (bytes[0] === 0xff && bytes[1] === 0xfe) encoding = 'utf-16le';
  else if (bytes[0] === 0xfe && bytes[1] === 0xff) encoding = 'utf-16be';
  else {
    const sample = bytes.subarray(0, Math.min(bytes.length, 256));
    let evenNuls = 0; let oddNuls = 0;
    sample.forEach((value, index) => {
      if (value === 0) { if (index % 2) oddNuls++; else evenNuls++; }
    });
    if (oddNuls > sample.length / 8 && evenNuls === 0) encoding = 'utf-16le';
    else if (evenNuls > sample.length / 8 && oddNuls === 0) encoding = 'utf-16be';
  }
  try {
    return { text: new TextDecoder(encoding, { fatal: true }).decode(bytes).replace(/^\ufeff/, ''), encoding };
  } catch {
    return { text: '', encoding, error: `input is not valid ${encoding}` };
  }
}

function collectAscModels(directives) {
  const models = new Map();
  directives.forEach((source, index) => {
    const match = /^\.model\b(.*)$/is.exec(source);
    if (!match) return;
    const parsed = parseSpiceModelDeclaration(match[1]);
    const looseName = match[1].trim().split(/\s+/)[0] || '';
    const name = parsed?.name || looseName;
    if (!name) return;
    const key = name.toLowerCase();
    const prior = models.get(key);
    models.set(key, {
      ...(parsed || prior || { name, type: '', body: '', params: {} }),
      source: [prior?.source, source].filter(Boolean).join('\n'),
      indexes: [...(prior?.indexes || []), index],
      ...(!parsed ? { malformed: true } : {}),
      ...(prior ? { ambiguous: true } : {}),
    });
  });
  return models;
}

function classifyAscShockleyThermal(directives) {
  const thermal = classifyShockleyThermal(directives);
  for (const source of directives) {
    const option = /^\.options?\b(.*)$/i.exec(source);
    if (!option || !/\b(?:temp|tnom)\b/i.test(option[1])) continue;
    let rest = option[1];
    while (rest.trim()) {
      const match = /^\s*,?\s*(?:temp|tnom)\s*=\s*([^\s,]+)([\s\S]*)$/i.exec(rest);
      if (!match) return { ok: false, explicit: true, source: thermal.source,
        reason: 'diode temperature options may contain only explicit TEMP and TNOM assignments' };
      rest = match[2];
    }
  }
  return thermal;
}

function authoredDiode(raw, models, thermal) {
  const modelName = String(raw || '').trim();
  let model = null;
  let reason = null;
  if (!modelName || !/^\S+$/.test(modelName)) {
    reason = 'diode Value must name exactly one explicit local D model';
  } else {
    model = models.get(modelName.toLowerCase()) || null;
    if (!model) reason = `diode model "${modelName}" is not declared in this ASC`;
    else if (model.ambiguous) reason = 'duplicate diode model declarations are ambiguous';
    else if (model.malformed) reason = 'diode model declaration is malformed';
    else if (model.type !== 'D') reason = `model type ${model.type || '(missing)'} is not D`;
    else {
      const exact = validateExplicitShockley(model.params, model.body);
      if (!exact.ok) reason = exact.reason;
      else if (!thermal.ok) reason = thermal.reason;
      else return { params: exact.params, model, reason: null };
    }
  }
  const source = [model?.source, ...(thermal.source || [])].filter(Boolean).join('\n')
    || `SYMATTR Value ${modelName || '(missing)'}`;
  return {
    params: {
      _spiceBlocked: reason,
      ...(model?.source ? { _spiceModel: model.source } : {}),
      ...(thermal.source?.length ? { _spiceTemperature: thermal.source.join('\n') } : {}),
    },
    model,
    reason,
    source,
  };
}

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
  const text = typeof value === 'string' || value instanceof Uint8Array
    || (typeof ArrayBuffer !== 'undefined' && value instanceof ArrayBuffer) ? value : value?.text;
  const declaredSha256 = typeof value === 'object' && value ? value.sha256 : null;
  if (!(typeof text === 'string' || text instanceof Uint8Array
      || (typeof ArrayBuffer !== 'undefined' && text instanceof ArrayBuffer))) {
    const resolved = { supplied: true, normalizedName,
      error: 'caller symbol asset must be text/bytes or {text, sha256}' };
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
  const decoded = decodeLtspiceText(text);
  if (decoded.error) return false;
  return /^\s*Version\s+4(?:\.1)?\s*$/im.test(decoded.text)
    && /^\s*SHEET\s+\d+\s+[-+]?\d+\s+[-+]?\d+\s*$/im.test(decoded.text)
    && /^\s*(?:WIRE|SYMBOL|FLAG)\b/im.test(decoded.text);
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

/**
 * Parse the ASC source document. Every non-empty source line has one record;
 * the native electrical projection below is a separate consumer of this IR.
 */
export function parseLtspiceAscDocument(text, options = {}) {
  const decoded = decodeLtspiceText(text);
  const wires = [];
  const flags = [];
  const symbols = [];
  const directives = [];
  const texts = [];
  const records = [];
  const findings = [];
  const unknownLines = [];
  const ignoredLines = [];
  let version = null;
  let sheet = null;
  let current = null;
  if (decoded.error) {
    return { ok: false, version, sheet, encoding: decoded.encoding, rawText: '', records,
      wires, flags, symbols, texts, directives, findings: [{ kind: 'invalid-asc-encoding',
        line: 0, reason: decoded.error }], unknownLines, ignoredLines };
  }
  const limits = { ...ASC_LIMITS, ...(options?.limits || {}) };
  if (ascByteLength(decoded.text) > Math.min(limits.maxBytes || ASC_LIMITS.maxBytes, ASC_LIMITS.maxBytes)) {
    return { ok: false, version, sheet, encoding: decoded.encoding, rawText: '', records,
      wires, flags, symbols, texts, directives, findings: [{ kind: 'asc-limit-exceeded',
        line: 0, reason: `schematic exceeds the ${ASC_LIMITS.maxBytes}-byte limit` }],
      unknownLines, ignoredLines };
  }
  const rawText = decoded.text.replace(/\r\n?/g, '\n');
  const lines = rawText.split('\n');
  if (lines.length > Math.min(limits.maxLines || ASC_LIMITS.maxLines, ASC_LIMITS.maxLines)) {
    return { ok: false, version, sheet, encoding: decoded.encoding, rawText: '', records,
      wires, flags, symbols, texts, directives, findings: [{ kind: 'asc-limit-exceeded',
        line: 0, reason: `schematic exceeds the ${ASC_LIMITS.maxLines}-line limit` }],
      unknownLines, ignoredLines };
  }
  for (let index = 0; index < lines.length; index++) {
    const source = lines[index];
    const line = source.trim();
    if (!line) continue;
    if (records.length >= ASC_LIMITS.maxRecords) {
      findings.push({ kind: 'asc-limit-exceeded', line: index + 1,
        reason: `schematic exceeds the ${ASC_LIMITS.maxRecords}-record limit` });
      break;
    }
    let match;
    if ((match = /^Version\s+(\d+(?:\.\d+)?)$/i.exec(line))) {
      version = match[1]; records.push({ type: 'VERSION', line: index + 1, source, value: version });
    } else if ((match = /^SHEET\s+(\d+)\s+(-?\d+)\s+(-?\d+)$/i.exec(line))) {
      sheet = { number: Number(match[1]), width: Number(match[2]), height: Number(match[3]), line: index + 1 };
      records.push({ type: 'SHEET', line: index + 1, source, ...sheet });
    } else if ((match = /^WIRE\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)$/i.exec(line))) {
      const coordinates = match.slice(1).map(Number);
      wires.push(coordinates); records.push({ type: 'WIRE', line: index + 1, source, coordinates });
    } else if ((match = /^FLAG\s+(-?\d+)\s+(-?\d+)\s+(.+)$/i.exec(line))) {
      const flag = { x: Number(match[1]), y: Number(match[2]), name: match[3].trim(), line: index + 1 };
      flags.push(flag); records.push({ type: 'FLAG', source, ...flag });
    } else if ((match = /^SYMBOL\s+(.+?)\s+(-?\d+)\s+(-?\d+)\s+(\S+)$/i.exec(line))) {
      if (symbols.length >= ASC_LIMITS.maxSymbols) {
        findings.push({ kind: 'asc-limit-exceeded', line: index + 1,
          reason: `schematic exceeds the ${ASC_LIMITS.maxSymbols}-symbol limit`, source });
        records.push({ type: 'SYMBOL', line: index + 1, source, refused: true });
        current = null; continue;
      }
      current = { source, lib: match[1], x: Number(match[2]), y: Number(match[3]),
        orientation: match[4], attrs: {}, attributeRecords: [], windows: [], line: index + 1 };
      symbols.push(current);
      records.push({ type: 'SYMBOL', line: index + 1, source, symbolIndex: symbols.length - 1,
        library: current.lib, x: current.x, y: current.y, orientation: current.orientation });
    } else if ((match = /^SYMATTR\s+(\S+)\s*(.*)$/i.exec(line)) && current) {
      const name = match[1]; const value = match[2]; const folded = name.toLowerCase();
      if (Object.prototype.hasOwnProperty.call(current.attrs, folded)) findings.push({
        kind: 'duplicate-symbol-attribute', line: index + 1, source,
        reason: `${current.attrs.instname || current.lib} repeats SYMATTR ${name}; last value retained`,
      });
      current.attrs[folded] = value;
      current.attributeRecords.push({ name, value, line: index + 1, source });
      records.push({ type: 'SYMATTR', line: index + 1, source,
        symbolIndex: symbols.indexOf(current), name, value });
    } else if ((match = /^TEXT\s+(-?\d+)\s+(-?\d+)\s+(\S+)\s+(\d+)\s*(.*)$/i.exec(line))) {
      const body = match[5]; const directive = body.startsWith('!') ? body.slice(1).trim() : null;
      const textRecord = { x: Number(match[1]), y: Number(match[2]), alignment: match[3],
        size: Number(match[4]), body, directive, line: index + 1, source };
      texts.push(textRecord); records.push({ type: 'TEXT', ...textRecord });
      if (directive !== null) directives.push(directive);
    } else if ((match = /^WINDOW\s+(.*)$/i.exec(line))) {
      const record = { line: index + 1, source, fields: match[1] };
      if (current) current.windows.push(record);
      records.push({ type: 'WINDOW', ...record,
        ...(current ? { symbolIndex: symbols.indexOf(current) } : {}) });
      ignoredLines.push({ line: index + 1, source,
        reason: 'symbol display annotation is not part of the bounded circuit projection' });
      // WINDOW records belong to the active SYMBOL and commonly precede or
      // separate its SYMATTR records. They do not end the symbol record.
    } else if (/^DATAFLAG\b/i.test(line)) {
      records.push({ type: 'DATAFLAG', line: index + 1, source });
      ignoredLines.push({ line: index + 1, source,
        reason: 'measurement annotation is not part of the bounded circuit projection' });
    } else {
      const record = { type: line.split(/\s+/, 1)[0].toUpperCase(), line: index + 1, source };
      records.push(record); unknownLines.push({ line: index + 1, source });
    }
  }
  if (!['4', '4.1'].includes(version)) findings.push({ kind: 'unsupported-asc-version', line: 0,
    reason: version === null ? 'schematic has no Version record' : `Version ${version} is not supported` });
  if (!sheet) findings.push({ kind: 'missing-asc-sheet', line: 0, reason: 'schematic has no SHEET record' });
  return { ok: !findings.some(item => ['asc-limit-exceeded', 'unsupported-asc-version',
    'missing-asc-sheet'].includes(item.kind)), version, sheet, encoding: decoded.encoding,
  rawText, records, wires, flags, symbols, texts, directives, findings, unknownLines, ignoredLines };
}

function documentPinDefinition(symbol, asset, spec, pinOnly) {
  if (asset.supplied) {
    if (asset.error) return { status: 'refused', pins: [], reason: asset.error };
    if (!asset.document?.ok) return { status: 'refused', pins: [],
      reason: 'caller-supplied ASY is not structurally valid' };
    if (String(asset.document.symbolType).toUpperCase() !== 'CELL') {
      return { status: 'refused', pins: [], reason: 'caller-supplied ASY SymbolType must be CELL' };
    }
    if (!asset.document.pins.length) return { status: 'refused', pins: [],
      reason: 'caller-supplied ASY has no electrical pins' };
    return { status: 'supplied', pins: [...asset.document.pins]
      .sort((a, b) => a.spiceOrder - b.spiceOrder)
      .map(pin => ({ x: pin.x, y: pin.y, spiceOrder: pin.spiceOrder,
        pinName: pin.pinName, orientation: pin.orientation, labelOffset: pin.labelOffset })) };
  }
  if (spec) return { status: 'builtin', pins: spec.pins.map(([x, y], index) => ({
    x, y, spiceOrder: index + 1, pinName: spec.terminals[index],
    pinContract: spec.aliasOf ? 'native-alias' : 'native',
  })), pinContract: spec.aliasOf ? 'native-alias' : 'native' };
  if (pinOnly) return { status: 'builtin', pins: pinOnly.pins.map(([x, y], index) => ({
    x, y, spiceOrder: index + 1, pinName: pinOnly.names[index], pinContract: 'pin-only',
  })), pinContract: 'pin-only', family: pinOnly.family };
  return { status: 'missing', pins: [], reason: 'no caller-supplied or verified built-in pin definition' };
}

const SPICE_PROJECTABLE_PREFIXES = new Set(['R', 'C', 'L', 'V', 'I', 'D', 'Q', 'M', 'E', 'G', 'X']);
const SPICE_PREFIX_PIN_COUNTS = Object.freeze({
  R: [2], C: [2], L: [2], V: [2], I: [2], D: [2], Q: [3], M: [3, 4], E: [4], G: [4],
});

function sourceModelMap(directives) {
  const models = new Map();
  for (const source of directives) {
    const match = /^\.model\b(.*)$/is.exec(source);
    if (!match) continue;
    const parsed = parseSpiceModelDeclaration(match[1]);
    if (parsed?.name) models.set(parsed.name.toLowerCase(), parsed);
  }
  return models;
}

function modelProjectionLoss(prefix, attrs, models, ref) {
  if (prefix !== 'Q' && prefix !== 'M') return null;
  const modelName = String(attrs.spicemodel || attrs.value || '').trim().split(/\s+/, 1)[0];
  const model = models.get(modelName.toLowerCase());
  if (!model) return { ref, kind: 'unsupported-or-missing-device-model',
    source: `SYMATTR Value ${modelName || '(missing)'}`,
    reason: `${prefix === 'Q' ? 'BJT' : 'MOSFET'} model ${modelName || '(missing)'} is not declared; `
      + 'the native part is retained for editing but default physics is not analysis-safe', fallback: null };
  const expected = prefix === 'Q' ? new Set(['NPN', 'PNP']) : new Set(['NMOS', 'PMOS']);
  if (!expected.has(model.type)) return { ref, kind: 'unsupported-device-model',
    source: `.model ${model.name} ${model.type} ${model.body}`,
    reason: `model type ${model.type || '(missing)'} does not match ${prefix}`, fallback: null };
  const allowed = prefix === 'Q'
    ? new Set(['is', 'bf', 'br', 'nf']) : new Set(['level', 'vto', 'kp', 'lambda']);
  const unsupported = Object.keys(model.params).filter(name => !allowed.has(name));
  if (prefix === 'M' && model.params.level !== undefined && model.params.level !== 1) {
    unsupported.unshift(`level=${model.params.level}`);
  }
  if (!unsupported.length) return null;
  return { ref, kind: 'unsupported-device-model-fields',
    source: `.model ${model.name} ${model.type} ${model.body}`,
    reason: `native ${prefix} projection does not implement ${unsupported.join(', ')}`, fallback: null };
}

function instanceProjectionLosses(prefix, instance) {
  const attrs = instance.effectiveAttrs;
  const extra = [attrs.value2, attrs.spiceline, attrs.spiceline2]
    .filter(value => String(value || '').trim()).join(' ').trim();
  const losses = [];
  const modelFile = String(attrs.spicemodel || attrs.modelfile || '').trim();
  if (modelFile) {
    losses.push({ ref: instance.ref, kind: 'unresolved-symbol-model-file',
      source: `SYMATTR ${attrs.spicemodel ? 'SpiceModel' : 'ModelFile'} ${modelFile}`,
      reason: 'symbol model-file attributes are retained as inert dependencies; the importer never opens them implicitly',
      fallback: null });
  }
  if (prefix === 'M' && instance.pins.length === 4
      && instance.pins[3]?.netId !== instance.pins[2]?.netId) {
    losses.push({ ref: instance.ref, kind: 'unsupported-mosfet-bulk-terminal',
      source: `SYMBOL ${instance.library} ${instance.x} ${instance.y} ${instance.orientation}`,
      reason: 'the native MOSFET has no bulk terminal and source/bulk are on different source nets',
      fallback: null });
  }
  if (!extra) return losses;
  const supportedMos = prefix === 'M' && extra.split(/\s+/)
    .every(field => /^(?:W|L)=\S+$/i.test(field));
  if (!supportedMos) losses.push({ ref: instance.ref,
    kind: prefix === 'X' ? 'unsupported-subcircuit-parameter-override' : 'unsupported-instance-netlist-fields',
    source: extra,
    reason: `${prefix} Value2/SpiceLine fields are retained but not fully represented by the native projection`,
    fallback: null });
  return losses;
}

function projectableCard(instance, drawing, options) {
  const attrs = instance.effectiveAttrs;
  const prefix = String(attrs.prefix || instance.ref?.[0] || '').toUpperCase();
  if (!SPICE_PROJECTABLE_PREFIXES.has(prefix)) return null;
  if (!instance.ref || instance.ref[0].toUpperCase() !== prefix || !/^\S+$/.test(instance.ref)) {
    return { error: `InstName must be one token beginning with effective Prefix ${prefix}` };
  }
  const allowedCounts = SPICE_PREFIX_PIN_COUNTS[prefix];
  if (allowedCounts && !allowedCounts.includes(instance.pins.length)) {
    return { error: `${prefix} projection needs ${allowedCounts.join(' or ')} SpiceOrder pins; definition has ${instance.pins.length}` };
  }
  if (prefix === 'X' && !instance.pins.length) return { error: 'X projection needs at least one SpiceOrder pin' };
  if (instance.pins.some((pin, index) => pin.spiceOrder !== index + 1)) {
    return { error: `${prefix} projection needs contiguous SpiceOrder 1..${instance.pins.length}` };
  }
  const nodes = instance.pins.map((pin, index) => `__asc_pin_${index + 1}`);
  // A three-pin LTspice MOS symbol has an implicit substrate connection. Its
  // exported SPICE card appends source as node four; make that explicit only
  // for the shared SPICE parser while retaining the three authored terminals.
  const cardNodes = prefix === 'M' && nodes.length === 3 ? [...nodes, nodes[2]] : nodes;
  const value = String(attrs.value || '').trim();
  const value2 = String(attrs.value2 || '').trim();
  const spiceLine = String(attrs.spiceline || '').trim();
  const spiceLine2 = String(attrs.spiceline2 || '').trim();
  const tail = [value, value2, spiceLine, spiceLine2].filter(Boolean).join(' ');
  if (!tail) return { error: `${prefix} projection has no Value/SpiceModel netlist tail` };
  let inSubcircuit = false;
  const definitions = drawing.directives.filter(source => {
    if (/^\.subckt\b/i.test(source)) { inSubcircuit = true; return true; }
    if (/^\.ends\b/i.test(source)) { inSubcircuit = false; return true; }
    return inSubcircuit || /^\.(?:model|param|params|func|temp|options?)\b/i.test(source);
  });
  const deck = ['LTspice ASC electrical projection', ...definitions,
    `${instance.ref} ${cardNodes.join(' ')} ${tail}`, '.end'].join('\n');
  const imported = importSpice(deck, { libraries: options?.libraries || options?.spiceLibraries || [] });
  let consumedDefinitions = [];
  if (prefix === 'Q' || prefix === 'M') {
    const modelName = value.split(/\s+/, 1)[0].toLowerCase();
    consumedDefinitions = definitions.filter(source => {
      const parsed = /^\.model\b(.*)$/is.exec(source);
      return parsed && parseSpiceModelDeclaration(parsed[1])?.name.toLowerCase() === modelName;
    });
  } else if (prefix === 'X') {
    const subcircuit = value.split(/\s+/, 1)[0].toLowerCase();
    let keep = false;
    consumedDefinitions = definitions.filter(source => {
      const start = /^\.subckt\s+(\S+)/i.exec(source);
      if (start) keep = start[1].toLowerCase() === subcircuit;
      const retained = keep;
      if (/^\.ends\b/i.test(source)) keep = false;
      return retained;
    });
  }
  return { prefix, nodes, cardNodes, deck, consumedDefinitions, imported };
}

/** Build format-level connectivity without requiring a bw-board device kind. */
function buildSourceDocument(drawing, options, symbolAssets) {
  const findings = [...drawing.findings];
  const dependencies = [];
  const dependencyKeys = new Set();
  const net = new NetSolver();
  drawing.wires.forEach(([x1, y1, x2, y2]) => net.addSegment(x1, y1, x2, y2));
  drawing.flags.forEach(flag => net.addName(flag.x, flag.y,
    flag.name === '0' ? '__LTSPICE_GND__' : flag.name.toLowerCase()));

  const instances = drawing.symbols.map((symbol, index) => {
    const spec = nativeSymbolSpec(symbol.lib);
    const pinOnly = pinOnlySymbolSpec(symbol.lib);
    const asset = symbolAsset(symbol.lib, options, symbolAssets);
    const definition = documentPinDefinition(symbol, asset, spec, pinOnly);
    const effectiveAttrs = { ...(asset.document?.ok ? asset.document.attrs : {}), ...symbol.attrs };
    const normalizedName = asset.normalizedName || normalizeLtspiceSymbolName(symbol.lib) || symbol.lib;
    if (!dependencyKeys.has(normalizedName)) {
      dependencyKeys.add(normalizedName);
      dependencies.push({ kind: 'symbol', name: normalizedName, status: definition.status,
        ...(definition.pinContract ? { pinContract: definition.pinContract } : {}),
        ...(definition.family ? { family: definition.family } : {}),
        ...(asset.declaredSha256 ? { declaredSha256: asset.declaredSha256 } : {}),
        ...(definition.reason ? { reason: definition.reason } : {}),
        ...(asset.document ? { document: asset.document } : {}) });
    }
    for (const field of ['spicemodel', 'modelfile']) {
      const declared = String(effectiveAttrs[field] || '').trim();
      if (!declared) continue;
      const key = `model-file:${declared.toLowerCase()}`;
      if (dependencyKeys.has(key)) continue;
      dependencyKeys.add(key);
      dependencies.push({ kind: 'spice-library', name: declared, declaredBy: `ASY/SYMATTR ${field}`,
        status: 'not-resolved', reason: 'symbol model-file attributes never trigger path or network reads' });
    }
    const instanceId = `asc-symbol-${index + 1}`;
    const pins = definition.pins.map(pin => {
      const absolute = placeLtspicePin(pin.x, pin.y, symbol);
      if (!absolute) {
        findings.push({ kind: 'unsupported-symbol-orientation', line: symbol.line,
          ref: symbol.attrs.instname || instanceId,
          reason: `orientation ${symbol.orientation} cannot place ${normalizedName} pins` });
        return { ...pin, absolute: null, netId: null };
      }
      net.addPoint(absolute[0], absolute[1]);
      return { ...pin, absolute, netId: null };
    });
    if (!pins.length) findings.push({ kind: definition.status === 'refused'
      ? 'refused-symbol-pin-definition' : 'missing-symbol-pin-definition', line: symbol.line,
      ref: symbol.attrs.instname || instanceId,
      reason: `${normalizedName}: ${definition.reason || 'no pin definition'}` });
    return { id: instanceId, ref: symbol.attrs.instname || null, library: symbol.lib,
      normalizedLibrary: normalizedName, x: symbol.x, y: symbol.y,
      orientation: symbol.orientation, line: symbol.line, attrs: { ...symbol.attrs },
      effectiveAttrs,
      attributeRecords: symbol.attributeRecords.map(record => ({ ...record })),
      windows: symbol.windows.map(record => ({ ...record })), definitionStatus: definition.status,
      pinStatus: pins.length ? 'recovered' : definition.status,
      ...(definition.pinContract ? { pinContract: definition.pinContract } : {}),
      ...(definition.family ? { pinFamily: definition.family } : {}), pins };
  });
  const instanceRefs = new Map();
  for (const instance of instances) {
    if (!instance.ref) continue;
    const folded = instance.ref.toLowerCase();
    if (instanceRefs.has(folded)) findings.push({ kind: 'duplicate-instance-name',
      line: instance.line, ref: instance.ref,
      reason: `InstName ${instance.ref} is also used by ${instanceRefs.get(folded)}` });
    else instanceRefs.set(folded, instance.id);
  }

  net.solve();
  const roots = new Map();
  const ensure = root => {
    if (root == null) return null;
    if (!roots.has(root)) roots.set(root, { root, aliases: [], terminals: [], points: [] });
    return roots.get(root);
  };
  drawing.wires.forEach(coordinates => {
    ensure(net.netAt(coordinates[0], coordinates[1]))?.points.push(coordinates.slice(0, 2));
    ensure(net.netAt(coordinates[2], coordinates[3]))?.points.push(coordinates.slice(2, 4));
  });
  drawing.flags.forEach(flag => {
    const group = ensure(net.netAt(flag.x, flag.y));
    if (group && !group.aliases.includes(flag.name)) group.aliases.push(flag.name);
  });
  instances.forEach(instance => instance.pins.forEach(pin => {
    if (!pin.absolute) return;
    const group = ensure(net.netAt(pin.absolute[0], pin.absolute[1]));
    if (!group) return;
    group.terminals.push({ instanceId: instance.id, ref: instance.ref,
      spiceOrder: pin.spiceOrder, pinName: pin.pinName });
  }));
  const nets = [...roots.values()].map((group, index) => ({
    id: `asc-net-${index + 1}`,
    name: group.aliases.includes('0') ? '0' : group.aliases[0] || null,
    aliases: group.aliases,
    terminals: group.terminals,
    points: group.points,
  }));
  const idByRoot = new Map([...roots.keys()].map((root, index) => [root, `asc-net-${index + 1}`]));
  instances.forEach(instance => instance.pins.forEach(pin => {
    if (pin.absolute) pin.netId = idByRoot.get(net.netAt(pin.absolute[0], pin.absolute[1])) || null;
  }));
  for (const item of nets) {
    const folded = new Set(item.aliases.map(alias => alias === '0' ? '0' : alias.toLowerCase()));
    if (folded.size > 1) findings.push({ kind: 'conflicting-net-labels', line: 0,
      reason: `one geometric net carries distinct aliases: ${item.aliases.join(', ')}`, netId: item.id });
  }
  const includes = drawing.directives.filter(source => /^\.(?:include|inc|lib)\b/i.test(source));
  includes.forEach(source => dependencies.push({ kind: 'spice-library', name: source,
    status: 'not-resolved', reason: 'ASC import never opens directive paths' }));
  return {
    format: 'ltspice-asc', ok: drawing.ok, version: drawing.version,
    encoding: drawing.encoding, sheet: drawing.sheet, rawText: drawing.rawText,
    records: drawing.records.map(record => ({ ...record })),
    instances, nets,
    texts: drawing.texts.map(record => ({ ...record })),
    directives: drawing.directives.map(source => ({ source })),
    dependencies, findings,
    stats: {
      records: drawing.records.length, symbols: instances.length,
      pinsRecovered: instances.reduce((sum, instance) => sum + instance.pins.length, 0),
      symbolsWithPins: instances.filter(instance => instance.pins.length).length,
      wires: drawing.wires.length, flags: drawing.flags.length, nets: nets.length,
      unknownRecords: drawing.unknownLines.length,
    },
  };
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
  const drawing = parseLtspiceAscDocument(text, options);
  const sourceDocument = buildSourceDocument(drawing, options, symbolAssets);
  sourceDocument.electricalProjection = { mappedInstances: [], refusedInstances: [] };
  if (!drawing.ok) {
    sourceDocument.electricalProjection.status = 'invalid-source-document';
    sourceDocument.electricalProjection.numericStatus = 'blocked-before-projection';
    sourceDocument.instances.forEach(instance => { instance.electricalStatus = 'not-projected-invalid-document'; });
    return { parts, wires: [], warnings: ['Not an LTspice Version 4 ASCII schematic.'],
      unmapped, losses, ignored, analyses, sourceDirectives, netNames: [], sourceSymbols,
      sourceDocument };
  }
  const ascModels = collectAscModels(drawing.directives);
  const sourceModels = sourceModelMap(drawing.directives);
  const diodeThermal = classifyAscShockleyThermal(drawing.directives);
  const usedModelDirectiveIndexes = new Set();
  const blockedModelDirectiveIndexes = new Set();
  let mappedDiodeCount = 0;
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
  const projectedMemberships = [];
  const projectedWires = [];
  const usedProjectionDirectives = new Set();
  const used = new Set();
  for (const [symbolIndex, symbol] of drawing.symbols.entries()) {
    const spec = nativeSymbolSpec(symbol.lib);
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
      const instance = sourceDocument.instances[symbolIndex];
      const projected = instance?.pins.length ? projectableCard(instance, drawing, options) : null;
      if (projected && !projected.error && projected.imported.parts.length
          && !projected.imported.unmapped.length
          && projected.imported.parts.every(part => !used.has(part.id))) {
        const projectionLosses = [...projected.imported.losses,
          ...instanceProjectionLosses(projected.prefix, instance)];
        const modelLoss = modelProjectionLoss(projected.prefix,
          instance.effectiveAttrs, sourceModels, instance.ref);
        if (modelLoss) projectionLosses.push(modelLoss);
        const blockers = projectionLosses.map(loss => ({ type: 'semantic-import-loss', ...loss }));
        for (const [partIndex, projectedPart] of projected.imported.parts.entries()) {
          used.add(projectedPart.id);
          parts.push({ ...projectedPart, x: symbol.x + partIndex * 24, y: symbol.y + partIndex * 24,
            sourceInstance: instance.id,
            ...(blockers.length ? { analysisBlockers: [
              ...(projectedPart.analysisBlockers || []), ...blockers,
            ] } : {}) });
        }
        projectedWires.push(...projected.imported.wires);
        projected.consumedDefinitions.forEach(source => usedProjectionDirectives.add(source));
        for (const [pinIndex, pin] of instance.pins.entries()) {
          const named = projected.imported.netNames.find(item =>
            item.name.toLowerCase() === projected.nodes[pinIndex].toLowerCase());
          if (!pin.absolute || !named) continue;
          net.addPoint(pin.absolute[0], pin.absolute[1]);
          projectedMemberships.push({ x: pin.absolute[0], y: pin.absolute[1],
            members: named.terminals.map(member => ({
              part: member.partId, terminal: member.terminal,
            })) });
        }
        losses.push(...projectionLosses);
        warnings.push(...projected.imported.warnings.map(message => `${instance.ref}: ${message}`));
        sourceDocument.electricalProjection.mappedInstances.push({ instanceId: instance.id,
          ref: instance.ref, prefix: projected.prefix,
          partIds: projected.imported.parts.map(part => part.id),
          card: projected.deck.split('\n').at(-2), losses: projectionLosses.length,
          numericStatus: projectionLosses.length ? 'blocked-model-or-instance-semantics' : 'candidate-native-model' });
        instance.electricalStatus = projectionLosses.length ? 'mapped-with-analysis-blockers' : 'mapped';
        instance.nativePartIds = projected.imported.parts.map(part => part.id);
        if (sourceSymbolRecord) sourceSymbolRecord.electricalStatus = projectionLosses.length
          ? 'mapped-with-analysis-blockers' : 'mapped-existing-native-kind';
        continue;
      }
      const projectionReason = projected?.error
        || (projected?.imported.unmapped || []).map(item => item.libsource).join('; ')
        || (instance?.pins.length ? 'effective Prefix is not supported by the native/SPICE projection'
          : 'no symbol pin definition is available');
      unmapped.push({ ref, value: effectiveAttrs.value || '',
        libsource: `${symbol.lib}: ${projectionReason}`,
        ...(asset.supplied ? { sourceSymbol: asset.normalizedName || String(symbol.lib) } : {}) });
      warnings.push(`Unmapped LTspice symbol: ${ref} (${symbol.lib})`);
      sourceDocument.electricalProjection.refusedInstances.push({ instanceId: instance?.id,
        ref: instance?.ref, reason: projectionReason });
      if (instance) instance.electricalStatus = 'refused';
      if (sourceSymbolRecord) sourceSymbolRecord.electricalStatus = 'refused-electrical-projection';
      continue;
    }
    if (definition.error) {
      unmapped.push({ ref, value: effectiveAttrs.value || '',
        libsource: `${symbol.lib}: ${definition.error}`,
        ...(asset.supplied ? { sourceSymbol: asset.normalizedName || String(symbol.lib) } : {}) });
      warnings.push(`${ref}: supplied LTspice symbol definition refused: ${definition.error}`);
      sourceDocument.electricalProjection.refusedInstances.push({
        instanceId: sourceDocument.instances[symbolIndex]?.id, ref, reason: definition.error });
      sourceDocument.instances[symbolIndex].electricalStatus = 'refused';
      continue;
    }
    const expectedPrefix = STANDARD_PREFIX[spec.kind];
    if (effectiveAttrs.prefix != null
        && String(effectiveAttrs.prefix).toUpperCase() !== expectedPrefix) {
      unmapped.push({ ref, value: effectiveAttrs.value || '',
        libsource: `${symbol.lib}: effective Prefix must be ${expectedPrefix}; instance attributes take precedence`,
        ...(asset.supplied ? { sourceSymbol: asset.normalizedName || String(symbol.lib) } : {}) });
      warnings.push(`${ref}: LTspice Prefix ${effectiveAttrs.prefix} does not match ${expectedPrefix}`);
      sourceDocument.electricalProjection.refusedInstances.push({
        instanceId: sourceDocument.instances[symbolIndex]?.id, ref,
        reason: `effective Prefix must be ${expectedPrefix}` });
      sourceDocument.instances[symbolIndex].electricalStatus = 'refused';
      continue;
    }
    const pins = definition.pins.map(([px, py]) => placeLtspicePin(px, py, symbol));
    if (pins.some(pin => pin === null)) {
      unmapped.push({ ref, value: symbol.attrs.value || '',
        libsource: `${symbol.lib}: unsupported orientation ${symbol.orientation}` });
      warnings.push(`${ref}: unsupported LTspice orientation ${symbol.orientation}`);
      sourceDocument.electricalProjection.refusedInstances.push({
        instanceId: sourceDocument.instances[symbolIndex]?.id, ref,
        reason: `unsupported orientation ${symbol.orientation}` });
      sourceDocument.instances[symbolIndex].electricalStatus = 'refused';
      continue;
    }
    if (!effectiveAttrs.instname) {
      unmapped.push({ ref, value: effectiveAttrs.value || '', libsource: `${symbol.lib}: missing InstName` });
      warnings.push(`${symbol.lib} at line ${symbol.line}: missing InstName`);
      sourceDocument.electricalProjection.refusedInstances.push({
        instanceId: sourceDocument.instances[symbolIndex]?.id, ref, reason: 'missing InstName' });
      sourceDocument.instances[symbolIndex].electricalStatus = 'refused';
      continue;
    }
    const id = makeId(ref, used);
    const authored = spec.kind === 'diode'
      ? authoredDiode(effectiveAttrs.value, ascModels, diodeThermal)
      : authoredParams(effectiveAttrs.value, spec, constantParameters.values);
    if (spec.kind === 'diode') {
      mappedDiodeCount++;
      for (const index of authored.model?.indexes || []) {
        usedModelDirectiveIndexes.add(index);
        if (authored.reason) blockedModelDirectiveIndexes.add(index);
      }
    }
    if (!authored.reason && spec.kind === 'inductor' && !(authored.params.henrys > 0)) {
      authored.reason = 'inductor Value must resolve to a positive finite scalar';
      authored.params = {};
    }
    const params = authored.params;
    const partBlockers = [];
    if (authored.reason) {
      const loss = { ref: id, kind: spec.kind === 'diode'
        ? 'unsupported-diode-model' : 'unsupported-or-missing-static-value',
        source: authored.source || symbol.source,
        reason: authored.reason, fallback: null };
      losses.push(loss);
      partBlockers.push({ type: 'semantic-import-loss', ...loss });
      warnings.push(spec.kind === 'diode'
        ? `${id}: diode model is retained but not numerically approximated`
        : `${id}: non-static or missing value is not approximated`);
    } else if (spec.kind === 'diode' && !diodeThermal.explicit) {
      warnings.push(`${id}: omitted SPICE TEMP/TNOM uses bw-board's fixed VT=0.02585 V profile; raw default-temperature source fidelity is not established.`);
    }
    for (const [name, attributeValue] of Object.entries(effectiveAttrs)) {
      if (name === 'instname' || name === 'value' || name === 'prefix') continue;
      const loss = { ref: id, kind: 'unsupported-symbol-attribute',
        source: `${Object.prototype.hasOwnProperty.call(symbol.attrs, name) ? 'SYMATTR' : 'ASY SYMATTR'} ${name} ${attributeValue}`,
        reason: `the bounded ASC importer does not interpret ${name}`, fallback: null };
      losses.push(loss);
      partBlockers.push({ type: 'semantic-import-loss', ...loss });
      if (spec.kind === 'diode') {
        params._spiceBlocked ||= `unsupported LTspice diode instance attribute ${name}`;
        if (authored.model?.source) params._spiceModel ||= authored.model.source;
      }
      warnings.push(`${id}: unsupported LTspice symbol attribute ${name} is retained as a loss`);
    }
    parts.push({ id, kind: spec.kind, params, x: symbol.x, y: symbol.y,
      sourceInstance: sourceDocument.instances[symbolIndex]?.id,
      ...(partBlockers.length ? { analysisBlockers: partBlockers } : {}) });
    sourceDocument.electricalProjection.mappedInstances.push({
      instanceId: sourceDocument.instances[symbolIndex]?.id, ref, prefix: expectedPrefix,
      partIds: [id], mapping: spec.aliasOf ? `native-alias:${spec.aliasOf}` : 'native-standard',
      losses: partBlockers.length,
      numericStatus: partBlockers.length ? 'blocked-model-or-instance-semantics' : 'candidate-native-model' });
    sourceDocument.instances[symbolIndex].electricalStatus = partBlockers.length
      ? 'mapped-with-analysis-blockers' : 'mapped';
    sourceDocument.instances[symbolIndex].nativePartIds = [id];
    pins.forEach(([x, y], index) => net.addPoint(x, y));
    placements.push({ id, spec, pins });
  }

  for (const [directiveIndex, directive] of drawing.directives.entries()) {
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
    if (usedProjectionDirectives.has(directive)) {
      sourceDirectives.push({ source: directive,
        kind: /^\.model\b/i.test(directive) ? 'model-definition' : 'subcircuit-definition',
        handling: 'shared-spice-projection' });
      ignored.push({ source: directive, reason: 'consumed by a shared SPICE electrical projection' });
      continue;
    }
    if (usedModelDirectiveIndexes.has(directiveIndex)) {
      sourceDirectives.push({ source: directive, kind: 'model-definition',
        handling: blockedModelDirectiveIndexes.has(directiveIndex)
          ? 'unsupported' : 'strict-diode-model' });
      ignored.push({ source: directive, reason: blockedModelDirectiveIndexes.has(directiveIndex)
        ? 'retained by the diode model refusal'
        : 'consumed by a mapped strict Shockley diode' });
      continue;
    }
    if (mappedDiodeCount && (/^\.temp\b/i.test(directive)
        || /^\.options?\b.*\b(?:temp|tnom)\b/i.test(directive))) {
      sourceDirectives.push({ source: directive, kind: 'temperature-profile',
        handling: diodeThermal.ok ? 'fixed-diode-thermal' : 'unsupported' });
      ignored.push({ source: directive, reason: diodeThermal.ok
        ? 'consumed by the fixed Shockley diode profile'
        : 'retained by the diode model refusal' });
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
  for (const projected of projectedMemberships) {
    const netId = net.netAt(projected.x, projected.y);
    for (const member of projected.members) join(netId, member.part, member.terminal);
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
  resolved.wires.push(...projectedWires);
  const mappedPinCount = placements.reduce((sum, placement) => sum + placement.pins.length, 0);
  warnings.push(`geometry: ${attached}/${mappedPinCount} mapped pins landed on a wire or flag `
    + `(${resolved.nets} connected nets, ${drawing.flags.length} flags)`);
  if (floating) warnings.push(`${floating} mapped pin(s) are electrically floating`);
  if (!parts.length) warnings.push('No mappable components found in LTspice ASC schematic.');
  const mappedCount = sourceDocument.electricalProjection.mappedInstances.length;
  const refusedCount = sourceDocument.electricalProjection.refusedInstances.length;
  sourceDocument.electricalProjection.status = !mappedCount ? 'no-native-projection'
    : refusedCount ? 'partial-native-projection'
      : losses.length ? 'complete-projection-with-analysis-blockers' : 'complete-native-projection';
  sourceDocument.electricalProjection.numericStatus = !mappedCount ? 'no-native-parts'
    : (refusedCount || unmapped.length || losses.length) ? 'blocked-import-semantics'
      : 'candidate-requires-analysis-validation';
  sourceDocument.electricalProjection.mappedParts = parts.filter(part => part.kind !== 'gnd').length;
  sourceDocument.electricalProjection.semanticLosses = losses.length;
  sourceDocument.projectionSnapshot = sourceDocumentProjection(parts, resolved.wires);
  return { parts, wires: resolved.wires, warnings, unmapped, losses, ignored,
    analyses, sourceDirectives, netNames, sourceSymbols, sourceDocument };
}
