/** Stateful second-order Butterworth low-pass at the CAPTURE cadence, before
 * native resampling. This finite filter is not an ideal anti-alias guarantee.
 * Four scalar history values keep processing independent of transport chunks.
 */
export function createScopeAudioLowPass(sampleRateHz, bandwidthHz) {
  if (!Number.isFinite(sampleRateHz) || sampleRateHz < 3000 || sampleRateHz > 192000 ||
      !Number.isFinite(bandwidthHz) || bandwidthHz < 1 || bandwidthHz > sampleRateHz * 0.45) {
    throw new Error('Audio bandwidth must be between 1 Hz and 45% of a 3–192 kHz capture rate');
  }
  const k = Math.tan(Math.PI * bandwidthHz / sampleRateHz);
  const norm = 1 / (1 + Math.SQRT2 * k + k * k);
  const b0 = k * k * norm, b1 = 2 * b0, b2 = b0;
  const a1 = 2 * (k * k - 1) * norm, a2 = (1 - Math.SQRT2 * k + k * k) * norm;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  return value => {
    if (!Number.isFinite(value)) throw new Error('Nonfinite audio filter input');
    const y = b0 * value + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    if (!Number.isFinite(y)) throw new Error('Nonfinite audio filter output');
    x2 = x1; x1 = value; y2 = y1; y1 = y;
    return y;
  };
}

export function apertureAudioFilter(capture, rate, bandwidthHz) {
  if (bandwidthHz === undefined || bandwidthHz === 0) return null;
  if (capture !== 'average') throw new Error('Output bandwidth requires an interval-mean capture');
  return createScopeAudioLowPass(rate, bandwidthHz);
}
