// The generated parts-data/index.js is the ONLY sidecar source the browser
// bundle sees (via model/sidecar-loader.js -> SIDECARS). Node tests instead read
// the parts-data DIRECTORY with fs (test/_setup.js, scripts that boot the bench),
// so a part whose JSON is present but MISSING from the generated index registers
// fine in every node test and silently loses its terminals only in the browser —
// which is exactly how tang_nano_20k shipped with a 2-terminal ['a','b'] stub and
// broke the FPGA demo board's Tang wiring. This test closes that gap: it asserts
// the generated index references (and lists) every sidecar JSON in the directory.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(here, '../src/parts-data');
const indexSrc = readFileSync(path.join(dir, 'index.js'), 'utf8');

test('the generated index.js imports and lists every parts-data sidecar JSON', () => {
  const jsonFiles = readdirSync(dir).filter(f => f.endsWith('.json')).sort();
  // Map imported file -> its identifier, e.g. import s232 from './tang_nano_20k.json';
  const imports = new Map(
    [...indexSrc.matchAll(/import\s+(\w+)\s+from\s+'\.\/([^']+\.json)'/g)].map(m => [m[2], m[1]])
  );
  // The SIDECARS array identifiers.
  const arrMatch = indexSrc.match(/export const SIDECARS = \[([^\]]*)\]/);
  const listed = new Set((arrMatch ? arrMatch[1] : '').split(',').map(s => s.trim()).filter(Boolean));

  const notImported = jsonFiles.filter(f => !imports.has(f));
  const notListed = jsonFiles.filter(f => imports.has(f) && !listed.has(imports.get(f)));

  assert.deepEqual(notImported, [],
    'parts-data JSONs present in the directory but NOT imported by the generated index.js. '
    + 'Run scripts/sync-parts-data.mjs to regenerate it. Until then these parts register in '
    + 'node tests (which read the dir) but are absent from the browser bundle, so they lose '
    + 'their terminals at runtime (the tang_nano_20k regression).');
  assert.deepEqual(notListed, [],
    'parts-data JSONs imported but missing from the SIDECARS array — regenerate the index.');
  // The part this test was born for.
  assert.ok(imports.has('tang_nano_20k.json'),
    'tang_nano_20k.json must be registered in the generated index.js');
});
