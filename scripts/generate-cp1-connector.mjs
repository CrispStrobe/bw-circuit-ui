#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Original schematic abstraction, not a reproduction of Kosmos product art.
import {writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

/** One coordinate source for the drawn contacts and the canvas wire anchors. */
export function createCp1ConnectorAssets() {
  const w = 300, h = 400;
  const terminals = [];
  for (let port = 1; port <= 5; port++) {
    for (let bit = 0; bit < (port === 5 ? 6 : 8); bit++) {
      const x = port === 5 ? 154 + bit * 24 : port <= 2 ? 6 : 294;
      const y = port === 5 ? 394 : (port === 1 || port === 3 ? 64 : 218) + bit * 14;
      terminals.push({name: `P${port}.${bit}`, x, y, functions: []});
    }
  }
  terminals.push({name: '5v', x: 44, y: 394, functions: []},
    {name: 'gnd', x: 92, y: 394, functions: []});
  const sidecar = {kind: 'kosmos-cp1', w, h, terminals, variants: null, footprint: null,
    _note: 'Original system-connector schematic abstraction; not product artwork. P3/P4/P5 require CP3. Pin .0 corresponds to physical contact 1.'};
  const contacts = terminals.map(t => {
    const bottom = t.y === 394;
    const left = t.x === 6;
    const colour = t.name === '5v' ? '#e88d76' : t.name === 'gnd' ? '#b2b8c4'
      : /^P[345]\./.test(t.name) ? '#7bb4d3' : '#e4a138';
    const labelX = bottom ? t.x : left ? 20 : 280;
    const labelY = bottom ? 378 : t.y + 3;
    return `<g data-terminal="${t.name}"><line x1="${t.x}" y1="${t.y}" x2="${bottom ? t.x : left ? 16 : 284}" y2="${bottom ? 382 : t.y}" stroke="${colour}" stroke-width="2"/>
<circle cx="${t.x}" cy="${t.y}" r="3" fill="${colour}"/>
<text x="${labelX}" y="${labelY}" text-anchor="${bottom ? 'middle' : left ? 'start' : 'end'}" font-size="9" fill="${colour}">${t.name}</text></g>`;
  }).join('\n');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="Kosmos CP1 system connector">
<rect x="12" y="12" width="276" height="376" rx="10" fill="#252a35" stroke="#e4a138" stroke-width="2"/>
<g fill="#edf0f5" font-family="monospace">
<text x="150" y="32" text-anchor="middle" font-size="9" fill="#abb3c2">Pin .0 = physical contact 1</text>
<text x="20" y="49" font-size="9" fill="#e4a138">PORT 1</text>
<text x="280" y="49" text-anchor="end" font-size="9" fill="#7bb4d3">CP3 / PORT 3</text>
<text x="20" y="203" font-size="9" fill="#e4a138">PORT 2</text>
<text x="280" y="203" text-anchor="end" font-size="9" fill="#7bb4d3">CP3 / PORT 4</text>
${contacts}
<text x="150" y="118" text-anchor="middle" font-size="18">KOSMOS</text>
<text x="150" y="155" text-anchor="middle" font-size="32" font-weight="bold">CP1</text>
<text x="150" y="178" text-anchor="middle" font-size="9" fill="#c8d0de">SYSTEM CONNECTOR</text>
<line x1="80" y1="191" x2="220" y2="191" stroke="#596171"/>
<text x="150" y="219" text-anchor="middle" font-size="10">8049 / 8155</text>
<text x="150" y="241" text-anchor="middle" font-size="9" fill="#c8d0de">Firmware-controlled I/O</text>
<text x="150" y="273" text-anchor="middle" font-size="9" fill="#7bb4d3">Blue contacts need CP3</text>
<text x="210" y="351" text-anchor="middle" font-size="9" fill="#7bb4d3">CP3 / PORT 5</text>
<text x="68" y="351" text-anchor="middle" font-size="9" fill="#c8d0de">SUPPLY</text>
</g></svg>\n`;
  return {sidecar, svg};
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const {sidecar, svg} = createCp1ConnectorAssets();
  writeFileSync(new URL('../src/parts-data/kosmos-cp1.json', import.meta.url), `${JSON.stringify(sidecar, null, 2)}\n`);
  writeFileSync(new URL('../src/parts-data/kosmos-cp1.svg', import.meta.url), svg);
}
