/**
 * Circuit model — the mutable data structure behind the circuit designer.
 *
 * Holds parts (with layout positions), nets (wires), and the board instance.
 * Every mutation that affects the netlist calls board.setNetlist() to keep
 * the engine in sync. The UI reads instrument values from the board.
 *
 * This module is the testable core — no React, no DOM, no browser APIs.
 */

import { getEngine } from '../engine.js';
import { History } from './history.js';
import { mergeNets } from './merge-nets.js';
import { BreadboardModel } from './breadboard.js';
import { logicChipTerminals } from './dip-chips.js';
import { computeLeadMap, rotateFootprint, FOOTPRINTS as BB_FOOTPRINTS_FOR_ROTATE } from './footprints.js';

let _nextId = 1;
function genId(prefix) { return `${prefix}_${_nextId++}`; }

/** Reset the ID counter (for tests). */
export function resetIds() { _nextId = 1; }

/**
 * @typedef {object} PlacedPart
 * @property {string} id
 * @property {string} kind
 * @property {Record<string, number|string>} params
 * @property {string[]} terminals
 * @property {number} x — canvas X
 * @property {number} y — canvas Y
 */

/**
 * @typedef {object} Wire
 * @property {string} id
 * @property {string} netId — the net this wire belongs to
 * @property {{part: string, terminal: string}} from
 * @property {{part: string, terminal: string}} to
 */

export class Circuit {
  /**
   * @param {number} [vcc=5.0]
   */
  constructor(vcc = 5.0) {
    /** @type {number} */
    this.vcc = vcc;

    /** @type {Function} — the BoardImpl constructor, from the injected engine */
    this._BoardImpl = getEngine().BoardImpl;

    /** @type {PlacedPart[]} */
    this.parts = [];

    /** @type {Wire[]} */
    this.wires = [];

    /** @type {object} */
    this.board = new this._BoardImpl(vcc);

    /** @type {boolean} */
    this.powered = true;

    /** @type {bigint} — current simulation time in ns */
    this.timeNs = 0n;

    /** @type {History} */
    this.history = new History();

    /**
     * One BreadboardModel PER breadboard part on the canvas — boards are
     * ordinary parts, as many as the user drops, each with its own hole
     * occupancy. Keyed by the breadboard part's id.
     * @type {Map<string, import('./breadboard.js').BreadboardModel>}
     */
    this.breadboards = new Map();
  }

  /**
   * Seat a part on a breadboard: its leads occupy holes, the strips make
   * the connections. Re-seating releases the old holes first (including on
   * a DIFFERENT board — dragging a part between boards is just a re-seat).
   * @param {string} partId @param {string} boardId
   * @param {Record<string, string>} leadMap - terminal → hole id
   * @returns {boolean} seated (false = holes occupied / invalid, part left free)
   */
  seatPart(partId, boardId, leadMap) {
    const bb = this.breadboards.get(boardId);
    const part = this.parts.find(p => p.id === partId);
    if (!bb || !part) return false;
    this.unseatPart(partId);
    try {
      bb.occupy(partId, leadMap);
    } catch {
      this._syncNetlist();
      return false;
    }
    part.seat = { boardId, leadMap };
    this._syncNetlist();
    return true;
  }

  /**
   * A jumper wire between two holes of one board — the classic colored
   * breadboard wire. Returns its reference id ("bbw:<board>:<wire>") or null
   * when the holes cannot take it (occupied / invalid / same strip is fine —
   * the model's teaching notes call out a no-op jumper).
   * @param {string} boardId @param {string} a @param {string} b
   * @param {string} [color]
   * @returns {string | null}
   */
  addHoleWire(boardId, a, b, color) {
    const bb = this.breadboards.get(boardId);
    if (!bb) return null;
    const id = genId('bbw');
    try {
      bb.addWire(id, a, b, color);
    } catch {
      return null;
    }
    this._syncNetlist();
    this._saveHistory();
    return `bbw:${boardId}:${id}`;
  }

  /** Recolor a jumper by its reference. */
  updateHoleWire(ref, props) {
    const m = /^bbw:([^:]+):(.+)$/.exec(ref);
    if (!m) return false;
    const bb = this.breadboards.get(m[1]);
    const w = bb && bb.wires.get(m[2]);
    if (!w) return false;
    if ('color' in props) w.color = props.color ?? undefined;
    return true;
  }

