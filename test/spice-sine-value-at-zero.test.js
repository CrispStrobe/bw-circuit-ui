/**
 * A SINE SOURCE'S BIAS VALUE IS THE WAVEFORM AT t = 0, NOT ITS OFFSET.
 *
 * `.op` solves at t = 0, and ngspice's `SIN(VO VA FREQ TD THETA PHASE)` is
 * piecewise:
 *
 *     0 <= t < TD    VO + VA*sin(2*pi*PHASE/360)
 *     t >= TD        VO + VA*exp(-(t-TD)*THETA)
 *                       * sin(2*pi*(FREQ*(t-TD) + PHASE/360))
 *
 * We imported the OFFSET, which is right only when the phase is zero and the
 * delay is not negative. Two corpus decks proved it independently, each with a
 * different mechanism:
 *
 *     SINE(0 63.6396 50 0 0 -120)   ngspice -55.1135   we said 0   (phase)
 *     SINE(0 0.5 25MEG -10n)        ngspice   0.5      we said 0   (delay)
 *
 * The first is one leg of a three-phase supply -- two of its three legs sit at
 * +/-55 V at t = 0 and only the 0-degree leg is at the offset, so a deck like
 * that disagreed on every node. The second has a NEGATIVE delay, which is legal
 * and means the source started before t = 0; a quarter cycle of lead at 25 MHz
 * puts it at full amplitude. Both now agree with ngspice, and so does 3496, the
 * third deck of the three-phase family.
 *
 * THE FORMULA IS CHECKED AGAINST ngspice, NOT AGAINST ITS MANUAL. Eight cards
 * covering both branches, a damped case and the plain zero-phase case were run
 * through ngspice 42 and matched to 1e-6 relative. The numbers below are those
 * readings.
 *
 * POPULATION, measured before the change: of 1,597 Si7li no-aug decks carrying a
 * SINE, only 65 have a t = 0 value that is not the offset (4 of 1,401 in ADI v2,
 * 421 of 11,072 in the raw corpus). So the identity case is the overwhelming
 * majority, and the first test here is the one that keeps it identity.
 */

import './_setup.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sineValueAtZero, parseStrictSpiceSine } from '../src/model/spice-source.js';

/** ngspice 42's own `.op` readings for these cards, one volt across one ohm. */
const NGSPICE = [
  ['SINE(0 63.6396 50 0 0 -120)', -55.113510],
  ['SINE(0 63.6396 50 0 0 120)', 55.113510],
  ['SINE(0 0.5 25MEG -10n)', 0.500000],
  ['SINE(2.5 2 2k 0 0 180)', 2.500000],
  ['SINE(0 0.1 200MEG 0 0 90)', 0.100000],
  ['SINE(1 3 1k 1m 0 45)', 3.121320],
  ['SINE(0 5 60 0 0 0)', 0.000000],
  ['SINE(0 10 1k 0 500 90)', 10.000000],
];

const fieldsOf = (card) => {
  const raw = /\(([^)]*)\)/.exec(card)[1].trim().split(/[\s,]+/);
  const num = (x) => {
    if (x === undefined) return 0;
    const s = String(x).replace(/meg/i, 'e6').replace(/([0-9.])k$/i, '$1e3')
      .replace(/([0-9.])m$/, '$1e-3').replace(/([0-9.])n$/, '$1e-9');
    return parseFloat(s);
  };
  return { offset: num(raw[0]), amplitude: num(raw[1]), freq: num(raw[2]),
    td: num(raw[3]), theta: num(raw[4]), phase: num(raw[5]) };
};

