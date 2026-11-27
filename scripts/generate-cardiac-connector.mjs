#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Original schematic artwork. No historic CARDIAC board artwork is reproduced.
import {readFileSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export function createCardiacConnectorAssets() {
  const w = 280, h = 260;
  const terminals = [
    {name: 'IN', x: 6, y: 142, functions: []},
    {name: 'OUT', x: 274, y: 142, functions: []},
    {name: '5v', x: 98, y: 254, functions: []},
    {name: 'gnd', x: 182, y: 254, functions: []},
  ];
  const sidecar = {kind: 'cardiac', w, h, terminals, variants: null, footprint: null,
    _note: 'Original CARDIAC plus Brickwright I/O adapter connector. The historical cardboard machine has no electrical pins. IN explicitly samples 0–5 V to a 000–999 card. OUT is 5 V only for output 001; every other output drives 0 V.'};
  const grid = Array.from({length: 100}, (_, i) =>
    `<rect x="${66 + i % 10 * 15}" y="${76 + Math.floor(i / 10) * 8}" width="12" height="5" rx="1" fill="${i === 0 ? '#d88a52' : '#e2dcc4'}"/>`).join('\n');
  const contacts = terminals.map(t => {
    const bottom = t.y === 254, left = t.x === 6;
    const color = t.name === 'gnd' ? '#cbd5e1' : '#f9db9a';
    return `<g data-terminal="${t.name}"><line x1="${t.x}" y1="${t.y}" x2="${bottom ? t.x : left ? 34 : 246}" y2="${bottom ? 235 : t.y}" stroke="#218a88" stroke-width="3"/>
<circle cx="${t.x}" cy="${t.y}" r="3" fill="#218a88"/>
<text x="${bottom ? t.x : left ? 45 : 235}" y="${bottom ? 233 : t.y - 7}" text-anchor="${bottom ? 'middle' : left ? 'start' : 'end'}" font-size="9" fill="${bottom ? color : '#145b61'}">${t.name}</text></g>`;
  }).join('\n');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="CARDIAC plus Brickwright I/O adapter circuit connector">
<rect x="34" y="10" width="212" height="190" rx="9" fill="#f6f0dc" stroke="#b7ab87" stroke-width="2"/>
<rect x="34" y="184" width="212" height="61" rx="8" fill="#155c62" stroke="#0b454c" stroke-width="2"/>
<g font-family="monospace" text-anchor="middle">
<text x="140" y="37" font-size="21" font-weight="bold" fill="#173d44">CARDIAC</text>
<text x="140" y="56" font-size="9" fill="#59645f">100 DECIMAL MEMORY CELLS</text>
${grid}
<text x="140" y="174" font-size="9" fill="#59645f">INPUT · COMPUTE · OUTPUT</text>
<text x="140" y="205" font-size="10" font-weight="bold" fill="#fff3d4">BRICKWRIGHT I/O ADAPTER</text>
<text x="140" y="220" font-size="8" fill="#d7e7df">SAMPLE IN · LATCH OUT</text>
${contacts}
</g></svg>\n`;
  return {sidecar, svg};
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const {sidecar, svg} = createCardiacConnectorAssets();
  for (const [name, data] of [['cardiac.json', `${JSON.stringify(sidecar, null, 2)}\n`], ['cardiac.svg', svg]]) {
    const file = new URL(`../src/parts-data/${name}`, import.meta.url);
    if (process.argv.includes('--check')) {
      if (readFileSync(file, 'utf8') !== data) throw new Error(`${name} differs from its original generator.`);
    } else writeFileSync(file, data);
  }
}
