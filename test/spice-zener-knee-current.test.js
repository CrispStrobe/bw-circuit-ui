/**
 * BV IS A CORNER; BV WITH IBV IS A POINT ON AN EXPONENTIAL.
 *
 * SPICE's diode model states the breakdown voltage AND the current it is
 * measured at, and ngspice places the junction so the current is exactly IBV
 * when |Vj| = BV. bw-board's zener now stamps that exponential when the card
 * gives both numbers (CrispStrobe/bw-board), so `IBV` moves a bias point and
 * this reader has to carry it.
 *
 * WHAT IT IS WORTH: the ADI2005 v2 zener regulator read 3.302498 V where
 * ngspice reads 3.243334 V, reported as 5.92e-2 V on **12 decks**, with four
 * more in the gallery. With the knee current carried, the same bench lands
 * within 0.033 mV — the residual being the harness's named thermal offset (our
 * fixed 26.83 °C against ngspice's 27 °C default), not the model.
 *
 * IBV IS STATED ON 976 CORPUS DECKS (502 in ADI v2, 440 in v3, 34 in Si7li), so
 * this is a large population and mostly one that already agreed; the measured
 * before/after is in the commit rather than asserted here.
 *
 * THE FIELD MOVED OUT OF `DIODE_NON_DC_FIELDS`, whose old comment said IBV
 * describes a knee "which a piecewise zener does not have" — true of the engine
 * at the time, and exactly the shape of the mistake that list already records
 * for `BV` itself ("a DC bias point never reaches it", which was an assumption
 * about the circuit rather than a property of the field).
 *
 * AND MOVING IT OUT WAS NOT ENOUGH, which the third test here is about. A field
 * that is neither DC, mapped, a non-parameter nor non-DC counts as UNKNOWN and
 * blocks the whole model: taking `ibv` out of the non-DC set without adding it
 * to the mapped set made every BV+IBV card import as a bare diode with no vz at
 * all. That is a regression I introduced and measured within a minute, and it
 * is the one a reader is most likely to reintroduce.
 */

import './_setup.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { importSpice } from '../src/importers/spice.js';
import { diodeBreakdown, diodeBreakdownCurrent, classifyDiodeFields } from '../src/model/spice-diode.js';

/** The ADI2005 v2 regulator deck, with whatever model body the caller wants. */
const regulatorWith = (body) => importSpice([
  '*Zener Voltage Regulator',
  'V1 IN 0 DC 7.4V',
  'R1 IN OUT 8.2k',
  'DZ1 0 OUT ZENER',
  `.MODEL ZENER D (${body})`,
  '.OP',
  '.END',
].join('\n'), {});

const zenerOf = (out) => out.parts.find(p => /^DZ/i.test(String(p.id || '')));

describe('the knee current reaches the part', () => {
  it('carries IBV beside BV, on the corpus card', () => {
    const out = regulatorWith('BV=3.3 IBV=5m RS=5');
    const z = zenerOf(out);
    assert.equal(z.kind, 'zener');
    assert.equal(z.params.vz, 3.3);
    assert.equal(z.params.ibv, 5e-3);
    assert.equal(z.params.rs, 5, 'and the series resistance, which the exponential needs');
  });

  it('leaves `ibv` absent when the card states none', () => {
    // The control, and the shipped 1N4733A card is this case. Absent means the
    // engine keeps its piecewise corner, so every gallery circuit is untouched.
    const z = zenerOf(regulatorWith('BV=3.3 RS=5'));
    assert.equal(z.kind, 'zener');
    assert.equal(z.params.vz, 3.3);
    assert.equal('ibv' in z.params, false, JSON.stringify(z.params));
  });

  it('does not BLOCK the model, which is how this first went wrong', () => {
    // A field that is neither DC, mapped, a non-parameter nor non-DC counts as
    // UNKNOWN and refuses the whole model. Taking `ibv` out of the non-DC set
    // without adding it to the mapped set made this card import as a bare diode
    // with no vz, no rs and no breakdown at all -- strictly worse than before.
    const out = regulatorWith('BV=3.3 IBV=5m RS=5');
    const z = zenerOf(out);
    assert.equal(z.kind, 'zener', `must still be a zener, was ${z.kind}`);
    assert.equal(z.params._spiceBlocked, undefined, 'the model must not be blocked');
    assert.deepEqual(out.losses.map(l => l.kind), []);
    // And the classifier must place it, not leave it unknown.
    const { unknown, mapped } = classifyDiodeFields({ bv: 3.3, ibv: 5e-3, rs: 5 });
    assert.deepEqual(unknown, [], 'no field here may be unknown');
    assert.deepEqual(mapped.sort(), ['bv', 'ibv']);
  });

  it('treats a zero or negative IBV as no knee at all', () => {
    for (const body of ['BV=3.3 IBV=0', 'BV=3.3 IBV=-5m']) {
      const z = zenerOf(regulatorWith(body));
      assert.equal(z.kind, 'zener', body);
      assert.equal('ibv' in z.params, false, `${body}: ${JSON.stringify(z.params)}`);
    }
  });

  it('keeps NBV and the low-level breakdown fields set aside, not mapped', () => {
    // NBV is the breakdown region's IDEALITY, which our exponential fixes at 1,
    // and IBVL/NBVL describe a second low-level segment we do not model. They
    // are reported as set aside with the raw model kept -- the label in that
    // list says "non-DC", which is imprecise for them and recorded as such.
    // Population: 7 decks in Si7li no-aug, ZERO in ADI v2 and v3.
    const out = regulatorWith('BV=3.3 IBV=5m NBV=2 RS=5');
    const z = zenerOf(out);
    assert.equal(z.params.ibv, 5e-3, 'IBV is still mapped');
    assert.equal(z.params.nbv, undefined, 'NBV is not');
    const { nonDc } = classifyDiodeFields({ bv: 3.3, ibv: 5e-3, nbv: 2, ibvl: 1e-6, nbvl: 1 });
    assert.deepEqual(nonDc.sort(), ['ibvl', 'nbv', 'nbvl']);
  });
});

describe('the readers, individually', () => {
  it('diodeBreakdown takes BV as a magnitude either way round', () => {
    assert.equal(diodeBreakdown({ bv: 3.3 }), 3.3);
    assert.equal(diodeBreakdown({ bv: -3.3 }), 3.3, 'a deck writing it negative means the same device');
    assert.equal(diodeBreakdown({}), null);
    assert.equal(diodeBreakdown({ bv: 0 }), null);
  });

  it('diodeBreakdownCurrent returns null rather than SPICE\'s 1e-3 default', () => {
    // ngspice defaults IBV to 1 mA whether or not a card says so, and taking
    // that default here would switch every shipped zener to the exponential and
    // move the whole gallery. A deck that wants it says IBV.
    assert.equal(diodeBreakdownCurrent({ ibv: 5e-3 }), 5e-3);
    assert.equal(diodeBreakdownCurrent({}), null, 'absent is absent, not 1e-3');
    assert.equal(diodeBreakdownCurrent({ ibv: 0 }), null);
    assert.equal(diodeBreakdownCurrent({ ibv: -1 }), null);
  });
});
