/**
 * SEVENSEG8 face: 8-digit 2×4 common-cathode 7-segment display must
 * render each digit's segments from device state, with terminal offsets
 * and deviceStates whitelist entry.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const boardSrc = readFileSync(join(here, '../src/components/BoardCanvas.jsx'), 'utf8');

test('sevenseg8 has a render case in SvgParts', () => {
  const svgParts = boardSrc.indexOf('function SvgParts');
  assert.ok(svgParts > 0, 'SvgParts function found');
  const block = boardSrc.slice(svgParts, boardSrc.indexOf('function WokwiParts'));
  assert.ok(block.includes("case 'sevenseg8':"), 'sevenseg8 has a render case');
});

test('sevenseg8 face renders 8 digits in a 2×4 grid', () => {
  const caseStart = boardSrc.indexOf('SEVENSEG8: 8-digit 2×4');
  assert.ok(caseStart > 0, 'sevenseg8 render case comment found');
  const block = boardSrc.slice(caseStart, caseStart + 4000);
  // Should iterate over 8 digits
  assert.ok(block.includes('length: 8'), 'creates 8 digit elements');
  // 2 rows × 4 columns layout
  assert.ok(block.includes('cols = 4'), '4 columns');
  assert.ok(block.includes('rows = 2'), '2 rows');
});

test('sevenseg8 face reads per-digit segments from device state', () => {
  const caseStart = boardSrc.indexOf('SEVENSEG8: 8-digit 2×4');
  const block = boardSrc.slice(caseStart, caseStart + 4000);
  assert.ok(block.includes('deviceStates'), 'reads from deviceStates');
  assert.ok(block.includes('ds.digits'), 'reads digits array from device state');
});

test('sevenseg8 face renders 7 segments + decimal point per digit', () => {
  const caseStart = boardSrc.indexOf('SEVENSEG8: 8-digit 2×4');
  const block = boardSrc.slice(caseStart, caseStart + 4000);
  // 7 segment rectangles from segDefs
  assert.ok(block.includes('segDefs'), 'uses segDefs for segment geometry');
  assert.ok(block.includes('segDefs.map'), 'iterates over segment definitions');
  // Decimal point circle
  assert.ok(block.includes('circle'), 'renders decimal point as circle');
  // Bit 7 = dp
  assert.ok(block.includes('seg >> 7'), 'reads bit 7 for decimal point');
});

test('sevenseg8 face uses lit/unlit segment colors', () => {
  const caseStart = boardSrc.indexOf('SEVENSEG8: 8-digit 2×4');
  const block = boardSrc.slice(caseStart, caseStart + 4000);
  assert.ok(block.includes('#ff3030'), 'lit segment color present');
  assert.ok(block.includes('#1a0000'), 'unlit segment color present');
});

test('sevenseg8 is included in the SvgParts deviceStates gathering', () => {
  const gatherer = boardSrc.slice(boardSrc.indexOf('<SvgParts'));
  assert.ok(gatherer.includes("p.kind === 'sevenseg8'"), 'sevenseg8 in deviceStates filter');
});

test('sevenseg8 has terminal offsets for all 13 pins', () => {
  const offsets = boardSrc.slice(
    boardSrc.indexOf('function terminalOffsetsForPart'),
    boardSrc.indexOf('function terminalOffsetsForPart') + 5000,
  );
  assert.ok(offsets.includes("case 'sevenseg8':"), 'sevenseg8 in terminal offsets switch');
  for (const pin of ['vcc', 'gnd', 'seg_a', 'seg_b', 'seg_c', 'seg_d',
                      'seg_e', 'seg_f', 'seg_g', 'seg_dp',
                      'sel_a', 'sel_b', 'sel_c']) {
    assert.ok(offsets.includes(pin), `terminal offset for ${pin} defined`);
  }
});

test('sevenseg8 segment bit mapping matches a2-displays.js spec', () => {
  const caseStart = boardSrc.indexOf('SEVENSEG8: 8-digit 2×4');
  const block = boardSrc.slice(caseStart, caseStart + 4000);
  // The segDefs array should have 7 entries (a-g), indexed 0-6
  // Segment bits: 0=a, 1=b, 2=c, 3=d, 4=e, 5=f, 6=g
  // The code uses (seg >> si) & 1 where si is the segDefs index
  assert.ok(block.includes('(seg >> si) & 1'), 'uses bit index matching segDefs order');
  // Verify segDefs has entries for a through g
  const segComments = ['/* a */', '/* b */', '/* c */', '/* d */', '/* e */', '/* f */', '/* g */'];
  for (const c of segComments) {
    assert.ok(block.includes(c), `segment ${c} defined in segDefs`);
  }
});
