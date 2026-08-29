/**
 * The spectrum view's arithmetic — a radix-2 real FFT, a window, and the
 * refusals that keep it from describing a signal that was never captured.
 *
 * D24 / X2.2. There was no FFT anywhere in the circuit UI, and the reason it
 * could not simply be bolted on is that the scope's ring buffer stores an
 * interleaved (min, max) ENVELOPE: each pair is the extremes of everything that
 * happened inside a bucket, so its two numbers are two different instants
 * reported as one. Transforming that produces a spectrum of a waveform that
 * never existed — and it would look plausible, which is worse than looking
 * wrong. The engine now offers `addScopeChannel({capture: 'sample'})`, a true
 * uniformly-spaced sample series, and everything here refuses to run on
 * anything else.
 *
 * Three refusals, all of them the multimeter-that-lies rule in a new costume:
 *
 * - an ENVELOPE buffer is refused by name, not silently averaged;
 * - a window containing an unwritten (NaN) sample is refused — the ring starts
 *   full of NaN and stays that way until the capture has run long enough, and
 *   zero-filling the gap would put a step discontinuity into the transform and
 *   spray harmonics across the whole axis;
 * - fewer than 64 samples is refused, because a transform of 16 points has no
 *   frequency resolution worth reading.
 *
 * Everything is stated: the window function by name, the bin width in hertz,
 * the number of points actually transformed, and the amplitude convention
 * (peak volts, not RMS, not dBFS). A spectrum whose vertical unit is a guess
 * is not a measurement.
 */

/** Windows on offer. Hann by default: a rectangular window on a tone that is
 *  not exactly on a bin smears it across the whole axis. */
export const WINDOWS = {
  rect: { name: 'rectangular', w: () => 1 },
  hann: { name: 'Hann', w: (i, n) => 0.5 * (1 - Math.cos((2 * Math.PI * i) / n)) },
};

/** The smallest transform worth reading. */
export const MIN_POINTS = 64;

/**
 * In-place radix-2 Cooley–Tukey FFT.
 * @param {Float64Array} re
 * @param {Float64Array} im
 */
