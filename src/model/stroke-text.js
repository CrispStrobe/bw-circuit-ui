/**
 * Text → stroke polylines, for plotters (the Gerber silk layers).
 *
 * The anchor (x, y) is the CENTRE of the string, matching how the SVG
 * renderer places its text-anchor:middle labels — the plotted board and
 * the on-screen board put every legend in the same spot. `size` is the
 * cap height in mm; rotation is CCW degrees about the anchor, the model
 * frame's convention.
 *
 * @module
 */

import { GLYPHS, MISSING_GLYPH, GLYPH_H, ADVANCE } from '../data/stroke-font.js';

/**
 * @param {string} text
 * @param {{x: number, y: number, size?: number, rotation?: number}} opts
 * @returns {Array<Array<[number, number]>>} polylines in mm
 */
export function strokeText(text, { x, y, size = 1.2, rotation = 0 }) {
  const chars = [...String(text)];
  const scale = size / GLYPH_H;
  const pitch = ADVANCE * scale;
  const width = chars.length * pitch;
  const x0 = -width / 2 + (pitch - 4 * scale) / 2; // centre the 4-wide glyph in its cell
  const y0 = -size / 2;

  const th = (rotation * Math.PI) / 180;
  const c = Math.cos(th); const s = Math.sin(th);
  const place = (gx, gy) => {
    const px = x0 + gx; const py = y0 + gy;
    return [x + px * c - py * s, y + px * s + py * c];
  };

  const out = [];
  chars.forEach((ch, i) => {
    const glyph = GLYPHS[ch] ?? GLYPHS[ch.toUpperCase()] ?? MISSING_GLYPH;
    for (const stroke of glyph) {
      out.push(stroke.map(([gx, gy]) => place(i * pitch + gx * scale, gy * scale)));
    }
  });
  return out;
}

/** The plotted width of a string at a given cap height, in mm. */
export function strokeTextWidth(text, size = 1.2) {
  return [...String(text)].length * ADVANCE * (size / GLYPH_H);
}
