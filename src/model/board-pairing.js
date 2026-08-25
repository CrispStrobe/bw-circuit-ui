/**
 * SCH/PCB pairing: does the board implement the schematic? (Phase 0.5b)
 *
 * An EasyEDA user arrives with both files. The schematic import yields a
 * circuit; the board lift yields the circuit the COPPER implements. Both
 * speak the same vocabulary — part refs and kind terminals — so the diff
 * is a partition comparison over shared (ref, terminal) nodes:
 *
 *   SPLIT   one schematic net, several board islands: something the
 *           schematic connects is not connected on the board (unrouted,
 *           torn label, forgotten return).
 *   BRIDGE  one board island, several schematic nets: the board joins
 *           what the schematic keeps apart (a short — copper overlap, or
 *           two nets landed on one internally-shorted terminal).
 *
 * This is KiCad's "update PCB from schematic" check, rebuilt on the copper
 * netlist.
 *
 * Honesty rules, each learned from the live pair:
 *
 *   - only refs present on BOTH sides are compared — a part only one file
 *     knows is reported as such, never diffed.
 *   - power-rail marker parts (vcc/gnd kinds) are dissolved into their
 *     nets on the schematic side; they have no board existence and would
 *     otherwise read as one split per rail symbol.
 *   - THE VOCABULARY IS THE KIND. A ref that lifted to different kinds on
 *     the two sides (the OLED module is ssd1306 in the schematic and a
 *     1x4 header on the board; a 1N5817 was given a resistor footprint)
 *     has no shared terminal names; diffing across that gap manufactures
 *     a split AND a bridge per pin. Such refs are excluded and REPORTED
 *     in `vocabularyMismatch` — the diff says what it could not check.
 *     For equal kinds the admissible names are whatever either side
 *     wires: asking terminalsForKind here would need a live engine for
 *     dynamic kinds (pi_pico), and its static fallback would silently
 *     drop every gp pin.
 *   - a bridge whose extra members are all pins the schematic left
 *     UNDRAWN (a Pico's seven ground pins, of which the schematic wires
 *     one) is `severity: 'info'` — the board may join pins the schematic
 *     never mentions. A bridge joining nets the schematic actually DRAWS
 *     is `severity: 'error'`: copper connects what the author kept apart.
 *
 * What this diff CANNOT see, by construction: a terminal-short (two nets
 * on one internally-joined terminal) collapses the nets on BOTH sides —
 * the schematic symbol and the lifted board agree about the collapsed
 * result. That fault belongs to pcb-drc's `terminal-short` rule, which
 * compares pad NET LABELS against the terminal map (plan §5 Phase 2).
 *
 * @module
 */

import { wireEndpoint } from './wire-endpoints.js';

/** Union-find over string keys. */
class Groups {
  constructor() { this.p = new Map(); }
  add(k) { if (!this.p.has(k)) this.p.set(k, k); }
  find(k) {
    this.add(k);
    let r = k;
    while (this.p.get(r) !== r) r = this.p.get(r);
    let c = k;
    while (this.p.get(c) !== c) { const n = this.p.get(c); this.p.set(c, r); c = n; }
    return r;
  }
  union(a, b) { const ra = this.find(a); const rb = this.find(b); if (ra !== rb) this.p.set(ra, rb); }
  keys() { return [...this.p.keys()]; }
  has(k) { return this.p.has(k); }
}

// Separator between ref and terminal in node keys. Importer refs are
// sanitised (makeId strips everything but [A-Za-z0-9_]), so '/' cannot
// occur in the ref half — and it is PRINTABLE, which matters: this file's
// first separator was an invisible byte and cost a debugging session.
const SEP = '/';
const NODE = (part, terminal) => `${part}${SEP}${terminal}`;
const partOf = (key) => key.slice(0, key.indexOf(SEP));
const RAIL_KINDS = new Set(['vcc', 'gnd']);

/**
 * Build the (ref,terminal) partition of a circuit {parts, wires}, with
 * rail parts dissolved: every terminal wired to a rail part lands in one
 * group per rail part id.
 */
export function circuitPartition(circuit) {
  const railIds = new Map();
  for (const p of circuit.parts || []) {
    if (RAIL_KINDS.has(p.kind)) railIds.set(p.id, `rail:${p.id}`);
  }
  const g = new Groups();
  for (const w of circuit.wires || []) {
    // The one endpoint reader (wire-endpoints.js): both wire dialects
    // handled, and breadboard-hole endpoints — meaningless on a board
    // diff — come back as non-part and are skipped.
    const fe = wireEndpoint(w, 'from');
    const te = wireEndpoint(w, 'to');
    if (!fe?.part || !te?.part) continue;
    const a = railIds.get(fe.part) || NODE(fe.part, fe.terminal);
    const b = railIds.get(te.part) || NODE(te.part, te.terminal);
    g.union(a, b);
  }
  return { groups: g, railIds };
}

