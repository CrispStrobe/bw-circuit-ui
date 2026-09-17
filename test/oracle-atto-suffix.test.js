/**
 * ngspice READS A BARE `A` SUFFIX AS ATTO, AND WE READ IT AS AMPERES.
 *
 * `I1 0 vc 2.6A` is 2.6e-18 A to ngspice 42 and 2.6 A to us -- we treat a
 * trailing letter as a unit, which is what makes `4.7kOhm`, `100nF` and `1uF`
 * work. Two Si7li decks were being reported as numeric disagreements on this
 * alone, at 63.6 V and 2.6 V, and neither is a disagreement about a circuit.
 *
 * THE SCOPE IS EXACTLY ONE LETTER, measured rather than assumed. Every suffix a
 * deck plausibly writes was run through ngspice 42 as `I1 0 vc 2<suffix>` and
 * compared against `parseSpiceValue`:
 *
 *     same:     (none) V v R r F f H h Ohm ohm T G K k M MEG meg MIL U u
 *               N n P p m E e
 *     DIFFERS:  A a        ngspice 2e-18, ours 2
 *
 * That sweep includes the two traps this codebase already documents -- `F` is
 * femto and not farads, `M` is milli and not mega -- and both agree. So `A` is
 * the only reading difference between the two number parsers, and a narrow
 * named refusal is the whole of it.
 *
 * WHICH READING IS RIGHT IS NOT THE POINT, and that is why this is a refusal
 * rather than a fix to either side. A deck author writing `2.6A` for a current
 * source plainly means amperes; ngspice plainly means atto. The comparison is
 * meaningless either way, so it is declined BY NAME -- the same treatment
 * `oracle-clamped-is` gets for ngspice's silent 1e-28 floor on diode IS.
 *
 * ONLY VALUE POSITIONS ARE INSPECTED. `3a` is a perfectly good node name and
 * the corpus contains one (`XU4 N001 0 +V -V 3a level3a Avol=1Meg`), so a
 * looser scan would decline decks over a node's spelling. The control for that
 * is in here.
 */

import './_setup.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { attoSuffixedRefsOf } from '../scripts/spice-oracle.mjs';
import { parseSpiceValue } from '../src/model/si.js';

const refs = (deck) => [...attoSuffixedRefsOf(deck)].sort();

describe('finding the cards whose value carries a bare A', () => {
  it('names the element, on every card shape that puts a value there', () => {
    assert.deepEqual(refs('I1 0 Vcurrent 2.6A\nR4 Vcurrent 0 1'), ['I1']);
    assert.deepEqual(refs('V1 a b DC 5A\nR1 a b 1k'), ['V1'], 'past a DC keyword');
    assert.deepEqual(refs('R1 a b 10a'), ['R1'], 'lower case too');
    assert.deepEqual(refs('C1 a b 4.7A'), ['C1']);
    assert.deepEqual(refs('L1 a b 1e-3A'), ['L1'], 'with an exponent');
    assert.deepEqual(refs('I1 0 n1 5A\nI2 0 n2 7a\nR1 n1 0 1'), ['I1', 'I2'], 'more than one');
  });

  it('does NOT fire on a node named like a value', () => {
    // THE CONTROL. `3a` is a node here, and the corpus has exactly this shape.
    // A scan that looked at the whole line would decline the deck over it.
    assert.deepEqual(refs('XU4 N001 0 +V -V 3a level3a Avol=1Meg\nR1 3a 0 1k'), []);
    assert.deepEqual(refs('R1 3a 4a 1k'), [], 'both nodes named like values');
    assert.deepEqual(refs('I1 0 2A 5'), [], 'even when the NODE is spelled 2A');
  });

  it('does not fire on a SCALE FACTOR that merely ends in a', () => {
    // The separating case for the strict pattern, and it is not hypothetical:
    // both parsers take the first recognised scale factor and ignore the rest,
    // so these agree exactly and a value ending in `a` is not automatically an
    // atto value. Measured against ngspice 42:
    //
    //     2ka   2e3      2na   2e-9     2Ta   2e12
    //     2Mega 2e6      2MEGA 2e6      2mega 2e6
    //
    // A loose `/[Aa]$/` test passes every other assertion in this file and
    // wrongly declines all six of these.
    for (const value of ['2ka', '2na', '2Ta', '2Mega', '2MEGA', '2mega', '2ua', '2pa']) {
      assert.deepEqual(refs(`I1 0 vc ${value}`), [], `${value} is a scale factor, not atto`);
    }
  });

  it('does not fire on suffixes the two engines agree about', () => {
    // If any of these ever starts firing, the sweep in this file's header has to
    // be re-run before the pattern is widened -- these are agreements, measured.
    for (const card of ['R1 a b 4.7kOhm', 'C1 a b 100nF', 'L1 a b 1mH',
      'V1 a b 3V', 'R1 a b 1MEG', 'C1 a b 2F', 'R1 a b 1MIL']) {
      assert.deepEqual(refs(card), [], card);
    }
  });

  it('ignores comments, directives and titles', () => {
    assert.deepEqual(refs(';I1 0 vc 5A\nR1 a b 1k'), []);
    assert.deepEqual(refs('* I1 0 vc 5A\nR1 a b 1k'), []);
    assert.deepEqual(refs('.param x=5A\nR1 a b 1k'), [],
      'a .param is not an element card; its value never reaches this path');
    assert.deepEqual(refs('R1 a b 1k ; see I1 0 vc 5A'), [], 'a trailing comment');
  });
});

describe('our own parser, for the record', () => {
  it('reads the suffix as a unit, which is the behaviour the rest depends on', () => {
    assert.equal(parseSpiceValue('2.6A'), 2.6);
    assert.equal(parseSpiceValue('4.7kOhm'), 4700, 'the same rule that makes this work');
    assert.equal(parseSpiceValue('100nF'), 100e-9);
    // And the traps the sweep confirmed we share with ngspice.
    assert.equal(parseSpiceValue('2F'), 2e-15, 'F is femto, not farads');
    assert.equal(parseSpiceValue('2M'), 2e-3, 'M is milli, not mega');
  });
});
