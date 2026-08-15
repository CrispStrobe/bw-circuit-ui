/**
 * Breadboard lattice geometry + placement snapping — shared by the renderer
 * and the ghost snapper, so the hole you see is the hole you get.
 *
 * The lattice mirrors model/breadboard.js's logical board (63 columns,
 * rows a–e / gutter / f–j, two rails top and bottom) at BB_PITCH world units
 * per hole. This module is pure geometry: the ELECTRICAL mapping of a
 * snapped position to hole ids (and from there to nets) composes with
 * BreadboardModel and lands with the wiring integration.
 *
 * @module
 */

export const BB_PITCH = 14;
const RAIL_GAP = 18;   // rails ↔ terminal rows
const GUTTER = 24;     // row e ↔ row f
const MARGIN_X = 27;   // board edge → first hole column

/**
 * Physical spec of a breadboard part by its size param. The mini (170-point)
 * board has NO power rails — that is what makes it mini.
 * @param {{params?: {size?: string}}} [part]
 */
export function bbSpec(part) {
  const size = part && part.params && part.params.size;
  if (size === 'half') return { cols: 30, hasRails: true };
  if (size === 'mini') return { cols: 17, hasRails: false };
  return { cols: 63, hasRails: true };
}

/** Rendered outline of a breadboard part, derived from its spec. */
export function bbFootprint(part) {
  const { cols, hasRails } = bbSpec(part);
  const railBlock = 2 * BB_PITCH + RAIL_GAP;
  const totalH = (hasRails ? 2 * railBlock : 0) + 10 * BB_PITCH + GUTTER;
  return { w: (cols - 1) * BB_PITCH + 2 * MARGIN_X, h: totalH + 2 * MARGIN_X };
}

/**
 * World-space anchors of a breadboard part's hole lattice.
 * @param {{x: number, y: number}} part - breadboard part (centre coords)
 */
export function bbHoleOrigin(part) {
  // Vertical layout, centred on part.y. With rails:
  //   2 rail rows · RAIL_GAP · 5 rows · GUTTER · 5 rows · RAIL_GAP · 2 rail rows
  // The mini board drops the rail blocks entirely.
  const { cols, hasRails } = bbSpec(part);
  const railBlock = 2 * BB_PITCH + RAIL_GAP;
  const totalH = (hasRails ? 2 * railBlock : 0) + 10 * BB_PITCH + GUTTER;
  const top = part.y - totalH / 2 + BB_PITCH / 2;
  const railTopY = hasRails ? top : NaN;
  const topRowsY = hasRails ? railTopY + railBlock : top;
  const bottomRowsY = topRowsY + 5 * BB_PITCH + GUTTER;
  const railBottomY = hasRails ? bottomRowsY + 5 * BB_PITCH + RAIL_GAP : NaN;
  return {
    x: part.x - ((cols - 1) * BB_PITCH) / 2,
    railTopY, topRowsY, bottomRowsY, railBottomY,
    cols, hasRails,
  };
}

/** All row Y positions of a breadboard part, with their logical row names. */
export function bbRows(part) {
  const o = bbHoleOrigin(part);
  const rows = [];
  if (o.hasRails) {
    rows.push({ name: 't+', y: o.railTopY }, { name: 't-', y: o.railTopY + BB_PITCH });
  }
  ['a', 'b', 'c', 'd', 'e'].forEach((n, i) => rows.push({ name: n, y: o.topRowsY + i * BB_PITCH }));
  ['f', 'g', 'h', 'i', 'j'].forEach((n, i) => rows.push({ name: n, y: o.bottomRowsY + i * BB_PITCH }));
  if (o.hasRails) {
    rows.push({ name: 'b+', y: o.railBottomY }, { name: 'b-', y: o.railBottomY + BB_PITCH });
  }
  return rows;
}

/**
 * Nearest hole to a world point on a given breadboard part, or null when the
 * point is outside the lattice (with half-pitch tolerance).
 * @returns {{x: number, y: number, hole: string} | null}
 */
