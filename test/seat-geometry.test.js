// Seat geometry invariants: the renderer's hole positions, the snapper's
// lattice, and the model's hole ids must all be ONE geometry.
// _setup.js registers the parts-data sidecars; the alias tests at the
// bottom need them (the geometry tests above do not care).
import './_setup.js';
import { test, describe, it } from 'node:test';
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

/**
 * A seated chip's aliases must land in their twin's HOLE.
 *
 * bw-board answers to two names for some legs (74hc595 ser/data,
 * stc15_mcu P3.0/p3.0). Only the physical spelling can be in the leadMap —
 * BreadboardModel.occupy() throws on "hole used twice by this part", so a
 * footprint that listed both would make the chip refuse to seat. That left
 * the alias with no _seatTerminals entry, so terminalPos() fell through to
 * the free-part offset table, whose rows are the OPPOSITE way round from
 * the seated ones: measured 38 units off, i.e. the far side of the package.
 */
describe('seated parts: a two-named leg is still one hole', () => {
  it('74hc595 aliases sit exactly on their twin holes, and it still seats', async () => {
    const { computeLeadMap, straddleRefRow } = await import('../src/model/footprints.js');
    const { resolveSeatedParts } = await import('../src/interaction/seat-geometry.js');
    const { getSidecar } = await import('../src/model/parts-registry.js');
    const fp = getSidecar('74hc595').footprint;
    const leadMap = computeLeadMap(fp, `${straddleRefRow(fp)}5`);
    // The footprint must stay seatable: sixteen legs, sixteen distinct holes.
    assert.equal(Object.keys(leadMap).length, 16, 'sixteen legs in the leadMap');
    assert.equal(new Set(Object.values(leadMap)).size, 16,
      'an alias in footprint.leads would double a hole and occupy() would throw');

    const bb = { kind: 'breadboard', id: 'bb', x: 0, y: 0, params: {} };
    const chip = { kind: '74hc595', id: 'u1', x: 0, y: 0, seat: { boardId: 'bb', leadMap } };
    const [, seated] = resolveSeatedParts([bb, chip]);
    const t = seated._seatTerminals;
    assert.ok(t, 'the chip resolved as seated');
    for (const [alias, twin] of [['data', 'ser'], ['clock', 'srclk'], ['latch', 'rclk'],
      ['q0', 'qa'], ['Q0', 'qa'], ['q7', 'qh'], ['Q7', 'qh']]) {
      assert.ok(t[alias], `seated 74hc595 has no position for ${alias} — it would render at the part origin`);
      assert.deepEqual(t[alias], t[twin], `seated ${alias} must be in ${twin}'s hole`);
    }
    assert.equal(new Set(Object.values(t).map(p => `${p.x},${p.y}`)).size, 16,
      'thirty-five names, sixteen holes');
  });

  it('stc15_mcu lowercase names land in the uppercase pins holes', async () => {
    const { computeLeadMap, straddleRefRow } = await import('../src/model/footprints.js');
    const { resolveSeatedParts } = await import('../src/interaction/seat-geometry.js');
    const { getSidecar } = await import('../src/model/parts-registry.js');
    const fp = getSidecar('stc15_mcu').footprint;
    const leadMap = computeLeadMap(fp, `${straddleRefRow(fp)}5`);
    const bb = { kind: 'breadboard', id: 'bb', x: 0, y: 0, params: {} };
    const mcu = { kind: 'stc15_mcu', id: 'u1', x: 0, y: 0, seat: { boardId: 'bb', leadMap } };
    const [, seated] = resolveSeatedParts([bb, mcu]);
    const t = seated._seatTerminals;
    for (const [alias, twin] of [['p0.0', 'P0.0'], ['vcc', 'VCC'], ['gnd', 'GND'], ['p3.0', 'P3.0']]) {
      assert.ok(t[alias], `seated stc15_mcu has no position for ${alias}`);
      assert.deepEqual(t[alias], t[twin], `seated ${alias} must be in ${twin}'s hole`);
    }
    assert.equal(new Set(Object.values(t).map(p => `${p.x},${p.y}`)).size, 40,
      'eighty names, forty holes');
  });
});
