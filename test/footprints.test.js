/**
 * Tests for breadboard footprint computation.
 */

import './_setup.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { FOOTPRINTS, computeLeadMap } from '../src/model/footprints.js';
import { BreadboardModel } from '../src/model/breadboard.js';

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
    assert.equal(map.b, 'f3'); // gutter straddle: e(4) → f(5)
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

  it('shift register straddles gutter', () => {
    const map = computeLeadMap(FOOTPRINTS.shift_register, 'e10');
    assert.equal(map.data, 'e10');
    assert.equal(map.clock, 'e11');
    assert.equal(map.latch, 'f10'); // gutter straddle: e(4) → f(5)
  });

  it('from bottom block, offset stays in bottom rows', () => {
    const map = computeLeadMap(FOOTPRINTS.resistor, 'f5');
    assert.equal(map.a, 'f5');
    assert.equal(map.b, 'f9');
  });

  it('buzzer spans 3 columns', () => {
    const map = computeLeadMap(FOOTPRINTS.buzzer, 'b4');
    assert.equal(map.a, 'b4');
    assert.equal(map.b, 'b6');
  });
});

describe('breadboard + footprint integration', () => {
  it('place a resistor and derive nets', () => {
    const bb = new BreadboardModel();
    const leadMap = computeLeadMap(FOOTPRINTS.resistor, 'a5');
    bb.occupy('r1', leadMap);
    const { nets } = bb.deriveNets();
    // resistor terminal 'a' is in strip col-t5, terminal 'b' in col-t9
    // Each should appear in a net with one terminal (floating)
    assert.ok(nets.length >= 2, 'should produce at least 2 nets');
    const terms = nets.flatMap(n => n.terminals);
    assert.ok(terms.some(t => t.part === 'r1' && t.terminal === 'a'));
    assert.ok(terms.some(t => t.part === 'r1' && t.terminal === 'b'));
  });

  it('two parts wired via same strip share a net', () => {
    const bb = new BreadboardModel();
    // Resistor a-terminal at a5 (strip col-t5), LED anode at c5 (same strip)
    bb.occupy('r1', { a: 'a5', b: 'a9' });
    bb.occupy('led1', { anode: 'c5', cathode: 'c6' });
    const { nets } = bb.deriveNets();
    // r1.a and led1.anode are in the same strip (col-t5)
    const shared = nets.find(n =>
      n.terminals.some(t => t.part === 'r1' && t.terminal === 'a') &&
      n.terminals.some(t => t.part === 'led1' && t.terminal === 'anode')
    );
    assert.ok(shared, 'r1.a and led1.anode should share a net via strip col-t5');
  });
});

describe('FOOTPRINTS', () => {
  it('every footprint has a refTerminal in its leads', () => {
    for (const [kind, fp] of Object.entries(FOOTPRINTS)) {
      // Retro DIP entries (coordinator-claimed) may omit refTerminal —
      // they use pin-1-bottom with straddlesGutter and the seating code
      // picks the first lead as the implicit reference. Skip those.
      if (!fp.refTerminal && fp.straddlesGutter) continue;
      assert.ok(fp.leads[fp.refTerminal], `${kind}: refTerminal "${fp.refTerminal}" not in leads`);
    }
  });

  it('ref terminal is always at offset (0, 0)', () => {
    for (const [kind, fp] of Object.entries(FOOTPRINTS)) {
      if (!fp.refTerminal) continue; // skip entries without explicit refTerminal
      const ref = fp.leads[fp.refTerminal];
      assert.equal(ref.dRow, 0, `${kind}: refTerminal dRow should be 0`);
      assert.equal(ref.dCol, 0, `${kind}: refTerminal dCol should be 0`);
    }
  });
});
