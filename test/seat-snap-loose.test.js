/**
 * Loose seat snapping — a chip dropped ANYWHERE over the board seats.
 *
 * nearestHole's half-pitch tolerance is the right contract for wire ends
 * and the wrong one for seating a 40-pin DIP by its body; seatSnapHole is
 * the generous complement. These tests pin down its clamping (footprint
 * stays on the board), its row fallback (tryHole rejections walk to the
 * next-nearest row), and its outline gate (a point nowhere near the board
 * returns null, so free-canvas drops stay free).
 */

import './_setup.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { seatSnapHole, bbHoleOrigin, bbRows, BB_PITCH } from '../src/interaction/breadboard-snap.js';
import { FOOTPRINTS, computeLeadMap } from '../src/model/footprints.js';

const bb = { kind: 'breadboard', x: 470, y: 330, params: {} }; // full-size, 63 cols
const mcu = FOOTPRINTS.mcu;      // 40-pin DIP, dCol 0..19, straddles gutter
const resistor = FOOTPRINTS.resistor;

const validFor = fp => h => { try { computeLeadMap(fp, h); return true; } catch { return false; } };

describe('seatSnapHole', () => {
  it('seats a resistor from an exact hole position', () => {
    const o = bbHoleOrigin(bb);
    const rowB = bbRows(bb).find(r => r.name === 'b');
    const hole = seatSnapHole(bb, resistor, o.x + 4 * BB_PITCH, rowB.y, validFor(resistor));
    assert.equal(hole, 'b5');
  });

  it('seats a 40-pin MCU dropped between rows — no half-pitch demand', () => {
    const o = bbHoleOrigin(bb);
    const rowC = bbRows(bb).find(r => r.name === 'c');
    // ref point 6px off the row — nearestHole tolerance would still take
    // this, but 6px off in a gutter-adjacent spot is the common miss.
    const hole = seatSnapHole(bb, mcu, o.x + 9 * BB_PITCH, rowC.y + 6, validFor(mcu));
    assert.ok(hole, 'must snap');
    assert.ok(validFor(mcu)(hole), `computeLeadMap must accept ${hole}`);
  });

  it('clamps the column so the whole footprint stays on the board', () => {
    const o = bbHoleOrigin(bb);
    const rowA = bbRows(bb).find(r => r.name === 'a');
    // ref pin aimed at column 60 of 63: a 20-column footprint cannot start
    // there. The clamp pulls it back to column 44 (44 + 19 = 63).
    const hole = seatSnapHole(bb, mcu, o.x + 59 * BB_PITCH, rowA.y, validFor(mcu));
    assert.equal(hole, 'a44');
  });

  it('walks to the next-nearest row when tryHole rejects', () => {
    const o = bbHoleOrigin(bb);
    const rowB = bbRows(bb).find(r => r.name === 'b');
    const hole = seatSnapHole(bb, resistor, o.x + 4 * BB_PITCH, rowB.y,
      h => h[0] !== 'b'); // pretend every b-row seat is occupied
    assert.ok(hole, 'must fall through to a neighbouring row');
    assert.notEqual(hole[0], 'b');
  });

  it('returns null away from the board — free drops stay free', () => {
    const hole = seatSnapHole(bb, mcu, bb.x + 2000, bb.y, validFor(mcu));
    assert.equal(hole, null);
  });

  it('straddle rows survive the row fallback (MCU never lands rail-side)', () => {
    const o = bbHoleOrigin(bb);
    const rowJ = bbRows(bb).find(r => r.name === 'j');
    // aimed at the bottom row block: fallback must find a row from which
    // the straddling footprint still maps (computeLeadMap accepts it).
    const hole = seatSnapHole(bb, mcu, o.x + 9 * BB_PITCH, rowJ.y, validFor(mcu));
    assert.ok(hole, 'must snap somewhere legal');
    assert.ok(validFor(mcu)(hole));
  });
});
