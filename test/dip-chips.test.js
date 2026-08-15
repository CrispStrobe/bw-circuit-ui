/**
 * Tests for DIP chip definitions — 74HC logic family.
 */

import './_setup.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LOGIC_CHIPS, logicChipTerminals, logicChipFootprint, dipFootprint } from '../src/model/dip-chips.js';
import { computeLeadMap } from '../src/model/footprints.js';
import { BreadboardModel } from '../src/model/breadboard.js';

describe('LOGIC_CHIPS', () => {
  it('every chip has both vcc and gnd somewhere in its pin map', () => {
    for (const [kind, chip] of Object.entries(LOGIC_CHIPS)) {
      const names = Object.values(chip.pinMap);
      assert.ok(names.includes('vcc'), `${kind}: must have VCC`);
      assert.ok(names.includes('gnd'), `${kind}: must have GND`);
    }
  });

  it('every chip has unique terminal names', () => {
    for (const [kind, chip] of Object.entries(LOGIC_CHIPS)) {
      const names = Object.values(chip.pinMap);
      const unique = new Set(names);
      assert.equal(names.length, unique.size, `${kind}: duplicate terminal names`);
    }
  });
});

describe('logicChipTerminals', () => {
  it('74hc08 has 14 terminals (4 gates × 3 pins + vcc + gnd)', () => {
    const terms = logicChipTerminals('74hc08');
    assert.equal(terms.length, 14);
    assert.ok(terms.includes('vcc'), 'includes vcc');
    assert.ok(terms.includes('gnd'), 'includes gnd');
    assert.ok(terms.includes('1a'));
    assert.ok(terms.includes('1y'));
  });

  it('74hc04 has 14 terminals (6 inverters × 2 + vcc + gnd)', () => {
    const terms = logicChipTerminals('74hc04');
    assert.equal(terms.length, 14);
  });

  it('returns null for unknown kind', () => {
    assert.equal(logicChipTerminals('74hc999'), null);
  });
});

describe('logicChipFootprint', () => {
  it('74hc08 DIP-14 straddles the gutter', () => {
    const fp = logicChipFootprint('74hc08');
    assert.ok(fp.straddlesGutter);
    // Pin 1 (1a) at offset (0,0), pin 14 (vcc) at (5,0) — across gutter
    assert.deepEqual(fp.leads['1a'], { dRow: 0, dCol: 0 });
    assert.deepEqual(fp.leads['vcc'], { dRow: 5, dCol: 0 });
  });

  it('DIP-14 footprint can be seated on a breadboard', () => {
    const fp = logicChipFootprint('74hc08');
    const leadMap = computeLeadMap(fp, 'e5');

    // Pin 1 at e5, pin 7 (gnd) at e11, pin 8 at f11 (gutter straddle), pin 14 (vcc) at f5
    assert.equal(leadMap['1a'], 'e5');
    assert.equal(leadMap['gnd'], 'e11');
    assert.equal(leadMap['vcc'], 'f5');

    // Should seat on a breadboard
    const bb = new BreadboardModel();
    bb.occupy('ic1', leadMap);
    const occ = bb.occupantOf('e5');
    assert.equal(occ.partId, 'ic1');
    assert.equal(occ.terminal, '1a');
  });
});
