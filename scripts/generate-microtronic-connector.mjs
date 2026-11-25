#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Original functional panel abstraction. No product or manual artwork is reproduced.
import {writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {MICROTRONIC_KEY_ROWS} from '../src/model/microtronic-controls.js';

export function createMicrotronicConnectorAssets() {
  const w = 260, h = 300;
  const terminals = [
    ...Array.from({length: 4}, (_, i) => ({name: `IN${i + 1}`, x: 6, y: 90 + i * 42, functions: []})),
    ...Array.from({length: 4}, (_, i) => ({name: `OUT${i + 1}`, x: 254, y: 90 + i * 42, functions: []})),
    {name: 'CLOCK', x: 64, y: 294, functions: []},
    {name: '5v', x: 130, y: 294, functions: []},
    {name: 'gnd', x: 196, y: 294, functions: []},
  ];
  const sidecar = {kind: 'busch-microtronic', w, h, terminals, variants: null, footprint: null,
    _note: 'Original whole-system connector abstraction. Live program, display and keys are in the Microtronic controls. Behavioral teaching-machine model; TMS1600 firmware execution is not included.'};
  const contacts = terminals.map(t => {
    const bottom = t.y === 294, left = t.x === 6;
    const color = t.name.startsWith('IN') ? '#67e8f9' : t.name.startsWith('OUT') ? '#fdba74'
      : t.name === 'CLOCK' ? '#c4b5fd' : t.name === '5v' ? '#fca5a5' : '#cbd5e1';
    return `<g data-terminal="${t.name}"><line x1="${t.x}" y1="${t.y}" x2="${bottom ? t.x : left ? 16 : 244}" y2="${bottom ? 281 : t.y}" stroke="${color}" stroke-width="2"/>
<circle cx="${t.x}" cy="${t.y}" r="3" fill="${color}"/>
<text x="${bottom ? t.x : left ? 18 : 242}" y="${bottom ? 277 : t.y + 3}" text-anchor="${bottom ? 'middle' : left ? 'start' : 'end'}" font-size="8" fill="${color}">${t.name}</text></g>`;
  }).join('\n');
  const keys = MICROTRONIC_KEY_ROWS.flat().map((key, index) => {
    const x = 58 + index % 6 * 24, y = 130 + Math.floor(index / 6) * 23;
    return `<rect x="${x}" y="${y}" width="21" height="18" rx="3" fill="#334155" stroke="#64748b"/><text x="${x + 10.5}" y="${y + 12}" text-anchor="middle" font-size="${key.length > 1 ? 5.5 : 9}">${key}</text>`;
  }).join('\n');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="Busch Microtronic 2090 circuit connector">
<rect x="12" y="12" width="236" height="276" rx="12" fill="#202735" stroke="#f59e0b" stroke-width="2"/>
<g font-family="monospace" fill="#f8fafc">
<text x="130" y="37" text-anchor="middle" font-size="11" fill="#fdba74">BUSCH</text>
<text x="130" y="58" text-anchor="middle" font-size="17" font-weight="bold">MICROTRONIC</text>
<text x="130" y="73" text-anchor="middle" font-size="9" fill="#cbd5e1">2090 · 4-BIT COMPUTER</text>
<rect x="66" y="86" width="128" height="31" rx="4" fill="#0b111c" stroke="#475569"/>
<text x="130" y="106" text-anchor="middle" font-size="9" fill="#94a3b8">6-DIGIT DISPLAY</text>
${keys}
<text x="130" y="239" text-anchor="middle" font-size="9" fill="#fdba74">PROGRAM · RUN · STEP</text>
<text x="130" y="255" text-anchor="middle" font-size="8" fill="#cbd5e1">Open Microtronic controls</text>
${contacts}
</g></svg>\n`;
  return {sidecar, svg};
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const {sidecar, svg} = createMicrotronicConnectorAssets();
  writeFileSync(new URL('../src/parts-data/busch-microtronic.json', import.meta.url), `${JSON.stringify(sidecar, null, 2)}\n`);
  writeFileSync(new URL('../src/parts-data/busch-microtronic.svg', import.meta.url), svg);
}