  /** Remove a jumper by its "bbw:<board>:<wire>" reference. */
  removeHoleWire(ref) {
    const m = /^bbw:([^:]+):(.+)$/.exec(ref);
    if (!m) return false;
    const bb = this.breadboards.get(m[1]);
    if (!bb) return false;
    bb.removeWire(m[2]);
    this._syncNetlist();
    this._saveHistory();
    return true;
  }

  /**
   * A tap wire: one end on a part terminal, the other in a breadboard hole —
   * "wire the battery to the rail" made literal. Represented as a normal
   * wire whose `to` end is {board, hole}; _syncNetlist glues it to the
   * hole's strip via a pseudo-terminal that never reaches the engine.
   * @returns {object | null} the wire, or null if the hole is invalid/occupied
   */
  addTapWire(partId, terminal, boardId, hole, color) {
    const bb = this.breadboards.get(boardId);
    if (!bb || !bb.isValidHole(hole)) return null;
    const occ = bb.occupantOf(hole);
    if (occ) return null; // a leg or jumper owns that hole
    const wire = {
      id: genId('w'), netId: genId('net'),
      from: { part: partId, terminal },
      to: { board: boardId, hole },
      color,
    };
    this.wires.push(wire);
    this._syncNetlist();
    this._saveHistory();
    return wire;
  }

  /** All jumpers across all boards, render-ready. */
  holeWires() {
    const out = [];
    for (const [boardId, bb] of this.breadboards) {
      for (const [id, w] of bb.wires) {
        out.push({ ref: `bbw:${boardId}:${id}`, boardId, a: w.a, b: w.b, color: w.color });
      }
    }
    return out;
  }

  /**
   * Rotate a SEATED part 90° about its reference hole: the leadMap is
   * re-derived from the rotated footprint. Returns false (and changes
   * nothing) when the rotated holes are off-board or occupied — refusal is
   * visible as nothing happening at the same spot, never a corrupted seat.
   * @param {string} partId
   * @param {object} footprint - the part's breadboard footprint
   * @returns {boolean}
   */
  rotateSeated(partId, footprint) {
    const part = this.parts.find(p => p.id === partId);
    if (!part || !part.seat || !footprint) return false;
    const refHole = part.seat.leadMap[footprint.refTerminal];
    if (!refHole) return false;
    const rot = ((part.seat.rot ?? 0) + 1) % 4;
    let leadMap;
    try {
      leadMap = computeLeadMap(rotateFootprint(footprint, rot), refHole);
    } catch {
      return false;
    }
    const boardId = part.seat.boardId;
    if (!this.canSeat(boardId, partId, leadMap)) return false;
    const ok = this.seatPart(partId, boardId, leadMap);
    if (ok) part.seat.rot = rot;
    return ok;
  }

  /** Free a part's holes wherever it sits. Safe when not seated. */
  unseatPart(partId) {
    const part = this.parts.find(p => p.id === partId);
    for (const bb of this.breadboards.values()) bb.release(partId);
    if (part && part.seat) delete part.seat;
  }

  /** Can this leadMap be seated on that board right now? */
  canSeat(boardId, partId, leadMap) {
    const bb = this.breadboards.get(boardId);
    if (!bb) return false;
    for (const hole of Object.values(leadMap)) {
      if (!bb.isValidHole(hole)) return false;
      const occ = bb.occupantOf(hole);
      if (occ && !(occ.kind === 'lead' && occ.partId === partId)) return false;
    }
    return true;
  }

  /** Save current state to history. Called after structural mutations. */
  _saveHistory() {
    // Save both circuit layout AND engine state (capacitor voltages, etc.)
    const engineSnap = this.board.snapshot ? this.board.snapshot() : null;
    this.history.save({ parts: this.parts, wires: this.wires, engineSnap });
  }

  /** Undo the last structural change. Returns true if successful. */
  undo() {
    const state = this.history.undo();
    if (!state) return false;
    this.parts = state.parts.map(p => ({ ...p }));
    this.wires = state.wires.map(w => ({ ...w }));
    this._syncNetlist();
    // Restore engine state if available
    if (state.engineSnap && this.board.restore) {
      this.board.restore(state.engineSnap);
    }
    return true;
  }

