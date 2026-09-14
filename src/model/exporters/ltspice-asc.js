/** Bounded LTspice Version-4 ASCII schematic serializer. */
import { wireEndpoint, isBoardEndpoint } from '../wire-endpoints.js';
import { parseSpiceValue } from '../si.js';

const SPECS = {
  resistor: { lib: 'res', parameter: 'ohms', allowed: ['ohms'], terminals: { a: [16, 16], b: [16, 96] } },
  capacitor: { lib: 'cap', parameter: 'farads', allowed: ['farads'], terminals: { a: [16, 0], b: [16, 64] } },
  inductor: { lib: 'ind', parameter: 'henrys', allowed: ['henrys'], terminals: { a: [16, 16], b: [16, 96] } },
  vsource: { lib: 'voltage', parameter: 'volts', allowed: ['volts'], terminals: { pos: [0, 16], neg: [0, 96] } },
  // LTspice order 1 -> 2 is native neg -> pos for an independent current source.
  isource: { lib: 'current', parameter: 'amps', allowed: ['amps'], terminals: { neg: [0, 0], pos: [0, 80] } },
  diode: { lib: 'diode', allowed: ['is', 'n', 'rs', 'vf', 'model', '_model'],
    terminals: { anode: [16, 0], cathode: [16, 64] }, modelType: 'D' },
  npn: { lib: 'bw_npn', prefix: 'Q', allowed: ['beta', 'is', 'br', 'n', 'model', '_model'],
    pinList: [['collector', 0, 0], ['base', 0, 32], ['emitter', 0, 64]], modelType: 'NPN' },
  pnp: { lib: 'bw_pnp', prefix: 'Q', allowed: ['beta', 'is', 'br', 'n', 'model', '_model'],
    pinList: [['collector', 0, 0], ['base', 0, 32], ['emitter', 0, 64]], modelType: 'PNP' },
  nmos: { lib: 'bw_nmos', prefix: 'M', allowed: ['vth', 'kp', 'lambda', 'w', 'l', '_model'],
    pinList: [['drain', 0, 0], ['gate', 0, 24], ['source', 0, 48], ['source', 0, 64]], modelType: 'NMOS' },
  pmos: { lib: 'bw_pmos', prefix: 'M', allowed: ['vth', 'kp', 'lambda', 'w', 'l', '_model'],
    pinList: [['drain', 0, 0], ['gate', 0, 24], ['source', 0, 48], ['source', 0, 64]], modelType: 'PMOS' },
  vcvs: { lib: 'bw_vcvs', prefix: 'E', parameter: 'gain', allowed: ['gain'],
    pinList: [['outp', 0, 0], ['outn', 0, 24], ['inp', 64, 0], ['inn', 64, 24]] },
  vccs: { lib: 'bw_vccs', prefix: 'G', parameter: 'gm', allowed: ['gm'],
    pinList: [['outn', 0, 0], ['outp', 0, 24], ['inp', 64, 0], ['inn', 64, 24]] },
};

const endpointKey = (part, terminal) => `${part}\u0000${terminal}`;
const scalar = value => Number.isFinite(value) ? (Object.is(value, -0) ? '0' : String(value)) : null;

function equivalentAuthoredValue(params, parameter) {
  const source = String(params?._value || '').trim();
  if (!source) return null;
  const parsed = parseSpiceValue(source);
  const projected = params?.[parameter];
  if (!Number.isFinite(parsed) || !Number.isFinite(projected)) return null;
  const scale = Math.max(1, Math.abs(parsed), Math.abs(projected));
  return Math.abs(parsed - projected) <= Number.EPSILON * 8 * scale ? source : null;
}

function retainedDocument(circuit) {
  const documents = [circuit.sourceDocument, ...(circuit.sourceDocuments || [])].filter(Boolean);
  return documents.find(document => document.format === 'ltspice-asc'
    && typeof document.rawText === 'string' && document.projectionSnapshot);
}

function sameProjection(circuit, document) {
  return JSON.stringify({ parts: circuit.parts || [], wires: circuit.wires || [] })
    === JSON.stringify(document.projectionSnapshot);
}

const finiteFields = (params, names) => names.every(name => Number.isFinite(params[name]));
const safeModelName = (part) => {
  const requested = String(part.params?._model || '').trim();
  return /^\S+$/.test(requested) ? requested : `BW_${String(part.id).replace(/[^A-Za-z0-9_]/g, '_')}_MODEL`;
};

