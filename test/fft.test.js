/**
 * D24 / X2.2 — the spectrum view's arithmetic, against signals whose spectra
 * are known before the code runs.
 *
 * Analytic oracles, in order of how much they would hurt if wrong:
 *
 * 1. A 1 kHz sine of amplitude 2 V sampled at 100 kHz for 8192 points has its
 *    energy at 1 kHz and nowhere else. Bin width is 100000/8192 = 12.207 Hz, so
 *    1 kHz is bin 81.92 — deliberately NOT on a bin centre, because a test that
 *    only ever transforms bin-aligned tones proves nothing about the window.
 * 2. The amplitude read back is 2 V PEAK, not 1.414 (RMS) and not 1 (the
 *    unscaled single-sided value). Getting the Hann window's coherent gain
 *    wrong halves every reading, silently and plausibly.
 * 3. A square wave of amplitude 1 V has odd harmonics only, with the n-th at
 *    1/n of the fundamental: the classic 4/(nπ) series. The 3rd is 1/3, the
 *    5th 1/5, and the EVEN ones are absent. That is a shape no coding error
 *    reproduces by accident.
 * 4. Parseval: the windowed signal's energy in time equals its energy in
 *    frequency. This catches a scale factor no eyeball would.
 */

import './_setup.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  MIN_POINTS, amplitudeAt, fftInPlace, formatHz, peakBin, pow2Floor, seriesFromScopeData,
  spectrum, spectrumToCsv, thd,
} from '../src/model/fft.js';

const RATE = 100_000;
const N = 8192;

function synth(fn, n = N) {
  const v = new Float64Array(n);
  for (let i = 0; i < n; i++) v[i] = fn(i / RATE);
  return v;
}

/**
 * dB from the peak to the strongest bin that is neither in the peak's own
 * mainlobe nor in DC's. A DC offset is a real component of the signal, so its
 * mainlobe is signal too — counting it as "floor" would say a clean 1 kHz tone
 * on a 2.5 V rail stands −2 dB above the noise, which is not a statement about
 * the tone at all.
 */
function peakToFloorDb(spec, peakIndex, guard = 3) {
  let floor = 0;
  for (let k = guard + 1; k < spec.magV.length; k++) {
    if (Math.abs(k - peakIndex) <= guard) continue;
    if (spec.magV[k] > floor) floor = spec.magV[k];
  }
  return 20 * Math.log10(spec.magV[peakIndex] / (floor || 1e-15));
}

describe('the transform itself', () => {
  it('a length-8 FFT of a known vector matches the hand-computed result', () => {
    // x = [1,0,0,0,0,0,0,0] → X[k] = 1 for every k. The impulse is the one
    // case a person can check in their head.
    const re = new Float64Array([1, 0, 0, 0, 0, 0, 0, 0]);
    const im = new Float64Array(8);
    fftInPlace(re, im);
    for (let k = 0; k < 8; k++) {
      assert.ok(Math.abs(re[k] - 1) < 1e-12 && Math.abs(im[k]) < 1e-12, `bin ${k}`);
    }
  });

  it('a DC vector puts everything in bin 0 and nothing anywhere else', () => {
    const re = new Float64Array(8).fill(1);
    const im = new Float64Array(8);
    fftInPlace(re, im);
    assert.ok(Math.abs(re[0] - 8) < 1e-12);
    for (let k = 1; k < 8; k++) assert.ok(Math.hypot(re[k], im[k]) < 1e-12, `bin ${k}`);
  });

  it('refuses a length that is not a power of two rather than truncating quietly', () => {
    assert.throws(() => fftInPlace(new Float64Array(6), new Float64Array(6)), /power of two/);
    assert.equal(pow2Floor(8191), 4096);
    assert.equal(pow2Floor(8192), 8192);
  });

  it('Parseval holds on a windowed sine', () => {
    const v = synth(t => 2 * Math.sin(2 * Math.PI * 1000 * t), 1024);
    const spec = spectrum(v, RATE, { window: 'rect' });
    let timeEnergy = 0;
    for (const x of v) timeEnergy += x * x;
    // Single-sided peak-volt bins: undo the doubling and the 1/N to compare.
    let freqEnergy = 0;
    for (let k = 0; k < spec.magV.length; k++) {
      const single = (k === 0 || k === spec.magV.length - 1) ? 1 : 2;
      const x = (spec.magV[k] * spec.points) / single;
      freqEnergy += (single === 1 ? x * x : 2 * x * x) / spec.points;
    }
    assert.ok(Math.abs(freqEnergy - timeEnergy) / timeEnergy < 1e-9,
      `time ${timeEnergy} vs frequency ${freqEnergy}`);
  });
});

