/** Finite replay of measured samples. Never reconstruct sound from FFT peaks. */
import {seriesFromScopeData} from '../model/fft.js';
import {getAudioCtx} from './buzzer-audio.js';

export const AUDIO_PER_VOLT = 0.05;

export function scopeAudio(data) {
  const series = seriesFromScopeData(data);
  if (!series.ok) throw new Error(series.reason);
  const {values, sampleRateHz} = series;
  if (!Number.isFinite(sampleRateHz) || sampleRateHz < 3000 || sampleRateHz > 192000) {
    throw new Error('Audio replay needs a sample rate between 3 and 192 kHz');
  }
  let dcVolts = 0;
  for (const value of values) {
    if (!Number.isFinite(value)) throw new Error('Audio capture contains a nonfinite sample');
    dcVolts += value / values.length;
  }
  const samples = Float32Array.from(values, value => Math.max(-1, Math.min(1, (value - dcVolts) * AUDIO_PER_VOLT)));
  return {samples, sampleRateHz, dcVolts};
}

/** Caller owns the returned stop function and calls it on replacement/unmount. */
export async function playScopeCapture(data, context) {
  const audio = scopeAudio(data); // refuse before creating audio nodes
  if (context === undefined) context = getAudioCtx();
  if (!context) throw new Error('Audio is unavailable in this browser');
  if (context.state === 'suspended' && typeof context.startRendering !== 'function') await context.resume();
  const buffer = context.createBuffer(1, audio.samples.length, audio.sampleRateHz);
  buffer.copyToChannel(audio.samples, 0);
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.connect(context.destination);
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    try { source.stop(); } finally { source.disconnect(); }
  };
  source.onended = () => { if (!stopped) { stopped = true; source.disconnect(); } };
  try { source.start(); } catch (error) { source.disconnect(); throw error; }
  return stop;
}

/** Mono PCM16 WAV at the capture's cadence (integer WAV rate rounded to nearest Hz). */
export function scopeAudioWav(data) {
  const {samples, sampleRateHz} = scopeAudio(data);
  const bytes = new ArrayBuffer(44 + samples.length * 2), v = new DataView(bytes);
  const text = (at, word) => [...word].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)));
  text(0, 'RIFF'); v.setUint32(4, bytes.byteLength - 8, true); text(8, 'WAVE');
  text(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  const rate = Math.round(sampleRateHz);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  text(36, 'data'); v.setUint32(40, samples.length * 2, true);
  samples.forEach((value, i) => v.setInt16(44 + i * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true));
  return bytes;
}