function encodedPart(part, spec) {
  const params = part.params || {};
  if (!spec.modelType) {
    const authored = equivalentAuthoredValue(params, spec.parameter);
    const value = authored || scalar(params[spec.parameter]);
    return value === null ? { error: `missing or non-finite ${spec.parameter}` }
      : { value, directives: [], representedMetadata: authored ? ['_value'] : [] };
  }
  const modelName = safeModelName(part);
  if (spec.modelType === 'D') {
    if (params.model !== 'shockley' || !finiteFields(params, ['is', 'n', 'rs'])) {
      return { error: 'diode needs explicit finite Shockley IS/N/RS parameters' };
    }
    return { value: modelName, directives: [`.model ${modelName} D (IS=${params.is} N=${params.n} RS=${params.rs})`] };
  }
  if (spec.modelType === 'NPN' || spec.modelType === 'PNP') {
    if (params.model !== 'shockley' || !Number.isFinite(params.is)) {
      return { error: 'BJT needs an explicit Ebers-Moll saturation current' };
    }
    const fields = [`IS=${params.is}`];
    if (Number.isFinite(params.beta)) fields.push(`BF=${params.beta}`);
    if (Number.isFinite(params.br)) fields.push(`BR=${params.br}`);
    if (Number.isFinite(params.n)) fields.push(`NF=${params.n}`);
    return { value: modelName,
      directives: [`.model ${modelName} ${spec.modelType} (${fields.join(' ')})`] };
  }
  if (!finiteFields(params, ['vth', 'kp'])) return { error: 'MOSFET needs finite level-1 VTO and KP parameters' };
  const fields = ['LEVEL=1', `VTO=${params.vth}`, `KP=${params.kp}`];
  if (Number.isFinite(params.lambda)) fields.push(`LAMBDA=${params.lambda}`);
  const spiceLine = [Number.isFinite(params.w) ? `W=${params.w}` : '',
    Number.isFinite(params.l) ? `L=${params.l}` : ''].filter(Boolean).join(' ');
  return { value: modelName, spiceLine,
    directives: [`.model ${modelName} ${spec.modelType} (${fields.join(' ')})`] };
}

function genericSymbol(spec) {
  const lines = ['Version 4', 'SymbolType CELL'];
  const xs = spec.pinList.map(pin => pin[1]); const ys = spec.pinList.map(pin => pin[2]);
  lines.push(`RECTANGLE Normal ${Math.min(...xs) + 8} ${Math.min(...ys) - 8} ${Math.max(...xs) + 56} ${Math.max(...ys) + 8}`);
  spec.pinList.forEach(([terminal, x, y], index) => {
    lines.push(`PIN ${x} ${y} ${x < 32 ? 'LEFT' : 'RIGHT'} 8`,
      `PINATTR PinName ${terminal}`, `PINATTR SpiceOrder ${index + 1}`);
  });
  lines.push(`SYMATTR Prefix ${spec.prefix}`);
  return `${lines.join('\n')}\n`;
}

function terminalPoints(spec, terminal) {
  if (spec.pinList) return spec.pinList.filter(pin => pin[0] === terminal).map(pin => [pin[1], pin[2]]);
  return spec.terminals?.[terminal] ? [spec.terminals[terminal]] : [];
}

function netGroups(parts, wires, warnings) {
  const byId = new Map(parts.map(part => [part.id, part]));
  const parent = new Map();
  const find = key => {
    if (!parent.has(key)) parent.set(key, key);
    if (parent.get(key) !== key) parent.set(key, find(parent.get(key)));
    return parent.get(key);
  };
  const union = (a, b) => { const ra = find(a); const rb = find(b); if (ra !== rb) parent.set(ra, rb); };
  for (const wire of wires || []) {
    const from = wireEndpoint(wire, 'from'); const to = wireEndpoint(wire, 'to');
    if (!from || !to || isBoardEndpoint(from) || isBoardEndpoint(to)) {
      warnings.push(`Wire ${wire?.id || '(unnamed)'} has a board or unreadable endpoint and was not exported`);
      continue;
    }
    if (!byId.has(from.part) || !byId.has(to.part)) {
      warnings.push(`Wire ${wire?.id || '(unnamed)'} names a missing part and was not exported`);
      continue;
    }
    union(endpointKey(from.part, from.terminal), endpointKey(to.part, to.terminal));
  }
  const groups = new Map();
  for (const key of parent.keys()) {
    const root = find(key);
    if (!groups.has(root)) groups.set(root, []);
    const split = key.indexOf('\u0000');
    groups.get(root).push({ part: key.slice(0, split), terminal: key.slice(split + 1) });
  }
  return [...groups.values()];
}

