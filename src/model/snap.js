/**
 * Snap-to-connector logic.
 *
 * When dragging a part, finds the closest unconnected terminal on
 * another part and snaps to it if within threshold. Returns the
 * snap offset and the terminals to auto-wire.
 */

const SNAP_DISTANCE = 25; // pixels — how close before snapping

/**
 * Terminal position helpers (duplicated from BoardCanvas to keep
 * the snap logic testable without React).
 */
function rotateOffset(dx, dy, deg) {
  switch (((deg % 360) + 360) % 360) {
    case 0: return { dx, dy };
    case 90: return { dx: -dy, dy: dx };
    case 180: return { dx: -dx, dy: -dy };
    case 270: return { dx: dy, dy: -dx };
    default: return { dx, dy };
  }
}

function baseOffsets(kind, terminals) {
  switch (kind) {
    case 'vcc': return { vcc: { dx: 0, dy: 20 } };
    case 'gnd': return { gnd: { dx: 0, dy: -10 } };
    case 'resistor': return { a: { dx: -30, dy: 0 }, b: { dx: 30, dy: 0 } };
    case 'led': return { anode: { dx: -20, dy: 0 }, cathode: { dx: 20, dy: 0 } };
    case 'potentiometer': return { a: { dx: -25, dy: 20 }, wiper: { dx: 0, dy: -20 }, b: { dx: 25, dy: 20 } };
    case 'button': return { a: { dx: -15, dy: 0 }, b: { dx: 15, dy: 0 } };
    case 'buzzer': return { a: { dx: -15, dy: 0 }, b: { dx: 15, dy: 0 } };
    case 'capacitor': return { a: { dx: -15, dy: 0 }, b: { dx: 15, dy: 0 } };
    case 'mcu': {
      const offsets = {};
      const count = terminals.length;
      const chipH = Math.max(60, count * 30 + 20);
      const chipY = -chipH / 2;
      terminals.forEach((pin, i) => {
        const o = rotateOffset(-60, chipY + 30 + i * 30, 0);
        offsets[pin] = o;
      });
      return offsets;
    }
    default: return { a: { dx: -15, dy: 0 }, b: { dx: 15, dy: 0 } };
  }
}

function terminalPos(part, terminal) {
  const raw = baseOffsets(part.kind, part.terminals);
  const offset = raw[terminal] ?? { dx: 0, dy: 0 };
  const rot = rotateOffset(offset.dx, offset.dy, part.rotation || 0);
  return { x: part.x + rot.dx, y: part.y + rot.dy };
}

/**
 * Find the best snap target when dragging a part.
 *
 * @param {object} draggedPart — the part being dragged (with current x, y)
 * @param {Array} allParts — all parts on the board
 * @param {Array} wires — existing wires
 * @returns {{ snapX: number, snapY: number, autoWire: { fromPart, fromTerm, toPart, toTerm } | null }}
 */
export function findSnapTarget(draggedPart, allParts, wires) {
  // Build set of already-connected terminal pairs
  const connected = new Set();
  for (const w of wires) {
    connected.add(`${w.from.part}:${w.from.terminal}`);
    connected.add(`${w.to.part}:${w.to.terminal}`);
  }

  let bestDist = SNAP_DISTANCE;
  let bestSnap = null;

  // For each terminal on the dragged part
  for (const dragTerm of draggedPart.terminals) {
    const dragPos = terminalPos(draggedPart, dragTerm);

    // For each terminal on every other part
    for (const other of allParts) {
      if (other.id === draggedPart.id) continue;

      for (const otherTerm of other.terminals) {
        // Skip if already connected to something
        if (connected.has(`${other.id}:${otherTerm}`)) continue;

        const otherPos = terminalPos(other, otherTerm);
        const dx = otherPos.x - dragPos.x;
        const dy = otherPos.y - dragPos.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < bestDist) {
          bestDist = dist;
          bestSnap = {
            // Offset the dragged part so its terminal aligns with the target
            snapX: draggedPart.x + dx,
            snapY: draggedPart.y + dy,
            autoWire: {
              fromPart: draggedPart.id,
              fromTerm: dragTerm,
              toPart: other.id,
              toTerm: otherTerm,
            },
          };
        }
      }
    }
  }

  return bestSnap || { snapX: draggedPart.x, snapY: draggedPart.y, autoWire: null };
}

/**
 * Get the snap distance threshold.
 */
export { SNAP_DISTANCE };
