/**
 * Circuit model — the mutable data structure behind the circuit designer.
 *
 * Holds parts (with layout positions), nets (wires), and the board instance.
 * Every mutation that affects the netlist calls board.setNetlist() to keep
 * the engine in sync. The UI reads instrument values from the board.
 *
 * This module is the testable core — no React, no DOM, no browser APIs.
 */

import { getEngine, engineTerminals } from '../engine.js';
import { History } from './history.js';
import { mergeNets } from './merge-nets.js';
import { BreadboardModel } from './breadboard.js';
import { logicChipTerminals } from './dip-chips.js';
import { resolveKind, resolveTerminal } from './terminal-aliases.js';
import { wireEndpoint } from './wire-endpoints.js';
import { sidecarTerminals } from './parts-registry.js';
import { computeLeadMap, rotateFootprint, FOOTPRINTS as BB_FOOTPRINTS_FOR_ROTATE } from './footprints.js';
import { getSidecar } from './parts-registry.js';

let _nextId = 1;
function genId(prefix) { return `${prefix}_${_nextId++}`; }

/**
 * Board/IC kinds → engine kind. The engine knows a fixed set of kinds
 * (resistor, led, mcu, etc.). Board-level sidecars (arduino_nano,
 * pi_pico, retro DIPs) carry richer terminal lists and footprints but
 * the engine treats them all as 'mcu' passthrough (null terminal
 * validation, pin-state driven). Any kind with a sidecar that the
 * engine doesn't know gets mapped here.
 */
