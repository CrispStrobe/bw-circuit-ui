import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const canvas = readFileSync(new URL('../src/components/BoardCanvas.jsx', import.meta.url), 'utf8');
const wrappers = readFileSync(new URL('../src/wokwi-wrappers/index.js', import.meta.url), 'utf8');
const thumbnail = readFileSync(new URL('../src/components/PartThumbnail.jsx', import.meta.url), 'utf8');

test('Arduino faces use the vendored MIT Wokwi components', () => {
  for (const name of ['WokwiArduinoUno', 'WokwiArduinoNano', 'WokwiArduinoMega']) {
    assert.ok(wrappers.includes(`export const ${name}`));
    assert.ok(canvas.includes(name));
    assert.ok(thumbnail.includes(name));
  }
  assert.ok(canvas.includes("data-board-face-license={WokwiFace ? 'MIT' : 'code'}"));
  assert.ok(canvas.includes('<foreignObject'), 'faces stay inside SVG z-order below wires');
  assert.ok(thumbnail.indexOf('const BoardFace') < thumbnail.indexOf('const svgUrl'),
    'Webpack-safe board thumbnails run before the Vite-only art path');
});
