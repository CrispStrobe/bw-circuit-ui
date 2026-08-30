/**
 * SI suffix parsing and formatting.
 *
 * Accepts: 10k, 4.7k, 1M, 100, 47u, 100n, 10p
 */

const SI_SUFFIXES = {
  p: 1e-12, n: 1e-9, u: 1e-6, µ: 1e-6, m: 1e-3,
  k: 1e3, K: 1e3, M: 1e6, G: 1e9,
};

/**
 * Parse a string with optional SI suffix to a number.
 */
export function parseSi(str) {
  const s = String(str).trim();
  if (!s) return NaN;
  const match = s.match(/^([0-9.]+)\s*([pnuµmkKMG]?)$/);
  if (!match) return parseFloat(s);
  const num = parseFloat(match[1]);
  const suffix = match[2];
  return suffix ? num * (SI_SUFFIXES[suffix] || 1) : num;
}

/**
 * Format a number with SI suffix for display.
 *
 * DISPLAY ONLY. `M` here means MEGA, the way an engineer writes it on a
 * schematic. Nothing that ends up inside a SPICE deck may come through
 * this function — see formatSpiceValue below for why.
 */
export function formatSi(val) {
  if (val == null || isNaN(val)) return '';
  if (val >= 1e6) return (val / 1e6) + 'M';
  if (val >= 1e3) return (val / 1e3) + 'k';
  if (val >= 1) return String(val);
  if (val >= 1e-3) return (val * 1e3) + 'm';
  if (val >= 1e-6) return (val * 1e6) + 'u';
  if (val >= 1e-9) return (val * 1e9) + 'n';
  return (val * 1e12) + 'p';
}

/**
 * Format a number for a SPICE deck.
 *
 * Every engine descended from Berkeley SPICE3 reads value suffixes
 * CASE-INSENSITIVELY, and a bare `M` is MILLI. So `1M` written for one
 * megohm is parsed as one milliohm: a silent 10^9x error on every part at
 * or above 1 MOhm / 1 MH. Mega is spelled `MEG`.
 *
 * Trailing alphabetic characters after a recognised suffix are ignored by
 * the parser, which is why `MEG` and `M` are distinguishable at all and
 * why `4.7k` and `4.7kOhm` mean the same thing.
 *
 * Scale letters used here, all unambiguous under case folding:
 *   T 1e12 · G 1e9 · MEG 1e6 · k 1e3 · (none) · m 1e-3 · u 1e-6 ·
 *   n 1e-9 · p 1e-12 · f 1e-15
 *
 * @param {number} val
 * @returns {string}
 */
export function formatSpiceValue(val) {
  if (val == null || typeof val !== 'number' || !isFinite(val)) return '';
  if (val === 0) return '0';
  const sign = val < 0 ? '-' : '';
  const a = Math.abs(val);
  // Round the mantissa to 12 significant digits so 1e-6 * 1e6 does not
  // print as 1.0000000000000002u.
  const mant = (x) => {
    const r = Number(x.toPrecision(12));
    return String(r);
  };
  if (a >= 1e12) return sign + mant(a / 1e12) + 'T';
  if (a >= 1e9) return sign + mant(a / 1e9) + 'G';
  if (a >= 1e6) return sign + mant(a / 1e6) + 'MEG';
  if (a >= 1e3) return sign + mant(a / 1e3) + 'k';
  if (a >= 1) return sign + mant(a);
  if (a >= 1e-3) return sign + mant(a * 1e3) + 'm';
  if (a >= 1e-6) return sign + mant(a * 1e6) + 'u';
  if (a >= 1e-9) return sign + mant(a * 1e9) + 'n';
  if (a >= 1e-12) return sign + mant(a * 1e12) + 'p';
  return sign + mant(a * 1e15) + 'f';
}
