/**
 * THE SINGLE-RENDERER RULE for board-model jumper wires.
 *
 * BoardCanvas's jumper layer (data-jumper groups, staple routing, above
 * the parts) is the ONE renderer for breadboard hole wires. A second
 * straight-line renderer inside BreadboardView drew every jumper twice —
 * once bent, once straight. It was removed on 2026-08-16 and CAME BACK
 * in a rebase the same week ("each wire rendered TWICE", owner, twice).
 *
 * This test pins the rule at the source level so a resurrection fails
 * the suite instead of reaching a deploy: BreadboardView must not
 * contain a <line> element fed from model.wires, and must not mount
 * any component over the model's wire map.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const src = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../src/components/BreadboardView.jsx'),
  'utf8');

test('BreadboardView renders no jumper wires of its own', () => {
  assert.ok(!/<Jumpers\b/.test(src),
    'a <Jumpers .../> mount came back — BoardCanvas owns jumper rendering');
  assert.ok(!/model\.wires[\s\S]{0,400}<line\b/.test(src),
    'a straight-line renderer over model.wires came back');
});

test('the deliberate-absence comment survives (context for the next reader)', () => {
  assert.ok(src.includes('DELIBERATELY NOT RENDERED HERE'),
    'the explanation of WHY there is no jumper renderer here was dropped');
});
