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
const COLS = 63;
const RAIL_GAP = 18;   // rails ↔ terminal rows
const GUTTER = 24;     // row e ↔ row f
const MARGIN_X = 27;   // board edge → first hole column

/**
 * World-space anchors of a breadboard part's hole lattice.
 * @param {{x: number, y: number}} part - breadboard part (centre coords)
 */
export function bbHoleOrigin(part) {
  // Vertical layout, centred on part.y:
  //   2 rail rows · RAIL_GAP · 5 rows · GUTTER · 5 rows · RAIL_GAP · 2 rail rows
  const totalH = 2 * BB_PITCH + RAIL_GAP + 4 * BB_PITCH + BB_PITCH + GUTTER
    + 4 * BB_PITCH + BB_PITCH + RAIL_GAP + 2 * BB_PITCH;
  const top = part.y - totalH / 2 + BB_PITCH / 2;
  const railTopY = top;
  const topRowsY = railTopY + 2 * BB_PITCH + RAIL_GAP;
  const bottomRowsY = topRowsY + 5 * BB_PITCH + GUTTER;
  const railBottomY = bottomRowsY + 5 * BB_PITCH + RAIL_GAP;
  return {
    x: part.x - ((COLS - 1) * BB_PITCH) / 2,
    railTopY, topRowsY, bottomRowsY, railBottomY,
    cols: COLS,
  };
}

/** All row Y positions of a breadboard part, with their logical row names. */
export function bbRows(part) {
  const o = bbHoleOrigin(part);
  const rows = [];
  rows.push({ name: 't+', y: o.railTopY }, { name: 't-', y: o.railTopY + BB_PITCH });
  ['a', 'b', 'c', 'd', 'e'].forEach((n, i) => rows.push({ name: n, y: o.topRowsY + i * BB_PITCH }));
  ['f', 'g', 'h', 'i', 'j'].forEach((n, i) => rows.push({ name: n, y: o.bottomRowsY + i * BB_PITCH }));
  rows.push({ name: 'b+', y: o.railBottomY }, { name: 'b-', y: o.railBottomY + BB_PITCH });
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
  if (g.kind !== 'breadboard') {
    for (const p of parts) {
      if (p.kind !== 'breadboard') continue;
      const hole = nearestHole(p, g.x, g.y);
      if (hole) return { ...g, x: hole.x, y: hole.y, snapped: true, hole: hole.hole, boardId: p.id };
    }
  }
  return { ...g, x: Math.round(g.x / 20) * 20, y: Math.round(g.y / 20) * 20, snapped: false };
}
