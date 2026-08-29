/**
 * The scope's VERTICAL scale — one per channel, not one for the instrument.
 *
 * D31. `ScopePanel` held `voltsPerDiv` and `verticalCenter` as two panel-level
 * `useState`s and applied both to every trace, so a bench with a 5 V rail on
 * CH1 and a 50 mV shunt drop on CH2 could show one of them or neither. In auto
 * it was worse than a shared manual setting: the auto range was taken across
 * ALL channels at once, so the small signal was ranged against the big one and
 * drew as a flat line on the axis — a trace that is present, wrong, and
 * indistinguishable from a dead net.
 *
 * Every real two-channel scope has two vertical knobs, and the reason is this
 * exact bench.
 *
 * The D4 rule applies to the fix as much as to the record length: a scale the
 * learner cannot read is a scale they cannot reason about, so `scaleLabel`
 * turns each channel's range into a stated pair of numbers ("0.00 … 5.00 V ·
 * 1 V/div") that the panel prints beside the trace. Two traces on two scales
 * with no labels would be a new way to lie, not a fix.
 *
 * Pure, so node tests pin it without a canvas.
 */

/** Horizontal graticule bands the panel draws — the screen is this many divisions tall. */
export const SCOPE_DIVISIONS = 5;

/** The offered V/div steps. 'auto' is the fifth option and lives in the panel. */
export const VOLTS_PER_DIV = [0.05, 0.1, 0.5, 1, 2, 5];

/** A channel's default vertical setting: auto, centred on the 0–5 V logic world. */
export function defaultScale() {
  return { mode: 'auto', voltsPerDiv: 1, center: 2.5 };
}

/**
 * The min and max actually captured on ONE channel, ignoring NaN gaps.
 * Returns null when the channel has no numbers yet — the caller decides what
 * an empty channel looks like, rather than this inventing a range for it.
 *
 * @param {{samples: Float64Array|number[]}|null} data
 * @returns {{min: number, max: number}|null}
 */
export function sampleExtent(data) {
  const s = data && data.samples;
  if (!s || !s.length) return null;
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < s.length; i += 2) {
    const mn = s[i], mx = s[i + 1];
    if (Number.isFinite(mn) && mn < min) min = mn;
    if (Number.isFinite(mx) && mx > max) max = mx;
  }
  return min <= max ? { min, max } : null;
}

/**
 * The volts one channel's screen spans, from its own setting and its own data.
 *
 * Auto ranges over THIS channel only (that is the defect being fixed), pads by
 * 8 % so the extremes are not welded to the frame, and never returns a zero-
 * height window — a flat trace still needs a screen to sit in.
 *
 * @param {{mode: 'auto'|'manual', voltsPerDiv?: number, center?: number}} scale
 * @param {{samples: Float64Array|number[]}|null} data
 * @returns {{vLo: number, vHi: number, auto: boolean, voltsPerDiv: number, center: number}}
 */
export function channelRange(scale, data) {
  const s = scale || defaultScale();
  if (s.mode !== 'auto') {
    const perDiv = Number(s.voltsPerDiv) > 0 ? Number(s.voltsPerDiv) : 1;
    const center = Number.isFinite(Number(s.center)) ? Number(s.center) : 0;
    const span = perDiv * SCOPE_DIVISIONS;
    return { vLo: center - span / 2, vHi: center + span / 2, auto: false, voltsPerDiv: perDiv, center };
  }
  const ext = sampleExtent(data);
  // Nothing captured: the 0–5 V window every logic bench lives in, so an
  // empty screen has a graticule that means something when data arrives.
  let min = ext ? ext.min : 0;
  let max = ext ? ext.max : 5;
  const pad = (max - min) * 0.08 || 0.5;
  min -= pad; max += pad;
  const span = max - min;
  return {
    vLo: min, vHi: max, auto: true,
    voltsPerDiv: span / SCOPE_DIVISIONS,
    center: (min + max) / 2,
  };
}

/**
 * A channel's range as a sentence of numbers.
 *
 * ONE unit for the whole label, chosen by the biggest number in it: a window
 * that runs from 0 V to 5 V must not read "0.00 mV … 5.000 V", and a 50 mV
 * window must not read "0.000 V … 0.054 V" where every digit that matters has
 * been rounded away. That is the same failure D3 fixed on the Bode plot's
 * whole-decibel labels, in a different unit.
 *
 * @param {{vLo: number, vHi: number, voltsPerDiv: number, auto: boolean}} range
 * @returns {string}
 */
export function scaleLabel(range) {
  if (!range || !Number.isFinite(range.vLo) || !Number.isFinite(range.vHi)) return '—';
  const scale = Math.max(Math.abs(range.vLo), Math.abs(range.vHi), range.vHi - range.vLo);
  const milli = scale < 1;
  const n = (v) => milli ? (v * 1000).toFixed(scale < 0.01 ? 2 : 1) : v.toFixed(3);
  const u = milli ? 'mV' : 'V';
  return `${n(range.vLo)} … ${n(range.vHi)} ${u} · ${n(range.voltsPerDiv)} ${u}/div`;
}

/** One volts figure at the precision a reader can act on: mV below 1 V. */
export function volts(v) {
  if (!Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a !== 0 && a < 1) return `${(v * 1000).toFixed(a < 0.01 ? 2 : 1)} mV`;
  return `${v.toFixed(3)} V`;
}