  /** Redo a previously undone change. Returns true if successful. */
  redo() {
    const state = this.history.redo();
    if (!state) return false;
    this.parts = state.parts.map(p => ({ ...p }));
    this.wires = state.wires.map(w => ({ ...w }));
    this._syncNetlist();
    if (state.engineSnap && this.board.restore) {
      this.board.restore(state.engineSnap);
    }
    return true;
  }

  // ── Part operations ─────────────────────────────────────────────

  /**
   * Add a part to the circuit at the given position.
   * @param {string} kind
   * @param {Record<string, number|string>} params
   * @param {number} x
   * @param {number} y
   * @returns {PlacedPart} the added part
   */
  addPart(kind, params, x, y, declName) {
    const terminals = terminalsForKind(kind, params);
    const part = { id: genId(kind), kind, params: { ...params }, terminals, x, y, rotation: 0 };
    if (declName) part.declName = declName;
    this.parts.push(part);
    if (kind === 'breadboard') this.breadboards.set(part.id, new BreadboardModel());
    this._syncNetlist();
    this._saveHistory();
    return part;
  }

  /**
   * Remove a part and all wires connected to it.
   * @param {string} partId
   * @returns {boolean} true if found and removed
   */
  removePart(partId) {
    const idx = this.parts.findIndex(p => p.id === partId);
    if (idx === -1) return false;
    this.unseatPart(partId);
    if (this.breadboards.has(partId)) {
      // Removing a board frees every part seated on it — they stay on the
      // canvas as free parts, they just lose the strips.
      this.breadboards.delete(partId);
      for (const p of this.parts) {
        if (p.seat && p.seat.boardId === partId) delete p.seat;
      }
    }
    this.parts.splice(idx, 1);
    // Remove wires connected to this part
    this.wires = this.wires.filter(
      w => w.from.part !== partId && w.to.part !== partId
    );
    this._syncNetlist();
    this._saveHistory();
    return true;
  }

  /**
   * Move a part to a new position. Does not affect the netlist.
   * @param {string} partId
   * @param {number} x
   * @param {number} y
   * @returns {boolean}
   */
  movePart(partId, x, y) {
    const part = this.parts.find(p => p.id === partId);
    if (!part) return false;
    part.x = x;
    part.y = y;
    return true;
  }

  /**
   * Find a part by ID.
   * @param {string} partId
   * @returns {PlacedPart|undefined}
   */
  getPart(partId) {
    return this.parts.find(p => p.id === partId);
  }

  /**
   * Rotate a part by 90 degrees clockwise.
   * @param {string} partId
   * @returns {boolean}
   */
  rotatePart(partId) {
    const seated = this.parts.find(p => p.id === partId);
    if (seated && seated.seat) {
      // On a board, rotation means re-seating the rotated leadMap — the
      // lattice decides, not free angles.
      return this.rotateSeated(partId, BB_FOOTPRINTS_FOR_ROTATE[seated.kind]);
    }
    const part = this.getPart(partId);
    if (!part) return false;
    part.rotation = ((part.rotation || 0) + 90) % 360;
    this._saveHistory();
    return true;
  }

  /**
   * Flip a part horizontally (mirror).
   * @param {string} partId
   * @returns {boolean}
   */
  flipPart(partId) {
    const part = this.getPart(partId);
    if (!part) return false;
    part.flipped = !part.flipped;
    this._saveHistory();
    return true;
  }

  /**
   * Duplicate a part at an offset position.
   * @param {string} partId
   * @param {number} [offsetX=40]
   * @param {number} [offsetY=40]
   * @returns {PlacedPart|null}
   */
  duplicatePart(partId, offsetX = 40, offsetY = 40) {
    const src = this.getPart(partId);
    if (!src) return null;
    // Uniquify declName: led1 → led2, pot1 → pot2, etc.
    let declName;
    if (src.declName) {
      const existing = new Set(this.parts.map(p => p.declName).filter(Boolean));
      const base = src.declName.replace(/\d+$/, '');
      for (let i = 1; ; i++) {
        const candidate = base + i;
        if (!existing.has(candidate)) { declName = candidate; break; }
      }
    }
    const dup = this.addPart(src.kind, { ...src.params }, src.x + offsetX, src.y + offsetY, declName);
    if (dup && src.rotation) dup.rotation = src.rotation;
    if (dup && src.flipped) dup.flipped = src.flipped;
    return dup;
  }

