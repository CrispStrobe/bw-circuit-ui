/**
 * B23 discrete faces: NPN/PNP, switch, LDR and DIP switch were drawn by the
 * generic module body (examples census 2026-10-19: DIP switch 26 examples,
 * switch 19, LDR 16, NPN 16). Their symbols are drawn around the existing
 * terminal offsets; these tests pin the geometry each symbol assumes.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { moduleTerminalLayout } from '../src/model/module-layout.js';

const read = rel => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const offsets = kind => moduleTerminalLayout(JSON.parse(read(`src/parts-data/${kind}.json`))).offsets;

test('the faces are their own case, ahead of the generic default', () => {
  const canvas = read('src/components/BoardCanvas.jsx');
  const at = canvas.indexOf("case 'npn': case 'pnp': case 'switch': case 'ldr': case 'dip_switch_spst': {");
  assert.ok(at > 0, 'discrete-face case present');
  assert.ok(at < canvas.indexOf('      default: {', at), 'before the default branch');
  assert.match(canvas, /data-part-face=\{kind\} data-discrete-face=\{kind\}/);
});

test('transistor: base on the left, collector above, emitter below', () => {
  for (const kind of ['npn', 'pnp']) {
    const o = offsets(kind);
    assert.ok(o.base.dx < 0 && o.base.dy === 0, `${kind} base`);
    assert.ok(o.collector.dy < 0 && o.emitter.dy > 0, `${kind} collector/emitter`);
    assert.equal(o.collector.dx, o.emitter.dx, `${kind} C and E share a column`);
  }
});

test('switch and LDR: two terminals on one horizontal line, a left of b', () => {
  for (const kind of ['switch', 'ldr']) {
    const o = offsets(kind);
    assert.equal(o.a.dy, o.b.dy, kind);
    assert.ok(o.a.dx < 0 && o.b.dx > 0, kind);
  }
});

test('DIP switch: 1a..4a on the top row, 1b..4b below, column by column', () => {
  const o = offsets('dip_switch_spst');
  for (const n of [1, 2, 3, 4]) {
    assert.ok(o[`${n}a`].dy < o[`${n}b`].dy, `${n}a above ${n}b`);
    assert.equal(o[`${n}a`].dx, o[`${n}b`].dx, `${n}a and ${n}b share a column`);
  }
  assert.ok([1, 2, 3].every(n => o[`${n}a`].dx < o[`${n + 1}a`].dx), 'switch 1 is leftmost');
});

test('a kind that only aliases to one of these keeps the generic body', () => {
  // light_sensor aliases to ldr but has vcc/gnd/out: the LDR symbol needs a/b.
  const canvas = read('src/components/BoardCanvas.jsx');
  assert.match(canvas, /if \(!needs\.every\(name => o\[name\] && part\.terminals\.includes\(name\)\)\) return genericFace\(\);/);
  const ls = JSON.parse(read('src/parts-data/light_sensor.json'));
  assert.deepEqual(ls.terminals.map(t => t.name), ['vcc', 'gnd', 'out']);
});