export function fftInPlace(re, im) {
  const n = re.length;
  if (n <= 1) return;
  if ((n & (n - 1)) !== 0) throw new Error(`fft: length ${n} is not a power of two`);
  // Bit-reversal permutation.
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr; im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

/** The largest power of two not greater than n. */
export function pow2Floor(n) {
  let p = 1;
  while (p * 2 <= n) p *= 2;
  return p;
}

/**
 * Pull a sample series out of a scope channel's ring buffer, newest-last.
 *
 * @param {{samples: Float64Array, count: number, writeIndex: number,
 *          sampleIntervalNs: bigint|number, capture?: string}} data
 * @returns {{ok: true, values: Float64Array, sampleRateHz: number}
 *          | {ok: false, reason: string}}
 */
export function seriesFromScopeData(data) {
  if (!data || !data.samples) return { ok: false, reason: 'no capture on this channel yet' };
  if ((data.capture ?? 'envelope') !== 'sample') {
    return {
      ok: false,
      reason: 'this channel captures a (min,max) envelope — an envelope is two '
        + 'instants reported as one, and its transform describes no real signal',
    };
  }
  const depth = data.samples.length / 2;
  const available = Math.min(Number(data.count) || 0, depth);
  const n = pow2Floor(available);
  if (n < MIN_POINTS) {
    return { ok: false, reason: `only ${available} samples captured — the transform needs ${MIN_POINTS}` };
  }
  const oldestOfN = ((data.writeIndex - n) % depth + depth) % depth;
  const values = new Float64Array(n);
  let gaps = 0;
  for (let k = 0; k < n; k++) {
    const v = data.samples[((oldestOfN + k) % depth) * 2];
    if (!Number.isFinite(v)) gaps++;
    values[k] = v;
  }
  if (gaps) {
    return {
      ok: false,
      reason: `${gaps} of ${n} samples in the window were never written — the trace is incomplete`,
    };
  }
  const intervalNs = Number(data.sampleIntervalNs);
  if (!(intervalNs > 0)) return { ok: false, reason: 'the channel reports no sample interval' };
  return { ok: true, values, sampleRateHz: 1e9 / intervalNs };
}

/**
 * The magnitude spectrum of a real sample series.
 *
 * Amplitudes are PEAK VOLTS of the component at that frequency: a 2 V-amplitude
 * sine reads 2, not 1.414 and not 0 dBFS. Single-sided, so every bin except DC
 * and Nyquist is doubled, and the window's coherent gain is divided out.
 *
 * @param {Float64Array|number[]} values
 * @param {number} sampleRateHz
 * @param {{window?: 'hann'|'rect'}} [opts]
 * @returns {{ok: true, freqs: Float64Array, magV: Float64Array, magDb: Float64Array,
 *            binHz: number, points: number, sampleRateHz: number, windowName: string}
 *          | {ok: false, reason: string}}
 */
export function spectrum(values, sampleRateHz, opts = {}) {
  const win = WINDOWS[opts.window || 'hann'] || WINDOWS.hann;
  const n = pow2Floor(values.length);
  if (n < MIN_POINTS) return { ok: false, reason: `need at least ${MIN_POINTS} samples, got ${values.length}` };
  if (!(sampleRateHz > 0)) return { ok: false, reason: 'sample rate must be positive' };
  const start = values.length - n; // newest n samples
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  // The window's two constants, computed from the window rather than written
  // down beside it, so a window added later cannot arrive with a stale number:
  //   coherentGain = Σw/N — divide it out or every amplitude reads low;
  //   lobeEnergy   = N·Σw²/(Σw)² — the constant Σ|W(δ+n)|² for integer n,
  //                  which is what makes `amplitudeAt` below independent of
  //                  where in a bin the tone actually sits (1.5 for Hann,
  //                  1 for rectangular).
  let sw = 0, sw2 = 0;
  for (let i = 0; i < n; i++) {
    const v = values[start + i];
    if (!Number.isFinite(v)) return { ok: false, reason: 'the window contains an unwritten sample' };
    const w = win.w(i, n);
    sw += w; sw2 += w * w;
    re[i] = v * w;
  }
  fftInPlace(re, im);
  const half = n / 2;
  const freqs = new Float64Array(half + 1);
  const magV = new Float64Array(half + 1);
  const magDb = new Float64Array(half + 1);
  const binHz = sampleRateHz / n;
  for (let k = 0; k <= half; k++) {
    const mag = Math.hypot(re[k], im[k]);
    const single = (k === 0 || k === half) ? 1 : 2;
    freqs[k] = k * binHz;
    magV[k] = (single * mag) / sw;
    // dBV: 0 dB is one volt peak. Floored rather than -Infinity so a plot and
    // a CSV can both carry the number without special cases.
    magDb[k] = magV[k] > 1e-12 ? 20 * Math.log10(magV[k]) : -240;
  }
  return {
    ok: true, freqs, magV, magDb, binHz, points: n,
    sampleRateHz, windowName: win.name,
    coherentGain: sw / n,
    lobeEnergy: (n * sw2) / (sw * sw),
  };
}

/**
 * The amplitude of the component whose mainlobe is centred near bin `k`, taken
 * as the ENERGY in the lobe rather than the height of its tallest bin.
 *
 * This is the difference between an instrument and a picture. A tone that does
 * not sit on a bin centre loses up to 1.42 dB off its peak bin under a Hann
 * window (scalloping loss), so reading the tallest bin under-reports it by up
 * to 15 % — measured on a 1 kHz square wave at 100 kHz over 8192 points, the
 * harmonic ratios came out 0.322/0.180/0.127 against the Fourier series'
 * 0.333/0.200/0.143, and THD read 40.46 % where the series says 42.88 %. The
 * lobe energy is invariant to that offset by construction, and on the same
 * bench reproduces every ratio to four decimals.
 *
 * @param {{magV: Float64Array, lobeEnergy: number}} spec
 * @param {number} k bin at or beside the component
 * @param {number} [halfWidth] bins either side to include
 * @returns {number} peak volts
 */
export function amplitudeAt(spec, k, halfWidth = 3) {
  if (!spec || !spec.magV) return 0;
  const half = spec.magV.length - 1;
  let e = 0;
  for (let j = Math.max(1, k - halfWidth); j <= Math.min(half - 1, k + halfWidth); j++) {
    e += spec.magV[j] * spec.magV[j];
  }
  return Math.sqrt(e / (spec.lobeEnergy || 1));
}

/**
 * The strongest component above DC, and where it is.
 *
 * `f` is the bin centre; `fInterp` is the parabola through the peak and its two
 * neighbours, which matters because a tone almost never sits on a bin. 1 kHz at
 * 100 kHz over 8192 points is bin 81.92 — and any harmonic located by
 * multiplying the ROUNDED index inherits that error times n, which is how a
 * square wave's 7th harmonic goes missing and the THD comes out 2.4 points low.
 *
 * @param {{freqs: Float64Array, magV: Float64Array, binHz: number}} spec
 * @returns {{index: number, f: number, fInterp: number, magV: number}|null}
 */
export function peakBin(spec) {
  if (!spec || !spec.magV) return null;
  let best = -1, bestV = -Infinity;
  // Skip DC and the first bin: a window's own leakage sits there and it is not
  // a component of the signal.
  for (let k = 2; k < spec.magV.length; k++) {
    if (spec.magV[k] > bestV) { bestV = spec.magV[k]; best = k; }
  }
  if (best < 0) return null;
  return {
    index: best,
    f: spec.freqs[best],
    fInterp: (best + parabolicOffset(spec.magV, best)) * spec.binHz,
    magV: spec.magV[best],
    // The amplitude a meter would report, free of scalloping loss.
    amplitude: amplitudeAt(spec, best),
  };
}

/** Sub-bin offset of a peak, from the parabola through its two neighbours. */
function parabolicOffset(mag, k) {
  if (k <= 0 || k >= mag.length - 1) return 0;
  const a = mag[k - 1], b = mag[k], c = mag[k + 1];
  const den = a - 2 * b + c;
  if (!Number.isFinite(den) || den === 0) return 0;
  const d = 0.5 * (a - c) / den;
  return Math.abs(d) <= 1 ? d : 0;
}

/**
 * Total harmonic distortion against the strongest component, as a fraction.
 *
 * Each harmonic is located from the INTERPOLATED fundamental (n · fInterp, not
 * n · roundedBin) and read as the largest bin within two of it, because a Hann
 * window spreads a tone over three bins. Multiplying the rounded index instead
 * costs up to n/2 bins of aim: measured on a 1 kHz square wave at 100 kHz over
 * 8192 points, that missed the 7th harmonic entirely and reported 40.46 % where
 * the Fourier series says 42.88 %.
 *
 * Returns null when the fundamental is too near the top of the axis for even a
 * second harmonic to exist — a THD figure with no harmonics in range is not a
 * small number, it is not a number.
 *
 * @param {{freqs: Float64Array, magV: Float64Array, binHz: number}} spec
 * @param {number} [maxHarmonic]
 * @returns {{thd: number, thdPercent: number, fundamentalHz: number, harmonics: number}|null}
 */
export function thd(spec, maxHarmonic = 9) {
  const peak = peakBin(spec);
  if (!peak || peak.amplitude <= 0) return null;
  const half = spec.magV.length - 1;
  let sumSq = 0, used = 0;
  for (let h = 2; h <= maxHarmonic; h++) {
    const k = Math.round((peak.fInterp * h) / spec.binHz);
    if (k > half) break;
    const a = amplitudeAt(spec, k);
    sumSq += a * a;
    used++;
  }
  if (!used) return null;
  const ratio = Math.sqrt(sumSq) / peak.amplitude;
  return {
    thd: ratio, thdPercent: ratio * 100,
    fundamentalHz: peak.fInterp, fundamentalV: peak.amplitude, harmonics: used,
  };
}

/**
 * The whole spectrum as CSV, at full precision.
 *
 * The header carries the things a reader needs in order to redo the arithmetic
 * — window, points, sample rate, bin width — because a column of numbers whose
 * window is unknown cannot be checked against anything. Same rule as D3's Bode
 * export: the table on screen is readable, the CSV is exact.
 *
 * @param {{freqs: Float64Array, magV: Float64Array, magDb: Float64Array,
 *          binHz: number, points: number, sampleRateHz: number, windowName: string}} spec
 * @returns {string}
 */
export function spectrumToCsv(spec) {
  if (!spec || !spec.freqs) return '';
  const head = `# window=${spec.windowName} points=${spec.points} `
    + `sampleRateHz=${spec.sampleRateHz} binHz=${spec.binHz} amplitude=peak-volts`;
  const rows = [head, 'hz,volts_peak,dbv'];
  for (let k = 0; k < spec.freqs.length; k++) {
    rows.push(`${spec.freqs[k]},${spec.magV[k]},${spec.magDb[k]}`);
  }
  return rows.join('\n');
}

/** A frequency in the unit a reader would say it in. */
export function formatHz(f) {
  if (!Number.isFinite(f)) return '—';
  if (f >= 1e6) return `${(f / 1e6).toFixed(3)} MHz`;
  if (f >= 1e3) return `${(f / 1e3).toFixed(3)} kHz`;
  return `${f.toFixed(2)} Hz`;
}
