/** Bounded LTspice Version-4 ASCII schematic serializer. */
import { wireEndpoint, isBoardEndpoint } from '../wire-endpoints.js';

const SPECS = {
  resistor: { lib: 'res', parameter: 'ohms', allowed: ['ohms'], terminals: { a: [16, 16], b: [16, 96] } },
  capacitor: { lib: 'cap', parameter: 'farads', allowed: ['farads'], terminals: { a: [16, 0], b: [16, 64] } },
  vsource: { lib: 'voltage', parameter: 'volts', allowed: ['volts'], terminals: { pos: [0, 16], neg: [0, 96] } },
  // LTspice order 1 -> 2 is native neg -> pos for an independent current source.
  isource: { lib: 'current', parameter: 'amps', allowed: ['amps'], terminals: { neg: [0, 0], pos: [0, 80] } },
};

const endpointKey = (part, terminal) => `${part}\u0000${terminal}`;
const scalar = value => Number.isFinite(value) ? (Object.is(value, -0) ? '0' : String(value)) : null;

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
export function toLtspiceAsc({ parts = [], wires = [], analysisBlockers = [] }) {
  const warnings = []; const skipped = []; const emitted = new Map();
  const lines = ['Version 4', 'SHEET 1 880 680'];
  if (analysisBlockers.length) warnings.push(`${analysisBlockers.length} persisted analysis blocker(s) are not represented in ASC`);
  const groundCount = parts.filter(part => part.kind === 'gnd').length;
  if (groundCount) warnings.push(`${groundCount} ground symbol instance(s) encoded as net label 0; symbol identity and layout are not preserved`);

  let ordinal = 0;
  for (const part of parts) {
    if (part.kind === 'gnd') continue;
    const spec = SPECS[part.kind]; const params = part.params || {};
    const extra = Object.keys(params).filter(name => !spec?.allowed.includes(name));
    const value = spec && scalar(params[spec.parameter]);
    if (!spec || value === null || extra.length || part.analysisBlockers?.length || !/^[^\s\r\n]+$/.test(String(part.id || ''))) {
      const reason = !spec ? 'unsupported kind' : value === null ? `missing or non-finite ${spec.parameter}`
        : extra.length ? `unrepresented parameters: ${extra.join(', ')}`
          : part.analysisBlockers?.length ? 'persisted semantic blocker' : 'invalid LTspice instance name';
      skipped.push({ id: part.id, kind: part.kind, reason }); warnings.push(`${part.id || '(unnamed)'} (${part.kind}): ${reason}`);
      continue;
    }
    const x = 128 + ordinal++ * 160; const y = 128;
    emitted.set(part.id, { spec, x, y });
    lines.push(`SYMBOL ${spec.lib} ${x} ${y} R0`, `SYMATTR InstName ${part.id}`, `SYMATTR Value ${value}`);
  }

  let netOrdinal = 0;
  for (const group of netGroups(parts, wires, warnings)) {
    const ground = group.some(member => parts.find(part => part.id === member.part)?.kind === 'gnd');
    const name = ground ? '0' : `_BW_NET_${++netOrdinal}`;
    for (const member of group) {
      const placement = emitted.get(member.part); if (!placement) continue;
      const pin = placement.spec.terminals[member.terminal];
      if (!pin) { warnings.push(`${member.part}.${member.terminal}: terminal is not representable and was omitted`); continue; }
      lines.push(`FLAG ${placement.x + pin[0]} ${placement.y + pin[1]} ${name}`);
    }
  }
  return { text: `${lines.join('\n')}\n`, warnings, skipped };
}
