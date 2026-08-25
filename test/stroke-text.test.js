/**
 * The stroke font: every glyph inside its cell, layout centred and
 * predictable, unknown glyphs visible as boxes — never silently blank.
 */

import './_setup.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { GLYPHS, GLYPH_W, GLYPH_H, ADVANCE, MISSING_GLYPH } from '../src/data/stroke-font.js';
import { strokeText, strokeTextWidth } from '../src/model/stroke-text.js';

describe('the font data', () => {
  test('every glyph stays inside its design cell', () => {
    for (const [ch, glyph] of Object.entries(GLYPHS)) {
      for (const stroke of glyph) {
        assert.ok(stroke.length >= 2, `${ch}: a stroke needs two points`);
        for (const [x, y] of stroke) {
          assert.ok(x >= 0 && x <= GLYPH_W, `${ch}: x ${x} out of cell`);
          assert.ok(y >= -1 && y <= GLYPH_H, `${ch}: y ${y} out of cell`);
        }
      }
    }
  });

  test('the alphabet and digits are covered', () => {
    for (const ch of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789') {
      assert.ok(GLYPHS[ch]?.length >= 1, `missing ${ch}`);
    }
    assert.deepEqual(GLYPHS[' '], []);
  });
});

describe('layout', () => {
  test('width is monospace-predictable', () => {
    assert.equal(strokeTextWidth('R1', 1.2), 2 * ADVANCE * (1.2 / GLYPH_H));
  });

  test('the string is centred on its anchor', () => {
    const strokes = strokeText('HH', { x: 10, y: 5, size: 2 });
    const xs = strokes.flat().map(([x]) => x);
    const ys = strokes.flat().map(([, y]) => y);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    // H fills its cell symmetrically, so the ink centre ≈ the anchor.
    assert.ok(Math.abs(cx - 10) < 0.2, `centre x ${cx}`);
    assert.ok(Math.min(...ys) >= 5 - 1.1 && Math.max(...ys) <= 5 + 1.1, 'cap height respected');
  });

  test('rotation turns the whole string about the anchor', () => {
    const flat = strokeText('I', { x: 0, y: 0, size: 2, rotation: 0 });
    const up = strokeText('I', { x: 0, y: 0, size: 2, rotation: 90 });
    const spanX = (ss) => {
      const xs = ss.flat().map(([x]) => x);
      return Math.max(...xs) - Math.min(...xs);
    };
    // An I is tall; rotated 90° its ink extent moves onto the x axis.
    assert.ok(spanX(up) > spanX(flat));
  });

  test('lowercase folds up, unknown glyphs box', () => {
    const lower = strokeText('r1', { x: 0, y: 0, size: 1 });
    const upper = strokeText('R1', { x: 0, y: 0, size: 1 });
    assert.deepEqual(lower, upper);
    const boxed = strokeText('@', { x: 0, y: 0, size: 1 });
    assert.equal(boxed.length, MISSING_GLYPH.length);
    assert.ok(boxed[0].length >= 4, 'the box outline is visible ink');
  });

  test('deterministic', () => {
    assert.deepEqual(
      strokeText('SW17', { x: 3, y: 4, size: 1.4, rotation: 45 }),
      strokeText('SW17', { x: 3, y: 4, size: 1.4, rotation: 45 }),
    );
  });
});