const PASSTHROUGH_KINDS = new Set([
  // MCU boards
  'stc_mcu', 'stc15_mcu', 'at89c2051', 'arduino_nano', 'arduino_uno', 'arduino_mega',
  'pi_pico', 'attiny85', 'attiny88', 'attiny13', 'attiny2313', 'microbit',
  // Retro DIPs (6502 family)
  'w65c02', 'w65c22', 'w65c51',
  // Machine-layer peripherals (bw-board implements them chip-level; the
  // electrical board only needs their terminals seatable and driveable)
  'ps2',
  // Memory ICs
  '28c256', '62256',
  // 6507 family
  'r6507', 'mos6532',
  // Z80 family
  'z80', 'mc6850',
  // Video / retro DIPs (machine-class, engine has device models)
  'tms9918', 'mc6845', 'ns16c550',
  // Board / module variants
  'microbit_breakout', 'pololu_motor_ctrl',
  // Video cards (machine-class sidecars, rendered as machine faces)
  'simplevga_card', 'tilevga', 'vga_prop_card',
  // Parallel display variant
  'ili9341_parallel',
]);
function engineKindFor(kind) {
  if (!PASSTHROUGH_KINDS.has(kind)) return kind;
  // A kind the engine has a REGISTERED device model for keeps its identity:
  // the model is strictly more truthful than the generic 'mcu' surface —
  // its power pins actually source (a Mega's 5v pin fed nothing as 'mcu'),
  // gpioFollowsPinStates drives its GPIO, and readPin works through it.
  // Kinds the engine does not know (older engine builds, machine-class
  // DIPs) keep collapsing to 'mcu' exactly as before.
  try {
    const eng = getEngine();
    if (eng && typeof eng.hasDevice === 'function' && eng.hasDevice(kind)) return kind;
  } catch { /* engine not injected yet — construction-time default below */ }
  return 'mcu';
}

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
   * Move a seated part by whole holes — the arrow-key move on a breadboard.
   * Every lead shifts together; the move happens only if EVERY target hole
   * exists and is free, else the part stays exactly where it was.
   * @param {string} partId @param {number} dcol @param {number} drow
   * @returns {boolean} moved
   */
  nudgeSeated(partId, dcol, drow) {
    const part = this.parts.find(p => p.id === partId);
    if (!part || !part.seat) return false;
    const { boardId, leadMap } = part.seat;
    const bb = this.breadboards.get(boardId);
    if (!bb) return false;
    const ROWS = 'abcdefghij';
    const shifted = {};
    for (const [term, hole] of Object.entries(leadMap)) {
      const rail = /^([tb][+-])(\d+)$/.exec(hole);
      if (rail) {
        if (drow !== 0) return false; // rails move sideways only
        shifted[term] = `${rail[1]}${Number(rail[2]) + dcol}`;
        continue;
      }
      const m = /^([a-j])(\d+)$/.exec(hole);
      if (!m) return false;
      const ri = ROWS.indexOf(m[1]) + drow;
      // Rows shift within the board only — crossing the gutter is a
      // different circuit, not a nudge.
      if (ri < 0 || ri > 9) return false;
      if ((ROWS.indexOf(m[1]) <= 4) !== (ri <= 4)) return false;
      shifted[term] = `${ROWS[ri]}${Number(m[2]) + dcol}`;
    }
    for (const h of Object.values(shifted)) {
      if (!bb.isValidHole(h)) return false;
    }
    const prev = { ...leadMap };
    this.unseatPart(partId);
    if (this.seatPart(partId, boardId, shifted)) return true;
    this.seatPart(partId, boardId, prev); // occupied: restore, unmoved
    return false;
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
    if (kind === 'breadboard') this.breadboards.set(part.id, new BreadboardModel(part.params));
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

  /** Set a named device parameter (e.g. the keypad's pressed key) and re-solve. */
  setPartParam(partId, param, value) {
    if (this.board.setPartParam) this.board.setPartParam(partId, param, value);
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
    // Board-level MCU kinds (arduino_nano, pi_pico, etc.) map to 'mcu' for the engine.
    const engineParts = this.parts.filter(p => p.kind !== 'meter' && p.kind !== 'breadboard').map(p => ({
      id: p.id,
      kind: engineKindFor(p.kind),
      params: p.params,
      terminals: p.terminals,
    }));

    // Build nets from wires. A {board, hole} endpoint becomes a pseudo-
    // terminal "@bb:<board>"/"<hole>" — mergeNets unions through it, and it
    // is stripped again before the engine ever sees it.
    const holeEnd = (e) => e.board ? { part: `@bb:${e.board}`, terminal: e.hole } : e;

    // One physical pin must be ONE net key. seat.leadMap spells STC pins
    // uppercase ("P1.0") while part.terminals and the wires that reference
    // them are lowercase ("p1.0"), so the union-find below saw two distinct
    // terminals and split one pin into two nets: the breadboard column got
    // MCU:P1.0 and the LED's wire got MCU:p1.0. The circuit still solved
    // (the stray half was a singleton), but findPinNet could resolve the
    // schematic's pin to the empty half and draw the MCU driving nothing —
    // 27 STC15 variants rendered exactly that. Canonicalise every terminal
    // to the part's DECLARED spelling before any net key is built.
    const canonBy = new Map(); // partId -> Map(lowercase -> declared spelling)
    for (const p of this.parts) {
      const m = new Map();
      for (const t of p.terminals || []) m.set(String(t).toLowerCase(), t);
      canonBy.set(p.id, m);
    }
    const canonEnd = (e) => {
      const m = canonBy.get(e.part);
      if (!m) return e; // pseudo-terminals (@bb:*) and unknown parts pass through
      const declared = m.get(String(e.terminal).toLowerCase());
      return declared === undefined || declared === e.terminal
        ? e : { ...e, terminal: declared };
    };
    const netMap = new Map(); // netId → Map of key → {part, terminal}
    for (const w of this.wires) {
      if (!netMap.has(w.netId)) netMap.set(w.netId, new Map());
      const net = netMap.get(w.netId);
      const f = canonEnd(holeEnd(w.from));
      const t = canonEnd(holeEnd(w.to));
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
        const derived = bb.deriveNets(boardId);
        // Retained for the canvas: hole -> net resolution at render time
        // (voltage labels on breadboard jumpers need the strip's net id).
        if (!this.boardStripNets) this.boardStripNets = new Map();
        this.boardStripNets.set(boardId, derived.stripToNet);
        const stripNets = derived.nets.map(n => ({ ...n, terminals: n.terminals.map(canonEnd) }));
        // Glue each tap-wire hole into its strip's net (or fabricate the
        // strip's net if nothing else lives there yet). For column strips
        // (not rails), track fabricated nets so multiple taps into the same
        // unoccupied column share one net — without this, two taps to
        // different rows of the same column each create their own net and
        // the strip fails to conduct (the seated-board wiring pattern).
        // Rail strips are left unfixed: merging them triggers a bw-board
        // cap-companion bug where setPin zeros out all voltages (spec-update
        // pending).
        const fabricated = new Map(); // stripId → net object (columns only)
        for (const w of this.wires) {
          for (const e of [w.from, w.to]) {
            if (!e.board || e.board !== boardId) continue;
            const stripId = bb.stripOf(e.hole);
            const pseudo = { part: `@bb:${boardId}`, terminal: e.hole };
            const netId = derived.stripToNet.get(stripId);
            const target = netId ? stripNets.find(n => n.id === netId) : null;
            if (target) {
              target.terminals.push(pseudo);
            } else if (!stripId.startsWith('rail-') && fabricated.has(stripId)) {
              fabricated.get(stripId).terminals.push(pseudo);
            } else {
              const net = { id: `n-${stripId}`, terminals: [pseudo] };
              stripNets.push(net);
              if (!stripId.startsWith('rail-')) fabricated.set(stripId, net);
            }
          }
        }
        engineNets = mergeNets(engineNets, stripNets);
      } catch {
        // A board mid-construction stays out of this sync; next sync catches up.
      }
    }
    // Pseudo-terminals did their gluing; the engine never meets them.
    engineNets = engineNets
      .map(n => ({
        ...n,
        // Also sheds any terminal without a string part — malformed data
        // must degrade to a missing connection, never to a render crash.
        terminals: n.terminals.filter(t => typeof t.part === 'string' && !t.part.startsWith('@bb:')),
      }))
      .filter(n => n.terminals.length > 0);

    // The resolved view — wires, rows and jumpers unioned into single
    // nodes — is what net-aware consumers (declaration derivation for
    // seated benches) need; keep it accessible after the sync.
    this.resolvedNets = engineNets;

    // Snapshot engine state before rebuilding (preserves cap voltages, etc.)
    const prevSnap = this.board.snapshot ? this.board.snapshot() : null;

    this.board = new this._BoardImpl(this.vcc);
    try {
      this.board.setNetlist(engineParts, engineNets);
      // Restore engine state if possible (surviving parts keep their state)
      if (prevSnap && this.board.restore) {
        this.board.restore(prevSnap);
      }
      this.netlistError = null;
    } catch (e) {
      // Partial circuit (e.g. VCC without GND) — engine validation
      // rejects incomplete netlists. This is fine during construction;
      // the next addPart/addWire will try again. But SAY SO: this catch
      // once swallowed a crashed validator, and the empty board it left
      // behind took a six-layer debugging chain to trace back here
      // (the pendant, 2026-08-16). The error is kept for the UI and
      // warned once per distinct message, not per keystroke.
      this.netlistError = (e && e.message) || String(e);
      if (this.netlistError !== this._warnedNetlistError) {
        console.warn('[circuit] netlist rejected — the board is EMPTY until this clears:', this.netlistError);
        this._warnedNetlistError = this.netlistError;
      }
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
      kind: engineKindFor(p.kind),
      params: p.params,
      terminals: p.terminals,
    }));

    this.resolvedNets = nets;

    const prevSnap = this.board.snapshot ? this.board.snapshot() : null;
    this.board = new this._BoardImpl(this.vcc);
    try {
      this.board.setNetlist(engineParts, nets);
      if (prevSnap && this.board.restore) this.board.restore(prevSnap);
      this.netlistError = null;
    } catch (e) {
      // Incomplete breadboard wiring — expected during construction.
      // Same loudness contract as _syncNetlist above.
      this.netlistError = (e && e.message) || String(e);
      if (this.netlistError !== this._warnedNetlistError) {
        console.warn('[circuit] netlist rejected — the board is EMPTY until this clears:', this.netlistError);
        this._warnedNetlistError = this.netlistError;
      }
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
      // Jumpers live in the per-board occupancy models — without this they
      // silently vanished from saves and the restored board stopped
      // conducting through its rails.
      holeWires: this.holeWires(),
    };
  }

  /**
   * Load state from a plain object.
   * @param {object} data
   * @returns {Circuit}
   */
  static fromJSON(data) {
    const c = new Circuit(data.vcc);
    // Legacy files also predate parts carrying their terminal list — every
    // renderer maps over part.terminals, so a missing list was the SECOND
    // way a gallery file crashed the GUI (pure-circuit examples, same day
    // as the wire-format crash). Derive it exactly as addPart does.
    // Legacy kind names the engine never had: 'battery' is a vsource with
    // pos/neg terminals and a volts param — same physics, older word.
    c.parts = data.parts.map(p => {
      const kind = resolveKind(p.kind);
      return {
        ...p,
        kind,
        // The THIRD way a params-less part crashed the app: the engine's
        // validateNetlist was the first (bw-board 355547e), terminals the
        // second, and the renderer's bare `params.color` reads the third
        // (eater6502-full-build, 2026-08-17 — button and LED faces map
        // over parts and a missing object took the whole app down).
        // Guarantee the object here, at the one choke point every load
        // shares, so no downstream reader needs to re-learn this.
        params: (p.params && typeof p.params === 'object') ? p.params : {},
        rotation: p.rotation ?? 0,
        terminals: Array.isArray(p.terminals) ? p.terminals : terminalsForKind(kind, p.params || {}),
      };
    });
    // Wires arrive in two dialects. Current saves carry endpoint objects
    // ({from: {part, terminal}}); the example gallery's circuit files were
    // written against the ORIGINAL flat format ({from: 'id', fromTerminal:
    // 't'}). Loading one of those used to build endpoints with undefined
    // parts, which crashed _syncNetlist mid-render and took the whole GUI
    // down to the crash page (2026-08-10, "Blink an LED"). Normalize both;
    // drop anything that resolves to no part/terminal — a lost wire renders
    // as a gap the user can see and re-draw, a throw renders as nothing at
    // all.
    // The canonical dialect reader (wire-endpoints.js) — its validity
    // rules were lifted from this very function, so behaviour is
    // unchanged; the hand-rolled copy is retired.
    c.wires = (data.wires || []).flatMap(w => {
      const from = wireEndpoint(w, 'from');
      const to = wireEndpoint(w, 'to');
      if (!from || !to) return [];
      // Legacy wires have no id either; the canvas hashes wire.id for
      // stable rendering offsets, so a missing one is a render crash.
      return [{ ...w, from, to, id: typeof w.id === 'string' ? w.id : genId('wire') }];
    });
    // Resolve wire terminal aliases: a wire referencing "data" on a part
    // whose sidecar-derived terminals say "ser" must resolve, or _syncNetlist
    // silently produces 0 nets and the schematic draws 0 wires.
    const partMap = new Map(c.parts.map(p => [p.id, p]));
    for (const w of c.wires) {
      for (const e of [w.from, w.to]) {
        if (!e || e.board) continue;
        const p = partMap.get(e.part);
        if (p && !p.terminals.includes(e.terminal)) {
          e.terminal = resolveTerminal(p.kind, e.terminal, p.terminals);
        }
      }
    }
    // Legacy wires also carry no netId — and _syncNetlist groups BY netId,
    // so they all landed in one `undefined` group: the entire circuit became
    // a single net, a silent short. Union wires that share an endpoint (the
    // grouping addWire computes incrementally) and stamp group ids.
    {
      const parent = new Map();
      const find = k => {
        let r = k;
        while (parent.get(r) !== r) r = parent.get(r);
        parent.set(k, r);
        return r;
      };
      const key = e => e.board ? `@bb:${e.board}:${e.hole}` : `${e.part}:${e.terminal}`;
      const wireKey = (w, i) => `w${i}`;
      const need = c.wires.filter(w => typeof w.netId !== 'string');
      for (const [i, w] of need.entries()) {
        for (const k of [wireKey(w, i), key(w.from), key(w.to)]) {
          if (!parent.has(k)) parent.set(k, k);
        }
        const wr = find(wireKey(w, i));
        parent.set(find(key(w.from)), wr);
        parent.set(find(key(w.to)), wr);
      }
      const groups = new Map();
      for (const [i, w] of need.entries()) {
        const root = find(wireKey(w, i));
        if (!groups.has(root)) groups.set(root, `net-lgc-${groups.size + 1}`);
        w.netId = groups.get(root);
      }
    }
    // Rebuild what serialization flattens: every breadboard part gets its
    // occupancy model back, and every seated part re-occupies its holes.
    // Without this, a loaded save LOOKED right but the strips no longer
    // conducted - the LED that was lit when saved came back dark.
    for (const p of c.parts) {
      if (p.kind === 'breadboard') c.breadboards.set(p.id, new BreadboardModel(p.params));
    }
    for (const p of c.parts) {
      if (!p.seat) continue;
      const bb = c.breadboards.get(p.seat.boardId);
      if (!bb) { delete p.seat; continue; }
      try { bb.occupy(p.id, p.seat.leadMap); } catch { delete p.seat; }
    }
    for (const jw of data.holeWires || []) {
      const bb = c.breadboards.get(jw.boardId);
      if (!bb) continue;
      const id = jw.ref ? jw.ref.split(':').pop() : genId('bbw');
      try { bb.addWire(id, jw.a, jw.b, jw.color); } catch { /* occupied: drop honestly */ }
    }
    c._syncNetlist();
    return c;
  }
}

