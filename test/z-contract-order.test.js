/**
 * THE Z CONTRACT: boards → parts → wires (owner spec, stated twice).
 *
 * SVG paints in document order, so the contract is exactly the JSX mount
 * order in BoardCanvas. The first enforcement of this order died
 * UNCOMMITTED in a working tree and never shipped — the owner kept
 * seeing wires under chips while the fix "existed". This test pins the
 * order at source level: if a refactor moves a layer, the suite fails
 * instead of a deploy lying.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const src = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../src/components/BoardCanvas.jsx'),
  'utf8');

test('mount order: substrate < chip bodies < wokwi parts < wire layers', () => {
  const at = (needle) => {
    const i = src.indexOf(needle);
    assert.ok(i >= 0, `anchor not found: ${needle}`);
    return i;
  };
  const substrate = at('<BreadboardView key={bb.id}');
  const svgParts = at('<SvgParts parts={parts}');
  const wokwi = at('<WokwiParts');
  const wires = at('<Wires wires={wires}');
  const jumpers = at('{/* Jumper wires.');
  assert.ok(substrate < svgParts, 'boards must paint before chip bodies');
  assert.ok(svgParts < wokwi, 'chip bodies before wokwi parts');
  assert.ok(wokwi < wires, 'WIRES must paint after ALL parts (z contract)');
  assert.ok(wokwi < jumpers, 'JUMPERS must paint after ALL parts (z contract)');
});
