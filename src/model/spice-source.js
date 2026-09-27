import { parseSpiceValue } from './si.js';

const PULSE_KEYS = ['v1', 'v2', 'td', 'tr', 'tf', 'pw', 'per'];

function pulseReason(values) {
  if (values.length !== 7 || !values.every(Number.isFinite)) {
    return 'PULSE source requires exactly seven finite scalars';
  }
  const [, , td, tr, tf, pw, per] = values;
  if (td < 0 || pw < 0 || !(tr > 0) || !(tf > 0) || !(per > 0)) {
    return 'PULSE source requires non-negative TD/PW and positive TR/TF/PER';
  }
  if (tr + pw + tf > per) {
    return 'PULSE source requires TR + PW + TF not to exceed PER';
  }
  return null;
}

/**
 * Parse the lossless, analysis-independent subset of a SPICE sine source.
 *
 * The complete card tail must be SIN(E)(offset amplitude frequency [delay
 * [damping [phase]]]). Omitted optional values have their SPICE zero defaults.
 *
 * @param {string} raw
 * @param {{allowSinAlias?: boolean}} options
 * @returns {null | {ok:true, params:Record<string,number|string>} |
 *   {ok:false, reason:string, fallback:number}}
 */
export function parseStrictSpiceSine(raw, { allowSinAlias = true } = {}) {
  const text = String(raw || '').trim();
  const name = allowSinAlias ? 'SIN(?:E)?' : 'SINE';
  const exact = new RegExp(`^${name}\\s*\\(([^()]*)\\)$`, 'i').exec(text);
  if (!exact) {
    if (!new RegExp(`\\b${name}\\s*\\(`, 'i').test(text)) return null;
    const first = /\(([^\s,()]+)/.exec(text)?.[1];
    const fallback = parseSpiceValue(first || '');
    return {
      ok: false,
      reason: 'sine source must be the complete three-to-six-value card',
      fallback: Number.isFinite(fallback) ? fallback : 0,
    };
  }
  const fields = exact[1].trim().split(/[\s,]+/).filter(Boolean);
  const values = fields.map(parseSpiceValue);
  if (fields.length < 3 || fields.length > 6 || !values.every(Number.isFinite)
      || values[2] <= 0 || (values[3] ?? 0) < 0 || (values[4] ?? 0) < 0) {
    // THE FALLBACK IS STILL THE t = 0 VALUE, not the offset.
    //
    // This branch is reached by cards this parser will not model as a waveform
    // -- a NEGATIVE delay is the corpus case (`SINE(0 0.5 25MEG -10n)`, legal,
    // and it means the source started before t = 0). Refusing to model the
    // waveform is a separate question from what the source is worth at a bias
    // point, and answering the second with the offset made the deck differ from
    // ngspice by the full amplitude: 0 against 0.5.
    const fallbackAtZero = values.every(Number.isFinite) && values.length >= 3 && values[2] > 0
      ? sineValueAtZero({ offset: values[0], amplitude: values[1], freq: values[2],
        td: values[3] ?? 0, theta: values[4] ?? 0, phase: values[5] ?? 0 })
      : NaN;
    return {
      ok: false,
      reason: 'sine source requires three to six finite scalars, positive frequency, and non-negative delay/damping',
      fallback: Number.isFinite(fallbackAtZero) ? fallbackAtZero
        : (Number.isFinite(values[0]) ? values[0] : 0),
    };
  }
  const [offset, amplitude, freq, td = 0, theta = 0, phase = 0] = values;
  return {
    ok: true,
    // `volts` is the BIAS value, which is the waveform at t = 0 and not the
    // offset -- see sineValueAtZero. A card with phase 0 and no negative delay
    // is unchanged, which is the overwhelming majority and is asserted.
    params: { volts: sineValueAtZero({ offset, amplitude, freq, td, theta, phase }),
      wave: 'spice-sine', offset, amplitude, freq, td, theta, phase },
  };
}

/** Parse a complete finite SPICE PWL point list. */
export function parseStrictSpicePwl(raw) {
  const text = String(raw || '').trim();
  const exact = /^PWL\s*\(([^()]*)\)$/i.exec(text);
  if (!exact) return /\bPWL\s*\(/i.test(text)
    ? { ok: false, reason: 'PWL source must be one complete non-nested point list', fallback: 0 }
    : null;
  const fields = exact[1].trim().split(/[\s,]+/).filter(Boolean);
  const values = fields.map(parseSpiceValue);
  if (fields.length < 4 || fields.length % 2 || fields.length > 1024
      || !values.every(Number.isFinite)) {
    return { ok: false, reason: 'PWL source requires 2 to 512 finite time/value pairs',
      fallback: Number.isFinite(values[1]) ? values[1] : 0 };
  }
  const points = [];
  for (let index = 0; index < values.length; index += 2) {
    const time = values[index]; const value = values[index + 1];
    if (time < 0 || (points.length && !(time > points.at(-1)[0]))) {
      return { ok: false, reason: 'PWL source times must be non-negative and strictly increasing',
        fallback: values[1] };
    }
    points.push([time, value]);
  }
  return { ok: true, params: { wave: 'spice-pwl', points, volts: points[0][1] } };
}

/** Parse exact EXP(V1 V2 TD1 TAU1 TD2 TAU2). */
export function parseStrictSpiceExp(raw) {
  const text = String(raw || '').trim();
  const exact = /^EXP\s*\(([^()]*)\)$/i.exec(text);
  if (!exact) return /\bEXP\s*\(/i.test(text)
    ? { ok: false, reason: 'EXP source must be one complete six-value form', fallback: 0 }
    : null;
  const fields = exact[1].trim().split(/[\s,]+/).filter(Boolean);
  const values = fields.map(parseSpiceValue);
  if (fields.length !== 6 || !values.every(Number.isFinite)) {
    return { ok: false, reason: 'EXP source requires exactly six finite scalars',
      fallback: Number.isFinite(values[0]) ? values[0] : 0 };
  }
  const [v1, v2, td1, tau1, td2, tau2] = values;
  if (td1 < 0 || td2 < td1 || !(tau1 > 0) || !(tau2 > 0)) {
    return { ok: false, reason: 'EXP source requires non-negative ordered delays and positive time constants',
      fallback: v1 };
  }
  return { ok: true, params: { wave: 'spice-exp', volts: v1, v1, v2, td1, tau1, td2, tau2 } };
}

/**
 * Parse the lossless seven-argument voltage-source PULSE subset implemented
 * by bw-board. Zero rise/fall values remain outside this contract because
 * SPICE dialects may replace them with the transient step size.
 *
 * @param {string} raw
 * @returns {null | {ok:true, params:Record<string,number|string>} |
 *   {ok:false, reason:string, fallback:number}}
 */
export function parseStrictSpicePulse(raw) {
  const text = String(raw || '').trim();
  const exact = /^PULSE\s*\(([^()]*)\)$/i.exec(text);
  if (!exact) {
    if (!/\bPULSE\b/i.test(text)) return null;
    const first = /\(([^\s,()]+)/.exec(text)?.[1];
    const fallback = parseSpiceValue(first || '');
    return {
      ok: false,
      reason: 'PULSE source must be the complete card value with exactly V1, V2, TD, TR, TF, PW, and PER',
      fallback: Number.isFinite(fallback) ? fallback : 0,
    };
  }
  const fields = exact[1].trim().split(/[\s,]+/).filter(Boolean);
  const values = fields.map(parseSpiceValue);
  const reason = pulseReason(values);
  if (reason) {
    return { ok: false, reason, fallback: Number.isFinite(values[0]) ? values[0] : 0 };
  }
  const params = { volts: values[0], wave: 'spice-pulse' };
  PULSE_KEYS.forEach((key, index) => { params[key] = values[index]; });
  return { ok: true, params };
}

/**
 * A SINE card's value AT t = 0, which is what a `.op` solves with.
 *
 * ngspice's own piecewise definition of `SIN(VO VA FREQ TD THETA PHASE)`:
 *
 *     0 <= t < TD    VO + VA*sin(2*pi*PHASE/360)
 *     t >= TD        VO + VA*exp(-(t-TD)*THETA)
 *                       * sin(2*pi*(FREQ*(t-TD) + PHASE/360))
 *
 * We were importing the OFFSET alone, which is only right when the phase is
 * zero and the delay is not negative. Two corpus decks proved it independently:
 *
 *     SINE(0 63.6396 50 0 0 -120)     ngspice -55.1135    we said 0
 *     SINE(0 0.5 25MEG -10n)          ngspice   0.5       we said 0
 *
 * The first is one leg of a three-phase supply, where two of the three legs sit
 * at +/-55 V at t = 0 and only the 0-degree leg is at the offset. The second has
 * a NEGATIVE delay -- legal, and it means the waveform started before t = 0, so
 * the `t >= TD` branch applies at t = 0 and the quarter-cycle of lead puts it at
 * full amplitude.
 *
 * Population, measured: of 1,597 Si7li no-aug decks carrying a SINE, 65 have a
 * t = 0 value that is not the offset (421 of 11,072 in the raw corpus, 4 of
 * 1,401 in ADI v2). So this is identity for the overwhelming majority and the
 * assertion that it stays identity for phase 0 is in the tests.
 */
export function sineValueAtZero({ offset = 0, amplitude = 0, freq = 0, td = 0, theta = 0, phase = 0 } = {}) {
  const turns = phase / 360;
  // A POSITIVE delay means the source has not started: it holds the phase term
  // only, with no frequency contribution. Folding the two branches into one
  // expression would need `t - TD` clamped at zero, which reads as an
  // optimisation and hides which of ngspice's two cases applies.
  if (td > 0) return offset + amplitude * Math.sin(2 * Math.PI * turns);
  const elapsed = -td;                       // t = 0, so (t - TD) is -TD
  return offset + amplitude * Math.exp(-elapsed * theta)
    * Math.sin(2 * Math.PI * (freq * elapsed + turns));
}

/** Validate an engine-side PULSE before lossless SPICE export. */
export function validateStrictSpicePulseParams(params) {
  const allowed = new Set(['wave', 'volts', 'amps', 'dcValue', 'dcBiasOrigin',
    'acMagnitude', 'acPhase', ...PULSE_KEYS]);
  const extra = Object.keys(params).filter(key => !allowed.has(key));
  if (extra.length) {
    return { ok: false, reason: `unsupported parameter${extra.length > 1 ? 's' : ''} ${extra.join(', ')}` };
  }
  const values = PULSE_KEYS.map(key => params[key]);
  const reason = pulseReason(values);
  return reason ? { ok: false, reason } : { ok: true, values };
}

function waveformExtras(params, allowed) {
  const common = ['wave', 'volts', 'amps', 'dcValue', 'dcBiasOrigin', 'acMagnitude', 'acPhase'];
  return Object.keys(params).filter(key => !common.includes(key) && !allowed.includes(key));
}

export function validateStrictSpiceSineParams(params) {
  const keys = ['offset', 'amplitude', 'freq', 'td', 'theta', 'phase'];
  const extra = waveformExtras(params, keys);
  if (extra.length) return { ok: false, reason: `unsupported parameters ${extra.join(', ')}` };
  const values = keys.map(key => params[key]);
  if (!values.every(Number.isFinite) || !(params.freq > 0) || params.td < 0 || params.theta < 0) {
    return { ok: false, reason: 'SINE parameters must be finite with positive frequency and non-negative delay/damping' };
  }
  return { ok: true, values };
}

export function validateStrictSpicePwlParams(params) {
  const extra = waveformExtras(params, ['points']);
  if (extra.length) return { ok: false, reason: `unsupported parameters ${extra.join(', ')}` };
  if (!Array.isArray(params.points) || params.points.length < 2 || params.points.length > 512) {
    return { ok: false, reason: 'PWL needs 2 to 512 points' };
  }
  let prior = -Infinity;
  for (const point of params.points) {
    if (!Array.isArray(point) || point.length !== 2 || !point.every(Number.isFinite)
        || point[0] < 0 || !(point[0] > prior)) {
      return { ok: false, reason: 'PWL points must be finite with strictly increasing non-negative times' };
    }
    prior = point[0];
  }
  return { ok: true, points: params.points };
}

export function validateStrictSpiceExpParams(params) {
  const keys = ['v1', 'v2', 'td1', 'tau1', 'td2', 'tau2'];
  const extra = waveformExtras(params, keys);
  if (extra.length) return { ok: false, reason: `unsupported parameters ${extra.join(', ')}` };
  const values = keys.map(key => params[key]);
  if (!values.every(Number.isFinite) || params.td1 < 0 || params.td2 < params.td1
      || !(params.tau1 > 0) || !(params.tau2 > 0)) {
    return { ok: false, reason: 'EXP parameters require ordered non-negative delays and positive time constants' };
  }
  return { ok: true, values };
}
