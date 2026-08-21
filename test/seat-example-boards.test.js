import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('seating powers a floating Arduino and lays it clear of the breadboard', () => {
  const root = mkdtempSync(join(tmpdir(), 'bw-seat-board-'));
  const example = join(root, 'comparator');
  mkdirSync(example);
  writeFileSync(join(example, 'circuit.json'), JSON.stringify({
    parts: [
      { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'], x: 0, y: 0 },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'], x: 0, y: 0 },
      { id: 'MCU', kind: 'arduino_uno', params: {}, terminals: ['a0', 'a1', 'd13'], x: 0, y: 0 },
      { id: 'R1', kind: 'resistor', params: { resistance: 1000 }, terminals: ['a', 'b'], x: 0, y: 0 },
    ],
    wires: [
      { from: 'VCC', fromTerminal: 'vcc', to: 'R1', toTerminal: 'a' },
      { from: 'GND', fromTerminal: 'gnd', to: 'R1', toTerminal: 'b' },
    ],
  }));

  execFileSync(process.execPath, ['scripts/seat-examples.mjs', '--examples', root], {
    cwd: new URL('..', import.meta.url), stdio: 'pipe',
  });
  const circuit = JSON.parse(readFileSync(join(example, 'circuit.json'), 'utf8'));
  const mcu = circuit.parts.find(p => p.id === 'MCU');
  const board = circuit.parts.find(p => p.kind === 'breadboard');
  assert.ok(mcu.terminals.includes('5v'));
  assert.ok(mcu.terminals.includes('gnd2'));
  assert.ok(circuit.wires.some(w => w.genPower && w.to === 'MCU' && w.toTerminal === '5v'));
  assert.ok(circuit.wires.some(w => w.genPower && w.to === 'MCU' && w.toTerminal === 'gnd2'));
  assert.ok(mcu.y + 147 < board.y - 155, 'controller clears the breadboard');
});
