/**
 * MAX7219 face: the LED matrix driver must render a live 8×8 grid
 * from getDeviceState, not fall through to the generic DIP body.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '../src/components/BoardCanvas.jsx'), 'utf8');

test('max7219 has a render case in SvgParts', () => {
  const svgParts = src.indexOf('function SvgParts');
  assert.ok(svgParts > 0, 'SvgParts function found');
  const block = src.slice(svgParts, src.indexOf('function WokwiParts'));
  assert.ok(block.includes("case 'max7219':"), 'max7219 has a render case');
});

test('max7219 face reads deviceStates and renders 64 LEDs', () => {
  // Find the render case (the one with "MAX7219 8×8" comment), not terminal offsets
  const caseStart = src.indexOf('MAX7219 8');
  assert.ok(caseStart > 0, 'max7219 render case found');
  const block = src.slice(caseStart, caseStart + 3000);
  assert.ok(block.includes('deviceStates'), 'reads from deviceStates');
  assert.ok(block.includes('ds.digits') || block.includes('ds?.digits'), 'reads digits array from device state');
  assert.ok(block.includes('64'), 'renders 64 LEDs (8×8 grid)');
});

test('max7219 face respects shutdown and displayTest flags', () => {
  const caseStart = src.indexOf('MAX7219 8');
  const block = src.slice(caseStart, caseStart + 3000);
  assert.ok(block.includes('shutdown'), 'reads shutdown flag');
  assert.ok(block.includes('displayTest'), 'reads displayTest flag');
  assert.ok(block.includes('intensity'), 'reads intensity level');
});

test('max7219 face supports per-pixel brightness from ds.brightness', () => {
  const caseStart = src.indexOf('MAX7219 8');
  const block = src.slice(caseStart, caseStart + 3000);
  // Path A: per-pixel brightness array
  assert.ok(block.includes('ds?.brightness') || block.includes('perPixel'), 'reads per-pixel brightness');
  assert.ok(block.includes('ledDisplayLevel'), 'uses ledDisplayLevel for perception');
  // Path B preserved: on/off digits + global intensity
  assert.ok(block.includes('globalIntensity') || block.includes('ds.intensity'), 'global intensity fallback preserved');
});

test('max7219 is included in the SvgParts deviceStates gathering', () => {
  const gatherer = src.slice(src.indexOf('<SvgParts'));
  assert.ok(gatherer.includes("p.kind === 'max7219'"), 'max7219 in deviceStates filter');
});

test('max7219 has terminal offsets (not falling through to default)', () => {
  const offsets = src.slice(
    src.indexOf('function terminalOffsetsForPart'),
    src.indexOf('function terminalOffsetsForPart') + 3000,
  );
  assert.ok(offsets.includes("case 'max7219':"), 'max7219 in terminal offsets switch');
  assert.ok(offsets.includes('din'), 'DIN terminal defined');
  assert.ok(offsets.includes('clk'), 'CLK terminal defined');
  assert.ok(offsets.includes('cs'), 'CS terminal defined');
});
