/**
 * A DARLINGTON DRIVER IS A SWITCH, AND SPICE HAS ONE.
 *
 * `tip120` is not an `npn` with a large beta. bw-board registers its own stamp:
 * a base resistance plus a threshold switch that conducts when Vbe exceeds
 * `vbe`, clamps Vce through `rceSat`, and draws NO BASE CURRENT.
 *
 * This deck used to carry `.model <X> NPN (Bf=1000 Is=1e-12)` with a DECLARED
 * approximation beside it, because an Ebers-Moll card expresses none of that.
 * The declaration was honest and it was second best. Measured on
 * `33-inductive-no-flyback`, the largest disagreement the 2,131-circuit gallery
 * had:
 *
 *   V(base)       engine 4.949270 V   ngspice 0.696071 V   delta 4.25 V
 *   V(collector)  engine 0.833194 V   ngspice 0.126525 V
 *
 * ngspice has exactly those two elements, so the deck now SAYS what the engine
 * solves: a resistor and an `S` voltage-controlled switch with a `SW` model.
 * All twelve variants of that example agree.
 *
 * EVERY NUMBER IS READ, NONE TYPED. `vbe`, `rceSat` and `rBase` come from the
 * part or from `classDefaults('tip120')`, which is where the stamp reads them
 * too. `rBase` was `R_INPUT / 10` inside the stamp -- a literal divided by a
 * literal, where no exporter could see it -- and declaring it in the parts
 * library is what made this emission possible. Same reason the buzzer, motor
 * and relay resistances live there.
 */

import './_setup.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Circuit } from '../src/model/circuit.js';
import { extractNetlist } from '../src/model/netlist.js';
import { toSpice } from '../src/model/exporters/spice.js';

/** A driven transistor of the given kind, collector loaded to a rail. */
const deckFor = (kind, params = {}) => {
  const c = Circuit.fromJSON({
    parts: [
      { id: 'v1', kind: 'vcc', params: {} },
      { id: 'g1', kind: 'gnd', params: {} },
      { id: 'rc1', kind: 'resistor', params: { ohms: 100 } },
      { id: 'rb1', kind: 'resistor', params: { ohms: 1000 } },
      { id: 'q1', kind, params },
    ],
    wires: [
      { id: 'w1', from: { part: 'v1', terminal: 'vcc' }, to: { part: 'rc1', terminal: 'a' } },
      { id: 'w2', from: { part: 'rc1', terminal: 'b' }, to: { part: 'q1', terminal: 'collector' } },
      { id: 'w3', from: { part: 'v1', terminal: 'vcc' }, to: { part: 'rb1', terminal: 'a' } },
      { id: 'w4', from: { part: 'rb1', terminal: 'b' }, to: { part: 'q1', terminal: 'base' } },
      { id: 'w5', from: { part: 'q1', terminal: 'emitter' }, to: { part: 'g1', terminal: 'gnd' } },
    ],
  });
  return toSpice(extractNetlist(c), `tip120 switch (${kind})`);
};

const swModel = (text) => {
  const m = /^\.model SW_(\S+) SW\(VT=([\d.eE+-]+) RON=([\d.eE+-]+) ROFF=([\d.eE+-]+)\)/m.exec(text);
  return m && { ref: m[1], vt: Number(m[2]), ron: Number(m[3]), roff: Number(m[4]) };
};

describe('the deck states the switch the engine solves', () => {
  it('emits a base resistor, an S switch and a SW model, and no BJT card', () => {
    const out = deckFor('tip120');
    // The switch: collector-emitter, controlled by base-emitter.
    assert.match(out.text, /^SQ1 \S+ \S+ \S+ \S+ SW_Q1$/m, out.text);
    // The Darlington input resistance, base to emitter.
    assert.match(out.text, /^RBQ1 \S+ \S+ 100k$/m, out.text);
    const m = swModel(out.text);
    assert.ok(m, `a SW model must be written: ${out.text}`);
    assert.deepEqual([m.vt, m.ron], [1.4, 2],
      'the threshold and saturation resistance are the stamp\'s own numbers');
    assert.ok(m.roff >= 1e12, `off must be effectively open, got ${m.roff}`);

    // NOT a BJT any more, and no longer an apology for being one.
    assert.ok(!/^Q\S*\s+\S+\s+\S+\s+\S+\s+\S+$/m.test(out.text),
      `no Q card may remain: ${out.text}`);
    assert.ok(!/\.model \S+ NPN/.test(out.text), out.text);
    assert.deepEqual(out.approximated || [], [],
      'the deck describes the device now, so nothing is approximated');
    assert.deepEqual(out.skipped, [], JSON.stringify(out.skipped));
  });

  it('reads the numbers rather than typing them', () => {
    // THE PROOF THAT NOTHING IS COPIED. Perturb the part and the deck must
    // move; this is the same discipline `parts-library-one-authority` applies
    // to model cards.
    const out = deckFor('tip120', { vbe: 2.1, rceSat: 0.4, rBase: 47000 });
    const m = swModel(out.text);
    assert.deepEqual([m.vt, m.ron], [2.1, 0.4], out.text);
    assert.match(out.text, /^RBQ1 \S+ \S+ 47k$/m, out.text);
  });

  it('refuses rather than writing a switch with a missing number', () => {
    // A `.model SW(VT=NaN)` is a deck that reads complete and cannot simulate,
    // which is the failure mode this file's own history is about.
    const out = deckFor('tip120', { vbe: 'wobble' });
    assert.ok(!/^SQ1 /m.test(out.text), out.text);
    assert.equal(out.skipped.length, 1, JSON.stringify(out.skipped));
    assert.match(out.skipped[0], /^Q1 \(tip120\)/);
  });

  it('leaves an ordinary npn on its BJT card', () => {
    // THE CONTROL: only this kind is a switch. An npn IS an Ebers-Moll device.
    const out = deckFor('npn');
    assert.match(out.text, /\.model \S+ NPN/, out.text);
    assert.ok(!/SW_Q1/.test(out.text), out.text);
    assert.ok(!/^SQ1 /m.test(out.text), out.text);
  });
});
