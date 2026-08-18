/**
 * ILI9341 TFT face: renders live pixels from getDeviceState GRAM,
 * and all three variants (SPI, 8080 parallel) share the same face.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '../src/components/BoardCanvas.jsx'), 'utf8');

test('ili9341 render case reads GRAM from deviceStates', () => {
  const caseStart = src.indexOf("ILI9341 TFT display");
  assert.ok(caseStart > 0, 'ILI9341 render section found');
  const block = src.slice(caseStart, caseStart + 2000);
  assert.ok(block.includes('ds.gram'), 'reads GRAM from device state');
  assert.ok(block.includes('RGB565'), 'converts RGB565 to RGBA');
  assert.ok(block.includes('putImageData'), 'paints pixels on canvas');
});

test('ili9341 face respects sleeping and displayOn flags', () => {
  const caseStart = src.indexOf("ILI9341 TFT display");
  const block = src.slice(caseStart, caseStart + 2000);
  assert.ok(block.includes('ds.sleeping'), 'reads sleeping flag');
  assert.ok(block.includes('ds.displayOn') || block.includes('displayOn'), 'reads displayOn flag');
});

test('all three ili9341 variants share the same render case', () => {
  const caseStart = src.indexOf("ILI9341 TFT display");
  const block = src.slice(caseStart, caseStart + 300);
  assert.ok(block.includes("case 'ili9341':"), 'SPI variant');
  assert.ok(block.includes("case 'ili9341_par':"), '8080 parallel variant');
  assert.ok(block.includes("case 'ili9341_parallel':"), 'parallel alias variant');
});

test('all ili9341 variants in deviceStates gathering', () => {
  const gatherer = src.slice(src.indexOf('<SvgParts'));
  assert.ok(gatherer.includes("p.kind === 'ili9341'"), 'ili9341 in deviceStates');
  assert.ok(gatherer.includes("p.kind === 'ili9341_par'"), 'ili9341_par in deviceStates');
  assert.ok(gatherer.includes("p.kind === 'ili9341_parallel'"), 'ili9341_parallel in deviceStates');
});

test('parallel variants have terminal offsets', () => {
  const offsets = src.slice(
    src.indexOf('function terminalOffsetsForPart'),
    src.indexOf('function terminalOffsetsForPart') + 5000,
  );
  assert.ok(offsets.includes("case 'ili9341_par':"), 'ili9341_par in offsets');
  assert.ok(offsets.includes("'wr'"), 'WR pin defined (parallel-specific)');
  assert.ok(offsets.includes("'d0'"), 'D0 data bus pin defined');
});
