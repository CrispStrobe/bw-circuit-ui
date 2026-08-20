/**
 * Seat geometry — where a seated part and its legs LIVE in world space.
 *
 * Seating is electrical (holes → strips → nets); this module makes it
 * visual and interactive: the part body anchors between its holes, each leg
 * ends exactly IN its hole, and — critically — the part's TERMINALS move to
 * the hole positions, so a wire drawn to a seated part's terminal attaches
 * where the leg actually is. One function feeds the renderer, the terminal
 * dots, and the hit-test alike; they cannot disagree.
 *
 * Pure math on top of breadboard-snap's lattice. No DOM, no React.
 *
 * @module
 */

import { bbHoleOrigin, bbRows, BB_PITCH } from './breadboard-snap.js';
import { terminalAliasPairs } from '../model/parts-registry.js';

/**
 * World position of a hole id on a given breadboard part.
 * @param {{x: number, y: number}} bbPart
 * @param {string} holeId - e.g. "b12", "t+3"
 * @returns {{x: number, y: number} | null}
 */
export function holeWorldPos(bbPart, holeId) {
  const origin = bbHoleOrigin(bbPart);
  const rows = bbRows(bbPart);
  // Rail ids have two-char names ("t+"); terminal rows one ("b").
  const rail = ['t+', 't-', 'b+', 'b-'].find(r => holeId.startsWith(r));
  const rowName = rail ?? holeId[0];
  const col = Number(holeId.slice(rowName.length));
  if (!Number.isInteger(col) || col < 1 || col > origin.cols) return null;
  const row = rows.find(r => r.name === rowName);
  if (!row) return null;
  return { x: origin.x + (col - 1) * BB_PITCH, y: row.y };
}

/**
 * Geometry of a seated part: body anchor + per-terminal leg positions.
 *
 * The body sits at the centroid of its holes; a two-lead part on one row
 * lies along the row, a gutter-straddling part spans the gap. Terminals ARE
 * the holes — that is the contract the rest of the canvas builds on.
 *
 * @param {{x: number, y: number}} bbPart - the breadboard part
 * @param {Record<string, string>} leadMap - terminal → hole id
 * @returns {{x: number, y: number, terminals: Record<string, {x: number, y: number}>} | null}
 */
export function seatGeometry(bbPart, leadMap) {
  const terminals = {};
  let sx = 0, sy = 0, n = 0;
  for (const [terminal, holeId] of Object.entries(leadMap)) {
    const p = holeWorldPos(bbPart, holeId);
    if (!p) return null;
    terminals[terminal] = p;
    sx += p.x; sy += p.y; n++;
  }
  if (n === 0) return null;
  return { x: sx / n, y: sy / n, terminals };
}

/**
 * Resolve render-ready parts: seated parts get their anchor and terminal
 * positions from their holes; free parts pass through untouched. The
 * `_seatTerminals` field is what the canvas's terminalPos consults first.
 *
 * @param {Array<object>} parts - the circuit's parts (breadboards included)
 * @returns {Array<object>}
 */
export function resolveSeatedParts(parts) {
  const boards = new Map(parts.filter(p => p.kind === 'breadboard').map(p => [p.id, p]));
  return parts.map(p => {
    if (!p.seat) return p;
    const bb = boards.get(p.seat.boardId);
    if (!bb) return p;
    const geo = seatGeometry(bb, p.seat.leadMap);
    if (!geo) return p;
    // A terminal bw-board knows by two names has ONE leg and therefore one
    // hole. Only the physical spelling is in the leadMap (occupy() refuses
    // a hole claimed twice), so the alias would miss _seatTerminals, fall
    // through to the free-part offset table, and draw on the opposite row
    // of the package — 38 units from the leg it names. Give it the twin's
    // hole, which is where the metal actually is.
    const terminals = { ...geo.terminals };
    for (const [alias, twin] of terminalAliasPairs(p.kind)) {
      if (terminals[twin] && !terminals[alias]) terminals[alias] = terminals[twin];
    }
    return { ...p, x: geo.x, y: geo.y, _seatTerminals: terminals };
  });
}
