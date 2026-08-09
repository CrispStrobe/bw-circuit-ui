/**
 * Merge nets from two sources — schematic wires and breadboard strips —
 * into one electrically-correct net set.
 *
 * The naive approach (concatenate, dedup identical nets) is wrong in the one
 * case mixed mode exists for: a drawn wire that TOUCHES a breadboard-seated
 * terminal must MERGE the wire's net with the strip's net into one node.
 * Electrical identity is transitive; only a union-find over terminals
 * captures that.
 *
 * Pure function, no model dependencies.
 *
 * @module
 */

/**
 * @param {Array<{id: string, terminals: Array<{part: string, terminal: string}>}>} netsA
 * @param {Array<{id: string, terminals: Array<{part: string, terminal: string}>}>} netsB
 * @returns {Array<{id: string, terminals: Array<{part: string, terminal: string}>}>}
 */
export function mergeNets(netsA, netsB) {
  const parent = new Map();
  const find = (k) => {
    let r = k;
    while (parent.get(r) !== r) r = parent.get(r);
    while (parent.get(k) !== r) { const n = parent.get(k); parent.set(k, r); k = n; }
    return r;
  };
  const ensure = (k) => { if (!parent.has(k)) parent.set(k, k); };
  const union = (a, b) => { ensure(a); ensure(b); const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };

  const tKey = (t) => `${t.part} ${t.terminal}`;

  // Which source-net ids touch each terminal, for stable naming.
  /** @type {Map<string, Set<string>>} terminal key -> source net ids */
  const namesFor = new Map();

  for (const net of [...netsA, ...netsB]) {
    const ts = net.terminals;
    if (ts.length === 0) continue;
    const first = tKey(ts[0]);
    ensure(first);
    for (const t of ts) {
      const k = tKey(t);
      union(first, k);
      if (!namesFor.has(k)) namesFor.set(k, new Set());
      namesFor.get(k).add(net.id);
    }
  }

  /** @type {Map<string, {terminals: Map<string, {part: string, terminal: string}>, ids: Set<string>}>} */
  const groups = new Map();
  for (const k of parent.keys()) {
    const root = find(k);
    if (!groups.has(root)) groups.set(root, { terminals: new Map(), ids: new Set() });
    const g = groups.get(root);
    const sep = k.indexOf(' ');
    g.terminals.set(k, { part: k.slice(0, sep), terminal: k.slice(sep + 1) });
    for (const id of namesFor.get(k) ?? []) g.ids.add(id);
  }

  const nameOf = (ids) => {
    const all = [...ids].sort();
    // A rail name is the human's landmark; otherwise the lexically first id.
    return all.find(id => id.startsWith('rail-')) ?? all[0];
  };

  const out = [];
  for (const g of groups.values()) {
    const terminals = [...g.terminals.values()]
      .sort((x, y) => (`${x.part}/${x.terminal}`).localeCompare(`${y.part}/${y.terminal}`));
    out.push({ id: nameOf(g.ids), terminals });
  }
  out.sort((x, y) => x.id.localeCompare(y.id));

  // Merged groups can collapse two source names onto one surviving id while a
  // DIFFERENT group still carries one of the collapsed names — uniquify.
  const seen = new Map();
  for (const net of out) {
    const n = seen.get(net.id) ?? 0;
    seen.set(net.id, n + 1);
    if (n > 0) net.id = `${net.id}-m${n}`;
  }
  return out;
}
