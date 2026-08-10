/**
 * Test setup — inject the engine from the local bw-board copy.
 *
 * Every test file must import this before importing any model module.
 */

import { setEngine } from '../src/engine.js';
import { BoardImpl } from '../../bw-board/src/board.js';
import { inferNetlist, checkWiring } from '../../bw-board/src/infer-netlist.js';
import { getMaxCurrent, PORT_LIMITS } from '../../bw-board/src/current-ratings.js';
import { registerSidecar } from '../src/model/parts-registry.js';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

setEngine({ BoardImpl, inferNetlist, checkWiring, getMaxCurrent, PORT_LIMITS });

// Load sidecars into the parts registry.
// Prefer vendored copies (src/parts-data/) — same data, no sibling dependency.
// Fall back to bw-parts checkout if vendored dir is empty/missing.
const here = path.dirname(fileURLToPath(import.meta.url));
const vendoredDir = path.join(here, '../src/parts-data');
const bwPartsDir = path.join(here, '../../bw-parts/parts');
const dataDir = existsSync(vendoredDir) && readdirSync(vendoredDir).some(f => f.endsWith('.json'))
  ? vendoredDir : bwPartsDir;
if (existsSync(dataDir)) {
  for (const f of readdirSync(dataDir).filter(f => f.endsWith('.json'))) {
    try {
      const sc = JSON.parse(readFileSync(path.join(dataDir, f), 'utf-8'));
      if (sc.kind && sc.terminals) registerSidecar(sc);
    } catch { /* skip malformed */ }
  }
}
