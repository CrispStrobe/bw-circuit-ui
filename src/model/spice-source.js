import { parseSpiceValue } from './si.js';

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
