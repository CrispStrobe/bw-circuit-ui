/**
 * AN AUTHORED BETA THE CARD DOES NOT CARRY IS STILL WHAT THE SOLVER USES.
 *
 * The exporter resolves a BJT's `.model` by NAME -- `params.part`, else the
 * kind's generic card -- and writes that card's `Bf`. bw-board's stamp reads
 * `params.beta`. A part carrying `beta` in its own params and no `params.part`
 * therefore got the GENERIC Bf in the deck while the engine solved the authored
 * number, and the oracle compared two different transistors.
 *
 * Measured on `44-darlington-motor`, where an open button feeds a BJT base
 * through 1 TOhm:
 *
 *   part says beta 1000, deck said `.model Q_DEFAULT NPN (Bf=100 Is=1e-14)`
 *   V(base)  engine 0.354255 V   ngspice 0.295240 V   delta 59 mV
 *
 * Both variants agree once the deck states the authored beta.
 *
 * WHY A PER-PART CARD. Two BJTs with different betas must not collide on one
 * model name, and the diode branch already emits `D_<refdes>` for exactly that
 * reason. The card's own body is the base, so every other field still comes
 * from the parts library rather than from a literal here -- only `Bf` is
 * substituted.
 *
 * POPULATION, measured BEFORE the change: 2 of the 79 gallery circuits carrying
 * a BJT have a part beta the deck contradicts, and both already disagreed. So
 * this costs no agreement, and the 2,131-circuit sweep confirms it: 2,114 ->
 * 2,116 with zero regressions.
 *
 * (The first measurement said ZERO of 79, because the regex was `[PN]NP` --
 * which matches PNP and cannot match NPN. A census that reports zero deserves
 * the same suspicion as one that reports everything.)
 */

import './_setup.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Circuit } from '../src/model/circuit.js';
import { extractNetlist } from '../src/model/netlist.js';
import { toSpice } from '../src/model/exporters/spice.js';

/** An NPN driven from a rail, with whatever params the caller wants on it. */
const deckFor = (params) => {
  const c = Circuit.fromJSON({
    parts: [
      { id: 'v1', kind: 'vcc', params: {} },
      { id: 'g1', kind: 'gnd', params: {} },
      { id: 'rc1', kind: 'resistor', params: { ohms: 100 } },
      { id: 'rb1', kind: 'resistor', params: { ohms: 10000 } },
      { id: 'q1', kind: 'npn', params },
    ],
    wires: [
      { id: 'w1', from: { part: 'v1', terminal: 'vcc' }, to: { part: 'rc1', terminal: 'a' } },
      { id: 'w2', from: { part: 'rc1', terminal: 'b' }, to: { part: 'q1', terminal: 'collector' } },
      { id: 'w3', from: { part: 'v1', terminal: 'vcc' }, to: { part: 'rb1', terminal: 'a' } },
      { id: 'w4', from: { part: 'rb1', terminal: 'b' }, to: { part: 'q1', terminal: 'base' } },
      { id: 'w5', from: { part: 'q1', terminal: 'emitter' }, to: { part: 'g1', terminal: 'gnd' } },
    ],
  });
  return toSpice(extractNetlist(c), 'authored beta');
};

const bfOf = (text, model) => {
  const m = new RegExp(`^\\.model\\s+${model}\\s+NPN\\s*\\(([^)]*)\\)`, 'im').exec(text);
  return m ? Number(/Bf\s*=\s*([\d.eE+-]+)/i.exec(m[1])?.[1]) : null;
};

describe('the deck states the beta the solver uses', () => {
  it('writes an authored beta the resolved card does not carry', () => {
    const out = deckFor({ beta: 1000 });
    // A per-part card, named for the refdes so two BJTs cannot collide.
    assert.match(out.text, /^Q\S*\s+\S+\s+\S+\s+\S+\s+Q_Q1\b/m, out.text);
    assert.equal(bfOf(out.text, 'Q_Q1'), 1000,
      `the deck must state the authored beta, not the card's: ${out.text}`);
    // Everything else still comes from the library: Is is the card's, untouched.
    assert.match(out.text, /^\.model Q_Q1 NPN \(Bf=1000 Is=\S+\)/m, out.text);
    // And it says why, so a reader of the deck is not left guessing.
    assert.match(out.text, /authored beta 1000, not card \S+'s 100/, out.text);
  });

  it('leaves a part whose beta matches its card on the shared card', () => {
    // THE CONTROL. Without it, every BJT would get a per-part model -- correct
    // output, but it would stop testing anything: a card change could no longer
    // move the deck, which is what test/parts-library-one-authority asserts.
    const out = deckFor({ beta: 100 });
    assert.ok(!/\.model Q_Q1\b/.test(out.text),
      `a beta equal to the card's needs no per-part model: ${out.text}`);
    assert.equal(bfOf(out.text, 'Q_DEFAULT'), 100, out.text);
  });

  it('leaves a part with no authored beta on the shared card', () => {
    const out = deckFor({});
    assert.ok(!/\.model Q_Q1\b/.test(out.text), out.text);
    assert.equal(bfOf(out.text, 'Q_DEFAULT'), 100, out.text);
  });
});
