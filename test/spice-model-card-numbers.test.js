/**
 * A MODEL CARD'S NUMBERS MUST REACH THE DEVICE.
 *
 * Three ways they were not, all found while chasing three corpus decks whose
 * op-amp output sat at the negative rail where ngspice keeps it near zero. Each
 * one is silent: the part is created, the engine solves it, and nothing says the
 * card's numbers were dropped on the way.
 *
 * 1. A COMMA IS A SEPARATOR. SPICE treats commas in a parameter list as
 *    whitespace, and the value pattern stopped only at whitespace and `=`. So
 *
 *        .MODEL NOX NMOS (LEVEL=2,KP=8.00E-05,VTO=+0.6,LAMBDA=0.02,RD=0)
 *
 *    captured `8.00E-05,VTO` as KP's value, parsed NaN, and the device reached
 *    the engine with NO vth, NO kp and NO lambda. Analog Devices' own library
 *    writes EVERY card that way: 971 Si7li no-aug decks and 452 ADI v2 decks
 *    resolve a library containing one.
 *
 * 2. KP IS DERIVED FROM UO AND TOX when the card does not state it, by SPICE's
 *    own `KP = UO * eps_ox / TOX`. LTspice's OP213 macromodel does exactly that:
 *
 *        .MODEL MN NMOS(LEVEL=3 VTO=1.3 RS=0.3 RD=0.3 TOX=8.5E-8
 *        + LD=1.48E-6 NSUB=1.53E16 UO=650 DELTA=10 ...)
 *
 *    Without it the device ran at the engine's FALLBACK transconductance --
 *    1,519 Si7li no-aug decks had a MOS device in that state, none of them
 *    agreeing, so nothing was at risk in fixing it.
 *
 *    Checked against ngspice rather than against the algebra: a card with
 *    `UO=650 TOX=8.5E-8` and no KP draws 5.28128e-4 A on a bench where the
 *    explicitly derived `KP=2.6417E-5` draws 5.28340e-4 A -- four figures, the
 *    residual being the rounding of the constant typed into the comparison deck.
 *
 * 3. A VDMOS STATES ITS CHANNEL WITH A BARE `pchan` FLAG, not a model type.
 *    `model.type` is VDMOS for both polarities, so keying off the type alone
 *    made every p-channel power MOSFET an n-channel one -- and invisibly, since
 *    a flag that is not a `key=value` pair leaves no parameter behind to notice
 *    missing.
 *
 * WHAT THESE ARE WORTH ON THE CORPUS: measured at ZERO. No agreements gained,
 * none lost, one disagreement newly exposed and three decks moved from
 * "unmapped" to importable. Their value is that a card's stated numbers are the
 * numbers solved; the decks that would show it are blocked upstream by element
 * coverage. Saying so is deliberate -- a fix whose corpus delta is zero is
 * still a fix, and dressing one up is how a refusal gets added to move a number.
 */

import './_setup.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseSpiceModelDeclaration } from '../src/model/spice-model.js';
import { importSpice } from '../src/importers/spice.js';

/** One MOSFET on a bench, with whatever model card the caller wants. */
const mosWith = (card, element = 'M1 d g s s X') => {
  const out = importSpice(['* model card bench', card, element,
    'V1 d 0 5', 'V2 g 0 3', 'R1 s 0 1k', '.op'].join('\n'), {});
  return { part: out.parts.find(p => /^M/i.test(String(p.id || ''))), out };
};

describe('commas separate parameters, they do not belong to values', () => {
  it('parses a comma-separated card exactly as a space-separated one', () => {
    const commas = parseSpiceModelDeclaration('X NMOS (LEVEL=2,KP=8E-5,VTO=0.6,LAMBDA=0.02,RD=0)');
    const spaces = parseSpiceModelDeclaration('X NMOS (LEVEL=2 KP=8E-5 VTO=0.6 LAMBDA=0.02 RD=0)');
    assert.deepEqual(commas.params, spaces.params);
    assert.deepEqual(commas.params, { level: 2, kp: 8e-5, vto: 0.6, lambda: 0.02, rd: 0 });
  });

  it('handles the mixed form, which is what real cards use', () => {
    const { params } = parseSpiceModelDeclaration('X PMOS (LEVEL=2,KP=10E-6, VTO=-0.328,LAMBDA=0.01)');
    assert.deepEqual(params, { level: 2, kp: 10e-6, vto: -0.328, lambda: 0.01 });
  });

  it('leaves `body` verbatim, because strict validators read it', () => {
    // The comma normalisation happens in the PARAMETER SCAN only. A diode
    // validator that regex-matches the original text must see the original
    // text, or this fix would silently change what those validators admit.
    const body = '(LEVEL=2,KP=8E-5,VTO=0.6)';
    assert.equal(parseSpiceModelDeclaration(`X NMOS ${body}`).body, body);
  });

  it('carries the values through to the imported device', () => {
    const { part } = mosWith('.MODEL X NMOS (LEVEL=1,KP=8E-5,VTO=0.6,LAMBDA=0.02)');
    assert.equal(part.params.vth, 0.6);
    assert.equal(part.params.kp, 8e-5);
    assert.equal(part.params.lambda, 0.02);
  });
});

