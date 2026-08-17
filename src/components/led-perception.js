/**
 * Perceptual level for a time-averaged LED brightness.
 *
 * The engine reports duty-cycle-averaged brightness: a row in a 1/16
 * multiplex scan averages ~0.06 even though the eye — integrating flashes
 * well above flicker fusion — sees it plainly lit. Rendering that average
 * linearly painted the whole retro-console matrix near-black while the
 * emulator scanned it perfectly (owner report, 2026-08-17). Gamma-lift to
 * match perception: 0.06 → ~0.28, 0.25 → ~0.53, 1 → 1.
 *
 * @param {number} b engine brightness 0..1
 * @returns {number} perceived level 0..1
 */
export function ledDisplayLevel(b) {
  if (!(b > 0.004)) return 0; // below any real duty — off, not a glow
  return Math.min(1, Math.pow(b, 1 / 2.2));
}
