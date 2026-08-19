/**
 * Breadboard model — hole coordinates, strip continuity, and net derivation.
 *
 * This is the placement substrate for bench-style building: legs go into
 * holes, and the board's internal strips — not drawn wires — make the
 * connections, exactly like the physical object. The model is pure data:
 * no rendering, no React, no engine imports. It answers three questions:
 *
 *   1. Which holes exist, and which are electrically common? (strips)
 *   2. What sits where? (occupancy: one lead or wire end per hole)
 *   3. What netlist does this board state imply? (deriveNets → boundary-B
 *      `Net[]` shape, consumed by the engine's setNetlist unchanged)
 *
 * The engine never learns breadboards exist — that is the design contract:
 * the board layer stays netlist-in, and this file owns the topology.
 *
 * Geometry (standard solderless board):
 *   - Terminal strips: rows a–e above the center gutter, f–j below, in
 *     `cols` columns. Holes "a1"…"e63" are common per column (one strip);
 *     "f1"…"j63" likewise; the gutter separates the two blocks — that gap
 *     is what DIP packages straddle.
 *   - Power rails: two above ("t+", "t-") and two below ("b+", "b-"), each
 *     running the board's length, holes "t+1"…"t+63" etc. `splitRails`
 *     breaks each rail into left/right halves between columns mid and
 *     mid+1 — many real boards do, and the missing jumper is a classic
 *     first-hour bug worth being able to teach.
 *
 * @module
 */

/** Row letters above and below the gutter. */
const TOP_ROWS = ['a', 'b', 'c', 'd', 'e'];
const BOTTOM_ROWS = ['f', 'g', 'h', 'i', 'j'];
const RAILS = ['t+', 't-', 'b+', 'b-'];

/**
 * @typedef {object} BreadboardSpec
 * @property {'full' | 'half'} [size] - 63 or 30 columns (default 'full')
 * @property {boolean} [splitRails] - rails broken at the middle (default false)
 */

/**
 * @typedef {object} HoleOccupant
 * @property {'lead' | 'wire'} kind
 * @property {string} [partId]    - for leads
 * @property {string} [terminal]  - for leads
 * @property {string} [wireId]    - for wires
 */

export class BreadboardModel {
  /** @param {BreadboardSpec} [spec] */
  constructor(spec = {}) {
    this.cols = spec.size === 'half' ? 30 : spec.size === 'mini' ? 17 : 63;
    // The 170-point mini board has no power rails at all.
    this.hasRails = spec.size !== 'mini';
    this.splitRails = spec.splitRails ?? false;
    /** Column where the left rail half ends when splitRails is on. */
    this.railSplitAt = Math.floor(this.cols / 2);

    /** @type {Map<string, HoleOccupant>} hole id → occupant */
    this.occupants = new Map();

    /** @type {Map<string, {a: string, b: string, color?: string}>} */
    this.wires = new Map();
  }

  // ─── Geometry ────────────────────────────────────────────────────────────

  /** @param {string} holeId @returns {boolean} */
  isValidHole(holeId) {
    const rail = RAILS.find(r => holeId.startsWith(r));
    if (rail) {
      if (!this.hasRails) return false;
      const n = Number(holeId.slice(rail.length));
      return Number.isInteger(n) && n >= 1 && n <= this.cols;
    }
    const row = holeId[0];
    const n = Number(holeId.slice(1));
    return (TOP_ROWS.includes(row) || BOTTOM_ROWS.includes(row))
      && Number.isInteger(n) && n >= 1 && n <= this.cols;
  }

  /**
   * The strip (electrically-common hole group) a hole belongs to.
   * Strip ids are stable and human-readable; they seed net ids.
   *
   * @param {string} holeId
   * @returns {string}
   */
  stripOf(holeId) {
    if (!this.isValidHole(holeId)) {
      throw new Error(`No such hole "${holeId}" on a ${this.cols}-column board`);
    }
    const rail = RAILS.find(r => holeId.startsWith(r));
    if (rail) {
      if (!this.splitRails) return `rail-${rail}`;
      const n = Number(holeId.slice(rail.length));
      return n <= this.railSplitAt ? `rail-${rail}-L` : `rail-${rail}-R`;
    }
    const row = holeId[0];
    const col = holeId.slice(1);
    return TOP_ROWS.includes(row) ? `col-t${col}` : `col-b${col}`;
  }