  /**
   * Update a part's parameters (e.g. resistor ohms, LED color).
   * @param {string} partId
   * @param {Record<string, number|string>} newParams — merged with existing
   * @returns {boolean}
   */
  updateParams(partId, newParams) {
    const part = this.getPart(partId);
    if (!part) return false;
    Object.assign(part.params, newParams);
    this._syncNetlist();
    this._saveHistory();
    return true;
  }

  // ── Wire operations ─────────────────────────────────────────────

  /**
   * Connect two terminals with a wire.
   * If both terminals are already in the same net, does nothing.
   * If one or both are in different nets, merges them.
   *
   * @param {string} fromPart
   * @param {string} fromTerminal
   * @param {string} toPart
   * @param {string} toTerminal
   * @returns {Wire|null} the new wire, or null if invalid
   */
  addWire(fromPart, fromTerminal, toPart, toTerminal) {
    // Validate endpoints exist
    const fp = this.getPart(fromPart);
    const tp = this.getPart(toPart);
    if (!fp || !tp) return null;
    if (!fp.terminals.includes(fromTerminal)) return null;
    if (!tp.terminals.includes(toTerminal)) return null;

    // Don't wire a terminal to itself
    if (fromPart === toPart && fromTerminal === toTerminal) return null;

    // Check if already directly connected
    const existing = this.wires.find(w =>
      (w.from.part === fromPart && w.from.terminal === fromTerminal &&
       w.to.part === toPart && w.to.terminal === toTerminal) ||
      (w.from.part === toPart && w.from.terminal === toTerminal &&
       w.to.part === fromPart && w.to.terminal === fromTerminal)
    );
    if (existing) return null;

    // Find or create the net
    const fromNet = this._netForTerminal(fromPart, fromTerminal);
    const toNet = this._netForTerminal(toPart, toTerminal);

    let netId;
    if (fromNet && toNet && fromNet === toNet) {
      // Already on the same net — still add the wire for visual purposes
      netId = fromNet;
    } else if (fromNet && toNet) {
      // Merge: rename all toNet wires to fromNet
      netId = fromNet;
      for (const w of this.wires) {
        if (w.netId === toNet) w.netId = fromNet;
      }
    } else {
      netId = fromNet || toNet || genId('net');
    }

    const wire = {
      id: genId('wire'),
      netId,
      from: { part: fromPart, terminal: fromTerminal },
      to: { part: toPart, terminal: toTerminal },
    };
    this.wires.push(wire);
    this._syncNetlist();
    this._saveHistory();
    return wire;
  }

  /**
   * Remove a wire by ID.
   * @param {string} wireId
   * @returns {boolean}
   */
  removeWire(wireId) {
    const idx = this.wires.findIndex(w => w.id === wireId);
    if (idx === -1) return false;
    this.wires.splice(idx, 1);
    this._syncNetlist();
    this._saveHistory();
    return true;
  }

  /**
   * Update wire properties (e.g. color, waypoints).
   * Does not trigger netlist rebuild — these are visual-only.
   * @param {string} wireId
   * @param {object} props — merged onto the wire
   * @returns {boolean}
   */
  updateWire(wireId, props) {
    const wire = this.wires.find(w => w.id === wireId);
    if (!wire) return false;
    Object.assign(wire, props);
    this._saveHistory();
    return true;
  }

  /**
   * Get the net ID for a terminal, or null if not wired.
   */
  _netForTerminal(partId, terminal) {
    for (const w of this.wires) {
      if ((w.from.part === partId && w.from.terminal === terminal) ||
          (w.to.part === partId && w.to.terminal === terminal)) {
        return w.netId;
      }
    }
    return null;
  }

  // ── Interaction ─────────────────────────────────────────────────

  /**
   * Set a control value (pot position 0…1, button 0/1).
   * @param {string} partId
   * @param {number} value
   */
  setControl(partId, value) {
    this.board.setControl(partId, value);
  }

