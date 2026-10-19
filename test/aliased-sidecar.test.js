/**
 * B24: an aliased kind keeps its own terminal geometry on the canvas.
 * Loading resolves light_sensor -> ldr but keeps the vcc/gnd/out terminals;
 * the ldr sidecar has only a/b, so all three were drawn on one point.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { KIND_ALIASES } from '../src/model/terminal-aliases.js';
import { moduleTerminalLayout } from '../src/model/module-layout.js';

const read = rel => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const sidecar = kind => {
  const url = new URL(`../src/parts-data/${kind}.json`, import.meta.url);
  return existsSync(url) ? JSON.parse(readFileSync(url, 'utf8')) : null;
};
const names = sc => (sc?.terminals || []).map(t => t.name);

test('light_sensor: the ldr sidecar lacks its terminals, its own sidecar places them apart', () => {
  const own = sidecar('light_sensor'), target = sidecar(KIND_ALIASES.light_sensor);
  assert.equal(KIND_ALIASES.light_sensor, 'ldr');
  assert.ok(!names(own).every(n => names(target).includes(n)), 'ldr sidecar would not place vcc/gnd/out');
  const pts = Object.values(moduleTerminalLayout(own).offsets).map(p => `${p.dx},${p.dy}`);
  assert.equal(new Set(pts).size, names(own).length, 'its own sidecar gives every terminal its own point');
});

test('every alias whose target lacks its terminals has a sidecar of its own to fall back to', () => {
  const missing = [];
  for (const [alias, target] of Object.entries(KIND_ALIASES)) {
    const a = sidecar(alias), t = sidecar(target);
    if (!a || !t) continue;
    if (!names(a).every(n => names(t).includes(n)) && !names(a).length) missing.push(alias);
  }
  assert.deepEqual(missing, []);
});

test('the canvas looks up the layout sidecar through the alias fallback', () => {
  const canvas = read('src/components/BoardCanvas.jsx');
  assert.match(canvas, /function layoutSidecar\(part\)/);
  assert.match(canvas, /const msc = layoutSidecar\(part\);/);
  assert.match(canvas, /function genericModuleLayout\(part\) \{\n  const sc = layoutSidecar\(part\);/);
});
