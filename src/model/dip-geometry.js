// Standard breadboard geometry: holes are 14 world units apart and the two
// DIP rows sit on the e/f strips, 38 units apart across the gutter.
export const DIP_PIN_PITCH = 14;
export const DIP_ROW_OFFSET = 19;

export function dipTerminalPositions(sidecar) {
  const positions = {};
  if (!sidecar?.terminals) return positions;
  const left = sidecar.terminals.filter(t => t.x <= sidecar.w / 2).sort((a, b) => a.y - b.y);
  const right = sidecar.terminals.filter(t => t.x > sidecar.w / 2).sort((a, b) => a.y - b.y);
  const put = (items, y) => items.forEach((t, i) => {
    positions[t.name] = {dx: (i - (items.length - 1) / 2) * DIP_PIN_PITCH, dy: y};
  });
  put(left, -DIP_ROW_OFFSET);
  put(right, DIP_ROW_OFFSET);
  return positions;
}
