/**
 * Parts registry — consumes bw-parts sidecar JSON for terminal positions.
 *
 * bw-parts owns the drawing and terminal geometry; bw-circuit-ui owns
 * the electrical meaning. This module bridges them: it reads sidecar
 * JSON and provides terminal names + positions for each part kind.
 *
 * In dev: reads from ../../bw-parts/parts/<kind>.json (sibling checkout).
 * In production: reads from vendored assets (bw-bundle copies them).
 *
 * @module
 */

/**
 * @typedef {object} PartSidecar
 * @property {string} kind
 * @property {number} w — width in the SVG's coordinate space
 * @property {number} h — height
 * @property {Array<{name: string, x: number, y: number}>} terminals
 *   ORDER IS LOAD-BEARING. A sidecar is consulted before circuit.js's own
 *   terminalsForKind case, so this array's order becomes the order of
 *   `part.terminals`, and downstream contracts assert it — bw-board's E/G
 *   cards are specified as outp/outn/inp/inn and a test holds that through
 *   Circuit.fromJSON. Authoring a sidecar in reading order instead broke it
 *   on 2026-09-14, correctly by the author's lights, because nothing here
 *   said so. Reorder only with the consuming contract in hand.
 * @property {*} variants
 */

/** @type {Map<string, PartSidecar>} */
const _cache = new Map();

/**
 * Register a sidecar (for use in tests or when bulk-loading).
 * @param {PartSidecar} sidecar
 */
export function registerSidecar(sidecar) {
  _cache.set(sidecar.kind, sidecar);
}

/**
 * Slug aliases: palette name → sidecar slug.
 * These resolve the 6 known mismatches where our palette uses a
 * different slug than bw-parts' sidecar filename.
 */
const SLUG_ALIASES = {
  shift_register: '74hc595',
  motor_encoder: 'dc_motor_encoder',
  pir_sensor: 'pir',
  tilt_sensor: 'tilt_switch',
  dip_switch: 'dip_switch_spst',
  keypad: 'keypad_4x4',
  breadboard: 'breadboard_full',
  meter: 'multimeter',
};

/**
 * Resolve a palette slug to its sidecar/art slug (for art lookups).
 * Returns the alias target if one exists, otherwise the original kind.
 * @param {string} kind
 * @returns {string}
 */
export function resolveArtSlug(kind) {
  return SLUG_ALIASES[kind] || kind;
}

/**
 * Get the sidecar for a kind, or null if not registered.
 * Resolves slug aliases so palette names find their sidecars.
 * @param {string} kind
 * @returns {PartSidecar | null}
 */
export function getSidecar(kind) {
  return _cache.get(kind) || _cache.get(SLUG_ALIASES[kind]) || null;
}

/**
 * Get terminal names from the sidecar.
 * @param {string} kind
 * @returns {string[] | null}
 */
export function sidecarTerminals(kind) {
  // Do NOT resolve slug aliases for terminals — shift_register has
  // friendly names (data/clock/latch) that differ from 74hc595's DIP
  // names (ser/srclk/rclk). The alias is for art/dimensions only.
  const sc = _cache.get(kind);
  if (!sc) return null;
  return sc.terminals.map(t => t.name);
}

/**
 * Get terminal positions (relative to part origin) from the sidecar.
 * @param {string} kind
 * @returns {Record<string, {x: number, y: number}> | null}
 */
export function sidecarTerminalPositions(kind) {
  const sc = _cache.get(kind);
  if (!sc) return null;
  const pos = {};
  for (const t of sc.terminals) {
    pos[t.name] = { x: t.x, y: t.y };
    // An alias is a second name bw-board accepts for the SAME metal, not a
    // second pin: it shares its twin's coordinates exactly.
    if (Array.isArray(t.aliases)) {
      for (const a of t.aliases) pos[a] = { x: t.x, y: t.y };
    }
  }
  return pos;
}

/**
 * Sidecar terminal positions expressed relative to the BODY CENTRE.
 *
 * Sidecar coordinates have their origin at the top-left of the viewBox; the
 * canvas places a part by its anchor, which is the centre of the body. This
 * is that one conversion, in one place, so a renderer never has to retype a
 * part's geometry — a second copy is right until the art moves.
 *
 * Returns null when the kind has no sidecar, so a caller can fall back
 * rather than silently placing every terminal at the origin.
 *
 * @param {string} kind
 * @returns {Record<string, {dx: number, dy: number}> | null}
 */
export function sidecarCenterOffsets(kind) {
  const sc = _cache.get(kind);
  if (!sc) return null;
  const positions = sidecarTerminalPositions(kind);
  if (!positions) return null;
  const out = {};
  for (const [name, p] of Object.entries(positions)) {
    out[name] = { dx: p.x - sc.w / 2, dy: p.y - sc.h / 2 };
  }
  return out;
}

/**
 * Alias → physical-twin pairs declared by a kind's sidecar.
 *
 * bw-board registers some devices under two namespaces over one set of
 * legs (74hc595's ser/data, stc15_mcu's P3.0/p3.0). The sidecar marks the
 * second spelling on the pin it belongs to; this is the flat view of that,
 * for callers that hold a name→position map and need the extra keys.
 *
 * They deliberately do NOT go into `footprint.leads`: BreadboardModel's
 * occupy() rejects "hole used twice by this part", so a leads map with
 * aliases in it makes the chip refuse to seat at all.
 *
 * @param {string} kind
 * @returns {Array<[string, string]>} [alias, twin] pairs
 */
export function terminalAliasPairs(kind) {
  const sc = _cache.get(kind);
  if (!sc?.terminals) return [];
  const pairs = [];
  for (const t of sc.terminals) {
    for (const a of (t.aliases || [])) pairs.push([a, t.name]);
  }
  return pairs;
}

/**
 * List all registered kinds.
 * @returns {string[]}
 */
export function registeredKinds() {
  return [..._cache.keys()];
}

/**
 * Bulk-register all sidecars from an array of JSON objects.
 * @param {PartSidecar[]} sidecars
 */
export function registerAll(sidecars) {
  for (const sc of sidecars) registerSidecar(sc);
}

/**
 * Report which kinds have sidecar art and which fall back to inline SVG.
 * @param {string[]} paletteKinds — all kinds the palette offers
 * @returns {{ withArt: string[], fallback: string[] }}
 */
export function artCoverage(paletteKinds) {
  const withArt = [];
  const fallback = [];
  for (const kind of paletteKinds) {
    if (_cache.has(kind) || _cache.has(SLUG_ALIASES[kind])) withArt.push(kind);
    else fallback.push(kind);
  }
  return { withArt, fallback };
}