/** Serialize standard R/C/static-V/static-I plus ground labels as interchange. */
export function toLtspiceAsc(circuit = {}) {
  const { parts = [], wires = [], analysisBlockers = [] } = circuit;
  const warnings = []; const skipped = []; const emitted = new Map();
  const modelDirectives = new Set(); const generatedSymbols = new Map();
  const retained = retainedDocument(circuit);
  if (retained && sameProjection({ parts, wires }, retained)) {
    if (retained.findings?.length) warnings.push(`${retained.findings.length} retained source-document finding(s) remain unresolved`);
    return { text: `${retained.rawText.replace(/\n*$/, '')}\n`, warnings, skipped,
      preservedSourceDocument: true };
  }
  if (retained) warnings.push('The circuit changed after ASC import; the retained source document was not replayed. A generated interchange schematic follows.');
  const lines = ['Version 4', 'SHEET 1 880 680'];
  if (analysisBlockers.length) warnings.push(`${analysisBlockers.length} persisted analysis blocker(s) are not represented in ASC`);
  const groundCount = parts.filter(part => part.kind === 'gnd').length;
  if (groundCount) warnings.push(`${groundCount} ground symbol instance(s) encoded as net label 0; symbol identity and layout are not preserved`);

  let ordinal = 0;
  for (const part of parts) {
    if (part.kind === 'gnd') continue;
    const spec = SPECS[part.kind]; const params = part.params || {};
    const encoding = spec ? encodedPart(part, spec) : null;
    const representedMetadata = new Set(encoding?.representedMetadata || []);
    const extra = Object.keys(params).filter(name => !spec?.allowed.includes(name)
      && !representedMetadata.has(name));
    const value = encoding?.value;
    if (!spec || encoding?.error || extra.length || part.analysisBlockers?.length || !/^[^\s\r\n]+$/.test(String(part.id || ''))) {
      const reason = !spec ? 'unsupported kind'
        : (encoding?.error || value == null) ? encoding?.error || 'value is not representable'
          : extra.length ? `unrepresented parameters: ${extra.join(', ')}`
            : part.analysisBlockers?.length ? 'persisted semantic blocker' : 'invalid LTspice instance name';
      skipped.push({ id: part.id, kind: part.kind, reason }); warnings.push(`${part.id || '(unnamed)'} (${part.kind}): ${reason}`);
      continue;
    }
    const x = 128 + ordinal++ * 160; const y = 128;
    emitted.set(part.id, { spec, x, y });
    lines.push(`SYMBOL ${spec.lib} ${x} ${y} R0`, `SYMATTR InstName ${part.id}`, `SYMATTR Value ${value}`);
    if (encoding.spiceLine) lines.push(`SYMATTR SpiceLine ${encoding.spiceLine}`);
    for (const directive of encoding.directives) modelDirectives.add(directive);
    if (spec.pinList) generatedSymbols.set(`${spec.lib}.asy`, genericSymbol(spec));
  }

  let netOrdinal = 0;
  for (const group of netGroups(parts, wires, warnings)) {
    const ground = group.some(member => parts.find(part => part.id === member.part)?.kind === 'gnd');
    const name = ground ? '0' : `_BW_NET_${++netOrdinal}`;
    for (const member of group) {
      const placement = emitted.get(member.part); if (!placement) continue;
      const pins = terminalPoints(placement.spec, member.terminal);
      if (!pins.length) { warnings.push(`${member.part}.${member.terminal}: terminal is not representable and was omitted`); continue; }
      for (const pin of pins) lines.push(`FLAG ${placement.x + pin[0]} ${placement.y + pin[1]} ${name}`);
    }
  }
  let directiveY = 560;
  for (const directive of modelDirectives) lines.push(`TEXT 32 ${directiveY += 16} Left 2 !${directive}`);
  return { text: `${lines.join('\n')}\n`, warnings, skipped,
    symbolFiles: [...generatedSymbols].map(([name, text]) => ({ name, text })) };
}
