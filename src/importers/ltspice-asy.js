/**
 * Pure, bounded reader for LTspice Version 4 symbol documents (.asy).
 *
 * This module never opens a path, follows an include, or performs network I/O.
 * Callers supply the complete symbol text.  The reader preserves drawing
 * records as document metadata, but only PIN/PINATTR and SYMATTR records have
 * electrical meaning to the ASC importer.
 */

const DEFAULT_LIMITS = Object.freeze({
  maxBytes: 1024 * 1024,
  maxLines: 10000,
  maxPins: 256,
  maxAttributes: 1024,
  maxGeometryRecords: 10000,
});

const GEOMETRY = new Set([
  'LINE', 'RECTANGLE', 'CIRCLE', 'ARC', 'TEXT', 'WINDOW', 'POLYLINE', 'POLYGON',
]);

function boundedInteger(value, fallback, ceiling) {
  return Number.isSafeInteger(value) && value > 0 ? Math.min(value, ceiling) : fallback;
}

function limitsFrom(options) {
  const given = options?.limits || {};
  return {
    maxBytes: boundedInteger(given.maxBytes, DEFAULT_LIMITS.maxBytes, DEFAULT_LIMITS.maxBytes),
    maxLines: boundedInteger(given.maxLines, DEFAULT_LIMITS.maxLines, DEFAULT_LIMITS.maxLines),
    maxPins: boundedInteger(given.maxPins, DEFAULT_LIMITS.maxPins, DEFAULT_LIMITS.maxPins),
    maxAttributes: boundedInteger(given.maxAttributes, DEFAULT_LIMITS.maxAttributes, DEFAULT_LIMITS.maxAttributes),
    maxGeometryRecords: boundedInteger(given.maxGeometryRecords,
      DEFAULT_LIMITS.maxGeometryRecords, DEFAULT_LIMITS.maxGeometryRecords),
  };
}

function byteLength(text) {
  return typeof TextEncoder === 'function' ? new TextEncoder().encode(text).byteLength : text.length;
}

function finding(kind, line, reason, source = '') {
  return { kind, line, reason, ...(source ? { source } : {}) };
}

function setAttribute(target, records, key, value, line, findings, owner) {
  const folded = key.toLowerCase();
  if (Object.prototype.hasOwnProperty.call(target, folded)) {
    findings.push(finding('duplicate-asy-attribute', line,
      `${owner} repeats SYMATTR/PINATTR ${key}; the electrical meaning is ambiguous`));
    return;
  }
  target[folded] = value;
  records.push({ name: key, value, line });
}

/**
 * Parse caller-supplied LTspice Version 4 .asy text.
 *
 * `ok` means the document is structurally safe to consume. Unsupported
 * drawing records remain in `findings`/`geometry`; they never become circuit
 * equations. Pins retain source order and expose validated `spiceOrder`.
 */
