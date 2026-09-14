/**
 * Preserve one-terminal electrical nodes that schematic/netlist importers can
 * name but the wire-only Circuit interchange cannot otherwise express.
 * Metadata is opt-in per imported part; ordinary unwired pins stay absent.
 */

const endpointKey = (part, terminal) => JSON.stringify([part, terminal]);

const token = value => {
  const points = Array.from(String(value), character => character.codePointAt(0).toString(16));
  return points.length ? points.join('-') : 'empty';
};

/** Mark unique imported net memberships on their owning parts. */
export function annotateImportedSingletonTerminals(parts, groups) {
  const byId = new Map(parts.map(part => [part.id, part]));
  for (const members of groups) {
    const unique = new Map();
    for (const member of members || []) {
      const part = member.part ?? member.partId;
      if (typeof part !== 'string' || typeof member.terminal !== 'string') continue;
      unique.set(endpointKey(part, member.terminal), { part, terminal: member.terminal });
    }
    if (unique.size !== 1) continue;
    const [{ part, terminal }] = unique.values();
    const owner = byId.get(part);
    if (!owner) continue;
    const declared = Array.isArray(owner.singletonTerminals) ? owner.singletonTerminals : [];
    if (!declared.includes(terminal)) owner.singletonTerminals = [...declared, terminal];
  }
}

/**
 * Materialize annotated terminals only when no resolved wire/strip net owns
 * them. Existing wiring wins; disconnecting naturally restores the node.
 */
export function withImportedSingletonNets(parts, nets) {
  const output = [...(nets || [])];
  const occupied = new Set();
  const usedIds = new Set();
  for (const net of output) {
    usedIds.add(net.id);
    for (const endpoint of net.terminals || []) occupied.add(endpointKey(endpoint.part, endpoint.terminal));
  }
  for (const part of parts || []) {
    if (typeof part?.id !== 'string' || !Array.isArray(part.terminals)
        || !Array.isArray(part.singletonTerminals)) continue;
    const valid = new Set(part.terminals);
    for (const terminal of new Set(part.singletonTerminals)) {
      const key = endpointKey(part.id, terminal);
      if (typeof terminal !== 'string' || !valid.has(terminal) || occupied.has(key)) continue;
      const base = `net-imported-singleton-${token(part.id)}-${token(terminal)}`;
      let id = base; let suffix = 2;
      while (usedIds.has(id)) id = `${base}-${suffix++}`;
      usedIds.add(id); occupied.add(key);
      output.push({ id, terminals: [{ part: part.id, terminal }] });
    }
  }
  return output;
}
