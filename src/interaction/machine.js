/**
 * The canvas interaction state machine.
 *
 * One machine owns every primary-button gesture: select, click-vs-drag
 * disambiguation, group drag, marquee, and wiring. It is pure JS — no DOM,
 * no React — driven by world-coordinate pointer events and a hit-test
 * interface, emitting semantic callbacks. That is what makes "can I select
 * a part" a unit test instead of a hope.
 *
 * The rules that fix the reported failures:
 *
 *  - A press is not a drag until it moves `threshold` world units
 *    (≈4 screen px). Jittery clicks select; deliberate moves drag.
 *  - Pressing an UNSELECTED part selects it immediately on pointerdown
 *    (replace, or toggle with shift) — feedback before the finger lifts.
 *    Pressing an already-selected part defers to pointerup, so a group
 *    drag does not collapse the selection first.
 *  - Dragging moves the WHOLE selection, not one part.
 *  - Marquee REPLACES the selection (adds with shift) and hit-tests part
 *    bounding boxes, not centres.
 *  - A wire gesture starts on a terminal, previews live with terminal
 *    snapping, and commits only terminal-to-terminal. Esc aborts.
 *
 * The pan/zoom gestures live OUTSIDE this machine (wheel + middle-button in
 * the canvas layer): panning mutates the transform that world coordinates
 * come from, so it must not run through world-space state.
 *
 * @module
 */

/**
 * @typedef {object} HitTest
 * @property {(wx: number, wy: number) => string | null} partAt
 * @property {(wx: number, wy: number, radius: number) => {partId: string, terminal: string, x: number, y: number} | null} terminalAt
 * @property {(wx: number, wy: number, radius: number) => string | null} wireAt
 * @property {(rect: {x1: number, y1: number, x2: number, y2: number}) => string[]} partsInRect
 */

/**
 * @typedef {object} InteractionCallbacks
 * @property {(partIds: string[], mode: 'replace' | 'toggle' | 'add') => void} select
 * @property {(wireId: string, mode: 'replace' | 'toggle') => void} selectWire
 * @property {() => void} clearSelection
 * @property {(dxWorld: number, dyWorld: number) => void} moveSelection - live, unsnapped delta
 * @property {() => void} endMove - gesture finished: snap + save history here
 * @property {(from: {partId: string, terminal: string}, to: {partId: string, terminal: string}) => void} createWire
 * @property {(from: object, toWorld: {x: number, y: number}, snapped: object | null) => void} wirePreview
 * @property {() => void} clearWirePreview
 * @property {(rect: {x1: number, y1: number, x2: number, y2: number} | null) => void} marqueeRect
 */

const TERMINAL_RADIUS_PX = 14;   // generous: terminals are small targets
const WIRE_RADIUS_PX = 12;
const DRAG_THRESHOLD_PX = 4;

export class InteractionMachine {
  /**
   * @param {HitTest} hit
   * @param {InteractionCallbacks} cb
   * @param {() => Set<string>} getSelection - current selected part ids
   * @param {(px: number) => number} worldDistance - screen px → world units
   */
  constructor(hit, cb, getSelection, worldDistance) {
    this.hit = hit;
    this.cb = cb;
    this.getSelection = getSelection;
    this.worldDistance = worldDistance;
    /** @type {string} */
    this.state = 'idle';
    this._gesture = null;
  }

  /** Abort whatever is in flight (Esc, pointercancel, blur). */
  cancel() {
    if (this.state === 'wiring' || this.state === 'stickyWiring') this.cb.clearWirePreview();
    if (this.state === 'rewiring' && this.cb.rewirePreview) this.cb.rewirePreview(null);
    if ((this.state === 'holeWiring' || this.state === 'stickyHoleWiring') && this.cb.holeWirePreview) this.cb.holeWirePreview(null);
    if (this.state === 'marquee') this.cb.marqueeRect(null);
    if (this.state === 'draggingParts') this.cb.endMove();
    if (this.state === 'placing') {
      this.cb.placeGhost(null);
      if (this.cb.placingDone) this.cb.placingDone(false);
    }
    this.state = 'idle';
    this._gesture = null;
  }

