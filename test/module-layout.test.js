/**
 * Generic module layout (B20): the one helper the canvas uses for the body,
 * terminal dots and wire endpoints of a sidecar kind with no renderer.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { moduleTerminalLayout, sidecarHasDistinctGeometry, MODULE_PIN_PITCH } from '../src/model/module-layout.js';

const sidecar = kind => JSON.parse(readFileSync(new URL(`../src/parts-data/${kind}.json`, import.meta.url), 'utf8'));

test('kinds with sidecar geometry keep every terminal exactly (centre offsets)', () => {
  for (const kind of ['npn', 'ds3231', 'relay', 'neopixel']) {
    const sc = sidecar(kind);
    assert.ok(sidecarHasDistinctGeometry(sc), `${kind} has geometry`);
    const { offsets, source, collapsed, box } = moduleTerminalLayout(sc);
    assert.equal(source, 'sidecar');
    assert.equal(collapsed, false);
    for (const t of sc.terminals) {
      assert.deepEqual(offsets[t.name], { dx: t.x - sc.w / 2, dy: t.y - sc.h / 2 }, `${kind}.${t.name}`);
      assert.ok(offsets[t.name].dx >= box.x && offsets[t.name].dx <= box.x + box.w, `${kind}.${t.name} inside body x`);
      assert.ok(offsets[t.name].dy >= box.y && offsets[t.name].dy <= box.y + box.h, `${kind}.${t.name} inside body y`);
    }
  }
});

test('existing offsets that already place every terminal are kept as they are', () => {
  const sc = { w: 20, h: 10, terminals: [{ name: 'a', x: 0, y: 5 }, { name: 'b', x: 20, y: 5 }] };
  const existing = { a: { dx: -15, dy: 0 }, b: { dx: 15, dy: 0 } };
  const { offsets, source } = moduleTerminalLayout(sc, { existing });
  assert.equal(source, 'existing');
  assert.deepEqual(offsets, existing);
});

test('existing offsets that miss a terminal do not win', () => {
  const sc = sidecar('npn');
  const { source } = moduleTerminalLayout(sc, { existing: { a: { dx: -15, dy: 0 }, b: { dx: 15, dy: 0 } } });
  assert.equal(source, 'sidecar');
});

test('collapsed terminals get distinct single-row positions at a fixed pitch, names unchanged', () => {
  // A real sidecar whose last two pins share one point (oe/out at 56,45),
  // and synthetic ones with no coordinates or all on one spot.
  const cases = [
    sidecar('tcs3200'),
    { terminals: [{ name: 'vcc' }, { name: 'gnd' }, { name: 'sig' }] },
    { w: 10, h: 10, terminals: ['p1', 'p2', 'p3', 'p4'].map(name => ({ name, x: 5, y: 5 })) },
  ];
  for (const sc of cases) {
    assert.equal(sidecarHasDistinctGeometry(sc), false);
    const { offsets, source, collapsed, box } = moduleTerminalLayout(sc);
    assert.equal(source, 'row');
    assert.equal(collapsed, true);
    const names = sc.terminals.map(t => t.name);
    assert.deepEqual(Object.keys(offsets), names);
    const ys = new Set(names.map(n => offsets[n].dy));
    assert.equal(ys.size, 1, 'one row');
    const xs = names.map(n => offsets[n].dx);
    assert.equal(new Set(xs).size, names.length, 'distinct');
    for (let i = 1; i < xs.length; i++) assert.equal(xs[i] - xs[i - 1], MODULE_PIN_PITCH);
    assert.ok(Math.abs(xs[0] + xs[xs.length - 1]) < 1e-9, 'centred');
    assert.ok(xs[0] >= box.x && xs[xs.length - 1] <= box.x + box.w, 'row inside body');
  }
});

test('aliases share their twin\'s point', () => {
  const sc = { terminals: [{ name: 'ser', aliases: ['data'] }, { name: 'clk' }] };
  const { offsets } = moduleTerminalLayout(sc);
  assert.deepEqual(offsets.data, offsets.ser);
});

test('the canvas routes its default branch through the shared helper', () => {
  const canvas = readFileSync(new URL('../src/components/BoardCanvas.jsx', import.meta.url), 'utf8');
  assert.match(canvas, /moduleTerminalLayout\(msc, \{ existing: legacy \}\)/);
  assert.match(canvas, /const mod = genericModuleLayout\(part\);/);
});
