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

// Load bw-parts sidecars into the parts registry (if available)
const here = path.dirname(fileURLToPath(import.meta.url));
const bwPartsDir = path.join(here, '../../bw-parts/parts');
if (existsSync(bwPartsDir)) {
  for (const f of readdirSync(bwPartsDir).filter(f => f.endsWith('.json'))) {
    try {
      const sc = JSON.parse(readFileSync(path.join(bwPartsDir, f), 'utf-8'));
      if (sc.kind && sc.terminals) registerSidecar(sc);
    } catch { /* skip malformed */ }
  }
}
