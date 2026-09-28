/** Pure parsing, endpoint resolution and scope summaries for `bwc measure`. */

const UNIT_SCALE = Object.freeze({
  ns: 1e-9, us: 1e-6, ms: 1e-3, s: 1,
  hz: 1, khz: 1e3, mhz: 1e6,
});

export function parseScaledNumber(value, kind) {
  const match = String(value ?? '').trim().match(/^([+]?(?:\d+(?:\.\d*)?|\.\d+))(ns|us|ms|s|hz|khz|mhz)?$/i);
  if (!match) throw new Error(`invalid ${kind}: ${value}`);
  const unit = (match[2] || (kind === 'duration' ? 's' : 'hz')).toLowerCase();
  if (kind === 'duration' && !['ns', 'us', 'ms', 's'].includes(unit)) throw new Error(`invalid duration unit: ${unit}`);
  if (kind === 'rate' && !['hz', 'khz', 'mhz'].includes(unit)) throw new Error(`invalid rate unit: ${unit}`);
  return Number(match[1]) * UNIT_SCALE[unit];
}

export function resolveEndpointNet(resolvedNets, selector) {
  const wanted = String(selector || '').trim();
  if (!wanted) throw new Error('empty probe endpoint');
  const nets = Array.isArray(resolvedNets) ? resolvedNets : [];
  const explicit = wanted.startsWith('net:') ? wanted.slice(4) : wanted;
  const byId = nets.filter(net => net.id === explicit);
  if (byId.length === 1) return byId[0].id;
  const dot = wanted.lastIndexOf('.');
  if (dot <= 0 || dot === wanted.length - 1) {
    throw new Error(`unknown net or endpoint "${wanted}"; use net:<id> or <part>.<terminal>`);
  }
  const part = wanted.slice(0, dot);
  const terminal = wanted.slice(dot + 1);
  const matches = nets.filter(net => (net.terminals || []).some(item => item.part === part && item.terminal === terminal));
  if (matches.length !== 1) throw new Error(`endpoint "${wanted}" resolves to ${matches.length} nets`);
  return matches[0].id;
}

export function parseScopeSpec(value) {
  const pieces = String(value || '').split(',').map(piece => piece.trim());
  if (pieces.length < 1 || pieces.length > 2 || !pieces[0]) {
    throw new Error(`invalid scope spec "${value}"; use <tip>[,<reference>]`);
  }
  return { tip: pieces[0], reference: pieces[1] || '' };
}

export function parseMeterSpec(value) {
  const colon = String(value || '').indexOf(':');
  if (colon < 1) throw new Error(`invalid meter spec "${value}"`);
  const mode = value.slice(0, colon).trim().toLowerCase();
  const probes = value.slice(colon + 1).split(',').map(piece => piece.trim()).filter(Boolean);
  if (!['voltage', 'current', 'resistance'].includes(mode)) throw new Error(`unknown meter mode "${mode}"`);
  const expected = mode === 'current' ? 1 : 2;
  if (probes.length !== expected) {
    throw new Error(`${mode} meter needs ${expected} endpoint${expected === 1 ? '' : 's'}`);
  }
  return { mode, probes };
}

export function scopeSeries(data) {
  if (!data?.samples) return [];
  const depth = Math.floor(data.samples.length / 2);
  const count = Math.min(Number(data.count || 0), depth);
  const oldest = ((Number(data.writeIndex || 0) - count) % depth + depth) % depth;
  const values = [];
  for (let offset = 0; offset < count; offset++) {
    const index = (oldest + offset) % depth;
    const low = data.samples[index * 2];
    const high = data.samples[index * 2 + 1];
    if (Number.isFinite(low) && Number.isFinite(high)) values.push((low + high) / 2);
  }
  return values;
}

export function summarizeScope(data) {
  const values = scopeSeries(data);
  if (!values.length) return { samples: 0, minVolts: null, maxVolts: null, meanVolts: null, rmsVolts: null, lastVolts: null };
  let min = Infinity; let max = -Infinity; let sum = 0; let squares = 0;
  for (const value of values) {
    min = Math.min(min, value); max = Math.max(max, value); sum += value; squares += value * value;
  }
  return {
    samples: values.length,
    minVolts: min,
    maxVolts: max,
    meanVolts: sum / values.length,
    rmsVolts: Math.sqrt(squares / values.length),
    lastVolts: values.at(-1),
  };
}
