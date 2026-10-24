import {MIN_POINTS, pow2Floor} from './fft.js';

/** An interval mean is a distinct acquisition, never an envelope or point sample. */
export function apertureCaptureInfo(data) {
  try {
    if (data?.capture !== 'average' || data.channelType !== 'voltage') {
      throw new Error('Interval means require an explicit voltage aperture capture');
    }
    const depth = data.samples?.length / 2;
    if (!Number.isSafeInteger(depth) || depth < 1 || !Number.isSafeInteger(data.count) || data.count < 0 ||
        !Number.isInteger(data.writeIndex) || data.writeIndex < 0 || data.writeIndex >= depth) {
      throw new Error('Invalid aperture capture ring');
    }
    const interval = BigInt(data.sampleIntervalNs);
    if (!Number.isSafeInteger(Number(interval)) || interval <= 0n ||
        typeof data.apertureNs !== 'bigint' || data.apertureNs !== interval) {
      throw new Error('Aperture duration must equal the actual capture interval');
    }
    if (typeof data.startTNs !== 'bigint' || data.startTNs < 0n) {
      throw new Error('Aperture capture has no valid endpoint epoch');
    }
    return {ok: true, depth, intervalNs: interval, apertureNs: data.apertureNs,
      sampleRateHz: 1e9 / Number(interval), available: Math.min(data.count, depth)};
  } catch (error) {
    return {ok: false, reason: String(error.message || error)};
  }
}

/** Newest complete power-of-two record, with the original aperture identity. */
export function seriesFromApertureData(data) {
  const info = apertureCaptureInfo(data);
  if (!info.ok) return info;
  const n = pow2Floor(info.available);
  if (n < MIN_POINTS) return {ok: false, reason: `only ${info.available} interval means captured — need ${MIN_POINTS}`};
  const oldest = (data.writeIndex - n + info.depth) % info.depth;
  const values = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const at = ((oldest + i) % info.depth) * 2, value = data.samples[at];
    if (!Number.isFinite(value) || value !== data.samples[at + 1]) {
      return {ok: false, reason: 'Aperture record contains an unwritten or invalid interval mean'};
    }
    values[i] = value;
  }
  return {ok: true, values, sampleRateHz: info.sampleRateHz,
    capture: 'average', apertureNs: info.apertureNs};
}
