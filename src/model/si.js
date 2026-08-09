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