export function parseLtspiceAsy(text, options = {}) {
  const findings = [];
  const attrs = {};
  const attributeRecords = [];
  const pins = [];
  const geometry = [];
  let symbolType = null;
  let version = null;

  if (typeof text !== 'string') {
    return { ok: false, version, symbolType, attrs, attributeRecords, pins, geometry,
      findings: [finding('invalid-asy-input', 0, 'symbol text must be a string')] };
  }
  const limits = limitsFrom(options);
  if (byteLength(text) > limits.maxBytes) {
    return { ok: false, version, symbolType, attrs, attributeRecords, pins, geometry,
      findings: [finding('asy-limit-exceeded', 0,
        `symbol text exceeds the ${limits.maxBytes}-byte limit`)] };
  }
  if (text.includes('\0')) {
    return { ok: false, version, symbolType, attrs, attributeRecords, pins, geometry,
      findings: [finding('invalid-asy-input', 0, 'symbol text contains a NUL byte')] };
  }

  const lines = text.replace(/\r\n/g, '\n').split('\n');
  if (lines.length > limits.maxLines) {
    return { ok: false, version, symbolType, attrs, attributeRecords, pins, geometry,
      findings: [finding('asy-limit-exceeded', 0,
        `symbol document exceeds the ${limits.maxLines}-line limit`)] };
  }
  let currentPin = null;
  let attributesSeen = 0;
  for (let index = 0; index < lines.length; index++) {
    const lineNumber = index + 1;
    const source = lines[index].trim();
    if (!source) continue;
    let match;
    if ((match = /^Version\s+(\d+)$/i.exec(source))) {
      if (version !== null) findings.push(finding('duplicate-asy-version', lineNumber,
        'symbol document contains more than one Version record', source));
      else version = Number(match[1]);
      currentPin = null;
    } else if ((match = /^SymbolType\s+(\S+)$/i.exec(source))) {
      if (symbolType !== null) findings.push(finding('duplicate-asy-symbol-type', lineNumber,
        'symbol document contains more than one SymbolType record', source));
      else symbolType = match[1];
      currentPin = null;
    } else if ((match = /^SYMATTR\s+(\S+)\s*(.*)$/i.exec(source))) {
      attributesSeen++;
      setAttribute(attrs, attributeRecords, match[1], match[2], lineNumber, findings, 'symbol');
      currentPin = null;
    } else if ((match = /^PIN\s+(-?\d+)\s+(-?\d+)\s+(\S+)\s+(-?\d+)$/i.exec(source))) {
      if (pins.length >= limits.maxPins) {
        findings.push(finding('asy-limit-exceeded', lineNumber,
          `symbol has more than ${limits.maxPins} pins`, source));
        currentPin = null;
        continue;
      }
      const coordinates = [Number(match[1]), Number(match[2]), Number(match[4])];
      if (!coordinates.every(Number.isSafeInteger)) findings.push(finding(
        'invalid-asy-coordinate', lineNumber, 'PIN coordinates and label offset must be safe integers', source));
      currentPin = {
        x: coordinates[0], y: coordinates[1], orientation: match[3],
        labelOffset: coordinates[2], attrs: {}, attributeRecords: [], line: lineNumber,
      };
      pins.push(currentPin);
    } else if ((match = /^PINATTR\s+(\S+)\s*(.*)$/i.exec(source))) {
      attributesSeen++;
      if (!currentPin) findings.push(finding('orphan-asy-pin-attribute', lineNumber,
        'PINATTR does not immediately follow a PIN record', source));
      else setAttribute(currentPin.attrs, currentPin.attributeRecords, match[1], match[2],
        lineNumber, findings, `pin at line ${currentPin.line}`);
    } else {
      const [record] = source.split(/\s+/, 1);
      if (GEOMETRY.has(record.toUpperCase())) {
        if (geometry.length >= limits.maxGeometryRecords) findings.push(finding(
          'asy-limit-exceeded', lineNumber,
          `symbol has more than ${limits.maxGeometryRecords} drawing records`, source));
        else geometry.push({ type: record.toUpperCase(), line: lineNumber,
          fields: source.slice(record.length).trim() });
      } else findings.push(finding('unsupported-asy-record', lineNumber,
        `unsupported ASY record ${record}`, source));
      currentPin = null;
    }
    if (attributesSeen > limits.maxAttributes) {
      findings.push(finding('asy-limit-exceeded', lineNumber,
        `symbol has more than ${limits.maxAttributes} attributes`));
      break;
    }
  }

  if (version !== 4) findings.push(finding('unsupported-asy-version', 0,
    version === null ? 'symbol document has no Version record' : `Version ${version} is not supported`));
  if (!symbolType) findings.push(finding('missing-asy-symbol-type', 0,
    'symbol document has no SymbolType record'));

  for (const pin of pins) {
    const raw = pin.attrs.spiceorder;
    pin.pinName = pin.attrs.pinname ?? null;
    const order = /^\d+$/.test(raw || '') ? Number(raw) : NaN;
    pin.spiceOrder = Number.isSafeInteger(order) && order > 0 ? order : null;
    if (pin.spiceOrder === null) findings.push(finding('invalid-asy-spice-order', pin.line,
      'every electrically used pin needs one positive integer SpiceOrder'));
  }
  const orders = pins.map(pin => pin.spiceOrder).filter(order => order !== null);
  if (new Set(orders).size !== orders.length) findings.push(finding('duplicate-asy-spice-order', 0,
    'SpiceOrder values must be unique'));

  const fatalKinds = new Set([
    'invalid-asy-input', 'asy-limit-exceeded', 'duplicate-asy-version',
    'duplicate-asy-symbol-type', 'duplicate-asy-attribute', 'orphan-asy-pin-attribute',
    'unsupported-asy-version', 'missing-asy-symbol-type', 'invalid-asy-spice-order',
    'duplicate-asy-spice-order', 'invalid-asy-coordinate', 'unsupported-asy-record',
  ]);
  return { ok: !findings.some(item => fatalKinds.has(item.kind)), version, symbolType,
    attrs, attributeRecords, pins, geometry, findings };
}

/** Reject paths/URLs before handing a library key to a caller resolver. */
export function normalizeLtspiceSymbolName(name) {
  const value = String(name || '').replace(/\\/g, '/').trim();
  if (!value || value.length > 256 || value.includes('\0') || value.startsWith('/')
      || /^[a-z][a-z0-9+.-]*:/i.test(value)
      || value.split('/').some(part => part === '..' || part === '')) return null;
  return value.toLowerCase();
}
