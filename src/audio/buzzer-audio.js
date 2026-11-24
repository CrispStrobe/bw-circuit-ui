/**
 * Buzzer audio — Web Audio oscillator driven by board.buzzerTone().
 *
 * The board reports { hz, on }. This module maps that to an oscillator:
 * - on=true → start/update oscillator at the given frequency
 * - on=false → stop oscillator
 *
 * The frequency comes from the engine (toggle period measurement).
 * Nothing is fabricated.
 *
 * The coil transducers (speaker, earphone) also report `level`, 0..1 with
 * the amplitude proportional to the coil current (1 at rated power). When it
 * is present the gain is FULL_GAIN × level, clamped to 0..1, and follows it
 * on every update; when it is absent (buzzer, piezo) the gain stays at
 * FULL_GAIN exactly as before. A tone flagged `noise` (an irregular coil
 * current, e.g. a junction in avalanche breakdown) plays looped white noise
 * at that gain instead of an oscillator.
 *
 * The AudioContext is SHARED: if the host (Scratch) already owns one,
 * call setSharedAudioContext() and every oscillator will use it instead
 * of creating a second context that fights for the browser's audio
 * thread.  Falling back to a private context is fine for standalone use.
 */

let audioCtx = null;
/** The gain of a tone at full level — quiet: a teaching tool, not an alarm. */
const FULL_GAIN = 0.05;
const oscillators = new Map(); // partId → { osc, gain }

/**
 * Let the host inject a pre-existing AudioContext so that circuit audio
 * and host audio (Scratch sound blocks, etc.) share one context.
 * Call this ONCE, before any buzzer tone fires.
 *
 * @param {AudioContext} ctx
 */
export function setSharedAudioContext(ctx) {
  if (ctx && typeof ctx.createOscillator === 'function') {
    audioCtx = ctx;
  }
}

/**
 * Get or create the AudioContext (lazy, needs user gesture).
 */
export function getAudioCtx() {
  if (!audioCtx) {
    if (typeof window === 'undefined' || (!window.AudioContext && !window.webkitAudioContext)) {
      return null; // non-browser environment
    }
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  // Browsers create AudioContext in 'suspended' state until a user gesture
  // lets it run. resume() is a no-op when already running, and returns a
  // promise we intentionally fire-and-forget — the oscillator queued by the
  // caller will start producing output the moment the context actually
  // transitions to 'running'.
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

/**
 * Update the buzzer audio for a given part.
 *
 * @param {string} partId
 * @param {{ hz: number, on: boolean, level?: number }} tone — from board.buzzerTone()
 */
export function updateBuzzerAudio(partId, tone) {
  if (!tone || !tone.on) {
    stopBuzzer(partId);
    return;
  }

  const ctx = getAudioCtx();
  if (!ctx) return; // no audio available

  // If the context was suspended (e.g., after a Scratch stop-all) and we
  // now have a tone to play, nudge it back to running.
  if (ctx.state === 'suspended') ctx.resume();

  let entry = oscillators.get(partId);
  const hasLevel = typeof tone.level === 'number' && Number.isFinite(tone.level);
  const gainValue = hasLevel ? FULL_GAIN * Math.min(1, Math.max(0, tone.level)) : FULL_GAIN;
  // A coil whose current crosses at random intervals is NOISE (bw-board
  // reports `noise` from the irregularity of its periods: a breakdown
  // junction's hiss). An oscillator at its momentary "pitch" would warble;
  // play white noise at the same loudness instead. Switching between a
  // tone and noise rebuilds the source.
  const noisy = tone.noise === true;
  if (entry && (entry.noise === true) !== noisy) {
    stopBuzzer(partId);
    entry = null;
  }

  if (!entry && noisy) {
    const src = createNoiseSource(ctx);
    if (!src) return;
    const gain = ctx.createGain();
    gain.gain.value = gainValue;
    src.connect(gain);
    gain.connect(ctx.destination);
    src.start();
    entry = { osc: src, gain, noise: true };
    oscillators.set(partId, entry);
  }
  if (entry?.noise) {
    if (hasLevel) entry.gain.gain.setTargetAtTime(gainValue, ctx.currentTime, 0.01);
    return;
  }

  if (!entry) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = tone.hz;
    gain.gain.value = gainValue;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    entry = { osc, gain };
    oscillators.set(partId, entry);
  }

  // Update frequency smoothly
  entry.osc.frequency.setTargetAtTime(tone.hz, ctx.currentTime, 0.01);
  // Loudness follows the coil current; a tone without a level keeps its gain.
  if (hasLevel) entry.gain.gain.setTargetAtTime(gainValue, ctx.currentTime, 0.01);
}

/** One second of white noise, made once per context and looped. */
let noiseBuffer = null;
let noiseBufferCtx = null;
function createNoiseSource(ctx) {
  if (typeof ctx.createBuffer !== 'function' || typeof ctx.createBufferSource !== 'function') return null;
  if (!noiseBuffer || noiseBufferCtx !== ctx) {
    const rate = ctx.sampleRate || 44100;
    noiseBuffer = ctx.createBuffer(1, rate, rate);
    const data = noiseBuffer.getChannelData(0);
    // A fixed linear-congruential sequence: the same hiss every time.
    let x = 12345;
    for (let i = 0; i < data.length; i++) {
      x = (Math.imul(x, 1103515245) + 12345) >>> 0;
      data[i] = (x / 4294967296) * 2 - 1;
    }
    noiseBufferCtx = ctx;
  }
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  src.loop = true;
  return src;
}

/**
 * Stop the buzzer for a given part.
 * @param {string} partId
 */
export function stopBuzzer(partId) {
  const entry = oscillators.get(partId);
  if (entry) {
    try {
      entry.osc.stop();
      entry.osc.disconnect();
      entry.gain.disconnect();
    } catch {
      // Already stopped
    }
    oscillators.delete(partId);
  }
}

/**
 * Stop all buzzers.
 */
export function stopAllBuzzers() {
  for (const partId of oscillators.keys()) {
    stopBuzzer(partId);
  }
}
