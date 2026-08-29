/**
 * D31 — per-channel vertical scale.
 *
 * The bench that makes it bite: CH1 on a 5 V rail, CH2 on a 50 mV shunt drop.
 * Under one global setting there is no choice that shows both:
 *
 *   1 V/div centred 2.5 V  → CH1 fills the screen, CH2 is a line on the axis
 *   0.05 V/div centred 0 V → CH2 fills the screen, CH1 is off it entirely
 *
 * and the old AUTO was the worst of the three, because it ranged across BOTH
 * channels at once: the 50 mV trace was drawn to a 0…5 V window, i.e. within
 * one pixel of flat, which is exactly what a dead net looks like.
 *
 * The numbers below are arithmetic on SCOPE_DIVISIONS = 5, not measurements,
 * and are written out so a change to the graticule cannot quietly pass.
 */

import './_setup.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  SCOPE_DIVISIONS, VOLTS_PER_DIV, channelRange, defaultScale, sampleExtent,
  scaleLabel, volts,
} from '../src/model/scope-scale.js';

/** An envelope buffer: interleaved [min, max, ...] like the engine's ring. */
function ring(pairs) {
  const a = new Float64Array(pairs.length * 2);
  pairs.forEach(([mn, mx], i) => { a[i * 2] = mn; a[i * 2 + 1] = mx; });
  return { samples: a };
}

const RAIL = ring([[0, 5], [0, 5], [4.98, 5.0]]);          // a 5 V logic rail
const SHUNT = ring([[0, 0.05], [0.001, 0.049], [0, 0.05]]); // a 50 mV shunt drop

describe('D31: each channel ranges on its own data', () => {
  it('auto on the shunt does not inherit the rail\'s range', () => {
    const shunt = channelRange({ mode: 'auto' }, SHUNT);
    const rail = channelRange({ mode: 'auto' }, RAIL);
    // 0…0.05 padded by 8 % of 0.05 = 0.004 → −0.004 … 0.054
    assert.ok(Math.abs(shunt.vLo - -0.004) < 1e-12, `vLo ${shunt.vLo}`);
    assert.ok(Math.abs(shunt.vHi - 0.054) < 1e-12, `vHi ${shunt.vHi}`);
    // The rail is 40× wider than the shunt's window: under one shared auto
    // range the shunt trace occupied 0.05/5.8 = 0.86 % of the screen height.
    assert.ok((rail.vHi - rail.vLo) / (shunt.vHi - shunt.vLo) > 50,
      'the two channels want ranges two orders of magnitude apart');
  });

  it('a manual V/div is that channel\'s alone', () => {
    const r = channelRange({ mode: 'manual', voltsPerDiv: 0.05, center: 0.025 }, SHUNT);
    // 0.05 V/div × 5 divisions = 0.25 V of screen, centred on 25 mV
    assert.equal(SCOPE_DIVISIONS, 5);
    assert.ok(Math.abs(r.vLo - -0.1) < 1e-12, `vLo ${r.vLo}`);
    assert.ok(Math.abs(r.vHi - 0.15) < 1e-12, `vHi ${r.vHi}`);
    assert.equal(r.auto, false);
    // …and it ignores the data entirely, which is what "manual" means.
    const same = channelRange({ mode: 'manual', voltsPerDiv: 0.05, center: 0.025 }, RAIL);
    assert.deepEqual([same.vLo, same.vHi], [r.vLo, r.vHi]);
  });

  it('an empty channel gets the 0–5 V window, not NaN and not a zero-height one', () => {
    for (const data of [null, { samples: new Float64Array(8).fill(NaN) }]) {
      const r = channelRange({ mode: 'auto' }, data);
      assert.ok(Number.isFinite(r.vLo) && Number.isFinite(r.vHi));
      assert.ok(r.vHi > r.vLo, 'a screen with no height cannot draw anything');
    }
  });

  it('a flat trace still gets a screen', () => {
    const r = channelRange({ mode: 'auto' }, ring([[3.3, 3.3], [3.3, 3.3]]));
    assert.ok(r.vHi - r.vLo >= 1, `a constant net gets a 1 V window, got ${r.vHi - r.vLo}`);
    assert.ok(r.vLo < 3.3 && r.vHi > 3.3);
  });

  it('NaN gaps are skipped, never ranged against', () => {
    const withGap = ring([[NaN, NaN], [1, 2], [NaN, NaN]]);
    assert.deepEqual(sampleExtent(withGap), { min: 1, max: 2 });
    const r = channelRange({ mode: 'auto' }, withGap);
    assert.ok(Number.isFinite(r.vLo) && Number.isFinite(r.vHi));
  });

  it('a nonsense V/div falls back rather than dividing by zero', () => {
    const r = channelRange({ mode: 'manual', voltsPerDiv: 0, center: 1 }, RAIL);
    assert.ok(r.vHi > r.vLo);
    assert.equal(r.voltsPerDiv, 1);
  });
});

describe('D31: the scale is a stated reading, not a hidden setting', () => {
  it('labels the span and the per-division step', () => {
    const r = channelRange({ mode: 'manual', voltsPerDiv: 1, center: 2.5 }, RAIL);
    assert.equal(scaleLabel(r), '0.000 … 5.000 V · 1.000 V/div');
  });

  it('states millivolts in millivolts — 50 mV must not read as 0.050 V', () => {
    const r = channelRange({ mode: 'auto' }, SHUNT);
    const label = scaleLabel(r);
    assert.equal(label, '-4.0 … 54.0 mV · 11.6 mV/div');
    assert.ok(!label.includes(' V'), `no volts unit anywhere in ${label}`);
    assert.equal(volts(0.05), '50.0 mV');
    assert.equal(volts(0.001), '1.00 mV');
    assert.equal(volts(3.3), '3.300 V');
  });

  it('the offered steps reach the shunt bench', () => {
    assert.ok(VOLTS_PER_DIV.includes(0.05),
      'without a 50 mV/div step the two-channel bench has no manual answer either');
    assert.equal(defaultScale().mode, 'auto');
  });
});
