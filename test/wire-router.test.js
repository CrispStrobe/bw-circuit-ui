/**
 * Tests for wire routing.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { routeWire, partBBoxes } from '../src/model/wire-router.js';

describe('routeWire', () => {
  it('uses L-shape when no obstacles', () => {
    const path = routeWire({ x: 0, y: 0 }, { x: 100, y: 100 }, []);
    // Should be an L-shape: horizontal then vertical
    assert.equal(path, 'M 0 0 L 100 0 L 100 100');
  });

  it('uses reverse L-shape when obstacle blocks horizontal-first', () => {
    // Obstacle at the midpoint of horizontal-first path
    const obs = [{ x: 40, y: -10, w: 20, h: 20 }];
    const path = routeWire({ x: 0, y: 0 }, { x: 100, y: 100 }, obs);
    // Should use vertical-first L: down then right
    assert.equal(path, 'M 0 0 L 0 100 L 100 100');
  });

  it('uses Z-shape when both L-shapes are blocked', () => {
    // Obstacle blocks both L-shapes
    const obs = [
      { x: 40, y: -10, w: 20, h: 20 },   // blocks horizontal-first at y=0
      { x: -10, y: 40, w: 20, h: 20 },   // blocks vertical-first at x=0
    ];
    const path = routeWire({ x: 0, y: 0 }, { x: 100, y: 100 }, obs);
    // Should be Z-shape: horizontal to midpoint, vertical, horizontal
    assert.equal(path, 'M 0 0 L 50 0 L 50 100 L 100 100');
  });

  it('handles same-y endpoints (horizontal wire)', () => {
    const path = routeWire({ x: 0, y: 50 }, { x: 200, y: 50 }, []);
    // L-shape degenerates to a straight horizontal line
    assert.equal(path, 'M 0 50 L 200 50 L 200 50');
  });

  it('handles same-x endpoints (vertical wire)', () => {
    const path = routeWire({ x: 100, y: 0 }, { x: 100, y: 200 }, []);
    assert.equal(path, 'M 100 0 L 100 0 L 100 200');
  });
});

describe('partBBoxes', () => {
  it('returns bounding boxes excluding specified parts', () => {
    const parts = [
      { id: 'a', kind: 'resistor', x: 100, y: 100 },
      { id: 'b', kind: 'led', x: 200, y: 200 },
      { id: 'c', kind: 'mcu', x: 300, y: 300 },
    ];
    const boxes = partBBoxes(parts, 'a', 'b');
    assert.equal(boxes.length, 1); // only MCU
    assert.ok(boxes[0].w > 0);
    assert.ok(boxes[0].h > 0);
  });

  it('returns empty for circuit with only two parts', () => {
    const parts = [
      { id: 'a', kind: 'vcc', x: 0, y: 0 },
      { id: 'b', kind: 'gnd', x: 100, y: 100 },
    ];
    const boxes = partBBoxes(parts, 'a', 'b');
    assert.equal(boxes.length, 0);
  });
});
