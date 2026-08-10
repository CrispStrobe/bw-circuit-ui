// Legibility invariants for the schematic projection, asserted as properties:
// distinct nets never share a trunk lane where their y-spans overlap, and
// symbol bodies never overlap. An IC-heavy circuit is the stress case - a
// shift register, an MCU and a fan of LEDs generate many nets per channel.
import './_setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Circuit, resetIds } from '../src/model/circuit.js';
import { projectSchematic } from '../src/model/schematic-projection.js';

const buildIcHeavy = () => {
  resetIds();
  const c = new Circuit(5.0);
  const vcc = c.addPart('vcc', {}, 0, 0);
  const gnd = c.addPart('gnd', {}, 0, 0);
  const mcu = c.addPart('mcu', { pins: ['P1.0', 'P1.1', 'P1.2'] }, 0, 0);
  const sr = c.addPart('shift_register', {}, 0, 0);
  c.addWire(mcu.id, 'P1.0', sr.id, 'data');
  c.addWire(mcu.id, 'P1.1', sr.id, 'clock');
  c.addWire(mcu.id, 'P1.2', sr.id, 'latch');
  for (let i = 0; i < 4; i++) {
    const r = c.addPart('resistor', { ohms: 220 }, 0, 0);
    const led = c.addPart('led', {}, 0, 0);
    c.addWire(r.id, 'b', led.id, 'anode');
    c.addWire(led.id, 'cathode', gnd.id, 'gnd');
    c.addWire(vcc.id, 'vcc', r.id, 'a');
  }
  return c;
};

test('no two nets share a trunk lane with overlapping spans', () => {
  const c = buildIcHeavy();
  const proj = projectSchematic(c.parts, c.board.getNets());
  const trunks = proj.wires.map(w => ({ id: w.netId, ...w.trunk }));
  for (let i = 0; i < trunks.length; i++) {
    for (let j = i + 1; j < trunks.length; j++) {
      const a = trunks[i], b = trunks[j];
      const xClose = Math.abs(a.x - b.x) < 6;
      const yOverlap = Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1) > -4;
      assert.ok(!(xClose && yOverlap),
        `nets ${a.id} and ${b.id} collide: trunks at x=${a.x},${b.x}`);
    }
  }
});

test('symbol bodies never overlap', () => {
  const c = buildIcHeavy();
  const proj = projectSchematic(c.parts, c.board.getNets());
  const HALF_W = 34, HALF_H = 30;
  for (let i = 0; i < proj.symbols.length; i++) {
    for (let j = i + 1; j < proj.symbols.length; j++) {
      const a = proj.symbols[i], b = proj.symbols[j];
      const overlap = Math.abs(a.x - b.x) < HALF_W * 2 && Math.abs(a.y - b.y) < HALF_H * 2;
      assert.ok(!overlap, `${a.id} (${a.x},${a.y}) overlaps ${b.id} (${b.x},${b.y})`);
    }
  }
});

test('stubs never cross a foreign symbol body', () => {
  const c = buildIcHeavy();
  const proj = projectSchematic(c.parts, c.board.getNets());
  const HALF_W = 30, HALF_H = 26;
  for (const w of proj.wires) {
    for (const [p1, p2] of w.stubs) {
      const y = p1.y;
      const x1 = Math.min(p1.x, p2.x), x2 = Math.max(p1.x, p2.x);
      for (const s of proj.symbols) {
        const pinOfSymbol = s.pins.some(p => p.netId === w.netId && p.y === y);
        if (pinOfSymbol) continue; // its own stub may touch its own edge
        const crosses = y > s.y - HALF_H && y < s.y + HALF_H
          && x1 < s.x + HALF_W && x2 > s.x - HALF_W;
        assert.ok(!crosses, `net ${w.netId} stub at y=${y} crosses ${s.id}`);
      }
    }
  }
});
