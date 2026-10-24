/** Continuous transport of actual voltage samples. Native Web Audio renders
 * scheduled buffers; a late solver produces buffering/underruns, never a new tone.
 */
import {AUDIO_PER_VOLT} from './scope-audio.js';
import {getAudioCtx} from './buzzer-audio.js';
import {apertureCaptureInfo} from '../model/scope-aperture-series.js';
import {apertureAudioFilter} from './scope-audio-filter.js';

export const STREAM_MAX_SECONDS = 0.25;
export const STREAM_PREFILL_SECONDS = 0.05;
export const STREAM_HIGH_PASS_HZ = 20;

function capture(data) {
  if (data?.capture === 'average') {
    const info = apertureCaptureInfo(data);
    if (!info.ok) throw new Error(info.reason);
  } else if (!data?.samples || data.capture !== 'sample') throw new Error('Continuous audio needs a sample capture, not an envelope');
  if (data.channelType && data.channelType !== 'voltage') throw new Error('Continuous audio needs voltage samples');
  const depth = data.samples.length / 2;
  if (!Number.isInteger(depth) || depth < 1 || !Number.isSafeInteger(data.count) || data.count < 0 ||
      !Number.isInteger(data.writeIndex) || data.writeIndex < 0 || data.writeIndex >= depth) {
    throw new Error('Invalid audio capture ring');
  }
  const interval = BigInt(data.sampleIntervalNs);
  const rate = 1e9 / Number(interval);
  if (!(rate >= 3000 && rate <= 192000)) throw new Error('Audio needs a sample rate between 3 and 192 kHz');
  const available = Math.min(data.count, depth), start = BigInt(data.startTNs);
  return {data, depth, interval, rate, available, start, end: start + BigInt(available) * interval};
}

export async function createScopeAudioStream(readCapture, {
  context, onStatus = () => {}, autoPump = true, bandwidthHz,
} = {}) {
  const initial = capture(readCapture());
  const captureKind = initial.data.capture;
  const lowPass = apertureAudioFilter(captureKind, initial.rate, bandwidthHz);
  if (context === undefined) context = getAudioCtx();
  if (!context) throw new Error('Audio is unavailable in this browser');
  if (context.state === 'suspended') await context.resume();
  if (context.state !== 'running') throw new Error('Audio context is not running');
  const rate = initial.rate, interval = initial.interval;
  // Starting live listening does not replay an already captured history.
  let cursor = initial.available ? initial.end : null;
  let nextAudio = null, timer = null, stopped = false, everPlayed = false, waiting = true;
  let underruns = 0, pending = [], previousInput = null, previousOutput = 0;
  const sources = new Set();
  const alpha = Math.exp(-2 * Math.PI * STREAM_HIGH_PASS_HZ / rate);
  const notify = (state, reason) => onStatus({state, reason, sampleRateHz: rate, underruns,
    queuedSeconds: Math.max(0, (nextAudio ?? context.currentTime) - context.currentTime)});
  const clean = () => {
    if (timer !== null) clearInterval(timer);
    timer = null;
    for (const source of sources) {
      source.onended = null;
      try { source.stop(); } catch { /* already ended */ }
      source.disconnect();
    }
    sources.clear(); pending = []; nextAudio = null;
  };
  const stop = () => {
    if (stopped) return;
    stopped = true; clean(); notify('stopped');
  };
  const pump = () => {
    if (stopped) return;
    try {
      if (context.state !== 'running') throw new Error('Audio context is no longer running');
      const c = capture(readCapture());
      if (c.data.capture !== captureKind) throw new Error('Audio capture mode changed');
      if (c.interval !== interval) throw new Error('Audio capture cadence changed');
      if (!c.available) {
        if (cursor !== null) throw new Error('Audio capture reset');
      } else {
        if (cursor === null) cursor = c.start;
        if (cursor < c.start) throw new Error('Audio capture overrun: samples were overwritten');
        if (cursor > c.end || (cursor - c.start) % interval !== 0n) throw new Error('Audio capture reset or discontinuity');
        const offset = Number((cursor - c.start) / interval), count = c.available - offset;
        if (pending.length + count > Math.ceil(rate * STREAM_MAX_SECONDS)) throw new Error('Audio input queue exceeds its bound');
        const oldest = (c.data.writeIndex - c.available + c.depth) % c.depth;
        for (let i = offset; i < c.available; i++) {
          const at = ((oldest + i) % c.depth) * 2, value = c.data.samples[at];
          if (!Number.isFinite(value) || value !== c.data.samples[at + 1]) throw new Error('Audio capture contains an unwritten or invalid sample');
          if (previousInput === null) previousInput = value;
          const filtered = alpha * (previousOutput + value - previousInput);
          if (!Number.isFinite(filtered)) throw new Error('Nonfinite audio filter result');
          previousInput = value; previousOutput = filtered;
          const gained = Math.max(-1, Math.min(1, filtered * AUDIO_PER_VOLT));
          pending.push(lowPass ? Math.max(-1, Math.min(1, lowPass(gained))) : gained);
        }
        cursor = c.end;
      }
      const now = context.currentTime;
      if (nextAudio === null || nextAudio <= now) {
        if (everPlayed && !waiting) underruns++;
        waiting = true;
        if (pending.length / rate < STREAM_PREFILL_SECONDS) { notify('buffering'); return; }
        nextAudio = now + 0.02;
      }
      if (pending.length) {
        const duration = pending.length / rate;
        if (nextAudio - now + duration > STREAM_MAX_SECONDS) throw new Error('Scheduled audio exceeds its queue bound');
        const buffer = context.createBuffer(1, pending.length, rate);
        buffer.copyToChannel(Float32Array.from(pending), 0);
        const source = context.createBufferSource();
        try {
          source.buffer = buffer; source.connect(context.destination);
          // Buffer allocation, copying and node setup may stall JavaScript while
          // the native audio clock keeps running. Recheck at the actual handoff.
          if (context.state !== 'running') throw new Error('Audio context is no longer running');
          const readyNow = context.currentTime;
          if (nextAudio <= readyNow) {
            if (everPlayed && !waiting) underruns++;
            waiting = true;
            if (pending.length / rate < STREAM_PREFILL_SECONDS) { notify('buffering'); return; }
            nextAudio = readyNow + 0.02;
          }
          if (nextAudio - readyNow + duration > STREAM_MAX_SECONDS) throw new Error('Scheduled audio exceeds its queue bound');
          sources.add(source);
          source.onended = () => { if (sources.delete(source)) source.disconnect(); };
          source.start(nextAudio); nextAudio += duration;
          pending = []; everPlayed = true; waiting = false;
        } finally {
          // An interrupted or undersized late buffer never entered the queue.
          if (!sources.has(source)) {
            try { source.disconnect(); } catch { /* retain the original refusal */ }
          }
        }
      }
      notify('playing');
    } catch (error) {
      stopped = true; clean(); notify('error', String(error.message || error));
    }
  };
  notify('buffering');
  if (autoPump) timer = setInterval(pump, 20);
  return {pump, stop};
}
