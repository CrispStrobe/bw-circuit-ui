/**
 * Importing a MOSFET's BULK node.
 *
 * The engine's nmos/pmos have three terminals, so the bulk is not wired. It is
 * not irrelevant, though: a stacked device has its source above the bulk by
 * construction, and its threshold is then not VTO. What the importer has to
 * carry across is not a fourth terminal but a FACT ABOUT THE WIRING —
 * `bulkAtGround` — plus the two model parameters the law needs.
 *
 * Census over ADI2005 v3's 12,471 decks (15,587 M cards):
 *   11,950 bulk on the source        -> no shift
 *    3,334 bulk at ground, source not -> shift
 *      303 bulk on a third node       -> declined, with a warning
 */

import './_setup.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { importSpice } from '../src/importers/spice.js';

const deck = (mLine, model = '.model NM NMOS(VTO=1 KP=100u GAMMA=0.5 PHI=0.6)') =>
  ['* bulk wiring', 'Vdd vdd 0 DC 10', 'Vg g 0 DC 4',
    mLine, 'Rd vdd d 2k', 'Rs s 0 1k', model, '.op', '.end'].join('\n');

const m1 = (r) => r.parts.find((p) => p.id === 'M1');

describe('MOSFET bulk node', () => {
  it('maps GAMMA and PHI off the model card', () => {
    const r = importSpice(deck('M1 d g s 0 NM'));
    assert.equal(m1(r).params.gamma, 0.5);
    assert.equal(m1(r).params.phi, 0.6);
  });

  it('omits GAMMA when the model omits it — SPICE defaults it to zero', () => {
    const r = importSpice(deck('M1 d g s 0 NM', '.model NM NMOS(VTO=1 KP=100u)'));
    assert.equal(m1(r).params.gamma, undefined);
    assert.equal(m1(r).params.phi, undefined);
  });

  it('flags bulk-at-ground when the SOURCE is somewhere else', () => {
    const r = importSpice(deck('M1 d g s 0 NM'));
    assert.equal(m1(r).params.bulkAtGround, true);
    assert.deepEqual(r.unmapped, []);
  });

  it('does NOT flag it when the bulk is tied to the source', () => {
    const r = importSpice(deck('M1 d g s s NM'));
    assert.equal(m1(r).params.bulkAtGround, undefined);
    assert.deepEqual(r.unmapped, []);
  });

  it('does NOT flag it when source and bulk are both the reference', () => {
    // Two spellings of the same node: bulk `0`, source `gnd`. Vsb is 0, so a
    // shift here would be a body effect invented out of a naming difference.
    const r = importSpice(deck('M1 d g gnd 0 NM'));
    assert.equal(m1(r).params.bulkAtGround, undefined);
  });

  it('declines and WARNS when the bulk is a third node, rather than guessing', () => {
    const r = importSpice(
      ['* third-node bulk', 'Vdd vdd 0 DC 10', 'Vg g 0 DC 4', 'Vb bulk 0 DC -5',
        'M1 d g s bulk NM', 'Rd vdd d 2k', 'Rs s 0 1k',
        '.model NM NMOS(VTO=1 KP=100u GAMMA=0.5 PHI=0.6)', '.op', '.end'].join('\n'));
    assert.equal(m1(r).params.bulkAtGround, undefined,
      'a third-node bulk is not a grounded bulk');
    assert.ok(r.warnings.some((w) => /bulk node/.test(w) && /M1/.test(w)),
      `the decision must be reported: ${JSON.stringify(r.warnings)}`);
  });

  it('warns for a third-node bulk on a PMOS too, not only an NMOS', () => {
    // Guard every reach, not the one you see: the bulk rule is on the M card,
    // so it must not depend on which channel type the model declares.
    const r = importSpice(
      ['* pmos third-node bulk', 'Vdd vdd 0 DC 10', 'Vb bulk 0 DC 12',
        'M1 d g s bulk PM', 'Rd d 0 2k', 'Vg g 0 DC 4', 'Vs vdd s 0',
        '.model PM PMOS(VTO=-1 KP=100u GAMMA=0.5 PHI=0.6)', '.op', '.end'].join('\n'));
    assert.ok(r.warnings.some((w) => /bulk node/.test(w) && /M1/.test(w)),
      `the decision must be reported for a PMOS as well: ${JSON.stringify(r.warnings)}`);
  });
});
