/**
 * A seated part's body must lie along its own legs.
 *
 * A tactile switch straddles the breadboard's centre channel: its footprint
 * puts one leg at dRow 0 and the other at dRow 5, upper bank and lower bank.
 * The Wokwi element is drawn with its leads left and right, and nothing
 * rotated it, so a seated button was drawn lying on its side — the picture
 * said "spans two columns" while the holes said "bridges the gutter".
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { seatedFaceRotation, resolveSeatedParts } from '../src/interaction/seat-geometry.js';
import { FOOTPRINTS } from '../src/model/footprints.js';

const board = { id: 'bb1', kind: 'breadboard', params: {}, x: 0, y: 0, terminals: [] };

function seat(kind, leadMap) {
  const part = { id: 'p1', kind, params: {}, terminals: Object.keys(leadMap),
    seat: { boardId: 'bb1', leadMap }, x: 0, y: 0 };
  return resolveSeatedParts([board, part]).find(p => p.id === 'p1');
}

describe('seated face rotation', () => {
  it('turns a gutter-straddling button upright', () => {
    // e5 and f5: same column, opposite banks — exactly what the button
    // footprint lays down, and the seating the user sees in 25-reaction-timer.
    const part = seat('button', { a: 'e5', b: 'f5' });
    assert.ok(part._seatTerminals, 'the part must actually be seated');
    assert.equal(seatedFaceRotation(part), 90);
  });

  it('leaves a part seated along a row alone', () => {
    assert.equal(seatedFaceRotation(seat('resistor', { a: 'e5', b: 'e9' })), 0);
  });

  it('leaves a free, unseated part alone', () => {
    assert.equal(seatedFaceRotation({ id: 'x', kind: 'button', params: {} }), 0);
  });

  it('does not guess for a package with more than two legs', () => {
    // The first two legs are deliberately in OPPOSITE banks: a check that
    // only looked at two holes would call this package vertical and spin it.
    const dip = seat('shift_register',
      { data: 'e5', q0: 'f5', clock: 'e6', q1: 'f6', latch: 'e7' });
    const [first, second] = Object.values(dip._seatTerminals);
    assert.ok(Math.abs(second.y - first.y) > Math.abs(second.x - first.x),
      'the fixture must present a vertical first pair, or it proves nothing');
    assert.equal(seatedFaceRotation(dip), 0);
  });

  it('agrees with the footprint that the button straddles the gutter', () => {
    // If the footprint ever stops straddling, this rotation is describing a
    // part that no longer exists — fail here rather than draw it wrong.
    assert.equal(FOOTPRINTS.button.straddlesGutter, true);
    const { a, b } = FOOTPRINTS.button.leads;
    assert.notEqual(a.dRow, b.dRow, 'the two legs must sit in different banks');
    assert.equal(a.dCol, b.dCol, 'and in the same column');
  });
});
