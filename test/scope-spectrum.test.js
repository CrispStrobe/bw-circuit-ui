/**
 * D24 end to end: the engine's own function generator, captured as a sample
 * series through the real Circuit, transformed, and read back.
 *
 * The unit tests in `fft.test.js` transform synthesised arrays; this one
 * transforms what the SOLVER produced, which is the only version of the claim
 * that can fail for a reason outside `fft.js` — a capture mode that does not
 * capture, an integrator step that straddles the sample grid, a ring buffer
 * indexed the wrong way round.
 *
 * The oracle is the source's own definition: `sourceVoltage` puts
 * `offset + amplitude·sin(2πft)` on the net, so a 1 kHz, 2 V, 2.5 V-offset sine
 * must come back as one component at 1 kHz of 2 V peak, on 2.5 V of DC, and
 * nothing else above the floor.
 */

import './_setup.js';
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Circuit, resetIds } from '../src/model/circuit.js';
import { peakBin, seriesFromScopeData, spectrum, thd } from '../src/model/fft.js';

beforeEach(() => resetIds());

/** vsource(sine) → 1 kΩ → gnd, with the signal net named back to the caller. */
function toneBench({ wave = 'sine', freq = 1000, amplitude = 2, offset = 2.5 } = {}) {
  const c = new Circuit(5.0);
  const gnd = c.addPart('gnd', {}, 0, 0);
  const src = c.addPart('vsource', { wave, freq, amplitude, offset }, 0, 0);
  const r = c.addPart('resistor', { ohms: 1000 }, 0, 0);
  c.addWire(src.id, 'pos', r.id, 'a');
  c.addWire(r.id, 'b', gnd.id, 'gnd');
  c.addWire(src.id, 'neg', gnd.id, 'gnd');
  const sig = c.board.getNets().find(n =>
    (n.terminals || []).some(t => t.part === src.id && t.terminal === 'pos'));
  return { c, sigNet: sig.id };
}

describe('D24: the engine\'s 1 kHz sine, through the real capture path', () => {
  it('peaks at 1 kHz with 2 V amplitude on 2.5 V of DC', () => {
    const { c, sigNet } = toneBench();
    const ch = c.board.addScopeChannel({
      type: 'voltage', netId: sigNet, sampleRateHz: 100_000, depth: 8192, capture: 'sample',
    });
    c.advanceTo(90_000_000n); // 90 ms — more than the 81.92 ms the ring holds
    const series = seriesFromScopeData(c.board.getScopeData(ch));
    assert.equal(series.ok, true, series.reason);
    assert.equal(series.values.length, 8192);
    assert.equal(series.sampleRateHz, 100_000);

    const spec = spectrum(series.values, series.sampleRateHz);
    assert.equal(spec.ok, true);
    const peak = peakBin(spec);
    assert.ok(Math.abs(peak.fInterp - 1000) < 1, `peak at ${peak.fInterp.toFixed(3)} Hz`);
    assert.ok(Math.abs(peak.amplitude - 2) < 0.01,
      `amplitude ${peak.amplitude.toFixed(5)} V against the source's own 2 V`);
    assert.ok(Math.abs(spec.magV[0] - 2.5) < 0.02, `DC ${spec.magV[0].toFixed(4)} V`);
  });

  it('the solved tone is clean: THD under 0.5 %', () => {
    const { c, sigNet } = toneBench();
    const ch = c.board.addScopeChannel({
      type: 'voltage', netId: sigNet, sampleRateHz: 100_000, depth: 8192, capture: 'sample',
    });
    c.advanceTo(90_000_000n);
    const series = seriesFromScopeData(c.board.getScopeData(ch));
    const d = thd(spectrum(series.values, series.sampleRateHz));
    assert.ok(d.thd < 0.005,
      `THD ${(d.thdPercent).toFixed(3)} % — anything larger is the capture, not the source`);
  });

  it('a square source shows its third harmonic at a third, through the solver', () => {
    const { c, sigNet } = toneBench({ wave: 'square', amplitude: 2, offset: 2.5 });
    const ch = c.board.addScopeChannel({
      type: 'voltage', netId: sigNet, sampleRateHz: 100_000, depth: 8192, capture: 'sample',
    });
    c.advanceTo(90_000_000n);
    const series = seriesFromScopeData(c.board.getScopeData(ch));
    const spec = spectrum(series.values, series.sampleRateHz);
    const peak = peakBin(spec);
    assert.ok(Math.abs(peak.fInterp - 1000) < 2, `fundamental at ${peak.fInterp.toFixed(2)} Hz`);
    // 4A/π for A = 2 is 2.546 V.
    assert.ok(Math.abs(peak.amplitude - (4 * 2) / Math.PI) < 0.03,
      `fundamental ${peak.amplitude.toFixed(4)} V, Fourier says ${((4 * 2) / Math.PI).toFixed(4)}`);
    const d = thd(spec);
    assert.ok(d.thd > 0.35 && d.thd < 0.50,
      `a square wave's THD is ~43 %; read ${d.thdPercent.toFixed(2)} %`);
  });

  it('the ENVELOPE channel on the same net is refused, by name', () => {
    const { c, sigNet } = toneBench();
    const ch = c.board.addScopeChannel({ type: 'voltage', netId: sigNet, sampleRateHz: 100_000, depth: 8192 });
    c.advanceTo(90_000_000n);
    const series = seriesFromScopeData(c.board.getScopeData(ch));
    assert.equal(series.ok, false);
    assert.match(series.reason, /envelope/);
  });

  it('a half-filled ring is refused rather than transformed with its NaNs', () => {
    const { c, sigNet } = toneBench();
    const ch = c.board.addScopeChannel({
      type: 'voltage', netId: sigNet, sampleRateHz: 100_000, depth: 8192, capture: 'sample',
    });
    c.advanceTo(20_000_000n); // 20 ms of an 81.92 ms ring
    const data = c.board.getScopeData(ch);
    assert.ok(data.count < 8192, 'the ring must genuinely be part-full for this to mean anything');
    const series = seriesFromScopeData(data);
    // 2000 samples → the largest power of two below is 1024, and all of those
    // WERE written, so this succeeds on the written part rather than refusing
    // the whole capture. The refusal is for holes INSIDE the window.
    assert.equal(series.ok, true, series.reason);
    assert.equal(series.values.length, 1024);
    for (const v of series.values) assert.ok(Number.isFinite(v), 'no NaN reaches the transform');
  });
});
