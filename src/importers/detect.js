/**
 * Which importer does this file want?
 *
 * Content first, filename second: EAGLE 6+ and KiCad both announce themselves
 * in their first bytes, so the common case needs no choice from the user, and
 * a file with the wrong extension still lands in the right parser. Returns
 * null rather than guessing -- the caller then asks.
 *
 * Content-first is not a nicety here. THREE different formats claim the `.sch`
 * extension: EAGLE 6+ (XML), KiCad 4/5 legacy (plain text) and, historically,
 * EAGLE 5 (binary). Only the bytes distinguish them, and each announces
 * itself on its first line -- `<eagle`, `EESchema Schematic File Version N`.
 *
 * Lives beside the importers, not in the menu component, so it is testable
 * without a DOM.
 *
 * @module
 */

import { looksLikeEasyEda } from './easyeda.js';
import { looksLikeEasyEdaPcb, looksLikeEasyEdaPro } from './easyeda-pcb.js';
import { looksLikeFritzing } from './fritzing.js';
import { looksLikeKicadPcb } from './kicad-pcb.js';
import { looksLikeEasyEdaProPcb } from './easyeda-pro-pcb.js';
import { looksLikeSpice } from './spice.js';

/**
 * @param {string} text      Raw file content
 * @param {string} filename  Used only as a fallback
 * @returns {string|null}    An importer key, or null if unrecognised
 */
export function detectFormat(text, filename = '') {
  if (/<eagle\b/i.test(text)) return 'eagle';
  // Fritzing. XML like EAGLE, so it is checked in the same breath and
  // separated by its own root/instance markers rather than by extension.
  if (looksLikeFritzing(text)) return 'fritzing';
  // KiCad 6+ schematic. Checked before the netlist rule: both are
  // s-expressions and only the root tag separates them.
  if (/^\s*\(kicad_sch\b/.test(text)) return 'kicad-sch';
  // KiCad board: same s-expression family, its own root tag.
  if (looksLikeKicadPcb(text)) return 'kicad-pcb';
  // KiCad 4/5 legacy. The magic line is exact and versioned, and it shares
  // the `.sch` extension with EAGLE -- which is why the EAGLE rule runs first
  // and why neither of them may fall back to the extension before this point.
  if (/^\s*EESchema Schematic File Version\s+\d+/.test(text)) return 'kicad-legacy';
  if (/^\s*\(export\b|<export\b/i.test(text)) return 'kicad-netlist';
  if (/"parts"\s*:/.test(text) && /"connections"\s*:/.test(text)) return 'wokwi';
  // EasyEDA Standard. JSON, and announced by `editorVersion` plus a payload
  // key -- NOT by the extension, which is the bare `.json` our own circuit
  // files use. The wokwi rule runs first for the same reason the EAGLE rule
  // runs before KiCad's: both are JSON and only a key tells them apart. Our
  // own circuit JSON has a top-level `parts` ARRAY and no `editorVersion`,
  // and bin/bwc.mjs checks for that array before it ever calls this.
  // EasyEDA PRO PCB documents (both generations: V2 array-lines and V3
  // log-lines) have a real reader now; other Pro documents are still
  // NAMED rather than mis-parsed.
  if (looksLikeEasyEdaProPcb(text)) return 'easyeda-pro-pcb';
  if (looksLikeEasyEdaPro(text)) return 'easyeda-pro';
  // EasyEDA Standard PCB (docType 3/14). Checked before the schematic rule:
  // both are tilde-DSL JSON with a `shape` array and only docType tells them
  // apart — same reason the EAGLE rule runs before KiCad's.
  if (looksLikeEasyEdaPcb(text)) return 'easyeda-pcb';
  if (looksLikeEasyEda(text)) return 'easyeda';
  // SPICE, LAST among the content rules and before any extension fallback.
  // A deck has no magic first line — line one is free-text by definition — so
  // it can only be recognised by the shape of its body, and every structured
  // format above must get its chance first. `.net` in particular is claimed
  // by KiCad's netlist, whose `(export` root is checked well above this.
  if (looksLikeSpice(text)) return 'spice';
  if (/\.kicad_sch$/i.test(filename)) return 'kicad-sch';
  if (/\.sch$/i.test(filename)) return 'eagle';
  if (/\.net$/i.test(filename)) return 'kicad-netlist';
  if (/\.(cir|sp|spi|ckt)$/i.test(filename)) return 'spice';
  return null;
}