/**
 * Kinds that keep the local catalog even when the engine has a model.
 *
 * `header` is the ONLY genuinely params-dependent kind: its terminals come
 * from `params.pins`, so a fixed engine list (p1..p8) would silently turn
 * every 6- or 10-way header into an 8-way one. Every other registered kind
 * was probed with two different params objects and returned the same list,
 * so "it's dynamic" is not an excuse available to anything else here.
 *
 * @type {Set<string>}
 */
const ENGINE_AUTHORITY_EXEMPT = new Set(['header']);

/**
 * Return the terminal names for a given part kind.
 *
 * ENGINE-FIRST. bw-board's registered device model is the authority for
 * terminal NAMES; a divergence is a bug in the catalog, never in the
 * engine. Before this, the catalog resolved sidecar -> switch -> ['a','b'],
 * consulting the engine nowhere: `addPart('vreg')` minted terminals a/b
 * against an engine that has in/out/gnd, `checkWiring` rejected the whole
 * netlist, and the board went EMPTY with one part on it and no wires.
 *
 * The engine is only consulted when the host injected `getDevice` into
 * setEngine(). A host that injects the three original keys gets exactly the
 * old resolution order, which is why this is a safe additive change.
 *
 * Below the engine, the old order still applies for kinds the engine has no
 * model for (built-ins, unregistered kinds): sidecar -> switch -> ['a','b'].
 *
 * POSITIONS: the canvas looks terminal positions up BY NAME out of the
 * sidecar, so an engine name the sidecar does not carry renders at the part
 * origin. The fix for that is in the sidecar, not here — `src/parts-data/`
 * was renamed to the engine's names wherever the two describe the same
 * physical pin (see test/hd44780-terminal-parity.test.js's ledger).
 */
