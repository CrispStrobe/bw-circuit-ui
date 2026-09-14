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
 * The complete card tail must be exactly SIN(E)(offset amplitude frequency).
 * Defaults and the optional delay/damping/phase fields deliberately remain
 * outside this contract because omitting them would change the waveform.
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
    return {
      ok: false,
      reason: 'sine source requires three to six finite scalars, positive frequency, and non-negative delay/damping',
      fallback: Number.isFinite(values[0]) ? values[0] : 0,
    };
  }
  const [offset, amplitude, freq, td = 0, theta = 0, phase = 0] = values;
  return {
    ok: true,
    params: { volts: offset, wave: 'spice-sine', offset, amplitude, freq, td, theta, phase },
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
    const time = values[index], value = values[index + 1];
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
