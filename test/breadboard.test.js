// Breadboard model: strip continuity, occupancy, and net derivation.
// Expected nets are worked out by hand against the physical board's rules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BreadboardModel } from '../src/model/breadboard.js';

test('strip continuity matches the physical board', () => {
  const bb = new BreadboardModel();
  // a–e share a column; f–j share a column; the gutter separates them.
  assert.equal(bb.stripOf('a5'), bb.stripOf('e5'));
  assert.equal(bb.stripOf('f5'), bb.stripOf('j5'));
  assert.notEqual(bb.stripOf('e5'), bb.stripOf('f5'));
  // Different columns are different strips.
  assert.notEqual(bb.stripOf('a5'), bb.stripOf('a6'));
  // Rails run the length.
  assert.equal(bb.stripOf('t+1'), bb.stripOf('t+63'));
  assert.notEqual(bb.stripOf('t+1'), bb.stripOf('t-1'));
  // Bounds and junk are refused.
  assert.throws(() => bb.stripOf('a64'), /No such hole/);
  assert.throws(() => bb.stripOf('k1'), /No such hole/);
  const half = new BreadboardModel({ size: 'half' });
  assert.ok(half.isValidHole('a30'));
  assert.ok(!half.isValidHole('a31'));
});

test('split rails break at the middle, and only there', () => {
  const bb = new BreadboardModel({ splitRails: true });
  assert.equal(bb.stripOf('t+1'), bb.stripOf('t+31'));   // 63 cols → split after 31
  assert.notEqual(bb.stripOf('t+31'), bb.stripOf('t+32'));
  assert.equal(bb.stripOf('t+32'), bb.stripOf('t+63'));
});

test('occupancy is one per hole, all-or-nothing, and errors name the squatter', () => {
  const bb = new BreadboardModel();
  bb.occupy('R1', { a: 'b5', b: 'b10' });
  assert.throws(() => bb.occupy('R2', { a: 'b5', b: 'b20' }),
    /hole "b5" is taken by R1\.a/);
  // The failed placement must not have landed its OTHER lead either.
  assert.equal(bb.occupantOf('b20'), undefined);
  bb.release('R1');
  assert.equal(bb.occupantOf('b5'), undefined);
  // Wires occupy their end holes too.
  bb.addWire('w1', 'a1', 't+3');
  assert.throws(() => bb.occupy('R3', { a: 'a1', b: 'a20' }), /taken by wire w1/);
  bb.removeWire('w1');
  bb.occupy('R3', { a: 'a1', b: 'a20' });
});

test('the classic LED circuit derives exactly three nets', () => {
  // VCC → rail; rail → col 5 (wire); R from col 5 to col 10; LED anode col 10,
  // cathode col 15; col 15 → minus rail (wire); GND on the minus rail.
  const bb = new BreadboardModel();
  bb.occupy('V1', { vcc: 't+1' });
  bb.occupy('G1', { gnd: 't-1' });
  bb.addWire('w1', 't+5', 'a5');
  bb.occupy('R1', { a: 'b5', b: 'b10' });
  bb.occupy('D1', { anode: 'c10', cathode: 'c15' });
  bb.addWire('w2', 'a15', 't-3');
  const { nets, notes } = bb.deriveNets();

  assert.equal(nets.length, 3, JSON.stringify(nets, null, 2));
  const byId = new Map(nets.map(n => [n.id, n.terminals]));
  // Rail-anchored nets are named for the rail — the human's landmark.
  assert.deepEqual(byId.get('rail-t+'),
    [{ part: 'R1', terminal: 'a' }, { part: 'V1', terminal: 'vcc' }]);
  assert.deepEqual(byId.get('rail-t-'),
    [{ part: 'D1', terminal: 'cathode' }, { part: 'G1', terminal: 'gnd' }]);
  assert.deepEqual(byId.get('n-col-t10'),
    [{ part: 'D1', terminal: 'anode' }, { part: 'R1', terminal: 'b' }]);
  assert.equal(notes.length, 0, notes.join('\n'));
});

test('net derivation is deterministic across insertion order', () => {
  const build = (order) => {
    const bb = new BreadboardModel();
    for (const step of order) step(bb);
    return JSON.stringify(bb.deriveNets().nets);
  };
  const steps = [
    (bb) => bb.occupy('V1', { vcc: 't+1' }),
    (bb) => bb.occupy('R1', { a: 'b5', b: 'b10' }),
    (bb) => bb.addWire('w1', 't+5', 'a5'),
  ];
  assert.equal(build(steps), build([steps[2], steps[0], steps[1]].map(s => s)));
});

test('teaching notes: shorts, no-op wires, floating leads, missing rail jumper', () => {
  const bb = new BreadboardModel({ splitRails: true });
  // Both resistor legs in one strip: shorted by the board.
  bb.occupy('R1', { a: 'a5', b: 'c5' });
  let { notes } = bb.deriveNets();
  assert.ok(notes.some(n => /R1.*same strip.*shorted/.test(n)), notes.join('\n'));
  bb.release('R1');

  // A wire within one strip does nothing.
  bb.addWire('w0', 'a7', 'e7');
  ({ notes } = bb.deriveNets());
  assert.ok(notes.some(n => /does nothing/.test(n)), notes.join('\n'));
  bb.removeWire('w0');

  // A lead alone on a net is floating.
  bb.occupy('R2', { a: 'b20', b: 'b25' });
  ({ notes } = bb.deriveNets());
  assert.ok(notes.some(n => /R2\.a.*floating|floating.*R2\.a/.test(n) || /alone on/.test(n)),
    notes.join('\n'));

  // Split rails: leads on the two halves are NOT connected — the classic
  // missing-jumper bug is representable, and the derivation shows two nets.
  const bb2 = new BreadboardModel({ splitRails: true });
  bb2.occupy('V1', { vcc: 't+2' });
  bb2.occupy('R3', { a: 't+40', b: 'a40' });
  const d = bb2.deriveNets();
  const railNets = d.nets.filter(n => n.id.startsWith('rail-t+'));
  assert.equal(railNets.length, 2, JSON.stringify(d.nets));
});

test('a DIP straddling the gutter keeps its two pin rows apart', () => {
  // An 8-pin DIP: pins 1–4 in e10..e13 (top block), pins 5–8 in f13..f10
  // (bottom block). The gutter is the whole reason the package fits.
  const bb = new BreadboardModel();
  bb.occupy('U1', {
    p1: 'e10', p2: 'e11', p3: 'e12', p4: 'e13',
    p5: 'f13', p6: 'f12', p7: 'f11', p8: 'f10',
  });
  // Pin 1's strip must not touch pin 8's strip (same column, opposite blocks).
  assert.notEqual(bb.stripOf('e10'), bb.stripOf('f10'));
  const { nets, notes } = bb.deriveNets();
  // Every pin floats alone until wired: 8 single-terminal nets, 8 notes.
  assert.equal(nets.length, 8);
  assert.equal(notes.filter(n => /alone on/.test(n)).length, 8);
});