  /**
   * Set a pin state (for scripted MCU driving).
   * @param {string} pin
   * @param {string} mode
   * @param {boolean} driveHigh
   */
  setPin(pin, mode, driveHigh) {
    this.board.setPin(pin, mode, driveHigh);
  }

  /**
   * Advance simulation time.
   * @param {bigint} tNs
   */
  advanceTo(tNs) {
    this.timeNs = tNs;
    this.board.advanceTo(tNs);
  }

  /**
   * Advance by a delta.
   * @param {bigint} deltaNs
   */
  advanceBy(deltaNs) {
    this.advanceTo(this.timeNs + deltaNs);
  }

  /**
   * Toggle power.
   * @param {boolean} on
   */
  setPower(on) {
    this.powered = on;
    this.board.setPower(on);
  }

  // ── Instrument readings (all from engine) ───────────────────────

  /**
   * @param {string} partId
   * @returns {number} 0…1
   */
  ledBrightness(partId) {
    return this.board.ledBrightness(partId);
  }

  /**
   * @param {string} partId
   * @returns {{hz: number, on: boolean}}
   */
  buzzerTone(partId) {
    return this.board.buzzerTone(partId);
  }

  /**
   * @param {string} netId
   * @returns {number} volts
   */
  nodeVoltage(netId) {
    return this.board.nodeVoltage(netId);
  }

  /**
   * @param {string} partId
   * @param {string} terminal
   * @returns {number} amperes
   */
  branchCurrent(partId, terminal) {
    return this.board.branchCurrent(partId, terminal);
  }

  /**
   * @param {string} netA
   * @param {string} netB
   * @returns {number|'requires-power-off'}
   */
  resistance(netA, netB) {
    return this.board.resistance(netA, netB);
  }

  // ── Board query methods (for extension menus) ───────────────────

  /** @returns {string[]} net IDs */
  getNets() { return this.board.getNets ? this.board.getNets().map(n => n.id) : []; }

  /** @returns {string[]} LED part IDs */
  getLeds() { return this.board.getLeds ? this.board.getLeds() : []; }

  /** @returns {string[]} buzzer part IDs */
  getBuzzers() { return this.board.getBuzzers ? this.board.getBuzzers() : []; }

  /** @returns {Array<{id, kind, value}>} control states */
  getControls() { return this.board.getControls ? this.board.getControls() : []; }

  // ── Netlist sync ────────────────────────────────────────────────

  /**
   * Build the boundary-B netlist from the current parts and wires,
   * then call board.setNetlist(). This is called after every mutation.
   */
  _syncNetlist() {
    // Parts for the engine (strip layout fields, exclude UI-only parts like meters)
    const engineParts = this.parts.filter(p => p.kind !== 'meter' && p.kind !== 'breadboard').map(p => ({
      id: p.id,
      kind: p.kind,
      params: p.params,
      terminals: p.terminals,
    }));

    // Build nets from wires. A {board, hole} endpoint becomes a pseudo-
    // terminal "@bb:<board>"/"<hole>" — mergeNets unions through it, and it
    // is stripped again before the engine ever sees it.
    const holeEnd = (e) => e.board ? { part: `@bb:${e.board}`, terminal: e.hole } : e;
    const netMap = new Map(); // netId → Map of key → {part, terminal}
    for (const w of this.wires) {
      if (!netMap.has(w.netId)) netMap.set(w.netId, new Map());
      const net = netMap.get(w.netId);
      const f = holeEnd(w.from);
      const t = holeEnd(w.to);
      const fk = `${f.part}:${f.terminal}`;
      const tk = `${t.part}:${t.terminal}`;
      if (!net.has(fk)) net.set(fk, f);
      if (!net.has(tk)) net.set(tk, t);
    }

    const wireNets = [];
    for (const [netId, termMap] of netMap) {
      wireNets.push({
        id: netId,
        terminals: [...termMap.values()],
      });
    }

    // Fold every board's strip nets into the wire nets — union-find keeps
    // a wire that touches a seated terminal electrically ONE node. Boards
    // are independent occupancy worlds; the merge is what unifies them.
    let engineNets = wireNets;
    for (const [boardId, bb] of this.breadboards) {
      try {
        const derived = bb.deriveNets();
        const stripNets = derived.nets.map(n => ({ ...n, terminals: [...n.terminals] }));
        // Glue each tap-wire hole into its strip's net (or fabricate the
        // strip's net if nothing else lives there yet).
        for (const w of this.wires) {
          for (const e of [w.from, w.to]) {
            if (!e.board || e.board !== boardId) continue;
            const stripId = bb.stripOf(e.hole);
            const pseudo = { part: `@bb:${boardId}`, terminal: e.hole };
            const netId = derived.stripToNet.get(stripId);
            const target = netId ? stripNets.find(n => n.id === netId) : null;
            if (target) target.terminals.push(pseudo);
            else stripNets.push({ id: `n-${stripId}`, terminals: [pseudo] });
          }
        }
        engineNets = mergeNets(engineNets, stripNets);
      } catch {
        // A board mid-construction stays out of this sync; next sync catches up.
      }
    }
    // Pseudo-terminals did their gluing; the engine never meets them.
    engineNets = engineNets
      .map(n => ({ ...n, terminals: n.terminals.filter(t => !t.part.startsWith('@bb:')) }))
      .filter(n => n.terminals.length > 0);

    // Snapshot engine state before rebuilding (preserves cap voltages, etc.)
    const prevSnap = this.board.snapshot ? this.board.snapshot() : null;

    this.board = new this._BoardImpl(this.vcc);
    try {
      this.board.setNetlist(engineParts, engineNets);
      // Restore engine state if possible (surviving parts keep their state)
      if (prevSnap && this.board.restore) {
        this.board.restore(prevSnap);
      }
    } catch {
      // Partial circuit (e.g. VCC without GND) — engine validation
      // rejects incomplete netlists. This is fine during construction;
      // the next addPart/addWire will try again.
    }
  }