  /**
   * Arm ghost placement of a new part (from the palette). Two flows share
   * this state: press-drag-release (palette pointerdown → drag onto the
   * canvas → release commits at the release point) and click-then-click
   * (palette click arms; the part rides the cursor as a ghost; a canvas
   * click commits). Esc cancels either.
   * @param {string} kind @param {object} params
   */
  startPlacing(kind, params) {
    this.cancel();
    this.state = 'placing';
    this._gesture = { kind, params, x: null, y: null };
  }

  _commitPlace(wx, wy) {
    const g = this._gesture;
    this.cb.placePart(g.kind, g.params, wx, wy);
    this.cb.placeGhost(null);
    if (this.cb.placingDone) this.cb.placingDone(true);
    this.state = 'idle';
    this._gesture = null;
  }

  /**
   * Primary-button pointerdown in world coordinates.
   * @param {number} wx @param {number} wy
   * @param {{shiftKey?: boolean}} mods
   */
  down(wx, wy, mods = {}) {
    if (this.state === 'placing') {
      this._commitPlace(wx, wy);
      return;
    }

    // Sticky wiring: a previous CLICK on a connector armed us; this click
    // commits (terminal or hole) or cancels on empty ground.
    if (this.state === 'stickyWiring' || this.state === 'stickyHoleWiring') {
      const g0 = this._gesture;
      const term = this.hit.terminalAt(wx, wy, this.worldDistance(TERMINAL_RADIUS_PX));
      const hole = !term && this.hit.holeAt
        ? this.hit.holeAt(wx, wy, this.worldDistance(TERMINAL_RADIUS_PX / 2)) : null;
      this.cb.clearWirePreview();
      if (this.cb.holeWirePreview) this.cb.holeWirePreview(null);
      this.state = 'idle'; this._gesture = null;
      if (g0.from.partId !== undefined) {
        if (term && !(term.partId === g0.from.partId && term.terminal === g0.from.terminal)) {
          this.cb.createWire({ partId: g0.from.partId, terminal: g0.from.terminal },
            { partId: term.partId, terminal: term.terminal });
        } else if (hole && this.cb.createTapWire) {
          this.cb.createTapWire({ partId: g0.from.partId, terminal: g0.from.terminal }, hole);
        }
      } else {
        if (hole && hole.boardId === g0.from.boardId && hole.hole !== g0.from.hole && this.cb.createHoleWire) {
          this.cb.createHoleWire(g0.from.boardId, g0.from.hole, hole.hole);
        } else if (term && this.cb.createTapWire) {
          this.cb.createTapWire({ partId: term.partId, terminal: term.terminal }, g0.from);
        }
      }
      return;
    }

    if (this.state !== 'idle') this.cancel();

    // A SELECTED wire's endpoint handle wins over everything: grabbing it
    // re-routes that end (drop on a terminal or hole commits; anywhere
    // else cancels and the wire stays as it was).
    if (this.hit.wireEndpointAt) {
      const ep = this.hit.wireEndpointAt(wx, wy, this.worldDistance(TERMINAL_RADIUS_PX));
      if (ep) {
        this.state = 'rewiring';
        this._gesture = { wireId: ep.wireId, fixed: ep.fixedEnd, fixedPos: ep.fixedPos };
        if (this.cb.rewirePreview) this.cb.rewirePreview(ep.fixedPos, { x: wx, y: wy }, false);
        return;
      }
    }

    // Terminals win over part bodies: they are smaller and on top.
    const terminal = this.hit.terminalAt(wx, wy, this.worldDistance(TERMINAL_RADIUS_PX));
    if (terminal) {
      this.state = 'wiring';
      this._gesture = { from: terminal, startX: wx, startY: wy, moved: false };
      this.cb.wirePreview(terminal, { x: wx, y: wy }, null);
      return;
    }

    // A free hole on a board starts a JUMPER — checked before the part
    // body, because every hole lies inside the breadboard's bounds. Occupied
    // holes hold legs, and legs are terminals, which won above.
    if (this.hit.holeAt) {
      const hole = this.hit.holeAt(wx, wy, this.worldDistance(TERMINAL_RADIUS_PX / 2));
      if (hole) {
        this.state = 'holeWiring';
        this._gesture = { from: hole, startX: wx, startY: wy, moved: false };
        if (this.cb.holeWirePreview) this.cb.holeWirePreview(hole, { x: wx, y: wy }, null);
        return;
      }
    }

    const partId = this.hit.partAt(wx, wy);
    if (partId) {
      const selected = this.getSelection();
      if (mods.shiftKey) {
        this.cb.select([partId], 'toggle');
        // A shift-click never starts a drag; it is pure selection surgery.
        this.state = 'idle';
        return;
      }
      if (!selected.has(partId)) {
        this.cb.select([partId], 'replace');
      }
      this.state = 'pressedPart';
      this._gesture = { partId, startX: wx, startY: wy, lastX: wx, lastY: wy, wasSelected: selected.has(partId) };
      return;
    }

    const wireId = this.hit.wireAt(wx, wy, this.worldDistance(WIRE_RADIUS_PX));
    if (wireId) {
      this.cb.selectWire(wireId, mods.shiftKey ? 'toggle' : 'replace');
      this.state = 'idle';
      return;
    }

    // Empty ground: arm a marquee.
    this.state = 'marqueeArm';
    this._gesture = { startX: wx, startY: wy, shift: !!mods.shiftKey };
  }

