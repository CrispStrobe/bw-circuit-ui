/**
 * Regenerate the board rendering baseline(s).
 *
 * Usage: node scripts/render-board.mjs
 * Writes test/docs/board-baselines/mini.svg from the mini fixture.
 * LOOK at the output in a browser before committing — a baseline updated
 * without being looked at converts a visible regression into a committed
 * one (the schematic baselines' rule, verbatim).
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { importEasyEdaPcb } from '../src/importers/easyeda-pcb.js';
import { renderBoardSvg } from '../src/model/board-svg.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = join(here, '..', 'test', 'fixtures', 'easyeda-pcb-mini.json');
const outDir = join(here, '..', 'test', 'docs', 'board-baselines');
mkdirSync(outDir, { recursive: true });
const svg = renderBoardSvg(importEasyEdaPcb(readFileSync(fixture, 'utf8')));
const out = join(outDir, 'mini.svg');
writeFileSync(out, svg);
console.log(`wrote ${out} (${svg.length} bytes) — open it and LOOK before committing.`);