/** @internal Exported for the contract test only. */
export function terminalsForKind(kind, params) {
  if (!ENGINE_AUTHORITY_EXEMPT.has(kind)) {
    const fromEngine = engineTerminals(kind);
    if (fromEngine) return fromEngine;
  }
  // Sidecar-first: a parts-data JSON with measured terminal positions is the
  // authority — the hardcoded switch below is the FALLBACK for kinds that have
  // no sidecar (simple passives, power symbols, dynamic-terminal kinds like
  // mcu). Without this order the switch SHADOWS a correct sidecar: slide_switch
  // once returned ['a','common','b'] here while the sidecar and engine both
  // agreed on 'com', silently rejecting every wire to the switch (0/0 board).
  // Dynamic-terminal kinds (mcu, led_cube, breadboard) still need the switch.
  const DYNAMIC_SWITCH_KINDS = new Set([
    'vcc', 'gnd', 'mcu', 'led_cube', 'breadboard',
    'arduino_uno', 'arduino_nano', 'arduino_mega', 'pi_pico',
    'stc_mcu', 'stc15_mcu', 'microbit', 'microbit_breakout',
  ]);
  if (!DYNAMIC_SWITCH_KINDS.has(kind)) {
    const sc = sidecarTerminals(kind);
    if (sc && sc.length > 0) return sc;
  }
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
    // Physical pin order (end, wiper, end) — matches the sidecar, which is
    // the authority. A fallback that disagrees only shows up on kinds whose
    // sidecar is missing, so keep the two in step.
    case 'potentiometer': return ['a', 'wiper', 'b'];
    case 'button': return ['a', 'b'];
    case 'switch': return ['a', 'b'];
    case 'buzzer': return ['a', 'b'];
    case 'ldr': return ['a', 'b'];
    case 'ntc': return ['a', 'b'];
    case 'npn': case 'pnp': return ['base', 'collector', 'emitter'];
    case 'nmos': case 'pmos': return ['gate', 'drain', 'source'];
    case 'opamp': return ['inp', 'inn', 'out'];
    case 'gate_and': case 'gate_or': case 'gate_nand': case 'gate_nor': case 'gate_xor': return ['in0', 'in1', 'out'];
    // Engine name (bw-board kind table): in0, not in — gallery wires
    // reference in0 and a mismatch renders as ghost terminals.
    case 'gate_not': return ['in0', 'out'];
    case '555': return ['vcc', 'gnd', 'trigger', 'threshold', 'control', 'discharge', 'output', 'reset'];
    case 'relay': return ['coil_a', 'coil_b', 'com', 'nc', 'no'];
    case 'servo': return ['signal', 'vcc', 'gnd'];
    case 'ili9341': return ['vcc', 'gnd', 'cs', 'rst', 'dc', 'mosi', 'sck', 'miso', 'led'];
    // Engine device names = datasheet names (vss/vdd/v0, a/k backlight).
    // The sidecar already says these; this list disagreeing was the ghost-
    // terminal disease: every wire to 'vcc'/'vo'/'bl_a' failed engine
    // validation and the WHOLE bench board went phantom (eater6502-full-
    // build, 2026-08-16). Old spellings migrate via TERMINAL_ALIASES.
    case 'hd44780': return ['rs', 'rw', 'e', 'd0', 'd1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7', 'vss', 'vdd', 'v0', 'a', 'k'];
    case 'at24c64': return ['a0', 'a1', 'a2', 'gnd', 'sda', 'scl', 'wp', 'vcc'];
    case 'adxl335': return ['vcc', 'gnd', 'xout', 'yout', 'zout', 'st'];
    case 'memsic2125': return ['vcc', 'gnd', 'xout', 'yout'];
    case 'matrix8x8': return ['col0', 'col1', 'col2', 'col3', 'col4', 'col5', 'col6', 'col7', 'row0', 'row1', 'row2', 'row3', 'row4', 'row5', 'row6', 'row7'];
    case 'dc_motor': case 'gearmotor': return ['a', 'b'];
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
    // Engine + sidecar say 'com' — 'common' here was the ghost-terminal
    // disease again (a power switch wired to com failed netlist validation).
    case 'slide_switch': return ['a', 'com', 'b'];
    // Engine + sidecar agree: FOUR switches, s0..s3 (0-indexed), and
    // params.switches is the CLOSED-switch BITMASK — this case used to
    // read it as a switch COUNT and mint s1..sN terminals, a third
    // dialect that rejected any bench wiring the real pins (z80-pd-bench
    // stage one, 2026-08-17).
    case 'dip_switch': return ['s0_a', 's0_b', 's1_a', 's1_b', 's2_a', 's2_b', 's3_a', 's3_b'];
    case 'l293d': case 'h_bridge': return ['vcc', 'gnd', 'en1', 'in1', 'out1', 'in2', 'out2', 'en2', 'vs'];
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
    case 'timer_555': return ['vcc', 'gnd', 'trigger', 'threshold', 'control', 'discharge', 'output', 'reset'];
    case 'seven_segment': return ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'dp', 'com'];
    case 'seven_seg_3': return ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'dp', 'com0', 'com1', 'com2'];
    case 'seven_seg_4': return ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'dp', 'com0', 'com1', 'com2', 'com3'];
    case 'char_lcd': return ['rs', 'rw', 'e', 'd0', 'd1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7', 'vcc', 'gnd', 'vo', 'bl_a', 'bl_k'];
    case 'shift_register': return ['data', 'clock', 'latch', 'oe', 'q0', 'q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7'];
    case 'ir_receiver': return ['vcc', 'gnd', 'out'];
    case 'temp_sensor': return ['vcc', 'gnd', 'dq'];
    case 'eeprom': return ['sda', 'scl', 'vcc', 'gnd'];
    case 'ssd1306': case 'sh1106': return ['vcc', 'gnd', 'sda', 'scl'];
    case 'bmp280': return ['vcc', 'gnd', 'sda', 'scl'];
    case 'tcs34725': return ['vcc', 'gnd', 'sda', 'scl', 'int', 'led'];
    case 'ina219': return ['vcc', 'gnd', 'sda', 'scl', 'vin_p', 'vin_n'];
    case 'vl53l0x': return ['vcc', 'gnd', 'sda', 'scl', 'xshut', 'gpio1'];
    case 'sgp30': return ['vcc', 'gnd', 'sda', 'scl'];
    case 'veml7700': return ['vcc', 'gnd', 'sda', 'scl'];
    case 'as5600': return ['vcc', 'gnd', 'sda', 'scl', 'dir', 'out'];
    case 'mono_lcd': return ['vcc', 'gnd'];
    case 'rgb_light': return ['vcc', 'gnd'];
    case 'matrix9x9': return [
      'col0','col1','col2','col3','col4','col5','col6','col7','col8',
      'row0','row1','row2','row3','row4','row5','row6','row7','row8',
    ];
    // PS/2 keyboard: protocol delivery is machine-side; the terminals
    // mirror bw-board's ps2 device contract. The generic a/b fallback
    // made the ENGINE reject the whole 6502-full-build netlist — the
    // designer board stayed empty and the machine drove a phantom
    // ('designer board empty', owner: LCD Hello shows nothing).
    case 'ps2': return ['d0', 'd1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7', 'da'];
    case 'led_matrix': return ['a', 'b'];
    case 'led_cube': return [
      ...Array.from({length: 8}, (_, i) => `sel_${i}`),
      ...Array.from({length: 8}, (_, i) => `data_${i}`),
    ];
    case 'mcu': {
      // The chip shows ALL physical pins (sidecar pin map, datasheet-true),
      // not only the declared ones - you wire to a real DIP-40, and the
      // declarations light up the pins the program drives. Falls back to
      // the declared list when no sidecar is registered (node tools).
      const sc = getSidecar('mcu');
      const declared = Array.isArray(params?.pins) ? params.pins : ['P1.0'];
      if (sc && sc.terminals && sc.terminals.length > 2) {
        const names = sc.terminals.map(t => t.name);
        for (const d of declared) if (!names.includes(d)) names.push(d);
        return names;
      }
      return declared;
    }
    default: {
      // Check logic chip definitions (74HC family)
      const chipTerms = logicChipTerminals(kind);
      if (chipTerms) return chipTerms;
      // Sidecar fallback — for kinds without explicit switch-case entries
      const sc = sidecarTerminals(kind);
      if (sc && sc.length > 0) return sc;
      return ['a', 'b'];
    }
  }
}
