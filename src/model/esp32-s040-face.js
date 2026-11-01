// Original bw-parts artwork coordinates. Tests bind these to the supplier
// sidecar, so display pixels, touch coordinates and header pads cannot drift.
export const ESP32_S040_FACE = Object.freeze({
  width: 240, height: 160, pixels: 480,
  screen: Object.freeze({ x: 16, y: 16, w: 124, h: 124 }),
});
export const ESP32_S040_TERMINALS = Object.freeze([
  'gnd', 'gnd2', 'gpio40', 'gpio44', 'gpio2', 'gpio43', 'gpio1', '5v',
]);
export const ESP32_S040_GPIO = Object.freeze(['gpio40', 'gpio44', 'gpio2', 'gpio43', 'gpio1']);

export function isEsp32S040Device(device) {
  return String(device || '').toLowerCase().replace(/-/g, '_') === 'esp32_4848s040';
}

/** A point in the SVG art's coordinates, after inverting its screen CTM. */
export function s040PointToTouch(x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const { screen, pixels } = ESP32_S040_FACE;
  const pixel = (value, origin, size) => Math.max(0, Math.min(pixels - 1,
    Math.floor((value - origin) * pixels / size)));
  return { x: pixel(x, screen.x, screen.w), y: pixel(y, screen.y, screen.h) };
}

/** Existing target.setInputs batch contract; pressed is last to commit down. */
export function s040TouchInputs(point, pressed) {
  const fields = [];
  if (point) {
    if (![point.x, point.y].every(n => Number.isInteger(n) && n >= 0 && n < ESP32_S040_FACE.pixels)) return [];
    fields.push({ component: 'touch', channel: 'x', value: point.x },
      { component: 'touch', channel: 'y', value: point.y });
  }
  if (pressed !== undefined) fields.push({ component: 'touch', channel: 'pressed', value: pressed ? 1 : 0 });
  return fields;
}

/** The host already decodes RGB565. The face accepts only its actual RGBA. */
export function s040VideoStatus(video) {
  if (!video) return 'unavailable';
  if (video.signal === false) return 'no-signal';
  if (video.width !== 480 || video.height !== 480 || !ArrayBuffer.isView(video.rgba)
    || video.rgba.BYTES_PER_ELEMENT !== 1 || video.rgba.length !== 480 * 480 * 4) return 'invalid-frame';
  const panel = video.panel;
  if (panel?.powered === false) return 'unpowered';
  if (panel?.sleeping === true) return 'sleeping';
  if (panel?.displayOn === false) return 'display-off';
  if (panel?.backlightOn === false) return 'backlight-off';
  if (panel?.framesReceived === 0) return 'waiting-frame';
  return 'live';
}

export const ESP32_S040_STATUS_TEXT = Object.freeze({
  unavailable: 'Display pending',
  'invalid-frame': 'Frame unavailable',
  'no-signal': 'No display signal',
  unpowered: 'Board unpowered',
  sleeping: 'Display sleeping',
  'display-off': 'Display off',
  'backlight-off': 'Backlight off',
  'waiting-frame': 'Waiting for a frame',
});
