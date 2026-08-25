import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const board = JSON.parse(readFileSync(join(import.meta.dirname,
  '..', 'gallery', 'board-prechin-a2.json'), 'utf8'));

const hasWire = (from, fromTerminal, to, toTerminal) => board.wires.some((w) =>
  w.from === from && w.fromTerminal === fromTerminal
  && w.to === to && w.toTerminal === toTerminal);

test('PRECHIN A2 preset matches the bench-verified board revision', () => {
  assert.equal(board.parts.filter((p) => p.kind === '74hc595').length, 1);
  assert.equal(board.parts.some((p) => p.kind === '74c922'), false);
  assert.ok(board.parts.some((p) => p.kind === 'xpt2046'));
  assert.ok(board.parts.some((p) => p.kind === 'sevenseg8'));
  assert.ok(board.parts.some((p) => p.kind === 'ledbank8'));

  for (let bit = 4; bit < 8; bit++)
    assert.ok(hasWire('mcu', `P0.${bit}`, 'lcd', `d${bit}`));
  assert.equal(board.wires.some((w) => w.to === 'lcd' && /^d[0-3]$/.test(w.toTerminal)), false);
  assert.ok(hasWire('mcu', 'P2.5', 'lcd', 'rw'));
  assert.ok(hasWire('mcu', 'P2.6', 'lcd', 'rs'));
  assert.ok(hasWire('mcu', 'P2.7', 'lcd', 'e'));

  assert.ok(hasWire('mcu', 'P2.5', 'buz', 'a'));
  assert.ok(hasWire('ir', 'out', 'mcu', 'P3.2'));
  assert.ok(hasWire('mcu', 'P3.4', 'rtc', 'io'));
  assert.ok(hasWire('mcu', 'P3.5', 'rtc', 'ce'));
  assert.ok(hasWire('mcu', 'P3.6', 'rtc', 'sclk'));
  assert.ok(hasWire('mcu', 'P3.7', 'temp', 'dq'));
  assert.ok(hasWire('mcu', 'P1.7', 'keypad', 'r0'));
  assert.ok(hasWire('mcu', 'P1.0', 'keypad', 'c3'));
});

test('J24 models OE-GND / OE-VCC selection and starts LCD-safe', () => {
  const j24 = board.parts.find((p) => p.id === 'j24');
  assert.equal(j24.kind, 'slide_switch');
  assert.equal(j24.params.position, 'b');
  assert.ok(hasWire('gnd1', 'gnd', 'j24', 'a'));
  assert.ok(hasWire('vcc1', 'vcc', 'j24', 'b'));
  assert.ok(hasWire('j24', 'com', 'sr1', 'oe'));
});
