/**
 * The exact-checker core, checked against numbers computed by hand.
 *
 * Every expected value below was worked out on paper before the code ran.
 * The one case that MUST be here: the inscribed-circle trap (plan §7.1) —
 * a rect pad's corner reached by a segment the disc model would miss.
 */

import './_setup.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  pointSegDist, segSegDist, segsIntersect, pointInPolygon, pointPolyDist,
  polyPolyDist, shapeDist, shapesTouch, padShape, trackShapes, viaShape,
  rotateAbout,
} from '../src/model/pcb-geometry.js';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`);
const SQUARE = [[0, 0], [10, 0], [10, 10], [0, 10]];

describe('primitives', () => {
  test('point-segment', () => {
    close(pointSegDist(5, 3, 0, 0, 10, 0), 3);       // above the middle
    close(pointSegDist(12, 0, 0, 0, 10, 0), 2);      // beyond the end
    close(pointSegDist(0, 5, 0, 0, 10, 0), 5);       // beside the start
    close(pointSegDist(3, 4, 0, 0, 0, 0), 5);        // degenerate segment
  });

  test('segment-segment', () => {
    assert.ok(segsIntersect(0, 0, 10, 10, 0, 10, 10, 0));
    close(segSegDist(0, 0, 10, 10, 0, 10, 10, 0), 0);          // crossing
    close(segSegDist(0, 0, 10, 0, 0, 4, 10, 4), 4);            // parallel
    close(segSegDist(0, 0, 0, 10, 3, 12, 3, 20), Math.hypot(3, 2)); // endpoint to endpoint
    close(segSegDist(0, 0, 10, 0, 5, 0, 15, 0), 0);            // collinear overlap
  });

  test('point in polygon: inside, outside, on the edge', () => {
    assert.equal(pointInPolygon(5, 5, SQUARE), true);
    assert.equal(pointInPolygon(15, 5, SQUARE), false);
    assert.equal(pointInPolygon(10, 5, SQUARE), true); // edge counts as in
  });

  test('point-polygon distance: 3-4-5 from the corner', () => {
    close(pointPolyDist(13, 14, SQUARE), 5);
    close(pointPolyDist(5, 5, SQUARE), 0);
  });

  test('polygon-polygon: gap, touch, containment', () => {
    const right = SQUARE.map(([x, y]) => [x + 13, y]);
    close(polyPolyDist(SQUARE, right), 3);
    const inner = [[4, 4], [6, 4], [6, 6], [4, 6]];
    close(polyPolyDist(SQUARE, inner), 0); // swallowed, no edge crossing
  });
});

describe('unified shapes', () => {
  test('two circles: centre gap minus both radii, clamped at zero', () => {
    const a = { kind: 'point', x: 0, y: 0, r: 2 };
    const b = { kind: 'point', x: 10, y: 0, r: 3 };
    close(shapeDist(a, b), 5);
    close(shapeDist(a, { kind: 'point', x: 4, y: 0, r: 3 }), 0);
  });

  test('THE trap: a rect pad corner the inscribed circle would miss', () => {
    // Pad 2.0 x 1.0 at origin. Its corner is at (1.0, 0.5) — 1.118 from
    // centre. The inscribed circle has r = 0.5. A track passing at
    // x = 0.9 with halfwidth 0.15 comes within 0 of the REAL pad
    // (0.9 < 1.0) but stays 0.9 - 0.5 - 0.15 = 0.25 clear of the disc.
    const pad = padShape({ shape: 'rect', x: 0, y: 0, w: 2.0, h: 1.0, rotation: 0 });
    const track = { kind: 'seg', x1: 0.9, y1: -5, x2: 0.9, y2: 5, r: 0.15 };
    close(shapeDist(pad, track), 0);
    const disc = { kind: 'point', x: 0, y: 0, r: 0.5 };
    close(shapeDist(disc, track), 0.25);
  });

  test('rect pad rotation 90: wide becomes tall', () => {
    const pad = padShape({ shape: 'rect', x: 0, y: 0, w: 4, h: 2, rotation: 90 });
    // Tall now: x in [-1,1], y in [-2,2].
    close(shapeDist(pad, { kind: 'point', x: 0, y: 1.9, r: 0 }), 0);
    close(shapeDist(pad, { kind: 'point', x: 1.5, y: 0, r: 0 }), 0.5);
    close(shapeDist(pad, { kind: 'point', x: 0, y: 2.5, r: 0 }), 0.5);
  });

  test('oval pad is a stadium, not a rect and not a circle', () => {
    const pad = padShape({ shape: 'oval', x: 0, y: 0, w: 4, h: 2, rotation: 0 });
    // Spine from (-1,0) to (1,0), r = 1. End cap is ROUND: the point
    // (2.2, 0) is 0.2 clear; the rect model would say 0.2 too, but the
    // corner point (1.9, 0.9) is hypot(0.9,0.9)-1 ≈ 0.273 clear of the
    // stadium while INSIDE the 4x2 rect.
    close(shapeDist(pad, { kind: 'point', x: 2.2, y: 0, r: 0 }), 0.2);
    close(shapeDist(pad, { kind: 'point', x: 1.9, y: 0.9, r: 0 }), Math.hypot(0.9, 0.9) - 1, 1e-9);
  });

  test('a track polyline becomes one stadium per segment', () => {
    const shapes = trackShapes({ width: 0.6, points: [[0, 0], [10, 0], [10, 10]] });
    assert.equal(shapes.length, 2);
    close(shapes[0].r, 0.3);
    assert.ok(shapesTouch(shapes[0], viaShape({ x: 5, y: 0.5, diameter: 0.5 })));
    assert.ok(!shapesTouch(shapes[0], viaShape({ x: 5, y: 2, diameter: 0.5 })));
  });

  test('rotateAbout: 90 degrees is a quarter turn CCW in math axes', () => {
    const [x, y] = rotateAbout(1, 0, 0, 0, 90);
    close(x, 0, 1e-12); close(y, 1, 1e-12);
  });
});
