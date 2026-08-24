/**
 * Choosing the scope's CAPTURE RATE, as opposed to zooming what it already has.
 *
 * `ScopePanel`'s own header says the UI owns "timebase (a window into the
 * ring)", and that was exactly true and exactly the defect: `windowFrac` zooms
 * into the ring, and nothing ever chose how long the ring is. The panel called
 * `board.addScopeChannel({type, netId})` and passed neither `sampleRateHz` nor
 * `depth`, so every capture in the app was the engine's default 100 kHz x 8192
 * = 81.92 ms — for ever, on every bench. (brickwright-lite
 * `docs/WAVE-OPEN-DEFECTS.md` D4.)
 *
 * The engine was never the constraint. Measured on 43-rc-timing, passing a rate
 * through to `addScopeChannel` and reading `getScopeData` back:
 *
 *     100 kHz x 8192 ->  0.082 s of record   (interval     10000 ns)
 *      10 kHz x 8192 ->  0.819 s             (interval    100000 ns)
 *       1 kHz x 8192 ->  8.192 s             (interval   1000000 ns)
 *     100  Hz x 8192 -> 81.920 s             (interval  10000000 ns)
 *
 * Every read inside the engine already uses `ch.intervalNs` and `ch.depth`
 * rather than a constant, so this is a bw-circuit-ui repair alone — which
 * corrects D4's recorded owner ("bw-board + bw-circuit-ui").
 *
 * Why record LENGTH is the label rather than sample rate: the question a
 * learner actually has is "does the thing I want to see fit on the screen".
 * An RC step with tau = 1 s does not fit in 81.92 ms, and no amount of zooming
 * a ring that never held it will help.
 *
 * Pure and exported, so a node test can pin it.
 */

/** Ring depth in (min,max) pairs. The engine's default, kept: the record
 *  length is chosen by rate alone so one number moves at a time. */
export const SCOPE_DEPTH = 8192;

/**
 * The offered capture rates, slowest record last.
 *
 * A decade apart, because that is how the benches are spread: a 1 MHz bus needs
 * the fastest, a 555 at 127 ms needs the middle, an RC with tau = 1 s needs the
 * slowest. Four is enough to cover the corpus and few enough to be a row of
 * buttons rather than a dialog.
 */
export const SCOPE_RATES = [100_000, 10_000, 1_000, 100];

/**
 * How much sim-time one full ring holds, in seconds.
 * @param {number} sampleRateHz
 * @param {number} [depth]
 * @returns {number}
 */
export function recordSeconds(sampleRateHz, depth = SCOPE_DEPTH) {
  if (!(sampleRateHz > 0) || !(depth > 0)) return NaN;
  return depth / sampleRateHz;
}

/**
 * A duration in the unit a reader would say it in, to three significant
 * figures. Used for the control's own labels, so what the learner picks and
 * what the status line reports cannot drift apart.
 * @param {number} s seconds
 * @returns {string}
 */
export function formatSeconds(s) {
  if (!Number.isFinite(s)) return '—';
  const a = Math.abs(s);
  if (a >= 1) return `${sig3(s)} s`;
  if (a >= 1e-3) return `${sig3(s * 1e3)} ms`;
  if (a >= 1e-6) return `${sig3(s * 1e6)} µs`;
  return `${sig3(s * 1e9)} ns`;
}

function sig3(v) {
  const a = Math.abs(v);
  const dp = a >= 100 ? 0 : a >= 10 ? 1 : 2;
  return v.toFixed(dp);
}

/**
 * The label for one rate: what it captures, not what it samples at.
 * @param {number} sampleRateHz
 * @param {number} [depth]
 */
export function rateLabel(sampleRateHz, depth = SCOPE_DEPTH) {
  return formatSeconds(recordSeconds(sampleRateHz, depth));
}

/**
 * The FASTEST offered rate whose record still holds `seconds` — the finest
 * resolution that fits the event. Returns the slowest rate offered when
 * nothing fits, because refusing to answer helps nobody: the caller can
 * compare `recordSeconds` against what it asked for and say so.
 *
 * @param {number} seconds
 * @param {number[]} [rates]
 * @param {number} [depth]
 * @returns {number}
 */
export function rateForSpan(seconds, rates = SCOPE_RATES, depth = SCOPE_DEPTH) {
  const ordered = [...rates].sort((a, b) => b - a); // fastest first
  for (const hz of ordered) if (recordSeconds(hz, depth) >= seconds) return hz;
  return ordered[ordered.length - 1];
}