export function nearestHole(part, wx, wy) {
  const o = bbHoleOrigin(part);
  const col = Math.round((wx - o.x) / BB_PITCH);
  if (col < 0 || col >= o.cols) return null;
  let best = null;
  for (const row of bbRows(part)) {
    const d = Math.abs(wy - row.y);
    if (d <= BB_PITCH / 2 + 1 && (!best || d < best.d)) {
      best = { d, row };
    }
  }
  if (!best) return null;
  return {
    x: o.x + col * BB_PITCH,
    y: best.row.y,
    hole: `${best.row.name}${col + 1}`,
  };
}

/**
 * Snap a ghost/placement position: onto the hole lattice when over a
 * breadboard, else onto the free 20 px canvas grid.
 * @param {{kind: string, x: number, y: number}} g
 * @param {Array<object>} parts
 * @returns {{kind: string, x: number, y: number, snapped: boolean, hole?: string, boardId?: string}}
 */
export function snapGhost(g, parts) {
  const anchorDx = Number(g.anchorDx) || 0;
  const anchorDy = Number(g.anchorDy) || 0;
  if (g.kind !== 'breadboard') {
    for (const p of parts) {
      if (p.kind !== 'breadboard') continue;
      const hole = nearestHole(p, g.x + anchorDx, g.y + anchorDy);
      if (hole) return { ...g, x: hole.x - anchorDx, y: hole.y - anchorDy, snapped: true, hole: hole.hole, boardId: p.id };
    }
  }
  return { ...g, x: Math.round(g.x / 20) * 20, y: Math.round(g.y / 20) * 20, snapped: false };
}

/**
 * LOOSE seat snap: the nearest ref hole where a footprint fits, for a part
 * dropped ANYWHERE over (or within one pitch of) a breadboard's outline.
 *
 * nearestHole demands the ref pin land within half a pitch of a hole — the
 * right contract for a wire end, and an impossible one for seating a 40-pin
 * DIP by its body: the user drags the chip, not its pin 1, and a miss falls
 * silently back to the free grid, which reads as "there is no snapping"
 * (owner report, 2026-08-15). Here the column clamps so the whole footprint
 * stays on the board, and rows are tried nearest-first through `tryHole`
 * (validity/occupancy is the caller's knowledge) so a drop near the edge
 * still finds the legal seat beside it.
 *
 * @param {{x: number, y: number}} bbPart - the breadboard part
 * @param {{leads: Record<string, {dRow: number, dCol: number}>}} fp
 * @param {number} wx @param {number} wy - desired ref-pin world position
 * @param {(hole: string) => boolean} [tryHole] - accept/reject a candidate
 * @returns {string | null} ref hole id, or null when not over this board
 */
export function seatSnapHole(bbPart, fp, wx, wy, tryHole) {
  const outline = bbFootprint(bbPart);
  if (Math.abs(wx - bbPart.x) > outline.w / 2 + BB_PITCH ||
      Math.abs(wy - bbPart.y) > outline.h / 2 + BB_PITCH) return null;
  const o = bbHoleOrigin(bbPart);
  const dCols = Object.values(fp.leads).map(l => l.dCol);
  const minD = Math.min(...dCols);
  const maxD = Math.max(...dCols);
  let col = Math.round((wx - o.x) / BB_PITCH) + 1; // 1-based hole column
  col = Math.max(1 - minD, Math.min(o.cols - maxD, col));
  if (col < 1 || col > o.cols) return null; // footprint wider than the board
  const rows = bbRows(bbPart).filter(r => r.name.length === 1); // terminal rows only
  const byDist = rows.map(r => ({ r, d: Math.abs(wy - r.y) })).sort((a, b) => a.d - b.d);
  for (const { r } of byDist) {
    const hole = `${r.name}${col}`;
    if (!tryHole || tryHole(hole)) return hole;
  }
  return null;
}
