// Centres in the existing pxt-adafruit 1.6.8 board art's viewBox. These are
// the LED0..LED9 paths, not a second idealised ring: index 0 is upper left.
// The art applies matrix(1.25 0 0 -1.25 0 179.229) to its source coordinates.
const point = (x, y) => Object.freeze({x: x * 1.25, y: 179.229 - y * 1.25});
export const CPX_FACE = Object.freeze({
  width: 180.094,
  height: 179.229,
  pixels: Object.freeze([
    point(47.201, 114.5775), point(29.922, 96.2195),
    point(23.4435, 72.102), point(29.923, 46.9055),
    point(49.001, 29.2675), point(96.516, 29.9885),
    point(114.872, 49.0665), point(120.632, 71.383),
    point(114.5125, 95.5), point(96.1545, 114.217)
  ]),
  buttons: Object.freeze({A: point(43.957, 74.9825), B: point(100.118, 74.982)}),
  redLed: point(89.6785, 134.7435),
  switch: point(72.038, 46.5925)
});

// The host publishes `shown` after the strip's brightness scaling. Apply
// only the same perceptual curve as Lite's CPX pane, never brightness twice.
export function cpxPixelFill(rgb = 0) {
  const channel = shift => Math.round(255 * Math.pow(((rgb >>> shift) & 255) / 255, 1 / 2.2));
  return `rgb(${channel(16)}, ${channel(8)}, ${channel(0)})`;
}
