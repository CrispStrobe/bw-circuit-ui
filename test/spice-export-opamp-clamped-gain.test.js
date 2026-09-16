/**
 * AN OP-AMP WITH RAILS IS A CLAMPED GAIN BLOCK, AND IT MUST CLAMP SHARPLY.
 *
 * This kind was omitted from the deck entirely, so `pc54-opamp-follower`
 * refused as `unrepresented-part: U1` -- honest, and a comparison we were
 * simply not having. bw-board's stamp is
 * `clamp(gain * (inp - inn), railLow, railHigh)`, and ngspice can say that.
 *
 * WHICH FORM, AND WHY NOT THE OBVIOUS ONE. An `E ... TABLE` looks right and is
 * wrong: ngspice ROUNDS A TABLE'S CORNERS to keep the derivative continuous, so
 * a breakpoint sitting on the operating point reads the smoothed value instead
 * of the corner. With `(0,0) (50u,5)` and the inputs exactly equal, ngspice
 * answers 0.125 V where the clamp says 0.
 *
 * That cost a real regression to find. `pc40-opamp-threshold` is a comparator
 * whose two inputs sit at 2.5 V each -- exactly on the corner. It AGREED while
 * the op-amp was missing from the deck, and went 125 mV out the moment a
 * rounded corner stood in for a sharp one. A `B` source with
 * `min(max(...))` clamps sharply, and on the same shape ngspice-42 gives
 * 0.000000 with the inputs equal, the rails at +/-1 mV, and 3.000000 V at
 * +30 uV, which is gain x 3e-5 exactly.
 *
 * Both examples agree now, and the gallery went 2,120 -> 2,122 of 2,131 with
 * zero regressions.
 */

import './_setup.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Circuit } from '../src/model/circuit.js';
import { extractNetlist } from '../src/model/netlist.js';
import { toSpice } from '../src/model/exporters/spice.js';

/** An op-amp wired as a follower, with whatever params the caller wants. */
const deckFor = (params) => {
  const c = Circuit.fromJSON({
    parts: [
      { id: 'v1', kind: 'vsource', params: { volts: 2.5 } },
      { id: 'g1', kind: 'gnd', params: {} },
      { id: 'r1', kind: 'resistor', params: { ohms: 1000 } },
      { id: 'u1', kind: 'opamp', params },
    ],
    wires: [
      { id: 'w1', from: { part: 'v1', terminal: 'neg' }, to: { part: 'g1', terminal: 'gnd' } },
      { id: 'w2', from: { part: 'v1', terminal: 'pos' }, to: { part: 'u1', terminal: 'inp' } },
      { id: 'w3', from: { part: 'u1', terminal: 'out' }, to: { part: 'u1', terminal: 'inn' } },
      { id: 'w4', from: { part: 'u1', terminal: 'out' }, to: { part: 'r1', terminal: 'a' } },
      { id: 'w5', from: { part: 'r1', terminal: 'b' }, to: { part: 'g1', terminal: 'gnd' } },
    ],
  });
  return toSpice(extractNetlist(c), 'opamp clamped gain');
};

describe('the deck states the clamped gain block the engine solves', () => {
  it('emits a B source whose expression is the stamp, and no TABLE', () => {
    const out = deckFor({ gain: 1e5, railLow: 0, railHigh: 5 });
    const m = /^BU1 (\S+) 0 V = min\(max\(([\d.eE+-]+)\*V\((\S+),(\S+)\), ([\d.eE+-]+)\), ([\d.eE+-]+)\)$/m
      .exec(out.text);
    assert.ok(m, `a clamped B source must be written: ${out.text}`);
    assert.equal(Number(m[2]), 1e5, 'the gain is the part\'s');
    assert.deepEqual([Number(m[5]), Number(m[6])], [0, 5], 'the rails are the part\'s');

    // NOT a table, and this is the assertion the regression bought: a rounded
    // corner reads 0.125 V where the clamp says 0.
    assert.ok(!/TABLE/i.test(out.text),
      `a TABLE rounds its corners and this device does not: ${out.text}`);
    assert.deepEqual(out.skipped, [], JSON.stringify(out.skipped));
    assert.deepEqual(out.approximated || [], [],
      'gain and rails are exact, so with no current limit nothing is approximated');
  });

  it('reads gain and rails rather than typing them', () => {
    const out = deckFor({ gain: 250, railLow: -12, railHigh: 12 });
    assert.match(out.text, /^BU1 \S+ 0 V = min\(max\(250\*V\(\S+,\S+\), -12\), 12\)$/m, out.text);
  });

  it('declares the output current limit, which the card cannot hold', () => {
    // `iLimit` is opt-in. Without it the card is a COMPLETE description; with
    // it the engine has a region the expression does not, and a limited output
    // would otherwise read as a rail and look like a solver disagreement.
    const out = deckFor({ gain: 1e5, railLow: 0, railHigh: 5, iLimit: 0.02 });
    assert.match(out.text, /^BU1 /m, 'the card is still written');
    assert.equal((out.approximated || []).length, 1, JSON.stringify(out.approximated));
    assert.match(out.approximated[0], /^U1 \(opamp\)/);
    assert.match(out.approximated[0], /0\.02 A output current limit/);
  });

  it('refuses rather than writing an unclamped or inverted gain block', () => {
    for (const bad of [{ gain: 0 }, { gain: 'wobble' }, { gain: 1e5, railLow: 5, railHigh: 0 }]) {
      const out = deckFor({ railLow: 0, railHigh: 5, ...bad });
      assert.ok(!/^BU1 /m.test(out.text), `${JSON.stringify(bad)}: ${out.text}`);
      assert.equal(out.skipped.length, 1, JSON.stringify(out.skipped));
      assert.match(out.skipped[0], /^U1 \(opamp\)/);
    }
  });
});
