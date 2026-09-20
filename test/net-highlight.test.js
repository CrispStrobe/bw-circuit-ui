/**
 * A voltage reading has to be answerable: which conductor is this 1.9 V on?
 *
 * The pills were pointerEvents="none", so the question could not be asked at
 * all — and the owner asked it: "many are ambiguous and it is not intuitive
 * which wires get numbers and which not". The highlight machinery already
 * existed for hover; what was missing is a way to make it STICK, because
 * moving the pointer toward the wire you are asking about is what ends a hover.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { netIsHighlighted, railFraction } from '../src/model/format.js';

describe('which nets draw highlighted', () => {
  it('highlights the hovered net', () => {
    assert.equal(netIsHighlighted('n3', 'n3', null), true);
    assert.equal(netIsHighlighted('n3', 'n4', null), false);
  });

  it('highlights the pinned net after the pointer has left it', () => {
    // The whole point: hover is gone, the answer is still on screen.
    assert.equal(netIsHighlighted('n3', null, 'n3'), true);
  });

  it('highlights either reason, and neither is required', () => {
    assert.equal(netIsHighlighted('n3', 'n9', 'n3'), true);
    assert.equal(netIsHighlighted('n3', 'n3', 'n9'), true);
    assert.equal(netIsHighlighted('n3', null, null), false);
  });

  it('never highlights a wire with no net', () => {
    // An unresolved wire has netId undefined; `undefined === undefined` would
    // otherwise light up every unrouted wire at once the moment nothing is
    // hovered or pinned.
    for (const missing of [undefined, null, '']) {
      assert.equal(netIsHighlighted(missing, undefined, undefined), false);
      assert.equal(netIsHighlighted(missing, null, null), false);
    }
  });
});

describe('where a reading sits between ground and the rail', () => {
  it('scales against the board rail, not a hardcoded 5 V', () => {
    // The defect: on a 3.3 V board the supply rail scored 0.66 and drew as
    // "mid-high" orange while being the highest voltage in the circuit.
    assert.equal(railFraction(3.3, 3.3), 1);
    assert.equal(railFraction(5, 5), 1);
    assert.equal(railFraction(9, 9), 1);
    assert.ok(railFraction(3.3, 5) < 0.7, 'and 3.3 V on a 5 V board is NOT the top');
  });

  it('clamps outside the rail rather than running off the scale', () => {
    assert.equal(railFraction(-2, 5), 0);
    assert.equal(railFraction(12, 5), 1);
  });

  it('falls back to 5 V for a nonsense rail instead of dividing by it', () => {
    for (const bad of [0, -5, NaN, undefined, null]) {
      assert.equal(railFraction(5, bad), 1, String(bad));
    }
  });

  it('treats a missing reading as ground rather than NaN', () => {
    assert.equal(railFraction(undefined, 5), 0);
    assert.equal(railFraction(NaN, 5), 0);
  });
});
