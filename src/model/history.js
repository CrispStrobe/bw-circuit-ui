/**
 * Undo/redo history for the circuit model.
 *
 * Stores snapshots of { parts, wires } after each mutation,
 * plus an optional engine snapshot (Maps, BigInts — not JSON-safe)
 * kept alongside for restore across undo/redo.
 */

const MAX_HISTORY = 50;

export class History {
  constructor() {
    /** @type {string[]} — JSON-serialized layout snapshots */
    this._stack = [];
    /** @type {(object|null)[]} — engine snapshots (opaque, not serialized) */
    this._engineStack = [];
    /** @type {number} — current position in the stack */
    this._cursor = -1;
  }

  /**
   * Save a snapshot. Truncates any redo states.
   * @param {{ parts: Array, wires: Array, engineSnap?: object }} state
   */
  save(state) {
    const json = JSON.stringify({ parts: state.parts, wires: state.wires });

    // Don't save if identical to current (e.g. movePart to same position)
    if (this._cursor >= 0 && this._stack[this._cursor] === json) return;

    // Truncate redo states
    this._stack.length = this._cursor + 1;
    this._engineStack.length = this._cursor + 1;
    this._stack.push(json);
    this._engineStack.push(state.engineSnap || null);

    // Cap size
    if (this._stack.length > MAX_HISTORY) {
      this._stack.shift();
      this._engineStack.shift();
    }
    this._cursor = this._stack.length - 1;
  }

  /**
   * @returns {{ parts, wires, engineSnap } | null}
   */
  undo() {
    if (this._cursor <= 0) return null;
    this._cursor--;
    const layout = JSON.parse(this._stack[this._cursor]);
    layout.engineSnap = this._engineStack[this._cursor];
    return layout;
  }

  /**
   * @returns {{ parts, wires, engineSnap } | null}
   */
  redo() {
    if (this._cursor >= this._stack.length - 1) return null;
    this._cursor++;
    const layout = JSON.parse(this._stack[this._cursor]);
    layout.engineSnap = this._engineStack[this._cursor];
    return layout;
  }

  /** @returns {boolean} */
  get canUndo() { return this._cursor > 0; }

  /** @returns {boolean} */
  get canRedo() { return this._cursor < this._stack.length - 1; }

  /** @returns {number} */
  get length() { return this._stack.length; }
}
