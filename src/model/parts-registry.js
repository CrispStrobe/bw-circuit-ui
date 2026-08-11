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
  }
  return pos;
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
