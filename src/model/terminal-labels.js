/**
 * Terminal-dot names (B23). An unconnected terminal of a free part shows its
 * name above its dot. On parts whose terminals sit closer than a name is
 * wide (the DIP switch: eight terminals at 7 px, names `1a 2a 3a 4a` at font
 * 9) those names piled on top of each other. A name that would overlap
 * another terminal's name of the same part is not drawn above the dot; the
 * dot keeps it as its hover title, and the part's own face (generic module
 * body, chip face) already labels its pins.
 *
 * Positions are canvas coordinates of the dots. The box is the name's: centred
 * on the dot, `LINE_H * fontSize` tall, `CHAR_W * fontSize` per character.
 */
export const TERMINAL_LABEL_FONT = 9;
const CHAR_W = 0.62;
// A text box on screen is taller than its font size (ascent + descent): a
// 9 px name measures about 11 px, so names 10 px apart still touch.
const LINE_H = 1.25;

/**
 * @param {Array<{name: string, x: number, y: number}>} points
 * @param {number} [fontSize]
 * @returns {Set<string>} names whose label would overlap another's
 */
export function clashingTerminalLabels(points, fontSize = TERMINAL_LABEL_FONT) {
  const clash = new Set();
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const a = points[i], b = points[j];
      const halfWidths = (a.name.length + b.name.length) * CHAR_W * fontSize / 2;
      if (Math.abs(a.x - b.x) < halfWidths + 1 && Math.abs(a.y - b.y) < fontSize * LINE_H + 1) {
        clash.add(a.name);
        clash.add(b.name);
      }
    }
  }
  return clash;
}
