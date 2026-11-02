import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ESP32_S040_FACE, s040PointToTouch, s040TouchInputs, s040VideoStatus } from '../src/model/esp32-s040-face.js';

test('S040 screen aperture matches the supplier art and sidecar', () => {
  const sidecar = JSON.parse(readFileSync(new URL('../src/parts-data/esp32_4848s040.json', import.meta.url)));
  const svg = readFileSync(new URL('../src/parts-data/esp32_4848s040.svg', import.meta.url), 'utf8');
  assert.deepEqual(ESP32_S040_FACE.screen, sidecar.screen);
  assert.deepEqual([ESP32_S040_FACE.width, ESP32_S040_FACE.height], [sidecar.w, sidecar.h]);
  assert.match(svg, /x="16" y="16" width="124" height="124"/);
});

test('touch pixel coordinates have independent corner, centre and captured-outside controls', () => {
  assert.deepEqual(s040PointToTouch(16, 16), { x: 0, y: 0 });
  assert.deepEqual(s040PointToTouch(139.999, 139.999), { x: 479, y: 479 });
  assert.deepEqual(s040PointToTouch(78, 78), { x: 240, y: 240 });
  assert.deepEqual(s040PointToTouch(16 + 31, 16 + 93), { x: 120, y: 360 });
  assert.deepEqual(s040PointToTouch(-200, 300), { x: 0, y: 479 });
  assert.equal(s040PointToTouch(NaN, 42), null);
});

test('typed touch batches commit down after coordinates and release without another position', () => {
  assert.deepEqual(s040TouchInputs({ x: 120, y: 360 }, true), [
    { component: 'touch', channel: 'x', value: 120 },
    { component: 'touch', channel: 'y', value: 360 },
    { component: 'touch', channel: 'pressed', value: 1 },
  ]);
  assert.deepEqual(s040TouchInputs(null, false), [{ component: 'touch', channel: 'pressed', value: 0 }]);
  assert.deepEqual(s040TouchInputs({ x: 1, y: 2 }), [
    { component: 'touch', channel: 'x', value: 1 }, { component: 'touch', channel: 'y', value: 2 },
  ]);
  assert.deepEqual(s040TouchInputs({ x: 480, y: 0 }, true), []);
});

test('only a real full-size RGBA frame is live; panel off states cannot reuse stale pixels', () => {
  const frame = { width: 480, height: 480, rgba: new Uint8Array(480 * 480 * 4), frame: 1, signal: true };
  assert.equal(s040VideoStatus(frame), 'live');
  assert.equal(s040VideoStatus(null), 'unavailable');
  assert.equal(s040VideoStatus({ ...frame, signal: false }), 'no-signal');
  for (const invalid of [{ width: 160 }, { height: 128 }, { rgba: new Uint16Array(480 * 480 * 2) }, { rgba: new Uint8Array(4) }, { rgba: [] }]) {
    assert.equal(s040VideoStatus({ ...frame, ...invalid }), 'invalid-frame');
  }
  for (const [panel, status] of [
    [{ powered: false }, 'unpowered'], [{ sleeping: true }, 'sleeping'],
    [{ displayOn: false }, 'display-off'], [{ backlightOn: false }, 'backlight-off'],
    [{ framesReceived: 0 }, 'waiting-frame'],
  ]) assert.equal(s040VideoStatus({ ...frame, panel }), status);
});