  /**
   * Sync the engine with externally-provided nets (e.g. from the breadboard model).
   * Uses the same parts filtering as _syncNetlist but replaces wire-derived nets.
   * @param {Array<{id: string, terminals: Array<{part: string, terminal: string}>}>} nets
   */
  syncWithExternalNets(nets) {
    const engineParts = this.parts.filter(p => p.kind !== 'meter' && p.kind !== 'breadboard').map(p => ({
      id: p.id,
      kind: p.kind,
      params: p.params,
      terminals: p.terminals,
    }));

    const prevSnap = this.board.snapshot ? this.board.snapshot() : null;
    this.board = new this._BoardImpl(this.vcc);
    try {
      this.board.setNetlist(engineParts, nets);
      if (prevSnap && this.board.restore) this.board.restore(prevSnap);
    } catch {
      // Incomplete breadboard wiring — expected during construction
    }
  }

  // ── Serialization ───────────────────────────────────────────────

  /**
   * Export the current state as a plain object (for save/load).
   */
  toJSON() {
    return {
      vcc: this.vcc,
      parts: this.parts.map(p => ({ ...p })),
      wires: this.wires.map(w => ({ ...w })),
    };
  }

  /**
   * Load state from a plain object.
   * @param {object} data
   * @returns {Circuit}
   */
  static fromJSON(data) {
    const c = new Circuit(data.vcc);
    c.parts = data.parts.map(p => ({ ...p }));
    c.wires = data.wires.map(w => ({ ...w }));
    c._syncNetlist();
    return c;
  }
}

/**
 * Return the terminal names for a given part kind.
 */