describe('D24: a 1 kHz sine', () => {
  const spec = spectrum(synth(t => 2.5 + 2 * Math.sin(2 * Math.PI * 1000 * t)), RATE);

  it('bins are 12.207 Hz and the peak is at 1 kHz', () => {
    assert.equal(spec.ok, true);
    assert.equal(spec.points, N);
    assert.ok(Math.abs(spec.binHz - 100000 / 8192) < 1e-9, `binHz ${spec.binHz}`);
    const peak = peakBin(spec);
    assert.ok(Math.abs(peak.f - 1000) < spec.binHz,
      `peak at ${peak.f.toFixed(2)} Hz, within one 12.207 Hz bin of 1000`);
  });

  it('reads 2 V PEAK — not 1.414 RMS, not 1.0 unscaled', () => {
    const peak = peakBin(spec);
    // The lobe-energy amplitude is exact to five decimals whatever the tone's
    // sub-bin offset; the tallest BIN is 0.4 % low here because 1 kHz is bin
    // 81.92 and a Hann lobe read off centre loses height (scalloping).
    assert.ok(Math.abs(peak.amplitude - 2) < 1e-4,
      `lobe amplitude ${peak.amplitude.toFixed(6)} V, want 2`);
    assert.ok(Math.abs(peak.magV - 2) < 0.02, `peak bin ${peak.magV.toFixed(4)} V`);
    assert.ok(peak.magV < peak.amplitude, 'the tallest bin under-reads an off-bin tone');
    assert.ok(Math.abs(peak.amplitude - Math.SQRT2) > 0.5, 'must not be the RMS value');
    assert.ok(Math.abs(peak.amplitude - 1) > 0.5, 'must not be the un-doubled value');
  });

  it('the window constants come out of the window, not out of a table', () => {
    // Hann: Σw/N = 0.5 exactly, and N·Σw²/(Σw)² = 1.5 exactly.
    assert.ok(Math.abs(spec.coherentGain - 0.5) < 1e-12, `coherentGain ${spec.coherentGain}`);
    assert.ok(Math.abs(spec.lobeEnergy - 1.5) < 1e-9, `lobeEnergy ${spec.lobeEnergy}`);
    const rect = spectrum(synth(t => Math.sin(2 * Math.PI * 1000 * t)), RATE, { window: 'rect' });
    assert.equal(rect.coherentGain, 1);
    assert.ok(Math.abs(rect.lobeEnergy - 1) < 1e-12);
  });

  it('the amplitude is right wherever in a bin the tone sits', () => {
    for (const f of [1000, 1234.5, (100000 / 8192) * 82]) {
      const s = spectrum(synth(t => 2 * Math.sin(2 * Math.PI * f * t)), RATE);
      assert.ok(Math.abs(peakBin(s).amplitude - 2) < 1e-4,
        `${f} Hz read ${peakBin(s).amplitude.toFixed(6)} V`);
    }
  });

  it('stands more than 40 dB above everything outside its own mainlobe', () => {
    // The ROADMAP's acceptance is "> 40 dB to the next bin". Taken literally
    // that is a rectangular-window, bin-aligned claim: a Hann window's mainlobe
    // is four bins wide by construction, so the bin NEXT to the peak is
    // supposed to be about -6 dB. The measurable version of the same
    // requirement — and the one that says the tone is clean — is the distance
    // to everything outside the mainlobe.
    const peak = peakBin(spec);
    const db = peakToFloorDb(spec, peak.index);
    assert.ok(db > 40, `peak stands ${db.toFixed(1)} dB above the floor`);
  });

  it('the 2.5 V DC offset lands in bin 0 and does not move the tone', () => {
    assert.ok(Math.abs(spec.magV[0] - 2.5) < 0.02, `DC bin reads ${spec.magV[0].toFixed(4)}`);
  });

  it('a rectangular window on the same tone is visibly worse — which is why Hann is the default', () => {
    const rect = spectrum(synth(t => 2 * Math.sin(2 * Math.PI * 1000 * t)), RATE, { window: 'rect' });
    const hann = spectrum(synth(t => 2 * Math.sin(2 * Math.PI * 1000 * t)), RATE, { window: 'hann' });
    const rectDb = peakToFloorDb(rect, peakBin(rect).index);
    const hannDb = peakToFloorDb(hann, peakBin(hann).index);
    assert.ok(hannDb > rectDb + 20,
      `Hann ${hannDb.toFixed(1)} dB vs rectangular ${rectDb.toFixed(1)} dB on an off-bin tone`);
    assert.equal(hann.windowName, 'Hann');
    assert.equal(rect.windowName, 'rectangular');
  });
});

