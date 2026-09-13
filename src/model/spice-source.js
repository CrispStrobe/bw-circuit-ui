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
      reason: 'sine source must be the complete card value with exactly offset, amplitude, and frequency',
      fallback: Number.isFinite(fallback) ? fallback : 0,
    };
  }
  const fields = exact[1].trim().split(/[\s,]+/).filter(Boolean);
  const values = fields.map(parseSpiceValue);
  if (fields.length !== 3 || !values.every(Number.isFinite) || values[2] <= 0) {
    return {
      ok: false,
      reason: 'sine source requires exactly three finite scalars and a positive frequency',
      fallback: Number.isFinite(values[0]) ? values[0] : 0,
    };
  }
  const [offset, amplitude, freq] = values;
  return {
    ok: true,
    params: { volts: offset, wave: 'sine', offset, amplitude, freq, phase: 0 },
  };
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
  const allowed = new Set(['wave', 'volts', ...PULSE_KEYS]);
  const extra = Object.keys(params).filter(key => !allowed.has(key));
  if (extra.length) {
    return { ok: false, reason: `unsupported parameter${extra.length > 1 ? 's' : ''} ${extra.join(', ')}` };
  }
  const values = PULSE_KEYS.map(key => params[key]);
  const reason = pulseReason(values);
  return reason ? { ok: false, reason } : { ok: true, values };
}