function terminalsForKind(kind, params) {
  switch (kind) {
    case 'vcc': return ['vcc'];
    case 'gnd': return ['gnd'];
    case 'resistor': return ['a', 'b'];
    case 'capacitor': return ['a', 'b'];
    case 'inductor': return ['a', 'b'];
    case 'diode': return ['anode', 'cathode'];
    case 'zener': return ['anode', 'cathode'];
    case 'led': return ['anode', 'cathode'];
    case 'rgb_led': return ['r_anode', 'g_anode', 'b_anode', 'cathode'];
    case 'potentiometer': return ['a', 'wiper', 'b'];
    case 'button': return ['a', 'b'];
    case 'switch': return ['a', 'b'];
    case 'buzzer': return ['a', 'b'];
    case 'ldr': return ['a', 'b'];
    case 'ntc': return ['a', 'b'];
    case 'npn': case 'pnp': return ['base', 'collector', 'emitter'];
    case 'nmos': case 'pmos': return ['gate', 'drain', 'source'];
    case 'opamp': return ['inp', 'inn', 'out'];
    case '555': return ['gnd', 'trigger', 'output', 'reset', 'control', 'threshold', 'discharge', 'vcc'];
    case 'relay': return ['coil_a', 'coil_b', 'no', 'com', 'nc'];
    case 'servo': return ['signal', 'vcc', 'gnd'];
    case 'dc_motor': case 'hobby_gearmotor': case 'gearmotor': return ['a', 'b'];
    case 'vibration_motor': return ['a', 'b'];
    case 'motor_encoder': return ['a', 'b', 'enc_a', 'enc_b'];
    case 'photodiode': return ['anode', 'cathode'];
    case 'solar_cell': return ['pos', 'neg'];
    case 'light_bulb': return ['a', 'b'];
    case 'soil_moisture': return ['vcc', 'gnd', 'sig'];
    case 'pir_sensor': return ['vcc', 'gnd', 'out'];
    case 'tilt_sensor': return ['a', 'b'];
    case 'ultrasonic': return ['vcc', 'gnd', 'trig', 'echo'];
    case 'tmp36': return ['vcc', 'gnd', 'vout'];
    case 'gas_sensor': return ['vcc', 'gnd', 'aout', 'dout'];
    case 'slide_switch': return ['a', 'common', 'b'];
    case 'dip_switch': return params?.switches ? Array.from({length: params.switches * 2}, (_, i) => `s${Math.floor(i/2)+1}_${i%2 === 0 ? 'a' : 'b'}`) : ['s1_a', 's1_b'];
    case 'l293d': return ['en1', 'in1', 'out1', 'gnd1', 'gnd2', 'out2', 'in2', 'en2', 'vcc', 'vs'];
    case 'relay_dpdt': return ['coil_a', 'coil_b', 'no1', 'com1', 'nc1', 'no2', 'com2', 'nc2'];
    case 'tip120': return ['base', 'collector', 'emitter'];
    case 'pcf8574': return ['sda', 'scl', 'vcc', 'gnd', 'p0', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'];
    case 'char_lcd_i2c': return ['sda', 'scl', 'vcc', 'gnd'];
    case 'clock_display': return ['clk', 'dio', 'vcc', 'gnd'];
    case 'ir_remote': return ['vcc', 'gnd', 'signal'];
    case 'neopixel': return ['din', 'dout', 'vcc', 'gnd'];
    case 'keypad': return ['r1', 'r2', 'r3', 'r4', 'c1', 'c2', 'c3', 'c4'];
    case 'header': return params?.pins ? Array.from({length: params.pins}, (_, i) => `p${i+1}`) : ['p1','p2','p3','p4','p5','p6','p7','p8'];
    case 'usb_a': return ['vcc', 'd_minus', 'd_plus', 'gnd'];
    case 'meter': return ['probe_a', 'probe_b'];
    case 'breadboard': return [];
    case 'vsource': case 'battery': return ['pos', 'neg'];
    case 'isource': return ['pos', 'neg'];
    case 'timer_555': return ['gnd', 'trigger', 'output', 'reset', 'control', 'threshold', 'discharge', 'vcc'];
    case 'seven_segment': return ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'dp', 'com'];
    case 'char_lcd': return ['rs', 'rw', 'e', 'd0', 'd1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7', 'vcc', 'gnd', 'vo', 'bl_a', 'bl_k'];
    case 'shift_register': return ['data', 'clock', 'latch', 'oe', 'q0', 'q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7'];
    case 'ir_receiver': return ['vcc', 'gnd', 'out'];
    case 'temp_sensor': return ['vcc', 'gnd', 'dq'];
    case 'eeprom': return ['sda', 'scl', 'vcc', 'gnd'];
    case 'led_matrix': return ['a', 'b'];
    case 'led_cube': return [
      ...Array.from({length: 8}, (_, i) => `sel_${i}`),
      ...Array.from({length: 8}, (_, i) => `data_${i}`),
    ];
    case 'mcu': return params?.pins || ['P1.0'];
    default: {
      // Check logic chip definitions (74HC family)
      const chipTerms = logicChipTerminals(kind);
      if (chipTerms) return chipTerms;
      return ['a', 'b'];
    }
  }
}