  /** All hole ids of a strip (for rendering highlights). */
  holesOfStrip(stripId) {
    const holes = [];
    if (stripId.startsWith('rail-')) {
      const parts = stripId.split('-'); // rail, t+, [L|R]
      const rail = parts[1];
      let from = 1, to = this.cols;
      if (parts[2] === 'L') to = this.railSplitAt;
      if (parts[2] === 'R') from = this.railSplitAt + 1;
      for (let n = from; n <= to; n++) holes.push(`${rail}${n}`);
      return holes;
    }
    const [, blockCol] = stripId.split('-'); // "t12" | "b12"
    const rows = blockCol[0] === 't' ? TOP_ROWS : BOTTOM_ROWS;
    const col = blockCol.slice(1);
    for (const r of rows) holes.push(`${r}${col}`);
    return holes;
  }

  // ─── Occupancy ───────────────────────────────────────────────────────────

  /**
   * Place a part: each terminal's lead goes into one hole. All-or-nothing —
   * on any conflict, nothing is placed and the error names every problem,
   * because "which hole is taken" is exactly what a learner needs to see.
   *
   * @param {string} partId
   * @param {Record<string, string>} leadMap - terminal → hole id
   */
  occupy(partId, leadMap) {
    const problems = [];
    const seen = new Set();
    for (const [terminal, holeId] of Object.entries(leadMap)) {
      if (!this.isValidHole(holeId)) {
        problems.push(`terminal "${terminal}": no such hole "${holeId}"`);
        continue;
      }
      if (seen.has(holeId)) {
        problems.push(`terminal "${terminal}": hole "${holeId}" used twice by this part`);
      }
      seen.add(holeId);
      const occ = this.occupants.get(holeId);
      if (occ) {
        const who = occ.kind === 'lead' ? `${occ.partId}.${occ.terminal}` : `wire ${occ.wireId}`;
        problems.push(`terminal "${terminal}": hole "${holeId}" is taken by ${who}`);
      }
    }
    if (problems.length > 0) {
      throw new Error(`Cannot place "${partId}":\n  - ${problems.join('\n  - ')}`);
    }
    for (const [terminal, holeId] of Object.entries(leadMap)) {
      this.occupants.set(holeId, { kind: 'lead', partId, terminal });
    }
  }

  /** Remove a part's leads. @param {string} partId */
  release(partId) {
    for (const [holeId, occ] of this.occupants) {
      if (occ.kind === 'lead' && occ.partId === partId) this.occupants.delete(holeId);
    }
  }

  /**
   * A jumper wire between two holes.
   * @param {string} wireId @param {string} a @param {string} b
   * @param {string} [color]
   */
  addWire(wireId, a, b, color) {
    if (this.wires.has(wireId)) throw new Error(`Wire id "${wireId}" already exists`);
    const problems = [];
    for (const holeId of [a, b]) {
      if (!this.isValidHole(holeId)) { problems.push(`no such hole "${holeId}"`); continue; }
      const occ = this.occupants.get(holeId);
      if (occ) {
        const who = occ.kind === 'lead' ? `${occ.partId}.${occ.terminal}` : `wire ${occ.wireId}`;
        problems.push(`hole "${holeId}" is taken by ${who}`);
      }
    }
    if (a === b) problems.push('both ends in the same hole');
    if (problems.length > 0) {
      throw new Error(`Cannot add wire "${wireId}":\n  - ${problems.join('\n  - ')}`);
    }
    this.wires.set(wireId, { a, b, color });
    this.occupants.set(a, { kind: 'wire', wireId });
    this.occupants.set(b, { kind: 'wire', wireId });
  }

  /** @param {string} wireId */
  removeWire(wireId) {
    const w = this.wires.get(wireId);
    if (!w) return;
    this.occupants.delete(w.a);
    this.occupants.delete(w.b);
    this.wires.delete(wireId);
  }

  /** @param {string} holeId @returns {HoleOccupant | undefined} */
  occupantOf(holeId) {
    return this.occupants.get(holeId);
  }

  // ─── Net derivation ──────────────────────────────────────────────────────

