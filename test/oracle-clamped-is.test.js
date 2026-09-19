/**
 * NGSPICE CLAMPS A DIODE'S IS AT 1e-28 WITHOUT SAYING SO.
 *
 * A deck stating less is simulated as a DIFFERENT device, and the direction
 * matters: the clamp is a FLOOR, so the reference's diode conducts more and
 * sits lower than the one the deck asked for.
 *
 * `40-led-color-mix` is where it bit. Three LEDs on 330 Ohm each; the two
 * Vf = 2 V ones agree to six decimals, and the Vf = 3.2 V one -- a blue/white
 * LED, Shockley-calibrated to `Is=1.995705e-30` -- reads:
 *
 *   engine 3.004796 V    ngspice 2.831799 V    delta 173 mV
 *
 * OURS is the stated device. Scoring that against us would have had me tune a
 * correct answer towards a floor in someone else's solver, which is the worst
 * shape an oracle disagreement can take.
 *
 * MEASURED SCOPE, and it is why this is a named refusal rather than a general
 * tolerance: 2 decks of the 2,131-circuit gallery state an IS below the clamp,
 * both already disagreed, and the gallery total is unchanged at 2,116. ZERO of
 * the 12,471 ADI v3 foreign decks state one, so `judgeForeignDeck` carries no
 * copy of this check -- a guard over an empty population is code nothing
 * exercises.
 */

import './_setup.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { clampedIsRefsOf } from '../scripts/spice-oracle.mjs';

const deck = (...lines) => ['* clamped-is fixture', ...lines, '.op', '.end'].join('\n');

describe('the IS ngspice honours, and the one the deck asked for', () => {
  it('names the refdes whose model sits below the clamp, and only that one', () => {
    const refs = clampedIsRefsOf(deck(
      'V1 s 0 DC 5',
      'R1 s a 330', 'R2 s b 330',
      'D1 a 0 D_BLUE',                       // 2e-30: below the floor
      'D2 b 0 D_RED',                        // 3.2e-19: honoured
      '.model D_BLUE D (Is=2.0e-30 N=1.8 Rs=10)',
      '.model D_RED D (Is=3.165700e-19 N=1.8 Rs=10)'));
    assert.deepEqual([...refs], ['D1']);
  });

  it('reads the refdes from the element line, not from the D_<refdes> habit', () => {
    // `D_<refdes>` is the exporter's convention and not a contract, so the
    // mapping comes from the card the element actually references.
    const refs = clampedIsRefsOf(deck(
      'DLED7 a 0 SOMEBLUEMODEL',
      '.model SOMEBLUEMODEL D (Is=9e-31 N=1.8 Rs=10)'));
    assert.deepEqual([...refs], ['DLED7']);
  });

  it('is empty when every IS is one ngspice will honour', () => {
    // THE CONTROL, and the important one: this must not fire on the ordinary
    // case, or every LED circuit in the gallery becomes a refusal.
    assert.deepEqual([...clampedIsRefsOf(deck(
      'D1 a 0 D_RED', '.model D_RED D (Is=3.165700e-19 N=1.8 Rs=10)'))], []);
    // Exactly AT the floor is honoured -- the clamp is `below`, not `at`.
    assert.deepEqual([...clampedIsRefsOf(deck(
      'D1 a 0 D_EDGE', '.model D_EDGE D (Is=1e-28 N=1.8 Rs=10)'))], []);
    // A model with no IS at all takes ngspice's default, which is above it.
    assert.deepEqual([...clampedIsRefsOf(deck(
      'D1 a 0 D_BARE', '.model D_BARE D'))], []);
    assert.deepEqual([...clampedIsRefsOf('')], []);
  });

  it('does not mistake a BJT or MOS saturation current for a diode', () => {
    // `IS` appears on NPN and NMOS cards too, where the clamp question is a
    // different one. TWO filters keep them out and they are not the same
    // filter: the element scan only reads `D...` refdeses, and the model scan
    // only reads `.model X D (...)`.
    assert.deepEqual([...clampedIsRefsOf(deck(
      'Q1 c b e Q_TINY', 'M1 d g s s M_TINY',
      '.model Q_TINY NPN (Bf=100 Is=1e-30)',
      '.model M_TINY NMOS (LEVEL=1 VTO=1 KP=1m IS=1e-30)'))], []);

    // AND THE CASE THAT SEPARATES THEM, because the assertion above passes on
    // the element filter alone and says nothing about the model filter -- the
    // mutation test proved it: widening `.model X D` to `.model X <anything>`
    // reddened nothing. Here a DIODE element references a model that is not a
    // diode model. Only the model-type filter can refuse this one.
    assert.deepEqual([...clampedIsRefsOf(deck(
      'D1 a 0 QMOD', '.model QMOD NPN (Bf=100 Is=1e-30)'))], [],
    'a `D` element naming an NPN model is a malformed deck, not a clamped diode');
  });
});
