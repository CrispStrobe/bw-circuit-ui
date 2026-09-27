/**
 * A BJT CARD MAY CARRY A SUBSTRATE NODE, AND WE WERE READING IT AS THE MODEL.
 *
 * ngspice's BJT is `Q<name> nc nb ne [ns] mname`, and LTspice writes the
 * optional substrate in brackets. Slicing a fixed three nodes took the
 * SUBSTRATE as the model name, so the real model name became a trailing field
 * nobody read:
 *
 *     Q1 N002 N003 N005 0 2N2222       ->  model "0"
 *     Q1 3 5 4 [4] NP                  ->  model "[4]"
 *
 * Neither name is declared anywhere, so the part fell through to engine
 * defaults -- a piecewise knee with no IS, no BF and no VAF where the deck
 * stated all three -- and SILENTLY: a warning, no loss, so the deck was still
 * judged. Measured on the Si7li no-aug corpus: **5,285 npn/pnp parts across
 * 2,028 decks** read a node as their model this way.
 *
 * THE DISCRIMINATOR IS THE MODEL TABLE, NOT THE TOKEN COUNT. `Q1 c b e MOD 2`
 * (a three-node card with an area factor) and `Q1 c b e s MOD` both have five
 * fields after the refdes, so counting cannot separate them. The rule is
 * ngspice's own lookahead: if what we took as the model is not declared and the
 * NEXT field is, the field we took was a node. It cannot fire when the
 * three-node reading already resolves, and the area-factor case below is the
 * control for that.
 *
 * WHAT THE FIX IS WORTH, and it is not what I first reported. On the comparable
 * set it gains NO agreements and exposes one disagreement that had been
 * reported as a non-convergence:
 *
 *     before                         638 agree / 17 disagree
 *     parse fix                      638 agree / 18 disagree
 *
 * Its value is correctness and the 2,028 decks that never reach the comparison,
 * not a headline number. Saying so is the point: a fix whose measured corpus
 * delta is zero is still a fix, and pretending otherwise is how a refusal gets
 * added to make the number move.
 *
 * WHICH IS EXACTLY WHAT I NEARLY DID. The dropped-substrate loss started as a
 * blanket one, and every optocoupler in the LTspice library ties the substrate
 * TO THE EMITTER, where dropping it is a topological no-op. The blanket version
 * made the oracle DECLINE those decks:
 *
 *     parse fix + blanket loss       638 agree / 12 disagree
 *
 * six visible disagreements turned into declines, none of them fixed. The last
 * test in this file is the one that holds that open.
 */

import './_setup.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { importSpice } from '../src/importers/spice.js';
import { undeclaredReferences } from '../scripts/ltspice-library-resolver.mjs';

/** A working BJT bench with whatever Q card the caller wants to write. */
const deckWith = (qCard, model = '.model NP NPN(Is=1e-14 Bf=610 Vaf=140)') => [
  '* four-node BJT bench',
  model,
  qCard,
  'V1 c 0 5',
  'R1 b 0 1k',
  'R2 e 0 1k',
  '.op',
].join('\n');

const bjtOf = (out) => out.parts.find(p => /^Q/i.test(String(p.id || '')));
const lossKinds = (out) => (out.losses || []).map(l => l.kind);

describe('the model name survives a substrate node', () => {
  it('reads a three-node card exactly as before', () => {
    const out = importSpice(deckWith('Q1 c b e NP'), {});
    const q = bjtOf(out);
    assert.equal(q.params._model, 'NP');
    assert.equal(q.params.is, 1e-14);
    assert.equal(q.params.beta, 610);
    assert.equal(q.params.vaf, 140);
    assert.deepEqual(lossKinds(out), []);
  });

  it('reads the model past a numeric substrate node', () => {
    const out = importSpice(deckWith('Q1 c b e 0 NP'), {});
    const q = bjtOf(out);
    assert.equal(q.params._model, 'NP', 'the substrate must not be read as the model');
    assert.equal(q.params.is, 1e-14, 'and the model card must actually be applied');
    assert.equal(q.params.beta, 610);
    assert.equal(q.params.vaf, 140);
    assert.equal(q.params.model, 'shockley', 'a stated IS puts it on the Ebers-Moll path');
  });

  it('reads the model past a BRACKETED substrate node, which is how LTspice writes it', () => {
    // The 4N25's own phototransistor: `Q1 3 5 4 [4] NP`.
    const out = importSpice(deckWith('Q1 c b e [e] NP'), {});
    const q = bjtOf(out);
    assert.equal(q.params._model, 'NP');
    assert.equal(q.params.vaf, 140);
  });

  it('does NOT mistake an area factor for a substrate node', () => {
    // THE CONTROL, and the reason the rule consults the model table: this card
    // has exactly as many fields as a four-node one. A token count reads `2` as
    // the model here and silently defaults the device.
    const out = importSpice(deckWith('Q1 c b e NP 2'), {});
    const q = bjtOf(out);
    assert.equal(q.params._model, 'NP');
    assert.equal(q.params.beta, 610);
    assert.ok(!lossKinds(out).includes('dropped-bjt-substrate-node'),
      'nothing was dropped: this card has three nodes');
  });

  it('does not let a bracketed substrate collide with a model of the same name', () => {
    // A model legally named `e` beside a substrate written `[e]`. The first
    // version of the lookahead stripped the brackets before consulting the
    // model table, which made `[e]` look like a declared model and read the
    // SUBSTRATE as the model again -- beta 7 instead of 610. A mutation
    // removing that strip changed nothing in any other test, which is how the
    // dead-and-wrong line was found; this is the case that pins its removal.
    const out = importSpice(deckWith('Q1 c b e [e] NP',
      '.model e NPN(Is=9e-14 Bf=7)\n.model NP NPN(Is=1e-14 Bf=610 Vaf=140)'), {});
    const q = bjtOf(out);
    assert.equal(q.params._model, 'NP');
    assert.equal(q.params.beta, 610, 'the substrate must not win over the real model');
    assert.equal(q.params.vaf, 140);
  });

  it('keeps the three-node reading when it already resolves', () => {
    // Two declared models, the card naming the first. The lookahead must not
    // fire just because a later field happens to name a model too.
    const out = importSpice(deckWith('Q1 c b e NP NQ',
      '.model NP NPN(Is=1e-14 Bf=610)\n.model NQ NPN(Is=2e-14 Bf=50)'), {});
    const q = bjtOf(out);
    assert.equal(q.params._model, 'NP');
    assert.equal(q.params.beta, 610, 'the FIRST name wins, as position dictates');
  });
});

