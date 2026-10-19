/**
 * B24: an aliased kind keeps its own terminal geometry on the canvas.
 * Loading resolved light_sensor -> ldr but kept the vcc/gnd/out terminals;
 * the ldr sidecar has only a/b, so all three were drawn on one point. Since
 * the engine models the light_sensor module itself the alias is gone, and
 * the part is drawn (and simulated) from its own three-terminal sidecar.
 */
import './_setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { KIND_ALIASES } from '../src/model/terminal-aliases.js';
import { moduleTerminalLayout } from '../src/model/module-layout.js';
import { registerAllDevices } from 'bw-board/register-all.js';
import { getDevice } from 'bw-board/devices.js';

registerAllDevices();

const read = rel => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const sidecar = kind => {
  const url = new URL(`../src/parts-data/${kind}.json`, import.meta.url);
  return existsSync(url) ? JSON.parse(readFileSync(url, 'utf8')) : null;
};
const names = sc => (sc?.terminals || []).map(t => t.name);

test('light_sensor: no longer aliased to ldr, the engine models the module on vcc/gnd/out', () => {
  assert.equal(KIND_ALIASES.light_sensor, undefined, 'light_sensor must resolve to itself');
  const model = getDevice('light_sensor');
  assert.ok(model, 'bw-board registers a light_sensor device');
  assert.deepEqual([...model.terminals].sort(), ['gnd', 'out', 'vcc']);
});

test('light_sensor: the ldr sidecar lacks its terminals, its own sidecar places them apart', () => {
  const own = sidecar('light_sensor'), target = sidecar('ldr');
  assert.deepEqual(names(own), ['vcc', 'gnd', 'out']);
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

test('a terminal the per-kind table does not place falls back to the sidecar, not the centre', () => {
  // eeprom (sda/scl only), seven_segment (a/b only), oscilloscope -> meter and
  // function_gen -> vsource (target names only) put the rest on one point.
  const canvas = read('src/components/BoardCanvas.jsx');
  assert.match(canvas, /const offset = offsets\[terminal\] \?\? sidecarFallbackOffset\(part, terminal\) \?\? \{ dx: 0, dy: 0 \};/);
  const eeprom = sidecar('eeprom');
  const pts = Object.values(moduleTerminalLayout(eeprom).offsets).map(p => `${p.dx},${p.dy}`);
  assert.equal(new Set(pts).size, names(eeprom).length, 'the eeprom sidecar places vcc and gnd apart');
});