describe('the t = 0 value of a SINE card', () => {
  it('matches ngspice on every branch of its own definition', () => {
    for (const [card, expected] of NGSPICE) {
      const got = sineValueAtZero(fieldsOf(card));
      assert.ok(Math.abs(got - expected) <= Math.abs(expected) * 1e-6 + 1e-9,
        `${card}: ngspice ${expected}, we compute ${got}`);
    }
  });

  it('is the OFFSET when the phase is zero and the delay is not negative', () => {
    // THE IDENTITY CASE, and the reason this change is safe: 1,532 of the 1,597
    // Si7li decks with a SINE are this. If a later refactor makes these move,
    // every one of those decks moves with it.
    for (const [offset, amplitude, freq] of [[0, 5, 60], [2.5, 2, 2000], [-1.2, 0.1, 1e6]]) {
      assert.equal(sineValueAtZero({ offset, amplitude, freq }), offset);
      assert.equal(sineValueAtZero({ offset, amplitude, freq, td: 1e-3 }), offset);
      assert.equal(sineValueAtZero({ offset, amplitude, freq, td: 1e-3, theta: 100 }), offset);
    }
  });

  it('separates the two branches at a positive delay', () => {
    // Before TD the source holds the phase term with NO frequency contribution.
    // Folding the branches into one expression without clamping (t - TD) at zero
    // would let the frequency leak in, and at 1 kHz with a 1 ms delay that is a
    // whole cycle -- which happens to land back on the same value. So the
    // separating case needs a delay that is NOT a whole number of cycles.
    const p = { offset: 0, amplitude: 1, freq: 1000, td: 0.25e-3, theta: 0, phase: 0 };
    assert.equal(sineValueAtZero(p), 0, 'held at the phase term, which is zero here');
    // The same card with the delay negative instead: a quarter cycle of lead.
    assert.ok(Math.abs(sineValueAtZero({ ...p, td: -0.25e-3 }) - 1) < 1e-12,
      'a negative delay puts the t >= TD branch a quarter cycle in');
  });

  it('applies the damping only in the t >= TD branch', () => {
    // THETA with a positive delay must not attenuate anything: there is no
    // elapsed time to damp. With a negative delay it must.
    assert.equal(sineValueAtZero({ offset: 0, amplitude: 10, freq: 1000, td: 1e-3, theta: 500, phase: 90 }), 10);
    const damped = sineValueAtZero({ offset: 0, amplitude: 10, freq: 1000, td: -1e-3, theta: 500, phase: 90 });
    assert.ok(Math.abs(damped) < 10, `a negative delay must damp: ${damped}`);
  });
});

describe('the parser hands the bias value on', () => {
  it('imports a phase-shifted card at its t = 0 value', () => {
    const r = parseStrictSpiceSine('SINE(0 63.6396 50 0 0 -120)');
    assert.equal(r.ok, true);
    assert.ok(Math.abs(r.params.volts - -55.113510) < 1e-5, `volts ${r.params.volts}`);
    // The waveform fields are still carried verbatim for a transient consumer.
    assert.equal(r.params.phase, -120);
    assert.equal(r.params.offset, 0, 'the offset is kept as itself, separately');
  });

  it('gives the t = 0 value as the FALLBACK for a card it will not model', () => {
    // A negative delay is legal and ngspice solves it, but this parser does not
    // model the waveform. Refusing the waveform is a different question from
    // what the source is worth at a bias point, and answering the second with
    // the offset cost the full amplitude: 0 against ngspice's 0.5.
    const r = parseStrictSpiceSine('SINE(0 0.5 25MEG -10n)');
    assert.equal(r.ok, false);
    assert.ok(Math.abs(r.fallback - 0.5) < 1e-9, `fallback ${r.fallback}`);
    assert.match(r.reason, /non-negative delay/);
  });

  it('still falls back to the offset when the card is unreadable', () => {
    // Not every not-ok card has six finite numbers to compute from. A
    // non-numeric field must not produce NaN volts.
    const r = parseStrictSpiceSine('SINE(0 abc 50)');
    assert.equal(r.ok, false);
    assert.equal(Number.isFinite(r.fallback), true, `fallback ${r.fallback}`);
    assert.equal(r.fallback, 0);
  });

  it('leaves a plain three-argument card exactly as it was', () => {
    const r = parseStrictSpiceSine('SINE(1.5 5 60)');
    assert.equal(r.ok, true);
    assert.equal(r.params.volts, 1.5);
  });
});
