/**
 * Warning chip: the count-badged findings chip must be in the toolbar,
 * and the bottom warning triangle must be gone from CircuitDesigner.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const canvas = readFileSync(join(here, '../src/components/BoardCanvas.jsx'), 'utf8');
const designer = readFileSync(join(here, '../src/components/CircuitDesigner.jsx'), 'utf8');

test('toolbar contains a data-warnings-chip button', () => {
  const toolbar = canvas.slice(canvas.indexOf('data-circuit-toolbar'));
  assert.ok(toolbar.includes('data-warnings-chip'), 'warnings chip in toolbar');
});

test('warnings chip shows count from drcWarnings', () => {
  const chip = canvas.slice(canvas.indexOf('data-warnings-chip'));
  assert.ok(chip.includes('drcWarnings.length'), 'chip count from drcWarnings');
});

test('warnings chip has a popover with findings listing', () => {
  assert.ok(canvas.includes('data-warnings-popover'), 'popover element exists');
  const popover = canvas.slice(canvas.indexOf('data-warnings-popover'));
  assert.ok(popover.includes('Circuit Check'), 'popover header says Circuit Check');
  assert.ok(popover.includes('w.explanation'), 'popover shows finding explanations');
});

test('warnings chip color: red for danger, amber for advisory', () => {
  // The chip is inside an IIFE; search the entire warnings-chip region
  const start = canvas.indexOf('Warning chip:');
  assert.ok(start > 0, 'warning chip region found');
  const chipBlock = canvas.slice(start, start + 2000);
  assert.ok(chipBlock.includes('#dc2626'), 'red color for danger');
  assert.ok(chipBlock.includes('#d97706'), 'amber color for advisory');
  assert.ok(chipBlock.includes('dangerCount'), 'danger count drives color');
});

test('bottom warning triangle removed from CircuitDesigner', () => {
  // The old bottom triangle had this exact pattern
  assert.ok(
    !designer.includes("fontSize: 20, lineHeight: 1, padding: '0 3px'}}>▲</button>"),
    'bottom triangle button is gone',
  );
  assert.ok(
    designer.includes('toolbar warning chip'),
    'comment references toolbar chip as replacement',
  );
});
