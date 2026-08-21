// Geometric invariants of the schematic projection, from the 2026-08-10
// owner report ("schematics view almost totally broken"): wires ran off the
// canvas, the MCU floated beside its own connections, stubs dangled.
//  A. everything inside the canvas
//  B. every stub's outer end lands ON a symbol pin
//  C. every drawn net has >= 2 stubs
import './_setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Circuit, resetIds } from '../src/model/circuit.js';
import { buildSeatedFromDeclarations } from '../src/model/infer-seated.js';
import { projectSchematic } from '../src/model/schematic-projection.js';

function checkInvariants(parts, nets, label) {
  const proj = projectSchematic(parts, nets);
  const inside = (x, y) => x >= -1 && y >= -1 && x <= proj.width + 1 && y <= proj.height + 1;
  const pinSet = new Set();
  for (const s of proj.symbols) {
    assert.ok(inside(s.x, s.y), `${label}: symbol ${s.id} outside canvas`);
    for (const pin of s.pins) {
      assert.ok(inside(pin.x, pin.y), `${label}: pin ${s.id}.${pin.name} outside canvas`);
      pinSet.add(`${Math.round(pin.x)},${Math.round(pin.y)}`);
    }
  }
  for (const w of proj.wires) {
    assert.ok(inside(w.trunk.x, w.trunk.y1) && inside(w.trunk.x, w.trunk.y2),
      `${label}: trunk ${w.netId} outside canvas`);
    for (const sym of proj.symbols) {
      const collides = Math.abs(w.trunk.x - sym.x) < 30 &&
        w.trunk.y1 < sym.y + 20 && w.trunk.y2 > sym.y - 20;
      assert.ok(!collides, `${label}: trunk ${w.netId} runs through symbol ${sym.id}`);
    }
    assert.ok(w.stubs.length >= 2, `${label}: net ${w.netId} dangles (${w.stubs.length} stub)`);
    for (const seg of w.stubs) {
      const [a, b] = seg;
      const outer = Math.abs(a.x - w.trunk.x) > Math.abs(b.x - w.trunk.x) ? a : b;
      assert.ok(pinSet.has(`${Math.round(outer.x)},${Math.round(outer.y)}`),
        `${label}: stub of ${w.netId} ends off-pin at ${outer.x | 0},${outer.y | 0}`);
    }
  }
  return proj;
}

test('seated MCU bench: a DIP-40 shows only its connected pins, wires meet the box', () => {
  resetIds();
  const c = new Circuit(5);
  buildSeatedFromDeclarations(c, { device: 'STC12C5A60S2', pins: [
    { name: 'led1', port: 1, bit: 0, direction: 'output', activeLow: true },
    { name: 'pot1', port: 1, bit: 3, direction: 'analog' },
  ] });
  const proj = checkInvariants(c.parts, c.board.getNets(), 'bench');
  const mcu = proj.symbols.find(s => s.kind === 'mcu');
  assert.ok(mcu, 'mcu symbol present');
  assert.ok(mcu.pins.length >= 3 && mcu.pins.length <= 8,
    `mcu draws its CONNECTED pins only, got ${mcu.pins.length}`);
  for (const pin of mcu.pins) {
    assert.ok(Math.abs(pin.y - mcu.y) < 120, `pin ${pin.name} within reach of the box`);
  }
});

test('pure battery circuit: no clipping, no dangling nets', () => {
  resetIds();
  const c = Circuit.fromJSON({
    vcc: 5,
    parts: [
      { id: 'bat1', kind: 'battery', params: { volts: 9 }, x: 0, y: 0 },
      { id: 'r1', kind: 'resistor', params: { ohms: 1000 }, x: 0, y: 0 },
      { id: 'led1', kind: 'led', params: { vf: 2, color: 'red' }, x: 0, y: 0 },
    ],
    wires: [
      { from: 'bat1', fromTerminal: 'pos', to: 'r1', toTerminal: 'a' },
      { from: 'r1', fromTerminal: 'b', to: 'led1', toTerminal: 'anode' },
      { from: 'led1', fromTerminal: 'cathode', to: 'bat1', toTerminal: 'neg' },
    ],
  });
  const proj = checkInvariants(c.parts, c.board.getNets(), 'battery');
  assert.equal(new Set([...proj.wires.map(w => w.netId), ...proj.netLabels.map(l => l.netId)]).size,
    3, 'three nets drawn directly or with repeated labels');
});

test('multi-pin IC (555): pins stay on the box, all wired ends meet pins', () => {
  resetIds();
  const c = new Circuit(5);
  const v = c.addPart('vsource', { volts: 5 }, 0, 0);
  const u = c.addPart('555', {}, 100, 0);
  const r = c.addPart('resistor', { ohms: 1000 }, 200, 0);
  c.addWire(v.id, 'pos', u.id, 'vcc');
  c.addWire(u.id, 'gnd', v.id, 'neg');
  c.addWire(u.id, 'output', r.id, 'a');
  checkInvariants(c.parts, c.board.getNets(), '555');
});
