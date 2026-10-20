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
  const at = canvas.indexOf("case 'npn': case 'pnp': case 'switch': case 'ldr': case 'dip_switch_spst':\n      case 'dc_motor': case 'ntc': case 'inductor': case 'slide_switch': case 'tilt_sensor': case 'opamp': case 'relay':\n      case 'piezo': case 'rgb_led': case 'nmos': case 'tip120': case 'battery_aa': case 'optocoupler': case 'ds18b20': {");
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
  // light_sensor (its own kind, formerly aliased to ldr) has vcc/gnd/out: the LDR symbol needs a/b.
  const canvas = read('src/components/BoardCanvas.jsx');
  assert.match(canvas, /if \(!needs\.every\(name => o\[name\] && part\.terminals\.includes\(name\)\)\) return genericFace\(\);/);
  const ls = JSON.parse(read('src/parts-data/light_sensor.json'));
  assert.deepEqual(ls.terminals.map(t => t.name), ['vcc', 'gnd', 'out']);
});

// B25: the next generic kinds by example use (decade counter 8, DC motor 7,
// NTC 6, inductor 5, slide switch 4, tilt sensor 4, op-amp 3, relay 3).
test('B25 symbols: the geometry each one assumes', () => {
  for (const kind of ['ntc', 'inductor']) {
    const o = offsets(kind);
    assert.equal(o.a.dy, o.b.dy, kind);
    assert.ok(o.a.dx < o.b.dx, kind);
  }
  const m = offsets('dc_motor');
  assert.equal(m.a.dy, m.b.dy, 'motor leads on one row');
  const s = offsets('slide_switch');
  assert.ok(s.a.dx < s.com.dx && s.com.dx < s.b.dx && s.a.dy === s.b.dy, 'slide switch a-com-b in a row');
  const t = offsets('tilt_sensor');
  assert.equal(t.a.dx, t.b.dx, 'tilt sensor leads in a column');
  const op = offsets('opamp');
  assert.ok(op.inp.dx < op.out.dx && op.inn.dx < op.out.dx && op.inp.dy !== op.inn.dy, 'op-amp inputs left, output right');
  const r = offsets('relay');
  const xs = ['coil_a', 'coil_b', 'no', 'com', 'nc'].map(n => r[n].dx);
  assert.deepEqual([...xs].sort((a, b) => a - b), xs, 'relay pins left to right: coil_a coil_b no com nc');
});

// B27: the next generic kinds in the examples census (piezo 2, RGB LED 2,
// NMOS 1, TIP120 1, AA cell 1, optocoupler 1, DS18B20 1).
test('B27 symbols: the geometry each one assumes', () => {
  const pz = offsets('piezo');
  assert.equal(pz.a.dy, pz.b.dy, 'piezo leads on one row');
  const rgb = offsets('rgb_led');
  const legs = ['r_anode', 'g_anode', 'b_anode', 'cathode'];
  assert.ok(legs.every(n => rgb[n].dy === rgb.cathode.dy), 'RGB LED legs on one row');
  assert.deepEqual(legs.map(n => rgb[n].dx), [...legs.map(n => rgb[n].dx)].sort((a, b) => a - b), 'R G B K left to right');
  const n = offsets('nmos');
  assert.ok(n.gate.dx < 0 && n.gate.dy === 0, 'gate on the left');
  assert.ok(n.drain.dy < 0 && n.source.dy > 0 && n.drain.dx === n.source.dx, 'drain above, source below, one column');
  for (const [kind, order] of [['tip120', ['base', 'collector', 'emitter']], ['ds18b20', ['gnd', 'dq', 'vcc']]]) {
    const o = offsets(kind);
    assert.ok(order.every(t => o[t].dy === o[order[0]].dy), `${kind} legs on one row`);
    assert.ok(order.every((t, i) => i === 0 || o[order[i - 1]].dx < o[t].dx), `${kind} legs ${order.join(' ')} left to right`);
  }
  const bat = offsets('battery_aa');
  assert.equal(bat.pos.dy, bat.neg.dy, 'AA cell terminals on one row');
  assert.notEqual(bat.pos.dx, bat.neg.dx);
  const op = offsets('optocoupler');
  assert.ok(op.anode.dx < 0 && op.cathode.dx < 0 && op.collector.dx > 0 && op.emitter.dx > 0, 'LED side left, transistor side right');
  assert.ok(op.anode.dy < op.cathode.dy, 'anode above cathode');
});

test('B27 faces draw the package or symbol their part is', () => {
  const canvas = read('src/components/BoardCanvas.jsx');
  for (const marker of ["{to220 ? 'TIP120' : 'DS18B20'}", '>AA</text>', "fill=\"#b08d3c\"", '>K</text>', '>G</text>']) {
    assert.ok(canvas.includes(marker), marker);
  }
});
