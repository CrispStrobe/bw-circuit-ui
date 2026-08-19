/**
 * LEDBANK8 face: 8 discrete LEDs with per-LED graded brightness.
 * Two brightness paths: continuous ds.brightness via ledDisplayLevel,
 * or on/off from ds.leds. Terminal offsets and deviceStates whitelist.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const boardSrc = readFileSync(join(here, '../src/components/BoardCanvas.jsx'), 'utf8');

test('ledbank8 has a render case in SvgParts', () => {
  const svgParts = boardSrc.indexOf('function SvgParts');
  const block = boardSrc.slice(svgParts, boardSrc.indexOf('function WokwiParts'));
  assert.ok(block.includes("case 'ledbank8':"), 'ledbank8 has a render case');
});

test('ledbank8 face renders 8 LEDs', () => {
  const caseStart = boardSrc.indexOf('LEDBANK8: 8 discrete LEDs');
  assert.ok(caseStart > 0, 'ledbank8 render case comment found');
  const block = boardSrc.slice(caseStart, caseStart + 3000);
  assert.ok(block.includes('length: 8') || block.includes('N = 8'), 'renders 8 LEDs');
  assert.ok(block.includes('circle'), 'renders LEDs as circles');
});

test('ledbank8 face reads continuous brightness from device state', () => {
  const caseStart = boardSrc.indexOf('LEDBANK8: 8 discrete LEDs');
  const block = boardSrc.slice(caseStart, caseStart + 3000);
  assert.ok(block.includes('ds?.brightness'), 'reads brightness from device state');
  assert.ok(block.includes('ledDisplayLevel('), 'uses ledDisplayLevel for perceptual mapping');
});

test('ledbank8 face falls back to on/off from ds.leds', () => {
  const caseStart = boardSrc.indexOf('LEDBANK8: 8 discrete LEDs');
  const block = boardSrc.slice(caseStart, caseStart + 3000);
  assert.ok(block.includes('ds?.leds'), 'reads leds array from device state');
  assert.ok(block.includes('leds[i]'), 'indexes into leds array per LED');
});

test('ledbank8 face has graded color rendering', () => {
  const caseStart = boardSrc.indexOf('LEDBANK8: 8 discrete LEDs');
  const block = boardSrc.slice(caseStart, caseStart + 3000);
  assert.ok(block.includes('#1a0000'), 'off-state dark color');
  assert.ok(block.includes('v > 0.05'), 'threshold separates off from lit');
  assert.ok(block.includes('40 + 140 * v'), 'green channel scales with brightness');
});

test('ledbank8 is included in the SvgParts deviceStates gathering', () => {
  const gatherer = boardSrc.slice(boardSrc.indexOf('<SvgParts'));
  assert.ok(gatherer.includes("p.kind === 'ledbank8'"), 'ledbank8 in deviceStates filter');
});

test('ledbank8 has terminal offsets for 10 pins (vcc, gnd, d0-d7)', () => {
  const offsets = boardSrc.slice(
    boardSrc.indexOf('function terminalOffsetsForPart'),
    boardSrc.indexOf('function terminalOffsetsForPart') + 6000,
  );
  assert.ok(offsets.includes("case 'ledbank8':"), 'ledbank8 in terminal offsets switch');
  for (const pin of ['vcc', 'gnd', 'd0', 'd1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7']) {
    assert.ok(offsets.includes(pin), `terminal offset for ${pin} defined`);
  }
});

test('ledbank8 brightness path is preferred over on/off', () => {
  const caseStart = boardSrc.indexOf('LEDBANK8: 8 discrete LEDs');
  const block = boardSrc.slice(caseStart, caseStart + 3000);
  const loopStart = block.indexOf('Array.from');
  const loopBlock = block.slice(loopStart);
  const brIdx = loopBlock.indexOf('if (br)');
  const ledsIdx = loopBlock.indexOf('leds ?');
  assert.ok(brIdx > 0, 'brightness path exists');
  assert.ok(ledsIdx > brIdx, 'on/off fallback comes after brightness check');
});