  /** @param {number} wx @param {number} wy */
  move(wx, wy) {
    const g = this._gesture;
    const threshold = this.worldDistance(DRAG_THRESHOLD_PX);

    switch (this.state) {
      case 'pressedPart': {
        if (Math.hypot(wx - g.startX, wy - g.startY) < threshold) return;
        this.state = 'draggingParts';
        // fall through into the drag update
      }
      // eslint-disable-next-line no-fallthrough
      case 'draggingParts': {
        this.cb.moveSelection(wx - g.lastX, wy - g.lastY);
        g.lastX = wx;
        g.lastY = wy;
        return;
      }
      case 'marqueeArm': {
        if (Math.hypot(wx - g.startX, wy - g.startY) < threshold) return;
        this.state = 'marquee';
        // fall through into the marquee update
      }
      // eslint-disable-next-line no-fallthrough
      case 'marquee': {
        this.cb.marqueeRect({ x1: g.startX, y1: g.startY, x2: wx, y2: wy });
        return;
      }
      case 'placing': {
        g.x = wx; g.y = wy;
        this.cb.placeGhost({ kind: g.kind, params: g.params, x: wx, y: wy });
        return;
      }
      case 'stickyHoleWiring':
      case 'holeWiring': {
        if (g.startX !== undefined && Math.hypot(wx - g.startX, wy - g.startY) > this.worldDistance(DRAG_THRESHOLD_PX)) g.moved = true;
        const snap = this.hit.holeAt
          ? this.hit.holeAt(wx, wy, this.worldDistance(TERMINAL_RADIUS_PX / 2))
          : null;
        const valid = snap && snap.boardId === g.from.boardId && snap.hole !== g.from.hole;
        if (this.cb.holeWirePreview) {
          this.cb.holeWirePreview(g.from,
            valid ? { x: snap.x, y: snap.y } : { x: wx, y: wy },
            valid ? snap : null);
        }
        return;
      }
      case 'rewiring': {
        const t = this.hit.terminalAt(wx, wy, this.worldDistance(TERMINAL_RADIUS_PX));
        const hole = !t && this.hit.holeAt
          ? this.hit.holeAt(wx, wy, this.worldDistance(TERMINAL_RADIUS_PX / 2)) : null;
        const snap = t ? { x: t.x, y: t.y } : hole ? { x: hole.x, y: hole.y } : { x: wx, y: wy };
        if (this.cb.rewirePreview) this.cb.rewirePreview(g.fixedPos, snap, !!(t || hole));
        return;
      }
      case 'stickyWiring':
      case 'wiring': {
        if (g.startX !== undefined && Math.hypot(wx - g.startX, wy - g.startY) > this.worldDistance(DRAG_THRESHOLD_PX)) g.moved = true;
        const snap = this.hit.terminalAt(wx, wy, this.worldDistance(TERMINAL_RADIUS_PX));
        const snapValid = snap && !(snap.partId === g.from.partId && snap.terminal === g.from.terminal);
        if (snapValid) {
          this.cb.wirePreview(g.from, { x: snap.x, y: snap.y }, snap);
          return;
        }
        const hole = this.hit.holeAt
          ? this.hit.holeAt(wx, wy, this.worldDistance(TERMINAL_RADIUS_PX / 2))
          : null;
        this.cb.wirePreview(g.from, hole ? { x: hole.x, y: hole.y } : { x: wx, y: wy },
          hole ?? null);
        return;
      }
      default:
    }
  }

