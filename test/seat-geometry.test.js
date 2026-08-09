// Seat geometry invariants: the renderer's hole positions, the snapper's
// lattice, and the model's hole ids must all be ONE geometry.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { holeWorldPos, seatGeometry, resolveSeatedParts } from '../src/interaction/seat-geometry.js';
import { nearestHole } from '../src/interaction/breadboard-snap.js';

const bb = { id: 'BB1', kind: 'breadboard', x: 500, y: 300 };

test('holeWorldPos and nearestHole are inverse — every row kind', () => {
  for (const hole of ['a1', 'e5', 'f12', 'j63', 'b30', 't+3', 'b-40']) {
    const pos = holeWorldPos(bb, hole);
    assert.ok(pos, `${hole} resolves`);
    const back = nearestHole(bb, pos.x, pos.y);
    assert.ok(back, `${hole} round-trips`);
    assert.equal(back.hole, hole, `${hole} → (${pos.x},${pos.y}) → ${back.hole}`);
  }
  assert.equal(holeWorldPos(bb, 'a64'), null, 'out of range refused');
  assert.equal(holeWorldPos(bb, 'k9'), null, 'bad row refused');
});

test('seatGeometry: body at the hole centroid, terminals AT the holes', () => {
  const geo = seatGeometry(bb, { a: 'b5', b: 'b9' });
  const h1 = holeWorldPos(bb, 'b5'), h2 = holeWorldPos(bb, 'b9');
  assert.deepEqual(geo.terminals.a, h1);
  assert.deepEqual(geo.terminals.b, h2);
  assert.equal(geo.x, (h1.x + h2.x) / 2);
  assert.equal(geo.y, h1.y);
});

test('resolveSeatedParts: seated parts move to their holes, free parts untouched', () => {
  const parts = [
    bb,
    { id: 'R1', kind: 'resistor', x: 0, y: 0, seat: { boardId: 'BB1', leadMap: { a: 'b5', b: 'b9' } } },
    { id: 'R2', kind: 'resistor', x: 111, y: 222 },
  ];
  const resolved = resolveSeatedParts(parts);
  const r1 = resolved.find(p => p.id === 'R1');
  const r2 = resolved.find(p => p.id === 'R2');
  assert.ok(r1._seatTerminals, 'seated part carries terminal override');
  assert.deepEqual(r1._seatTerminals.a, holeWorldPos(bb, 'b5'));
  assert.notEqual(r1.x, 0, 'anchored between its holes');
  assert.equal(r2.x, 111, 'free part untouched');
  assert.equal(r2._seatTerminals, undefined);
});
