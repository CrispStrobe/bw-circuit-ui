// A POTENTIOMETER'S KNOB IS WIDER THAN ITS SEAT.
//
// BoardCanvas draws a seated pot's control as a 60x60 box scaled by
// |b.x - a.x| / 40 (capped at 1.4), centred on the seat and lifted 60*scale
// above row a. For the ordinary three-lead pot that box overhangs the holes it
// occupies by two columns on each side, so a neighbour placed one column away
// is DRAWN UNDER THE KNOB: unclickable in simulate mode, and invisible.
//
// Measured before the fix, in the vendored bench
// arduino-sk-p05-servo-mood/circuit.arduino-uno.json (pot a3..a7, servo
// a9..a11): `POT_pot covers SERVO_servo by 7.0x30.0`, in all eight device
// variants. Brickwright-lite's circuit-corpus-invariants gate names them.
//
// This test drives the SEAT GENERATOR, not a hand-written bench, because the
// defect is in its column arithmetic and nothing else would hold it.
import './_setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolveSeatedParts } from '../src/interaction/seat-geometry.js';
import { partBounds } from '../src/interaction/hittest.js';

/** The knob rectangle exactly as BoardCanvas computes it for a seated pot. */
const knobBounds = pot => {
  const a = pot._seatTerminals?.a;
  const b = pot._seatTerminals?.b;
  assert.ok(a && b, 'the pot must be seated for this measurement to mean anything');
  const scale = Math.min(Math.abs(b.x - a.x) / 40, 1.4);
  return { minX: pot.x - 30 * scale, maxX: pot.x + 30 * scale,
    minY: a.y - 60 * scale, maxY: a.y };
};

const overlap = (one, other) => ({
  x: Math.min(one.maxX, other.maxX) - Math.max(one.minX, other.minX),
  y: Math.min(one.maxY, other.maxY) - Math.max(one.minY, other.minY),
});

const seat = parts => {
  const root = mkdtempSync(join(tmpdir(), 'bw-knob-'));
  const example = join(root, 'mood');
  mkdirSync(example);
  const ids = new Set(parts.map(part => part.id));
  writeFileSync(join(example, 'circuit.json'), JSON.stringify({
    parts, wires: [
      { from: 'VCC', fromTerminal: 'vcc', to: 'POT', toTerminal: 'a' },
      { from: 'GND', fromTerminal: 'gnd', to: 'POT', toTerminal: 'b' },
      { from: 'POT', fromTerminal: 'wiper', to: 'MCU', toTerminal: 'a0' },
      { from: 'MCU', fromTerminal: 'd9', to: 'SERVO', toTerminal: 'signal' },
      { from: 'VCC', fromTerminal: 'vcc', to: 'SERVO', toTerminal: 'vcc' },
      { from: 'GND', fromTerminal: 'gnd', to: 'SERVO', toTerminal: 'gnd' },
    ].filter(wire => ids.has(wire.from) && ids.has(wire.to)),
  }));
  execFileSync(process.execPath, ['scripts/seat-examples.mjs', '--examples', root],
    { cwd: new URL('..', import.meta.url), stdio: 'pipe' });
  return resolveSeatedParts(JSON.parse(readFileSync(join(example, 'circuit.json'), 'utf8')).parts);
};

const BENCH = [
  { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'], x: 0, y: 0 },
  { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'], x: 0, y: 0 },
  { id: 'MCU', kind: 'arduino_uno', params: {}, terminals: ['a0', 'd9'], x: 0, y: 0 },
  { id: 'POT', kind: 'potentiometer', params: {}, terminals: ['a', 'wiper', 'b'], x: 0, y: 0 },
  { id: 'SERVO', kind: 'servo', params: {}, terminals: ['signal', 'vcc', 'gnd'], x: 0, y: 0 },
];

test('a seated potentiometer\'s knob covers no neighbour', () => {
  const parts = seat(structuredClone(BENCH));
  const pot = parts.find(p => p.id === 'POT');
  assert.ok(pot.seat, 'the generator seated nothing — this test would prove nothing');
  const knob = knobBounds(pot);

  for (const part of parts) {
    if (part === pot || ['breadboard', 'vcc', 'gnd'].includes(part.kind)) continue;
    const gap = overlap(knob, partBounds(part));
    assert.ok(!(gap.x > 1 && gap.y > 1),
      `the pot knob covers ${part.id} by ${gap.x.toFixed(1)}x${gap.y.toFixed(1)}`);
  }
});

test('the reserved columns are charged only where a knob is', () => {
  // WHAT THE FIX COSTS, MEASURED RATHER THAN ASSUMED. Two extra columns per
  // pot is board space, and the packer opens a new breadboard when a part no
  // longer fits. On this bench — four pots, a servo, and a rank of eight
  // resistor+LED pairs — the clearance does cost one: 1 board before, 2 after.
  // That is the right trade (a control drawn on top of its neighbour is not a
  // bench you can use) and it stays well inside the owner's standing "at most
  // 3 breadboards", but it is charged, so it must be charged ONLY where a knob
  // actually is. The control bench below replaces the four pots with
  // resistors and must still fit on one board.
  const rank = (extra, base = BENCH) => {
    const bench = structuredClone(base);
    bench.push(...extra);
    for (let i = 0; i < 8; i++) {
      bench.push({ id: `R${i}`, kind: 'resistor', params: { resistance: 220 },
        terminals: ['a', 'b'], x: 0, y: 0 });
      bench.push({ id: `D${i}`, kind: 'led', params: {}, terminals: ['anode', 'cathode'], x: 0, y: 0 });
    }
    const parts = seat(bench);
    const floats = parts.filter(p => p.seat === undefined &&
      !['breadboard', 'vcc', 'gnd', 'arduino_uno'].includes(p.kind)).map(p => p.id);
    return { boards: parts.filter(p => p.kind === 'breadboard').length, floats };
  };

  const four = n => Array.from({ length: 4 }, (unused, i) => ({ id: `X${i}`, ...n(i) }));
  const withPots = rank(four(() => ({ kind: 'potentiometer', params: {},
    terminals: ['a', 'wiper', 'b'], x: 0, y: 0 })));
  // The control has NO knob on it at all — the base bench's own pot is
  // dropped too, so the board count answers only "does a knobless bench pay?"
  const knobless = BENCH.filter(part => part.kind !== 'potentiometer');
  const withResistors = rank(four(() => ({ kind: 'resistor', params: { resistance: 10000 },
    terminals: ['a', 'b'], x: 0, y: 0 })), knobless);

  assert.deepEqual(withPots.floats, [], 'the knob clearance pushed parts off the boards');
  assert.ok(withPots.boards <= 3, `${withPots.boards} breadboards — past the owner's limit`);
  assert.equal(withResistors.boards, 1,
    'a bench with no knob on it paid for the clearance anyway');
});
