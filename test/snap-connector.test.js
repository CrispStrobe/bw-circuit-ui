/**
 * Tests for snap-to-connector logic.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { findSnapTarget, SNAP_DISTANCE } from '../src/model/snap.js';

describe('findSnapTarget', () => {
  it('snaps when terminals are within threshold', () => {
    const dragged = {
      id: 'r1', kind: 'resistor', terminals: ['a', 'b'],
      x: 100, y: 100, rotation: 0,
    };
    const other = {
      id: 'led1', kind: 'led', terminals: ['anode', 'cathode'],
      x: 145, y: 100, rotation: 0, // LED anode at ~135,100; R1.b at ~135,100
    };

    const result = findSnapTarget(dragged, [dragged, other], []);
    assert.ok(result.autoWire, 'should find a snap target');
    assert.equal(result.autoWire.fromPart, 'r1');
    assert.equal(result.autoWire.toPart, 'led1');
  });

  it('does not snap when terminals are too far', () => {
    const dragged = {
      id: 'r1', kind: 'resistor', terminals: ['a', 'b'],
      x: 100, y: 100, rotation: 0,
    };
    const other = {
      id: 'led1', kind: 'led', terminals: ['anode', 'cathode'],
      x: 300, y: 300, rotation: 0,
    };

    const result = findSnapTarget(dragged, [dragged, other], []);
    assert.equal(result.autoWire, null, 'should not snap when far away');
  });

  it('skips already-connected terminals', () => {
    const dragged = {
      id: 'r1', kind: 'resistor', terminals: ['a', 'b'],
      x: 100, y: 100, rotation: 0,
    };
    const other = {
      id: 'led1', kind: 'led', terminals: ['anode', 'cathode'],
      x: 145, y: 100, rotation: 0,
    };
    // LED anode is already wired
    const wires = [{
      id: 'w1', netId: 'n1',
      from: { part: 'led1', terminal: 'anode' },
      to: { part: 'something', terminal: 'x' },
    }];

    const result = findSnapTarget(dragged, [dragged, other], wires);
    // Should not snap to the already-connected anode
    if (result.autoWire) {
      assert.notEqual(result.autoWire.toTerm, 'anode',
        'should not snap to already-connected terminal');
    }
  });

  it('returns correct snap position offset', () => {
    // Place R1 at (100, 100). R1.b is at dx=+30 → (130, 100).
    // Place LED at (160, 100). LED.anode is at dx=-20 → (140, 100).
    // Snap should move R1 so R1.b aligns with LED.anode:
    // R1.b needs to be at (140, 100), so R1.x = 140 - 30 = 110
    const dragged = {
      id: 'r1', kind: 'resistor', terminals: ['a', 'b'],
      x: 100, y: 100, rotation: 0,
    };
    const other = {
      id: 'led1', kind: 'led', terminals: ['anode', 'cathode'],
      x: 160, y: 100, rotation: 0,
    };

    const result = findSnapTarget(dragged, [dragged, other], []);
    assert.ok(result.autoWire);
    // The snap position should offset R1 to align terminals
    assert.ok(Math.abs(result.snapX - 110) < 2, `snapX should be ~110, got ${result.snapX}`);
    assert.ok(Math.abs(result.snapY - 100) < 2, `snapY should be ~100, got ${result.snapY}`);
  });

  it('does not snap to self', () => {
    const dragged = {
      id: 'r1', kind: 'resistor', terminals: ['a', 'b'],
      x: 100, y: 100, rotation: 0,
    };

    const result = findSnapTarget(dragged, [dragged], []);
    assert.equal(result.autoWire, null);
  });
});
