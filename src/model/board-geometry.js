// Convert sidecar artwork coordinates to the circuit canvas breadboard pitch.
export const BOARD_PIN_PITCH = 20;
export const SIDE_ART_PIN_PITCH = 8;

export function boardGeometry(sidecar) {
  if (!sidecar || !sidecar.w || !sidecar.h) return null;
  const scale = BOARD_PIN_PITCH / SIDE_ART_PIN_PITCH;
  return {scale, w: sidecar.w * scale, h: sidecar.h * scale};
}
