/**
 * A CONTROLLED SOURCE MAY WRITE ITS CONTROLLING PAIR IN PARENTHESES.
 *
 * `GP1 98 12 (9,98) 1` is standard SPICE for "a VCCS of 1 S controlled by
 * V(9,98)", and splitting the card on whitespace made `(9,98)` ONE field. The
 * element then had two output nodes, one junk control field, and a gain that
 * never parsed -- so the part was created with EMPTY params: a controlled
 * source with no gain, still in the circuit and still solved.
 *
 * LTspice's op-amp macromodels build their gain paths out of exactly these, and
 * a macromodel whose controlled sources all have zero gain has no gain at all.
 * Three corpus decks read V(OUT) = -14.93 V against ngspice's -0.002 V, with an
 * internal node at 52.5 V on a +/-15 V supply.
 *
 * (Those three decks are STILL disagreeing, and this file does not claim
 * otherwise. Their macromodel has fifty-odd elements and this was the fourth
 * hypothesis I tested on them; the first three -- VDMOS subthreshold, comma
 * separated model cards, and a missing KP -- were each disproved by measurement
 * too. What this fix does is make a documented SPICE spelling parse, which is
 * worth having whether or not it is the last thing wrong with an OP213.)
 *
 * ONLY A BARE NODE PAIR IS REWRITTEN, AND ONLY ON E/F/G/H, because an
 * `E ... TABLE(...)` card and a `B` source's expression also carry parentheses.
 *
 * BOTH OF THOSE GUARDS ARE DEFENSIVE RATHER THAN LOAD-BEARING TODAY, and
 * mutation testing is how I know: widening the letter gate to include `B`, and
 * replacing the narrow pattern with a greedy `/\((.*),(.*)\)/`, each leave
 * every assertion in this file passing. The reasons are specific --
 *
 *   - a `B` card is refused BY LETTER before the rewrite runs, so the rewrite
 *     never sees one; that changes the day behavioural sources are supported.
 *   - on the E/F/G/H card shapes that actually occur, greedy and narrow produce
 *     the same fields. A mangled `TABLE(...)` is unparseable either way and
 *     reports the same loss, so nothing observable separates them.
 *
 * The narrow forms are kept because they cost nothing and are correct, not
 * because a test below would catch their loss. The last two tests still earn
 * their place: they pin that a TABLE card and a B source come out of the
 * importer exactly as they did before this change, which is the regression that
 * WOULD be visible.
 */

import './_setup.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { importSpice } from '../src/importers/spice.js';

/** A controlled source on a bench, with whatever card the caller writes. */
const sourceFrom = (card) => {
  const out = importSpice(['* controlled source bench', card,
    'V1 in 0 1', 'R1 out 0 1k', 'R2 in 0 1k', 'R3 a b 1k', 'R4 b 0 1k', '.op'].join('\n'), {});
  return { part: out.parts.find(p => /^[EFGHB]/i.test(String(p.id || ''))), out };
};

describe('the controlling pair in parentheses', () => {
  it('reads a VCCS gain past a parenthesised pair', () => {
    const { part } = sourceFrom('GP1 out 0 (in,0) 1');
    assert.equal(part.kind, 'vccs');
    assert.equal(part.params.gm, 1, 'the gain must parse, not be left empty');
  });

  it('reads a VCVS gain past a parenthesised pair', () => {
    const { part } = sourceFrom('EP1 out 0 (in,0) 2');
    assert.equal(part.kind, 'vcvs');
    assert.equal(part.params.gain, 2);
  });

  it('tolerates whitespace inside the parentheses', () => {
    assert.equal(sourceFrom('GP1 out 0 ( in , 0 ) 1').part.params.gm, 1);
    assert.equal(sourceFrom('GP1 out 0 (in , 0) 1').part.params.gm, 1);
  });

  it('is identical to the unparenthesised form', () => {
    // THE CONTROL that says this is a spelling and not a different device.
    const withParens = sourceFrom('GP1 out 0 (in,0) 1').part;
    const without = sourceFrom('GP1 out 0 in 0 1').part;
    assert.equal(withParens.kind, without.kind);
    assert.deepEqual(withParens.params, without.params);
  });

  it('reports no loss for a card it now understands', () => {
    // Before the fix this card produced an `unsupported-constant-expression`
    // loss AND a zero-gain part -- the loss was real but the part was still
    // added, which is the worst of both.
    const { out } = sourceFrom('GP1 out 0 (in,0) 1');
    assert.deepEqual(out.losses.map(l => l.kind), []);
  });
});

describe('what must not be rewritten', () => {
  it('leaves an E ... TABLE card refused by name, with its own text in the loss', () => {
    const { out } = sourceFrom('E1 out 0 TABLE(V(in,0)) = (0,0) (1,5)');
    assert.deepEqual(out.losses.map(l => l.kind), ['unsupported-constant-expression'],
      'unchanged behaviour: a TABLE is still refused by name');
    // The loss must quote the card AS WRITTEN. A reader chasing it needs the
    // deck's own line, not a normalised one.
    assert.equal(out.losses[0].source, 'E1 out 0 TABLE(V(in,0)) = (0,0) (1,5)');
  });

  it('leaves a B source refused as behavioural, by name', () => {
    // A `B` card's whole value is an expression full of parentheses and commas:
    // `V = min(max(1e5*V(a,b),-15),15)`. It is refused by letter BEFORE the
    // rewrite runs, which is why widening the gate to `B` is invisible today --
    // and why this assertion is about the refusal being intact rather than
    // about the rewrite.
    const { out } = sourceFrom('B1 out 0 V = min(max(1e5*V(a,b),-15),15)');
    assert.deepEqual(out.losses.map(l => l.kind), []);
    assert.deepEqual(out.unmapped.map(u => u.ref), ['B1']);
    assert.match(out.unmapped[0].libsource, /behavioural source/);
  });

  it('leaves a resistor with a parenthesised value alone', () => {
    // The rewrite is gated on the element letter, and a non-E/F/G/H card with
    // parentheses must pass through untouched.
    const out = importSpice(['* bench', 'R1 a 0 {1k}', 'V1 a 0 1', '.op'].join('\n'), {});
    const r = out.parts.find(p => /^R1$/i.test(String(p.id || '')));
    assert.equal(r.params.ohms, 1000);
  });
});