  /** @param {number} wx @param {number} wy @param {{shiftKey?: boolean}} mods */
  up(wx, wy, mods = {}) {
    const g = this._gesture;
    // Placing: a release over the canvas after dragging from the palette
    // commits; a release that never travelled (the palette click that armed
    // us) keeps the ghost armed for the click-then-click flow.
    if (this.state === 'placing') {
      if (g.x !== null) this._commitPlace(wx, wy);
      return;
    }
    switch (this.state) {
      case 'pressedPart': {
        // A true click. Already-selected part without shift: collapse the
        // selection to just it (the deferred half of the down-handler rule).
        if (g.wasSelected && !mods.shiftKey) this.cb.select([g.partId], 'replace');
        break;
      }
      case 'draggingParts': {
        this.cb.endMove();
        break;
      }
      case 'marqueeArm': {
        // Click on empty ground: clear (shift-click on ground does nothing).
        if (!g.shift) this.cb.clearSelection();
        break;
      }
      case 'marquee': {
        const rect = { x1: g.startX, y1: g.startY, x2: wx, y2: wy };
        const ids = this.hit.partsInRect(rect);
        this.cb.select(ids, g.shift ? 'add' : 'replace');
        this.cb.marqueeRect(null);
        break;
      }
      case 'rewiring': {
        if (this.cb.rewirePreview) this.cb.rewirePreview(null);
        const t = this.hit.terminalAt(wx, wy, this.worldDistance(TERMINAL_RADIUS_PX));
        const hole = !t && this.hit.holeAt
          ? this.hit.holeAt(wx, wy, this.worldDistance(TERMINAL_RADIUS_PX / 2)) : null;
        if ((t || hole) && this.cb.rewire) {
          this.cb.rewire(g.wireId, g.fixed,
            t ? { partId: t.partId, terminal: t.terminal } : { boardId: hole.boardId, hole: hole.hole });
        }
        break;
      }
      case 'holeWiring': {
        const target = this.hit.holeAt
          ? this.hit.holeAt(wx, wy, this.worldDistance(TERMINAL_RADIUS_PX / 2))
          : null;
        if (this.cb.holeWirePreview) this.cb.holeWirePreview(null);
        if (target && target.boardId === g.from.boardId && target.hole !== g.from.hole
            && this.cb.createHoleWire) {
          this.cb.createHoleWire(g.from.boardId, g.from.hole, target.hole);
          break;
        }
        // Released on a part terminal instead: same tap wire, other direction.
        const term = this.hit.terminalAt(wx, wy, this.worldDistance(TERMINAL_RADIUS_PX));
        if (term && this.cb.createTapWire) {
          this.cb.createTapWire({ partId: term.partId, terminal: term.terminal }, g.from);
          break;
        }
        if (!g.moved) {
          this.state = 'stickyHoleWiring';
          this._gesture = g;
          return;
        }
        break;
      }
      case 'wiring': {
        const target = this.hit.terminalAt(wx, wy, this.worldDistance(TERMINAL_RADIUS_PX));
        this.cb.clearWirePreview();
        if (target && !(target.partId === g.from.partId && target.terminal === g.from.terminal)) {
          this.cb.createWire({ partId: g.from.partId, terminal: g.from.terminal },
            { partId: target.partId, terminal: target.terminal });
          break;
        }
        // No terminal under the release — a free HOLE also completes the
        // wire: "battery lead into the rail" is a first-class gesture.
        const hole = this.hit.holeAt
          ? this.hit.holeAt(wx, wy, this.worldDistance(TERMINAL_RADIUS_PX / 2))
          : null;
        if (hole && this.cb.createTapWire) {
          this.cb.createTapWire({ partId: g.from.partId, terminal: g.from.terminal }, hole);
          break;
        }
        // A plain CLICK on the connector (no drag): stay armed — the next
        // click completes the wire. Click-click is how most people wire.
        if (!g.moved) {
          this.state = 'stickyWiring';
          this._gesture = g;
          return;
        }
        break;
      }
      default:
    }
    this.state = 'idle';
    this._gesture = null;
  }
}

export { TERMINAL_RADIUS_PX, WIRE_RADIUS_PX, DRAG_THRESHOLD_PX };