  /**
   * Derive the netlist implied by strips + wires + leads.
   *
   * Conduction is strips and wires ONLY — a part's leads join nets, they do
   * not merge them (a resistor is a component, not a jumper). Union-find over
   * strips, wires as unions; every strip holding at least one lead lands its
   * leads' terminals in that group's net.
   *
   * Net ids are deterministic regardless of insertion order: a group that
   * contains a rail is named for it (rails are the human's landmarks);
   * otherwise the lexically first strip id, prefixed "n-".
   *
   * @returns {{nets: Array<{id: string, terminals: Array<{part: string, terminal: string}>}>,
   *            stripToNet: Map<string, string>, notes: string[]}}
   */
  deriveNets(boardId) {
    /** @type {Map<string, string>} union-find parent */
    const parent = new Map();
    const find = (x) => {
      let r = x;
      while (parent.get(r) !== r) r = /** @type {string} */ (parent.get(r));
      while (parent.get(x) !== r) { const nx = /** @type {string} */ (parent.get(x)); parent.set(x, r); x = nx; }
      return r;
    };
    const ensure = (x) => { if (!parent.has(x)) parent.set(x, x); };
    const union = (x, y) => { ensure(x); ensure(y); const rx = find(x), ry = find(y); if (rx !== ry) parent.set(rx, ry); };

    const notes = [];

    // Wires union strips.
    for (const [wireId, w] of this.wires) {
      const sa = this.stripOf(w.a);
      const sb = this.stripOf(w.b);
      if (sa === sb) {
        notes.push(`Wire "${wireId}" connects "${w.a}" and "${w.b}" — already the same strip; it does nothing.`);
      }
      union(sa, sb);
    }

    // Leads register their strips (and surface same-strip shorts).
    /** @type {Map<string, Array<{part: string, terminal: string}>>} strip → leads */
    const stripLeads = new Map();
    /** @type {Map<string, Map<string, string[]>>} partId → strip → terminals */
    const partStrips = new Map();
    for (const [holeId, occ] of this.occupants) {
      if (occ.kind !== 'lead') continue;
      const strip = this.stripOf(holeId);
      ensure(strip);
      if (!stripLeads.has(strip)) stripLeads.set(strip, []);
      stripLeads.get(strip).push({ part: /** @type {string} */ (occ.partId), terminal: /** @type {string} */ (occ.terminal) });
      if (!partStrips.has(occ.partId)) partStrips.set(occ.partId, new Map());
      const ps = partStrips.get(occ.partId);
      if (!ps.has(strip)) ps.set(strip, []);
      ps.get(strip).push(occ.terminal);
    }

    for (const [partId, strips] of partStrips) {
      for (const [strip, terminals] of strips) {
        if (terminals.length > 1) {
          notes.push(`Part "${partId}" has terminals ${terminals.join(' and ')} in the same strip (${strip}) — they are shorted together by the board.`);
        }
      }
    }

    // Group strips into nets.
    /** @type {Map<string, string[]>} root → member strips */
    const groups = new Map();
    for (const strip of parent.keys()) {
      const root = find(strip);
      if (!groups.has(root)) groups.set(root, []);
      groups.get(root).push(strip);
    }

    // Net ids must incorporate the boardId so that the same column index
    // on two different breadboards yields DISTINCT net ids.  Without this,
    // col-t13-m1 on board A collided with col-t13-m1 on board B, merging
    // an LED indicator net with a CPU data bus (eater6502 benches).
    const prefix = boardId ? `${boardId}:` : '';
    const netIdFor = (members) => {
      const rails = members.filter(m => m.startsWith('rail-')).sort();
      if (rails.length > 0) return `${prefix}${rails[0]}`;
      return `${prefix}n-${[...members].sort()[0]}`;
    };

    const nets = [];
    /** @type {Map<string, string>} */
    const stripToNet = new Map();
    for (const members of groups.values()) {
      const terminals = [];
      for (const strip of members) {
        for (const lead of stripLeads.get(strip) ?? []) terminals.push(lead);
      }
      if (terminals.length === 0) continue; // conductor with nothing attached
      const id = netIdFor(members);
      terminals.sort((x, y) => (x.part + '/' + x.terminal).localeCompare(y.part + '/' + y.terminal));
      nets.push({ id, terminals });
      for (const strip of members) stripToNet.set(strip, id);
    }
    nets.sort((x, y) => x.id.localeCompare(y.id));

    for (const net of nets) {
      if (net.terminals.length === 1) {
        const t = net.terminals[0];
        notes.push(`"${t.part}.${t.terminal}" is alone on ${net.id} — a floating lead connects to nothing.`);
      }
    }

    return { nets, stripToNet, notes };
  }
}
