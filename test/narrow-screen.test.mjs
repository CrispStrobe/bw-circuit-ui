import test from 'node:test';
import assert from 'node:assert/strict';
import { effectiveWidth, isNarrow, NARROW_PX } from '../src/hooks/narrow-screen.js';

test('a phone inside Brickwright reads as narrow despite a 1024 layout', () => {
  // The case that motivated this: iPhone 430pt, app declares width=1024, the
  // browser picks scale 0.42 to fit. innerWidth says 1024 and is useless.
  const w = effectiveWidth({width: 1024, scale: 430 / 1024}, 1024);
  assert.ok(Math.abs(w - 430) < 1, `expected ~430, got ${w}`);
  assert.equal(isNarrow(w), true);
  assert.equal(isNarrow(1024), false, 'the layout width alone must NOT trip it');
});

test('standalone degrades to the window width', () => {
  assert.equal(effectiveWidth({width: 430, scale: 1}, 430), 430);
  assert.equal(effectiveWidth(null, 430), 430);
  assert.equal(effectiveWidth(undefined, 1440), 1440);
});

test('a tablet keeps its panels', () => {
  // iPad 834pt over a 1024 layout -> scale 0.814 -> 834 effective.
  assert.equal(isNarrow(effectiveWidth({width: 1024, scale: 834 / 1024}, 1024)), false);
});

test('degenerate viewports fall back rather than reporting zero width', () => {
  assert.equal(effectiveWidth({width: 0, scale: 1}, 1440), 1440);
  assert.equal(effectiveWidth({width: 1024, scale: 0}, 1024), 1024, 'scale 0 treated as 1');
  assert.equal(isNarrow(0), false, 'an unknown width is not a narrow screen');
});

test('the threshold sits between a phone landscape and a small laptop', () => {
  assert.ok(NARROW_PX > 430 && NARROW_PX < 1024);
  assert.equal(isNarrow(NARROW_PX - 1), true);
  assert.equal(isNarrow(NARROW_PX), false, 'boundary is exclusive');
});
