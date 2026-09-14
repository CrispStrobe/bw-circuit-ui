import { isBoardEndpoint, wireEndpoint } from './wire-endpoints.js';

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
}

function endpointKey(endpoint) {
  if (!endpoint) return null;
  if (isBoardEndpoint(endpoint)) return `board:${endpoint.board}:${endpoint.hole}`;
  return `part:${endpoint.part}:${endpoint.terminal}`;
}

/**
 * Select the authored state that determines whether a retained source document
 * may be replayed. Circuit.fromJSON adds renderer defaults, generated wire ids,
 * and net ids; none of those mean that the imported schematic was edited.
 */
export function sourceDocumentProjection(parts = [], wires = []) {
  const projectedParts = parts.map(part => stable({
    id: part.id,
    kind: part.kind,
    params: part.params || {},
    x: Number.isFinite(part.x) ? part.x : null,
    y: Number.isFinite(part.y) ? part.y : null,
    rotation: Number.isFinite(part.rotation) ? part.rotation : 0,
    flipped: Boolean(part.flipped),
    analysisBlockers: part.analysisBlockers || [],
  })).sort((a, b) => String(a.id).localeCompare(String(b.id)) || String(a.kind).localeCompare(String(b.kind)));

  const projectedWires = wires.map(wire => {
    const ends = [endpointKey(wireEndpoint(wire, 'from')), endpointKey(wireEndpoint(wire, 'to'))].sort();
    return ends.join('\u0000');
  }).sort();
  return { parts: projectedParts, wires: projectedWires };
}
