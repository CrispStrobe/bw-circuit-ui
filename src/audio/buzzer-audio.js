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
 * The AudioContext is SHARED: if the host (Scratch) already owns one,
 * call setSharedAudioContext() and every oscillator will use it instead
 * of creating a second context that fights for the browser's audio
 * thread.  Falling back to a private context is fine for standalone use.
 */

let audioCtx = null;
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
function getAudioCtx() {
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
 * @param {{ hz: number, on: boolean }} tone — from board.buzzerTone()
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

  if (!entry) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = tone.hz;
    gain.gain.value = 0.05; // quiet — this is a teaching tool, not an alarm
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    entry = { osc, gain };
    oscillators.set(partId, entry);
  }

  // Update frequency smoothly
  entry.osc.frequency.setTargetAtTime(tone.hz, ctx.currentTime, 0.01);
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
