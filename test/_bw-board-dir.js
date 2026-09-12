/**
 * Where the engine's checkout lives, for tests that READ files from it
 * (contract scans, oracles) rather than import modules.
 *
 * Default: the installed `bw-board` package — the same tree the imports
 * resolve to, so a scan and an import cannot disagree about which engine
 * is under test. `BW_BOARD=/path/to/checkout` overrides it for live work
 * against a sibling checkout (pair it with `npm install /path/to/checkout`
 * so the imports move too).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const BWB = process.env.BW_BOARD
  || path.dirname(fileURLToPath(import.meta.resolve('bw-board/package.json')));
