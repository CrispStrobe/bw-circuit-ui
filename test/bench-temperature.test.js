/**
 * The bench-temperature control (src/components/BenchTemperature.jsx) and where
 * the designer puts it.
 *
 * bw-board solves the chips' on-die sensors and every temperature-dependent part
 * against board.temperatureC. A host (Brickwright Lite) owns that value and
 * applies it to its boards; the designer only shows it and reports edits. It
 * lives in the "More circuit controls" menu: added to the toolbar row it
 * overflowed the 150 px panel-navigation slot and covered the view switcher,
 * so a click on "Schematic view" landed on the palette (Lite's circuit-ux
 * browser gate, 2026-10-06).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, '..', 'src', 'components');
const require = createRequire(import.meta.url);

/** The component, compiled with the JSX transform vite ships, importing this package's React. */
async function loadComponent () {
  const { transformSync } = await import('rolldown/experimental');
  const file = join(SRC, 'BenchTemperature.jsx');
  const { code } = transformSync(file, readFileSync(file, 'utf8'), { jsx: { runtime: 'classic' } });
  const react = pathToFileURL(require.resolve('react')).href;
  const out = join(mkdtempSync(join(tmpdir(), 'bw-bench-')), 'BenchTemperature.mjs');
  writeFileSync(out, code.replace(/from ['"]react['"]/, `from '${react}'`));
  return import(pathToFileURL(out).href);
}

test('the control shows the host\'s value, its range and its label in both languages', async () => {
  const { BenchTemperature } = await loadComponent();
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const en = renderToStaticMarkup(React.createElement(BenchTemperature, { value: 60, onChange () {} }));
  assert.match(en, /data-bench-temperature/);
  assert.match(en, /type="number"/);
  assert.match(en, /value="60"/);
  assert.match(en, /min="-40"/);
  assert.match(en, /max="125"/);
  assert.match(en, /aria-label="Bench temperature in degrees Celsius"/);
  const de = renderToStaticMarkup(React.createElement(BenchTemperature, { value: -10, onChange () {}, lang: 'de' }));
  assert.match(de, /value="-10"/);
  assert.match(de, /aria-label="Umgebungstemperatur in Grad Celsius"/);
});

test('every edit is reported raw to the host, and blur shows the value in force', () => {
  const src = readFileSync(join(SRC, 'BenchTemperature.jsx'), 'utf8');
  assert.match(src, /onChange=\{\(e\) => \{ setDraft\(e\.target\.value\); onChange\?\.\(e\.target\.value\); \}\}/);
  assert.match(src, /onBlur=\{\(\) => setDraft\(null\)\}/);
  assert.match(src, /value=\{draft === null \? value : draft\}/);
});

test('the designer puts it in the More menu, never on the toolbar row, and only for a host that sets it', () => {
  const canvas = readFileSync(join(SRC, 'BoardCanvas.jsx'), 'utf8');
  const menu = canvas.indexOf('data-toolbar-more-menu');
  const use = canvas.indexOf('<BenchTemperature');
  assert.ok(menu > 0 && use > menu, 'BenchTemperature renders inside the More menu');
  assert.equal(canvas.indexOf('<BenchTemperature', use + 1), -1, 'and nowhere else');
  assert.match(canvas.slice(menu, use), /typeof onBenchTemperatureChange === 'function' \? \(/,
    'a host that does not set the temperature gets no control');
  assert.match(canvas, /<BenchTemperature value=\{benchTemperature \?\? 25\} onChange=\{onBenchTemperatureChange\} lang=\{lang\} \/>/);
  const designer = readFileSync(join(SRC, 'CircuitDesigner.jsx'), 'utf8');
  assert.match(designer, /performanceProbe = null, benchTemperature, onBenchTemperatureChange \}\) \{/);
  assert.match(designer, /benchTemperature=\{benchTemperature\}\s*onBenchTemperatureChange=\{onBenchTemperatureChange\}/);
});
