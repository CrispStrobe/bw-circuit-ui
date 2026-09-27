/** Bounded LTspice Version-4 ASCII schematic serializer. */
import { wireEndpoint, isBoardEndpoint } from '../wire-endpoints.js';
import { parseSpiceValue } from '../si.js';
import { sourceDocumentProjection } from '../source-document-projection.js';

const SPECS = {
  resistor: { lib: 'res', parameter: 'ohms', allowed: ['ohms'], terminals: { a: [16, 16], b: [16, 96] } },
  capacitor: { lib: 'cap', parameter: 'farads', allowed: ['farads'], terminals: { a: [16, 0], b: [16, 64] } },
  inductor: { lib: 'ind', parameter: 'henrys', allowed: ['henrys'], terminals: { a: [16, 16], b: [16, 96] } },
  vsource: { lib: 'voltage', parameter: 'volts', allowed: ['volts'], terminals: { pos: [0, 16], neg: [0, 96] } },
  // LTspice order 1 -> 2 is native neg -> pos for an independent current source.
  isource: { lib: 'current', parameter: 'amps', allowed: ['amps'], terminals: { neg: [0, 0], pos: [0, 80] } },
  diode: { lib: 'diode', allowed: ['is', 'n', 'rs', 'vf', 'model', '_model'],
    terminals: { anode: [16, 0], cathode: [16, 64] }, modelType: 'D' },
  npn: { lib: 'npn', prefix: 'Q', allowed: ['beta', 'is', 'br', 'n', 'model', '_model'],
    pinList: [['collector', 64, 0], ['base', 0, 48], ['emitter', 64, 96]], modelType: 'NPN' },
  pnp: { lib: 'pnp', prefix: 'Q', allowed: ['beta', 'is', 'br', 'n', 'model', '_model'],
    pinList: [['collector', 64, 0], ['base', 0, 48], ['emitter', 64, 96]], modelType: 'PNP' },
  // Standard three-pin MOS symbols make the substrate-to-source connection
  // internally; the importer reconstructs the repeated fourth SPICE node.
  //
  // `bulkOnSource` is therefore REPRESENTED, and exactly: it is the statement
  // that the deck ties the bulk to the source, which is the one bulk wiring
  // this symbol can draw. Listing it as unrepresented would refuse every
  // MOSFET the symbol exists for. `bulkAtGround` is the case that cannot be
  // drawn, and it is absent from this list for that reason -- see
  // `unrepresentedReason`.
  //
  // `gamma`/`phi`/`bulkIs` are represented by the emitted `.model` card, which
  // is where GAMMA/PHI/IS live in a level-1 MOS model. 1,296 of the 12,471 ADI
  // v3 decks declare GAMMA and PHI; before they were emitted, every one of
  // those MOSFETs was refused for carrying a parameter the card can hold.
  nmos: { lib: 'nmos', prefix: 'M',
    allowed: ['vth', 'kp', 'lambda', 'w', 'l', 'model', '_model', 'bulkOnSource', 'gamma', 'phi', 'bulkIs'],
    pinList: [['drain', 48, 0], ['gate', 0, 80], ['source', 48, 96]], modelType: 'NMOS' },
  pmos: { lib: 'pmos', prefix: 'M',
    allowed: ['vth', 'kp', 'lambda', 'w', 'l', '_model', 'bulkOnSource', 'gamma', 'phi', 'bulkIs'],
    pinList: [['drain', 48, 0], ['gate', 0, 80], ['source', 48, 96]], modelType: 'PMOS' },
  vcvs: { lib: 'e', prefix: 'E', parameter: 'gain', allowed: ['gain'],
    pinList: [['outp', 0, 16], ['outn', 0, 96], ['inp', -48, 32], ['inn', -48, 80]] },
  vccs: { lib: 'g', prefix: 'G', parameter: 'gm', allowed: ['gm'],
    pinList: [['outn', 0, 96], ['outp', 0, 16], ['inp', -48, 32], ['inn', -48, 80]] },
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
  return JSON.stringify(sourceDocumentProjection(circuit.parts, circuit.wires))
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
  // The body-effect pair and the bulk-junction saturation current, each emitted
  // INDEPENDENTLY of the others. That is safe -- and omitting one is not a loss
  // -- only because both sides default them identically: SPICE's GAMMA=0,
  // PHI=0.6 and IS=1e-14 are also what bw-board's `mosVth`/`mosBulkJunction`
  // fall back to (`params.phi ?? 0.6`, `params.bulkIs || 1e-14`). If either
  // default ever diverges, these become a set that must travel together.
  if (Number.isFinite(params.gamma)) fields.push(`GAMMA=${params.gamma}`);
  if (Number.isFinite(params.phi)) fields.push(`PHI=${params.phi}`);
  if (Number.isFinite(params.bulkIs)) fields.push(`IS=${params.bulkIs}`);
  const spiceLine = [Number.isFinite(params.w) ? `W=${params.w}` : '',
    Number.isFinite(params.l) ? `L=${params.l}` : ''].filter(Boolean).join(' ');
  return { value: modelName, spiceLine,
    directives: [`.model ${modelName} ${spec.modelType} (${fields.join(' ')})`] };
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

/**
 * A REFUSAL REASON SHOULD NAME THE CONSEQUENCE, NOT JUST THE FIELD.
 *
 * `bulkAtGround` is the case that made this worth a function. The generated
 * MOSFET symbols tie their fourth pin to SOURCE -- see `pinList` above, where
 * `source` appears twice -- so a part whose deck tied the bulk to the REFERENCE
 * instead cannot be drawn by them. Exporting it anyway would produce a
 * different device: no body-effect threshold shift and, more importantly, no
 * bulk-drain junction, which on a drain driven below the reference is worth
 * volts (measured 4.37 V on a 10k pull-down against ngspice).
 *
 * Before that flag existed the same deck round-tripped SILENTLY as the
 * bulk-on-source device. So this refusal is not a loss of coverage; it is a
 * semantic loss that used to go unreported, and the reason now says which.
 */
function unrepresentedReason(kind, extra) {
  if ((kind === 'nmos' || kind === 'pmos') && extra.includes('bulkAtGround')) {
    const rest = extra.filter(name => name !== 'bulkAtGround');
    return 'the deck ties the bulk to the reference, and the generated '
      + `${kind} symbol ties its bulk pin to the source; exporting it would drop `
      + 'the body effect and the bulk-drain junction'
      + (rest.length ? `; also unrepresented: ${rest.join(', ')}` : '');
  }
  return `unrepresented parameters: ${extra.join(', ')}`;
}

/** Serialize standard R/C/static-V/static-I plus ground labels as interchange. */
export function toLtspiceAsc(circuit = {}) {
  const { parts = [], wires = [], analysisBlockers = [] } = circuit;
  const warnings = []; const skipped = []; const emitted = new Map();
  const modelDirectives = new Set();
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
          : extra.length ? unrepresentedReason(part.kind, extra)
            : part.analysisBlockers?.length ? 'persisted semantic blocker' : 'invalid LTspice instance name';
      skipped.push({ id: part.id, kind: part.kind, reason }); warnings.push(`${part.id || '(unnamed)'} (${part.kind}): ${reason}`);
      continue;
    }
    const x = 128 + ordinal++ * 160; const y = 128;
    emitted.set(part.id, { spec, x, y });
    lines.push(`SYMBOL ${spec.lib} ${x} ${y} R0`, `SYMATTR InstName ${part.id}`, `SYMATTR Value ${value}`);
    if (encoding.spiceLine) lines.push(`SYMATTR SpiceLine ${encoding.spiceLine}`);
    for (const directive of encoding.directives) modelDirectives.add(directive);
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
  return { text: `${lines.join('\n')}\n`, warnings, skipped, symbolFiles: [] };
}
