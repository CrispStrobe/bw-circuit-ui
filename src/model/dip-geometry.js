// Standard breadboard geometry: holes are 14 world units apart and the two
// DIP rows sit on the e/f strips, 38 units apart across the gutter.
export const DIP_PIN_PITCH = 14;
export const DIP_ROW_OFFSET = 19;

/**
 * Terminal offsets for a DIP part, keyed by terminal NAME.
 *
 * Layout is decided by the PHYSICAL pins only — the entries in
 * `sidecar.terminals`. A terminal may additionally declare `aliases`: other
 * names bw-board accepts for the SAME piece of metal (the '595's ser/data,
 * the STC15's P3.0/p3.0). An alias is not a pin: it must not take a slot in
 * the row layout, or a 16-pin package silently renders as a 35-pin one. It
 * takes its physical twin's position instead, so a wire drawn to either
 * spelling lands on the same leg.
 *
 * Names with no entry here fall back to {dx:0, dy:0} in the canvas, i.e. the
 * part origin — which is why an engine terminal missing from this map is a
 * rendering bug, not a cosmetic one.
 *
 * @param {{w?: number, terminals?: Array<{name: string, x: number, y: number, aliases?: string[]}>}} sidecar
 * @returns {Record<string, {dx: number, dy: number}>}
 */
export function dipTerminalPositions(sidecar) {
  const positions = {};
  if (!sidecar?.terminals) return positions;
  const left = sidecar.terminals.filter(t => t.x <= sidecar.w / 2).sort((a, b) => a.y - b.y);
  const right = sidecar.terminals.filter(t => t.x > sidecar.w / 2).sort((a, b) => a.y - b.y);
  const put = (items, y) => items.forEach((t, i) => {
    positions[t.name] = {dx: (i - (items.length - 1) / 2) * DIP_PIN_PITCH, dy: y};
  });
  // Horizontal DIP, notch LEFT: pin 1 sits BOTTOM-left — pins 1..N/2
  // (the sidecar's left column) run along the BOTTOM row, pins N..N/2+1
  // along the top. The first version had the rows swapped, drawing
  // every chip rotated 180° ("as if one turned the chip upside down" —
  // owner report, 2026-08-15).
  put(left, DIP_ROW_OFFSET);
  put(right, -DIP_ROW_OFFSET);
  // Aliases second, so they can never displace a physical pin.
  for (const t of sidecar.terminals) {
    if (!Array.isArray(t.aliases)) continue;
    const twin = positions[t.name];
    if (!twin) continue;
    for (const a of t.aliases) positions[a] = { dx: twin.dx, dy: twin.dy };
  }
  return positions;
}