describe('D24: a square wave has odd harmonics at 1/n', () => {
  const spec = spectrum(
    synth(t => (Math.sin(2 * Math.PI * 1000 * t) >= 0 ? 1 : -1)), RATE);
  const peak = peakBin(spec);
  const near = (hz) => amplitudeAt(spec, Math.round(hz / spec.binHz));

  it('the fundamental is 4/π = 1.27324 V, not 1 V', () => {
    assert.ok(Math.abs(peak.amplitude - 4 / Math.PI) < 1e-4,
      `read ${peak.amplitude.toFixed(6)}, Fourier says ${(4 / Math.PI).toFixed(6)}`);
  });

  it('the 3rd, 5th, 7th and 9th are 1/n of it, to four decimals', () => {
    for (const n of [3, 5, 7, 9]) {
      const ratio = near(1000 * n) / peak.amplitude;
      assert.ok(Math.abs(ratio - 1 / n) < 1e-4,
        `harmonic ${n}: ${ratio.toFixed(6)}, want ${(1 / n).toFixed(6)}`);
    }
  });

  it('the even harmonics are absent — 40 dB down, not merely smaller', () => {
    for (const n of [2, 4, 6]) {
      const ratio = near(1000 * n) / peak.amplitude;
      assert.ok(20 * Math.log10(ratio) < -40,
        `harmonic ${n} sits at ${(20 * Math.log10(ratio)).toFixed(1)} dB`);
    }
  });

  it('THD of a square wave is the 42.88 % the series predicts', () => {
    // sqrt(1/9 + 1/25 + 1/49 + 1/81) over harmonics 3..9; the even terms
    // contribute nothing. Reported against harmonics 2..9.
    const d = thd(spec);
    const want = Math.sqrt(1 / 9 + 1 / 25 + 1 / 49 + 1 / 81);
    assert.ok(Math.abs(d.thd - want) < 1e-3,
      `THD ${(d.thd * 100).toFixed(3)} %, series says ${(want * 100).toFixed(3)} %`);
    assert.ok(Math.abs(d.fundamentalHz - 1000) < spec.binHz);
    assert.ok(Math.abs(d.fundamentalV - 4 / Math.PI) < 1e-4);
  });

  it('THD of a pure sine is essentially zero', () => {
    const s = spectrum(synth(t => 2 * Math.sin(2 * Math.PI * 1000 * t)), RATE);
    assert.ok(thd(s).thd < 0.005, `pure sine reads ${(thd(s).thd * 100).toFixed(3)} % THD`);
  });
});

describe('D24: the refusals', () => {
  const ring = ({ capture = 'sample', count = 512, depth = 512, nanAt = null } = {}) => {
    const samples = new Float64Array(depth * 2).fill(NaN);
    for (let k = 0; k < Math.min(count, depth); k++) {
      const v = k === nanAt ? NaN : Math.sin(k / 10);
      samples[k * 2] = v; samples[k * 2 + 1] = v;
    }
    return { samples, count, writeIndex: Math.min(count, depth) % depth, sampleIntervalNs: 10000, capture };
  };

  it('an envelope channel is refused by name, never averaged into a fake series', () => {
    const r = seriesFromScopeData(ring({ capture: 'envelope' }));
    assert.equal(r.ok, false);
    assert.match(r.reason, /envelope/);
    assert.match(r.reason, /two instants/);
  });

  it('an unwritten sample inside the window is refused, not zero-filled', () => {
    const r = seriesFromScopeData(ring({ nanAt: 7 }));
    assert.equal(r.ok, false);
    assert.match(r.reason, /never written|incomplete/);
  });

  it('too short a capture is refused with the number it needed', () => {
    const r = seriesFromScopeData(ring({ count: 40, depth: 512 }));
    assert.equal(r.ok, false);
    assert.match(r.reason, new RegExp(String(MIN_POINTS)));
  });

  it('a good sample channel yields the series and its rate', () => {
    const r = seriesFromScopeData(ring());
    assert.equal(r.ok, true);
    assert.equal(r.values.length, 512);
    assert.equal(r.sampleRateHz, 100000);
  });

  it('THD refuses when no harmonic fits on the axis', () => {
    // A tone at 40 kHz of a 50 kHz Nyquist has no second harmonic in range.
    const s = spectrum(synth(t => Math.sin(2 * Math.PI * 40000 * t), 1024), RATE);
    assert.equal(thd(s), null);
  });
});

describe('D24: the export carries what a reader needs to redo it', () => {
  const spec = spectrum(synth(t => 2 * Math.sin(2 * Math.PI * 1000 * t), 1024), RATE);
  const csv = spectrumToCsv(spec);

  it('names the window, the point count, the rate and the bin width', () => {
    const head = csv.split('\n')[0];
    assert.match(head, /window=Hann/);
    assert.match(head, /points=1024/);
    assert.match(head, /sampleRateHz=100000/);
    assert.match(head, /binHz=97\.65625/);
    assert.match(head, /amplitude=peak-volts/);
  });

  it('carries one row per bin at full precision, not display rounding', () => {
    const rows = csv.trim().split('\n');
    assert.equal(rows.length, 2 + spec.freqs.length, 'header + column names + every bin');
    assert.equal(rows[1], 'hz,volts_peak,dbv');
    // A residual analysis that starts from three significant figures measures
    // the formatter (the D3 rule), so the peak's volts must not be rounded.
    const peak = peakBin(spec);
    assert.ok(rows.some(r => r.includes(String(peak.magV))),
      'the peak bin appears at full double precision');
  });

  it('formatHz says kilohertz in kilohertz', () => {
    assert.equal(formatHz(1000), '1.000 kHz');
    assert.equal(formatHz(97.65625), '97.66 Hz');
    assert.equal(formatHz(2.5e6), '2.500 MHz');
  });
});
