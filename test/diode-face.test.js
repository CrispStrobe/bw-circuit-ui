/**
 * Diode face: the part must render on the canvas (not return null)
 * and have correct terminal offsets.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '../src/components/BoardCanvas.jsx'), 'utf8');

test('diode has a render case in WokwiParts (not falling through to default)', () => {
  const wokwiStart = src.indexOf('function WokwiParts');
  assert.ok(wokwiStart > 0, 'WokwiParts function found');
  const wokwiBlock = src.slice(wokwiStart);
  assert.ok(
    wokwiBlock.includes("case 'diode':"),
    'diode has a render case in WokwiParts',
  );
});

test('diode SVG contains triangle (diode symbol) and cathode bar', () => {
  const diodeCase = src.indexOf("case 'diode':");
  const secondDiode = src.indexOf("case 'diode':", diodeCase + 1);
  // Use the second occurrence (the render case, not terminal offsets)
  const renderIdx = secondDiode > 0 ? secondDiode : diodeCase;
  const block = src.slice(renderIdx, renderIdx + 1000);
  assert.ok(block.includes('<polygon'), 'diode SVG has triangle (polygon)');
  assert.ok(block.includes('cathode'), 'references cathode');
});

test('diode terminal offsets use anode/cathode (not a/b)', () => {
  const offsetSwitch = src.indexOf('function terminalOffsetsForPart');
  assert.ok(offsetSwitch > 0, 'terminalOffsetsForPart found');
  const offsetBlock = src.slice(offsetSwitch, offsetSwitch + 2000);
  // Find the diode case in the offset switch
  const diodeOffset = offsetBlock.indexOf("case 'diode':");
  assert.ok(diodeOffset > 0, 'diode has terminal offset case');
  const offsetLine = offsetBlock.slice(diodeOffset, diodeOffset + 200);
  assert.ok(offsetLine.includes('anode'), 'anode terminal offset defined');
  assert.ok(offsetLine.includes('cathode'), 'cathode terminal offset defined');
});

test('zener diode shares the diode render case and adds ticks', () => {
  const renderIdx = src.lastIndexOf("case 'diode':");
  const block = src.slice(renderIdx, renderIdx + 1000);
  assert.ok(block.includes("case 'zener':"), 'zener shares the diode render block');
  assert.ok(block.includes('isZener'), 'zener-specific rendering exists');
});
