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

// B21: pin labels of the generic body must not run into each other.
import { readdirSync } from 'node:fs';
import { moduleLabelLayout, PIN_LABEL_FONT } from '../src/model/module-layout.js';

const labelBox = (name, l) => {
  const len = name.length * l.size * 0.62;
  if (l.rotate === -90) {
    // text runs upward from (x, y) for anchor start, ends at (x, y) for end
    const y0 = l.anchor === 'start' ? l.y - len : l.y;
    return { l: l.x - l.size, r: l.x, t: y0, b: y0 + len };
  }
  const x0 = l.anchor === 'start' ? l.x : l.anchor === 'end' ? l.x - len : l.x - len / 2;
  return { l: x0, r: x0 + len, t: l.y - l.size, b: l.y };
};
const overlaps = (a, b) => Math.min(a.r, b.r) - Math.max(a.l, b.l) > 0.05 && Math.min(a.b, b.b) - Math.max(a.t, b.t) > 0.05;
const clashes = (sc, labels) => {
  const names = sc.terminals.map(t => t.name).filter(n => labels[n]);
  const out = [];
  for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) {
    if (overlaps(labelBox(names[i], labels[names[i]]), labelBox(names[j], labels[names[j]]))) out.push(`${names[i]}/${names[j]}`);
  }
  return out;
};
const allKinds = () => readdirSync(new URL('../src/parts-data/', import.meta.url)).filter(f => f.endsWith('.json')).flatMap(f => {
  try {
    const sc = JSON.parse(readFileSync(new URL(`../src/parts-data/${f}`, import.meta.url), 'utf8'));
    return sc.kind && sc.terminals?.length > 1 ? [sc] : [];
  } catch { return []; }
});
const rowKinds = () => allKinds().filter(sc => moduleTerminalLayout(sc).source === 'row');
// matrix16x8 has its own renderer (the generic body never draws it) and its
// sidecar stacks three column pins at one x inside the body.
const NOT_GENERIC = new Set(['matrix16x8']);

test('every sidecar kind: no two generic-body pin labels overlap; pins never move', () => {
  const kinds = allKinds().filter(sc => !NOT_GENERIC.has(sc.kind));
  assert.ok(kinds.length > 250, `found ${kinds.length} kinds`);
  const bad = [];
  for (const sc of kinds) {
    const lay = moduleTerminalLayout(sc);
    const before = JSON.stringify(lay.offsets);
    const { labels } = moduleLabelLayout(sc, lay);
    assert.equal(JSON.stringify(lay.offsets), before, `${sc.kind}: pins moved`);
    const c = clashes(sc, labels);
    if (c.length) bad.push(`${sc.kind}: ${c.join(' ')}`);
  }
  assert.deepEqual(bad, []);
});

test('header-row kinds: names stay inside the body and clear of the title', () => {
  const kinds = rowKinds();
  assert.ok(kinds.length >= 1);
  for (const sc of kinds) {
    const { labels, box, titleY } = moduleLabelLayout(sc, moduleTerminalLayout(sc));
    for (const t of sc.terminals) {
      const b = labelBox(t.name, labels[t.name]);
      assert.ok(b.t >= box.y - 0.01 && b.b <= box.y + box.h + 0.01, `${sc.kind}:${t.name} inside body`);
      assert.ok(b.b <= titleY - 4 || b.t >= titleY + 4, `${sc.kind}:${t.name} clear of title`);
    }
  }
});

test('control: the B20 drawing (horizontal names at font 3) does overlap', () => {
  // The B20 body drew every name centred on its pin, 4 above (bottom half)
  // or 7 below (top half). Some kinds must clash that way, or this suite
  // proves nothing about crowding.
  const b20 = (sc, lay) => Object.fromEntries(sc.terminals.map(t => {
    const p = lay.offsets[t.name];
    return [t.name, { x: p.dx, y: p.dy + (p.dy >= 0 ? -4 : 7), anchor: 'middle', rotate: 0, size: PIN_LABEL_FONT }];
  }));
  const crowded = allKinds().filter(sc => !NOT_GENERIC.has(sc.kind) && clashes(sc, b20(sc, moduleTerminalLayout(sc))).length);
  assert.ok(crowded.length >= 10, `B20 drawing clashes on ${crowded.length} kinds`);
  for (const sc of crowded) assert.deepEqual(clashes(sc, moduleLabelLayout(sc, moduleTerminalLayout(sc)).labels), [], sc.kind);
});
