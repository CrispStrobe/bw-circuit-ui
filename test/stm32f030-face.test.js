/**
 * The STM32F030 gets a chip body (B20). Seated as a bare chip, it reached
 * BoardCanvas's generic branch without a DIP_CHIP_LABELS entry and rendered
 * as a ghost: 20 pin names floating around no body (Lite LED-dimmer example).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dipTerminalPositions } from '../src/model/dip-geometry.js';

const read = rel => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

test('the STM32F030 has a generic chip body labelled with its real package', () => {
  const canvas = read('src/components/BoardCanvas.jsx');
  const labels = canvas.slice(canvas.indexOf('const DIP_CHIP_LABELS = {'), canvas.indexOf('\n};', canvas.indexOf('const DIP_CHIP_LABELS = {')));
  assert.match(labels, /\bstm32f030: 'STM32F030',/);
  assert.match(canvas, /const CHIP_PACKAGE_LABELS = \{ stm32f030: 'TSSOP-20' \};/);
  assert.match(canvas, /\{CHIP_PACKAGE_LABELS\[kind\] \|\| `DIP-\$\{pinCount\}`\}/);
});

test('its 20 sidecar terminals get 20 distinct body positions, 10 per row', () => {
  const sidecar = JSON.parse(read('src/parts-data/stm32f030.json'));
  const positions = dipTerminalPositions(sidecar);
  const names = sidecar.terminals.map(t => t.name);
  assert.equal(names.length, 20);
  assert.ok(names.every(name => positions[name]), 'every terminal is placed');
  const keys = new Set(names.map(name => `${positions[name].dx},${positions[name].dy}`));
  assert.equal(keys.size, 20, 'no two pins share a position');
  const rows = new Map();
  for (const name of names) rows.set(positions[name].dy, (rows.get(positions[name].dy) || 0) + 1);
  assert.deepEqual([...rows.values()].sort(), [10, 10]);
});
