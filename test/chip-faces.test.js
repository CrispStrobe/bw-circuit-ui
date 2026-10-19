/**
 * B22 chip faces: the STC15 (134 Lite examples), the STC MCU and the
 * TMS9918A were drawn by the generic module body. They keep its layout, so
 * no pin moves, and gain a chip outline: package notch at pin 1's end, a
 * pin-1 dot, part name and package.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { moduleLabelLayout, moduleTerminalLayout } from '../src/model/module-layout.js';

const read = rel => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const canvas = read('src/components/BoardCanvas.jsx');
const table = canvas.slice(canvas.indexOf('const CHIP_FACES = {'), canvas.indexOf('\n};', canvas.indexOf('const CHIP_FACES = {')));

for (const [kind, title, pkg] of [['stc15_mcu', 'STC15', 'PDIP-40'], ['stc_mcu', 'STC MCU', 'DIP-40'], ['tms9918', 'TMS9918A', 'DIP-40']]) {
  test(`${kind}: chip face entry, 40 pins on two columns, pin 1 at the top left`, () => {
    assert.ok(table.includes(`${kind}: { title: '${title}', pkg: '${pkg}' },`), `${kind} in CHIP_FACES`);
    const sc = JSON.parse(read(`src/parts-data/${kind}.json`));
    assert.equal(sc.terminals.length, 40);
    const lay = moduleTerminalLayout(sc);
    assert.equal(lay.source, 'sidecar', 'chip face keeps the sidecar geometry');
    const xs = new Set(sc.terminals.map(t => lay.offsets[t.name].dx));
    assert.equal(xs.size, 2, 'two pin columns');
    const p1 = lay.offsets[sc.terminals[0].name];
    assert.ok(p1.dx < 0 && p1.dy < 0, 'pin 1 top left, so the notch is on the top edge');
    const { labels } = moduleLabelLayout(sc, lay);
    assert.equal(Object.keys(labels).filter(n => sc.terminals.some(t => t.name === n)).length, 40, 'every pin named');
  });
}

test('chip faces mark themselves for the census and are not counted as generic bodies', () => {
  assert.match(canvas, /chip \? \{ 'data-chip-face': kind, 'data-package': chip\.pkg \} : \{ 'data-generic-module': kind \}/);
  assert.match(read('scripts/census-part-faces.mjs'), /querySelectorAll\('\[data-generic-module\], \[data-chip-face\]'\)/);
});

test('decade_counter: a CD4017 chip face over its two-column sidecar, pin 1 (clk) top left', () => {
  assert.ok(table.includes("decade_counter: { title: 'CD4017', pkg: 'DIP-16' },"));
  const sc = JSON.parse(read('src/parts-data/decade_counter.json'));
  const lay = moduleTerminalLayout(sc);
  assert.equal(lay.source, 'sidecar');
  assert.equal(new Set(sc.terminals.map(t => lay.offsets[t.name].dx)).size, 2);
  const p1 = lay.offsets[sc.terminals[0].name];
  assert.equal(sc.terminals[0].name, 'clk');
  assert.ok(p1.dx < 0 && p1.dy < 0);
});
