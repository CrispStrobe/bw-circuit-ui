// Seated inference: code declarations arrive as a REAL breadboard build,
// electrically proven — drive the declared pin and the LED responds.
import './_setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Circuit, resetIds } from '../src/model/circuit.js';
import { buildSeatedFromDeclarations } from '../src/model/infer-seated.js';

test('OUTPUT ACTIVE LOW: derived board lights when the pin sinks', () => {
  resetIds();
  const c = new Circuit(5.0);
  buildSeatedFromDeclarations(c, {
    pins: [{ name: 'led1', port: 1, bit: 0, direction: 'output', activeLow: true }],
  });
  const led = c.parts.find(p => p.kind === 'led');
  assert.ok(led.seat, 'LED is seated');
  // Pin idle HIGH (active-low off): dark.
  c.board.setPin('P1.0', 'quasi', true);
  c.board.advanceTo(25_000_000n);
  assert.ok(c.board.ledBrightness(led.id) < 0.02, 'off state dark');
  // Pin LOW: the sink path conducts: 5V rail → 1k → LED → pin.
  c.board.setPin('P1.0', 'quasi', false);
  c.board.advanceTo(50_000_000n);
  const lit = c.board.ledBrightness(led.id);
  assert.ok(lit > 0.10, `sinking pin lights the LED: ${lit}`);
});

test('ANALOG: pot wiper reaches the pin; INPUT: button pulls the pin low', () => {
  resetIds();
  const c = new Circuit(5.0);
  buildSeatedFromDeclarations(c, {
    pins: [
      { name: 'pot', port: 1, bit: 3, direction: 'analog' },
      { name: 'btn', port: 3, bit: 2, direction: 'input' },
    ],
  });
  const pot = c.parts.find(p => p.kind === 'potentiometer');
  c.board.setPin('P1.3', 'input', false);
  c.board.setControl(pot.id, 0.5);
  const v = c.board.readAnalog('P1.3');
  assert.ok(Math.abs(v - 2.5) < 0.3, `wiper at midpoint reads ~2.5 V: ${v}`);

  const btn = c.parts.find(p => p.kind === 'button');
  c.board.setPin('P3.2', 'quasi', true); // quasi high = weak pull-up
  assert.equal(c.board.readPin('P3.2'), 1, 'released: pull-up holds HIGH');
  c.board.setControl(btn.id, 1);
  assert.equal(c.board.readPin('P3.2'), 0, 'pressed: pulled LOW');
});

test('derived build round-trips through save/load still conducting', () => {
  resetIds();
  const c = new Circuit(5.0);
  buildSeatedFromDeclarations(c, {
    pins: [{ name: 'led1', port: 1, bit: 0, direction: 'output', activeLow: true }],
  });
  const r = Circuit.fromJSON(JSON.parse(JSON.stringify(c.toJSON())));
  r.board.setPin('P1.0', 'quasi', false);
  r.board.advanceTo(25_000_000n);
  const led = r.parts.find(p => p.kind === 'led');
  assert.ok(r.board.ledBrightness(led.id) > 0.10, 'restored derived board conducts');
});
