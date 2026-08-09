/**
 * Tests for breadboard footprint computation.
 */

import './_setup.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { FOOTPRINTS, computeLeadMap } from '../src/model/footprints.js';

describe('computeLeadMap', () => {
  it('resistor at e5 spans 4 columns', () => {
    const map = computeLeadMap(FOOTPRINTS.resistor, 'e5');
    assert.equal(map.a, 'e5');
    assert.equal(map.b, 'e9');
  });

  it('LED at a10 occupies adjacent holes', () => {
    const map = computeLeadMap(FOOTPRINTS.led, 'a10');
    assert.equal(map.anode, 'a10');
    assert.equal(map.cathode, 'a11');
  });

  it('button straddles gutter from e to f', () => {
    const map = computeLeadMap(FOOTPRINTS.button, 'e3');
    assert.equal(map.a, 'e3');
    assert.equal(map.b, 'j3'); // dRow=5 from e(idx=4) = idx 9 = j
  });

  it('potentiometer spans 5 holes', () => {
    const map = computeLeadMap(FOOTPRINTS.potentiometer, 'c1');
    assert.equal(map.a, 'c1');
    assert.equal(map.wiper, 'c3');
    assert.equal(map.b, 'c5');
  });

  it('throws for rail reference hole', () => {
    assert.throws(
      () => computeLeadMap(FOOTPRINTS.resistor, 't+5'),
      /rail/
    );
  });
});

describe('FOOTPRINTS', () => {
  it('every footprint has a refTerminal in its leads', () => {
    for (const [kind, fp] of Object.entries(FOOTPRINTS)) {
      assert.ok(fp.leads[fp.refTerminal], `${kind}: refTerminal "${fp.refTerminal}" not in leads`);
    }
  });

  it('ref terminal is always at offset (0, 0)', () => {
    for (const [kind, fp] of Object.entries(FOOTPRINTS)) {
      const ref = fp.leads[fp.refTerminal];
      assert.equal(ref.dRow, 0, `${kind}: refTerminal dRow should be 0`);
      assert.equal(ref.dCol, 0, `${kind}: refTerminal dCol should be 0`);
    }
  });
});
