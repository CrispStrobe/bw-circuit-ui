/**
 * Pin function lookup — reads from the parts registry (vendored sidecars).
 *
 * Three-state return per spec-update 007:
 *   string[] — audited, pin has these functions
 *   []       — audited, no alternates (GPIO only)
 *   null     — not yet audited (unknown)
 *
 * @module
 */

import { getSidecar } from './parts-registry.js';

/**
 * Get alternate functions for a pin on a given part.
 * @param {string} kind — part kind (e.g. 'mcu', 'stc_mcu', 'arduino_nano')
 * @returns {Array<{name: string, functions: string[]|null}>}
 */
export function getPinFunctionsForPart(kind) {
  const sc = getSidecar(kind);
  if (!sc || !sc.terminals) return [];
  return sc.terminals.map(t => ({
    name: t.name,
    functions: t.functions === undefined ? null : t.functions,
  }));
}
