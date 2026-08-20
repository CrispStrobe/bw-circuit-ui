/**
 * Which importer does this file want?
 *
 * Content first, filename second: EAGLE 6+ and KiCad both announce themselves
 * in their first bytes, so the common case needs no choice from the user, and
 * a file with the wrong extension still lands in the right parser. Returns
 * null rather than guessing — the caller then asks.
 *
 * Lives beside the importers, not in the menu component, so it is testable
 * without a DOM.
 *
 * @module
 */

/**
 * @param {string} text      Raw file content
 * @param {string} filename  Used only as a fallback
 * @returns {string|null}    An importer key, or null if unrecognised
 */
export function detectFormat(text, filename = '') {
  if (/<eagle\b/i.test(text)) return 'eagle';
  if (/^\s*\(export\b|<export\b/i.test(text)) return 'kicad-netlist';
  if (/"parts"\s*:/.test(text) && /"connections"\s*:/.test(text)) return 'wokwi';
  if (/\.sch$/i.test(filename)) return 'eagle';
  if (/\.net$/i.test(filename)) return 'kicad-netlist';
  return null;
}