describe('the substrate is a node even when the model is unavailable', () => {
  // The model table can only fire when the real model is DECLARED, and 3,690
  // parts in the Si7li no-aug corpus still reported their model as "0" after
  // the table rule alone: their decks name a model no library supplied, so
  // NEITHER token resolves and the table says nothing. The fallback is the
  // syntactic rule the library resolver already uses.
  const undeclared = (qCard) => importSpice(
    ['* no model card here', qCard, 'V1 c 0 5', 'R1 b 0 1k', 'R2 e 0 1k', '.op'].join('\n'), {});
  const modelWarning = (out) => (out.warnings || []).find(w => /model "/.test(w)) || '';

  it('names the real model in the warning, not the substrate node', () => {
    for (const card of ['Q1 c b e 0 2N2222', 'Q1 c b e [0] 2N2222']) {
      const out = undeclared(card);
      assert.equal(bjtOf(out).params._model, '2N2222', card);
      // The part is defaulted either way -- what changes is whether the reason
      // names the right cause. "model 0 is not declared" sends the next reader
      // to look for a model called 0.
      assert.match(modelWarning(out), /model "2N2222" is not declared/, card);
    }
  });

  it('leaves a model name that merely STARTS with a digit alone', () => {
    // `1N4148` is not a bare integer, and a looser test (`/^\d/`) would eat it.
    // The trailing field is load-bearing: without it the card has only one
    // field after the nodes, so the length guard alone protects it and a loose
    // pattern survives this assertion. With it, a loose pattern reads the area
    // factor as the model -- which is what makes this a separating state.
    const out = undeclared('Q1 c b e 1N4148 2');
    assert.equal(bjtOf(out).params._model, '1N4148');
    assert.match(modelWarning(out), /model "1N4148" is not declared/);
    // And the bare three-node form, for completeness.
    assert.equal(bjtOf(undeclared('Q1 c b e 1N4148')).params._model, '1N4148');
  });

  it('still leaves an area factor as an area factor', () => {
    const out = undeclared('Q1 c b e 2N2222 2');
    assert.equal(bjtOf(out).params._model, '2N2222');
  });
});

describe('the dropped substrate is reported only where it is a real loss', () => {
  it('names the loss when the substrate is a node of its own', () => {
    for (const card of ['Q1 c b e 0 NP', 'Q1 c b e sub NP', 'Q1 c b e [sub] NP']) {
      const out = importSpice(deckWith(card), {});
      assert.ok(lossKinds(out).includes('dropped-bjt-substrate-node'), card);
      const loss = out.losses.find(l => l.kind === 'dropped-bjt-substrate-node');
      assert.match(loss.reason, /collector-substrate junction is not\s+solved/,
        'the reason must say what is not solved');
      assert.match(loss.reason, /distinct from/, 'and why this one counts');
    }
  });

  it('reports NOTHING when the substrate is the emitter, so the deck stays judged', () => {
    // THE ASSERTION THAT HOLDS THE MEASUREMENT OPEN. Every optocoupler in the
    // LTspice library wires the substrate to the emitter, and a blanket loss
    // here made the oracle decline six Si7li decks whose disagreements it did
    // not fix. If this test ever reds because the condition was broadened, the
    // right response is to re-read the numbers in this file's header, not to
    // delete the assertion.
    for (const card of ['Q1 c b e e NP', 'Q1 c b e [e] NP']) {
      const out = importSpice(deckWith(card), {});
      assert.deepEqual(lossKinds(out), [], `${card} must import with no loss at all`);
      assert.equal(bjtOf(out).params.vaf, 140, 'and still read its model');
    }
  });
});

describe('the library resolver asks for the model, not the node', () => {
  it('requests the model name from a four-node card', () => {
    // The resolver keeps its own copy of the model-name position, so the fix
    // has two sites. Before this it asked the library for "0" and for "[4]" --
    // misses that look exactly like a missing vendor model, which is how the
    // whole thing stayed hidden.
    assert.deepEqual([...undeclaredReferences('Q1 N002 N003 N005 0 2N2222\n.op')], ['2n2222']);
    assert.deepEqual([...undeclaredReferences('Q1 3 5 4 [4] NP\n.op')], ['np']);
  });

  it('still requests the model from a three-node card, with or without an area', () => {
    assert.deepEqual([...undeclaredReferences('Q1 c b e 2N3904\n.op')], ['2n3904']);
    assert.deepEqual([...undeclaredReferences('Q1 c b e 2N3904 2\n.op')], ['2n3904']);
  });

  it('asks for nothing when the deck declares the model itself', () => {
    assert.deepEqual([...undeclaredReferences('.model NP NPN(Is=1e-14)\nQ1 c b e 0 NP\n.op')], []);
  });
});