describe('KP from UO and TOX', () => {
  // KP = UO * eps_ox / TOX, with UO in cm^2/V*s and eps_ox = 3.9 * 8.854e-12.
  const EXPECTED = 650e-4 * (3.9 * 8.854187817e-12) / 8.5e-8;   // 2.64063e-5

  it('derives KP when the card states the process numbers instead', () => {
    const { part } = mosWith('.MODEL X NMOS(LEVEL=1 VTO=1 UO=650 TOX=8.5E-8)');
    assert.ok(Math.abs(part.params.kp - EXPECTED) < EXPECTED * 1e-9,
      `derived ${part.params.kp}, expected ${EXPECTED}`);
    // And the value ngspice itself computes, to the precision the bench showed.
    assert.ok(Math.abs(part.params.kp - 2.6417e-5) < 2.6417e-5 * 1e-3);
  });

  it('accepts both spellings, because decks write both', () => {
    // SPICE's name is UO with a letter O. `U0` with a zero appears too, and
    // looking only for the zero is how this stayed hidden: the OP213 card
    // spells it UO and my first probe regex searched for U0.
    const a = mosWith('.MODEL X NMOS(LEVEL=1 VTO=1 UO=650 TOX=8.5E-8)').part;
    const b = mosWith('.MODEL X NMOS(LEVEL=1 VTO=1 U0=650 TOX=8.5E-8)').part;
    assert.equal(a.params.kp, b.params.kp);
  });

  it('an explicitly stated KP always wins', () => {
    const { part } = mosWith('.MODEL X NMOS(LEVEL=1 VTO=1 KP=9E-5 UO=650 TOX=8.5E-8)');
    assert.equal(part.params.kp, 9e-5, 'the card said KP; the derivation must not override it');
  });

  it('derives nothing when either number is missing', () => {
    // THE CONTROL. Half the relation is not a transconductance, and inventing
    // one would be worse than the fallback, which is at least visible as a
    // fallback.
    for (const card of ['.MODEL X NMOS(LEVEL=1 VTO=1 UO=650)',
      '.MODEL X NMOS(LEVEL=1 VTO=1 TOX=8.5E-8)',
      '.MODEL X NMOS(LEVEL=1 VTO=1)']) {
      assert.equal(mosWith(card).part.params.kp, undefined, card);
    }
  });

  it('derives it from the real OP213 card, commas or not', () => {
    const { part } = mosWith('.MODEL X NMOS(LEVEL=3 VTO=1.3 RS=0.3 TOX=8.5E-8 UO=650 DELTA=10 VMAX=2E5)');
    assert.equal(part.params.vth, 1.3);
    assert.ok(Math.abs(part.params.kp - EXPECTED) < EXPECTED * 1e-9);
  });
});

describe('a VDMOS declares its channel with a bare flag', () => {
  it('reads `pchan` as p-channel and its absence as n-channel', () => {
    assert.equal(mosWith('.MODEL X VDMOS(Vto=1 Kp=0.12 Ksubthres=0.1)').part.kind, 'nmos');
    assert.equal(mosWith('.MODEL X VDMOS(Vto=-1 Kp=0.12 pchan Ksubthres=0.1)').part.kind, 'pmos');
  });

  it('is not confused by a parameter whose NAME contains the flag', () => {
    // The flag must be a token. A substring test would read `pchanx=1` -- or a
    // model named `pchan_thing` -- as a polarity declaration.
    assert.equal(mosWith('.MODEL X VDMOS(Vto=1 Kp=0.12 pchanx=1)').part.kind, 'nmos');
  });

  it('carries Ksubthres so the engine can use it, and only from a card that states it', () => {
    assert.equal(mosWith('.MODEL X VDMOS(Vto=1 Kp=0.12 Ksubthres=0.1)').part.params.ksubthres, 0.1);
    assert.equal(mosWith('.MODEL X NMOS(LEVEL=1 VTO=1 KP=0.12)').part.params.ksubthres, undefined,
      'a level-1 card has no subthreshold conduction and must not gain one');
  });

  it('still reads an ordinary PMOS type as p-channel', () => {
    assert.equal(mosWith('.MODEL X PMOS(LEVEL=1 VTO=-1 KP=0.12)').part.kind, 'pmos');
  });
});
