/**
 * B22 chip faces: the STC15 (134 Lite examples), the STC MCU and the
 * TMS9918A were drawn by the generic module body. They keep its layout, so
 * no pin moves, and gain a chip outline: package notch at pin 1's end, a
 * pin-1 dot, part name and package.
 *
 * 2026-11-24: their sidecars are laid out on the breadboard pitch (bw-parts
 * generate-dip-art.js): two ROWS of pins 38 apart across the gutter, notch
 * left, pin 1 bottom-left, and the canvas draws that art (CHIP_FACES remains
 * the box for a part whose terminals are not the art's legs). The chip box
 * still uses the same pin positions, so the two faces never disagree.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { moduleLabelLayout, moduleTerminalLayout } from '../src/model/module-layout.js';

const read = rel => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const canvas = read('src/components/BoardCanvas.jsx');
const table = canvas.slice(canvas.indexOf('const CHIP_FACES = {'), canvas.indexOf('\n};', canvas.indexOf('const CHIP_FACES = {')));

for (const [kind, title, pkg] of [['stc15_mcu', 'STC15', 'PDIP-40'], ['stc_mcu', 'STC MCU', 'DIP-40'], ['tms9918', 'TMS9918A', 'DIP-40']]) {
  test(`${kind}: chip face entry, 40 pins on two rows across the gutter, pin 1 bottom left`, () => {
    assert.ok(table.includes(`${kind}: { title: '${title}', pkg: '${pkg}' },`), `${kind} in CHIP_FACES`);
    const sc = JSON.parse(read(`src/parts-data/${kind}.json`));
    assert.equal(sc.terminals.length, 40);
    const lay = moduleTerminalLayout(sc);
    assert.equal(lay.source, 'sidecar', 'chip face keeps the sidecar geometry');
    assert.ok(sc.dip, 'laid out on the breadboard pitch');
    const ys = new Set(sc.terminals.map(t => lay.offsets[t.name].dy));
    assert.deepEqual([...ys].sort((a, b) => a - b), [-19, 19], 'two pin rows, 38 apart across the gutter');
    const p1 = lay.offsets[sc.terminals[0].name];
    assert.ok(p1.dx < 0 && p1.dy > 0, 'pin 1 bottom left, so the notch is on the left end');
    const { labels } = moduleLabelLayout(sc, lay);
    assert.equal(Object.keys(labels).filter(n => sc.terminals.some(t => t.name === n)).length, 40, 'every pin named');
  });
}

test('chip faces mark themselves for the census and are not counted as generic bodies', () => {
  assert.match(canvas, /chip \? \{ 'data-chip-face': kind, 'data-package': chip\.pkg \} : \{ 'data-generic-module': kind \}/);
  assert.match(read('scripts/census-part-faces.mjs'), /querySelectorAll\('\[data-generic-module\], \[data-chip-face\]'\)/);
});

test('decade_counter: a CD4017 chip face over its breadboard-pitch sidecar, pin 1 (clk) bottom left', () => {
  assert.ok(table.includes("decade_counter: { title: 'CD4017', pkg: 'DIP-16' },"));
  const sc = JSON.parse(read('src/parts-data/decade_counter.json'));
  const lay = moduleTerminalLayout(sc);
  assert.equal(lay.source, 'sidecar');
  assert.equal(new Set(sc.terminals.map(t => lay.offsets[t.name].dy)).size, 2);
  const p1 = lay.offsets[sc.terminals[0].name];
  assert.equal(sc.terminals[0].name, 'clk');
  assert.ok(p1.dx < 0 && p1.dy > 0);
});

test('ds1302: a DS1302 DIP-8 chip face, its sidecar in datasheet pin order (pin 1 VCC2 bottom left)', () => {
  assert.ok(table.includes("ds1302: { title: 'DS1302', pkg: 'DIP-8' },"));
  const sc = JSON.parse(read('src/parts-data/ds1302.json'));
  assert.deepEqual(sc.terminals.map(t => t.name), ['vcc', 'x1', 'x2', 'gnd', 'ce', 'io', 'sclk', 'vcc1']);
  const lay = moduleTerminalLayout(sc);
  const p1 = lay.offsets.vcc;
  assert.ok(p1.dx < 0 && p1.dy > 0, 'pin 1 bottom left');
  assert.equal(new Set(sc.terminals.map(t => lay.offsets[t.name].dy)).size, 2, 'two rows of four');
  assert.equal(lay.offsets.vcc1.dx, p1.dx, 'pin 8 (VCC1) across from pin 1');
});