/**
 * @param {object} sch    schematic circuit {parts, wires} (importEasyEda output)
 * @param {object} board  lifted circuit {parts, wires} (liftBoardToCircuit output)
 * @returns {{
 *   splits:  Array<{net: string[], islands: string[][]}>,
 *   bridges: Array<{nets: string[][], island: string[], severity: 'error'|'info'}>,
 *   onlySchematic: string[], onlyBoard: string[],
 *   vocabularyMismatch: Array<{ref: string, schKind: string, boardKind: string}>,
 *   comparedRefs: string[],
 * }}
 * Node spelling in results: "REF.terminal".
 */
export function diffBoardAgainstSchematic(sch, board) {
  const schParts = new Map((sch.parts || []).map((p) => [p.id, p]));
  const boardParts = new Map((board.parts || []).map((p) => [p.id, p]));

  const shared = new Set();
  const vocabularyMismatch = [];
  for (const id of schParts.keys()) {
    if (!boardParts.has(id) || RAIL_KINDS.has(schParts.get(id).kind)) continue;
    const sp = schParts.get(id); const bp = boardParts.get(id);
    if (sp.kind !== bp.kind) {
      vocabularyMismatch.push({ ref: id, schKind: sp.kind, boardKind: bp.kind });
      continue;
    }
    shared.add(id);
  }
  vocabularyMismatch.sort((a, b) => a.ref.localeCompare(b.ref));
  const onlySchematic = [...schParts.keys()]
    .filter((id) => !boardParts.has(id) && !RAIL_KINDS.has(schParts.get(id).kind)).sort();
  const onlyBoard = [...boardParts.keys()].filter((id) => !schParts.has(id)).sort();

  const S = circuitPartition(sch);
  const B = circuitPartition(board);

  // The comparable universe: nodes of shared refs that at least one side
  // wires. A node the other side never wired is its own island there — an
  // honest "connected to nothing".
  const universe = new Set();
  for (const key of S.groups.keys()) if (shared.has(partOf(key))) universe.add(key);
  for (const key of B.groups.keys()) if (shared.has(partOf(key))) universe.add(key);

  const pretty = (key) => key.replace(SEP, '.');
  const rootIn = (P, key) => (P.groups.has(key) ? P.groups.find(key) : `solo:${key}`);

  const bySchNet = new Map();
  const byBoardIsland = new Map();
  for (const key of universe) {
    const s = rootIn(S, key); const b = rootIn(B, key);
    if (!bySchNet.has(s)) bySchNet.set(s, []);
    bySchNet.get(s).push(key);
    if (!byBoardIsland.has(b)) byBoardIsland.set(b, []);
    byBoardIsland.get(b).push(key);
  }

  const splits = [];
  for (const nodes of bySchNet.values()) {
    if (nodes.length < 2) continue;
    const islands = new Map();
    for (const key of nodes) {
      const b = rootIn(B, key);
      if (!islands.has(b)) islands.set(b, []);
      islands.get(b).push(pretty(key));
    }
    if (islands.size > 1) {
      splits.push({
        net: nodes.map(pretty).sort(),
        islands: [...islands.values()].map((a) => a.sort()).sort((x, y) => y.length - x.length),
      });
    }
  }

  const bridges = [];
  for (const nodes of byBoardIsland.values()) {
    if (nodes.length < 2) continue;
    const nets = new Map();
    for (const key of nodes) {
      const s = rootIn(S, key);
      if (!nets.has(s)) nets.set(s, []);
      nets.get(s).push(key);
    }
    if (nets.size > 1) {
      // Drawn nets = groups the schematic actually wires (a solo root is a
      // pin the schematic never touched). Two or more drawn nets in one
      // island is a short; one drawn net plus undrawn pins is the board
      // joining pins the schematic does not mention.
      const groups = [...nets.entries()];
      const drawn = groups.filter(([root]) => !root.startsWith('solo:')).length;
      bridges.push({
        island: nodes.map(pretty).sort(),
        nets: groups.map(([, a]) => a.map(pretty).sort()).sort((x, y) => y.length - x.length),
        severity: drawn >= 2 ? 'error' : 'info',
      });
    }
  }

  splits.sort((a, b) => a.net[0].localeCompare(b.net[0]));
  bridges.sort((a, b) => a.island[0].localeCompare(b.island[0]));
  return {
    splits, bridges, onlySchematic, onlyBoard, vocabularyMismatch,
    comparedRefs: [...shared].sort(),
  };
}
