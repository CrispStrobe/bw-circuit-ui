/**
 * MATRIX8X8 face: per-pixel 4-level brightness rendering from bw-board's
 * quantized levels surface. The face must read ds.levels (0..MATRIX_LEVELS)
 * and render graded brightness per dot, with on/off as the 0/MAX cases.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const boardSrc = readFileSync(join(here, '../src/components/BoardCanvas.jsx'), 'utf8');

// Extract the matrix render case block
const caseStart = boardSrc.indexOf('NxM LED matrix display');
const caseBlock = boardSrc.slice(caseStart, caseStart + 5000);

test('matrix face reads quantized levels from device state', () => {
  assert.ok(caseBlock.includes('ds?.levels'), 'reads levels from device state');
  assert.ok(caseBlock.includes('levels[i]'), 'indexes into levels array per pixel');
});

test('matrix face normalises levels by MATRIX_LEVELS (3)', () => {
  // levels[i] / 3 maps 0→0, 1→0.33, 2→0.67, 3→1.0
  assert.ok(caseBlock.includes('levels[i] / 3'), 'divides by MATRIX_LEVELS=3');
});

test('matrix face falls back to brightness + ledDisplayLevel', () => {
  assert.ok(caseBlock.includes('ledDisplayLevel'), 'uses ledDisplayLevel for fallback');
  assert.ok(caseBlock.includes('br ? br[i]'), 'reads from brightness array');
});

test('matrix face uses two-path brightness (levels preferred over continuous)', () => {
  // The levels path should be checked first (preferred);
  // search for the actual call, not the comment mention.
  const loopStart = caseBlock.indexOf('Array.from');
  const loopBlock = caseBlock.slice(loopStart);
  const levelsIdx = loopBlock.indexOf('if (levels)');
  // Find the ledDisplayLevel *call* (with parenthesis), not the comment
  const brIdx = loopBlock.indexOf('ledDisplayLevel(');
  assert.ok(levelsIdx > 0, 'levels path exists');
  assert.ok(brIdx > levelsIdx, 'brightness fallback comes after levels check');
});

test('graded brightness maps to visible color differences', () => {
  // The color formula: rgba(255, round(40+140*v), round(30*v), min(1, 0.25+0.75*v))
  // Level 0 (v=0) → '#1a0000' (off)
  // Level 1 (v=0.33) → visible dim red
  // Level 2 (v=0.67) → brighter red
  // Level 3 (v=1.0) → full bright
  assert.ok(caseBlock.includes('#1a0000'), 'off-state dark color');
  assert.ok(caseBlock.includes('v > 0.05'), 'threshold separates off from lit');
  assert.ok(caseBlock.includes('40 + 140 * v'), 'green channel scales with brightness');
  assert.ok(caseBlock.includes('30 * v'), 'blue channel scales with brightness');
  assert.ok(caseBlock.includes('0.25 + 0.75 * v'), 'alpha scales with brightness');
});

test('on/off are the 0 and MAX cases of the level path', () => {
  // Level 0: v = 0/3 = 0 → v > 0.05 is false → '#1a0000' (off)
  // Level 3: v = 3/3 = 1 → full brightness (on)
  // No separate on/off logic — it's all via the level normalisation
  const levelsPath = caseBlock.slice(
    caseBlock.indexOf('if (levels)'),
    caseBlock.indexOf('ledDisplayLevel'),
  );
  // The path just divides by 3 — no special-casing for 0 or 3
  assert.ok(!levelsPath.includes('=== 0') && !levelsPath.includes('=== 3'),
    'no special-case for off/full — they are natural 0/MAX of the normalisation');
});

test('matrix face comment documents both brightness paths', () => {
  assert.ok(caseBlock.includes('Path A'), 'documents Path A (levels)');
  assert.ok(caseBlock.includes('Path B'), 'documents Path B (continuous)');
  assert.ok(caseBlock.includes('MATRIX_LEVELS'), 'mentions MATRIX_LEVELS constant');
});
