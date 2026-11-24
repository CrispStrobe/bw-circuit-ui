#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Build and server-render the actual React canvas without starting a browser.
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {resolve, dirname} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {build} from 'vite';
import react from '@vitejs/plugin-react';

const root = fileURLToPath(new URL('..', import.meta.url));
const outDir = resolve(root, 'node_modules/.cache/cp1-static-verification');
const entry = resolve(outDir, '../cp1-static-entry.mjs');
const source = `
  import React from 'react';
  import {renderToStaticMarkup} from 'react-dom/server';
  import {BoardImpl} from 'bw-board/board.js';
  import {inferNetlist, checkWiring} from 'bw-board/infer-netlist.js';
  import {getDevice} from 'bw-board/devices.js';
  import {registerAllDevices} from 'bw-board/register-all.js';
  import {setEngine} from ${JSON.stringify(resolve(root, 'src/engine.js'))};
  import {registerSidecar} from ${JSON.stringify(resolve(root, 'src/model/parts-registry.js'))};
  import {BoardCanvas} from ${JSON.stringify(resolve(root, 'src/components/BoardCanvas.jsx'))};
  import {PartPalette} from ${JSON.stringify(resolve(root, 'src/components/PartPalette.jsx'))};
  import {loadPartArt} from ${JSON.stringify(resolve(root, 'src/components/part-art-loader.js'))};
  import sidecar from ${JSON.stringify(resolve(root, 'src/parts-data/kosmos-cp1.json'))};
  registerAllDevices();
  setEngine({BoardImpl, inferNetlist, checkWiring, getDevice});
  registerSidecar(sidecar);
  export async function render(rotation, flipped) {
    const url = await loadPartArt('kosmos-cp1');
    const computer = {id: 'computer', kind: 'kosmos-cp1', x: 250, y: 250,
      rotation, flipped, terminals: sidecar.terminals.map(t => t.name),
      params: {expansion: true, clockHz: 6000000}};
    const canvas = renderToStaticMarkup(React.createElement(BoardCanvas, {
      parts: [computer], wires: [], mode: 'wire', selectedParts: new Set(['computer']),
      ledBrightness: {}, buzzerTones: {}, nodeVoltages: {}, warnings: [],
      deviceStates: {}, drcWarnings: [], annotations: [],
    }));
    const palette = renderToStaticMarkup(React.createElement(PartPalette, {onAddPart() {}}));
    return {url, canvas, palette};
  }
`;
mkdirSync(dirname(entry), {recursive: true});
writeFileSync(entry, source);
await build({root, configFile: false, logLevel: 'error', plugins: [react()],
ssr: {noExternal: ['@wokwi/elements']},
build: {ssr: entry, outDir, emptyOutDir: true,
  rolldownOptions: {output: {entryFileNames: 'render.mjs'}}}});
const {render} = await import(pathToFileURL(resolve(outDir, 'render.mjs')).href);
const sidecar = JSON.parse(readFileSync(new URL('../src/parts-data/kosmos-cp1.json', import.meta.url), 'utf8'));
let checked = 0;
for (const rotation of [0, 90, 180, 270]) {
  for (const flipped of [false, true]) {
    const {url, canvas, palette} = await render(rotation, flipped);
    assert.ok(url, 'hyphenated CP1 art must resolve through the real lazy loader');
    assert.match(canvas, /data-art-face="kosmos-cp1"[^>]*data-art-loaded="true"/);
    assert.match(canvas, /<image[^>]*x="-150"[^>]*y="-200"[^>]*width="300"[^>]*height="400"/);
    for (const terminal of sidecar.terminals) {
      const name = terminal.name.replace('.', '\\.');
      const match = canvas.match(new RegExp(`data-terminal-dot="computer:${name}"[^]*?<circle[^>]*cx="([^"]+)"[^>]*cy="([^"]+)"`));
      assert.ok(match, `visible terminal ${terminal.name}`);
      const x = (terminal.x - 150) * (flipped ? -1 : 1), y = terminal.y - 200;
      const theta = rotation * Math.PI / 180;
      const expectedX = 250 + x * Math.cos(theta) - y * Math.sin(theta);
      const expectedY = 250 + x * Math.sin(theta) + y * Math.cos(theta);
      assert.ok(Math.abs(+match[1] - expectedX) < 1e-6 && Math.abs(+match[2] - expectedY) < 1e-6,
        `${terminal.name} follows the art at rotation ${rotation}, flipped ${flipped}`);
    }
    assert.match(palette, /aria-label="Kosmos CP1"/);
    assert.match(palette, /aria-label="Kosmos CP1 \+ CP3"/);
    checked++;
  }
}
console.log(`CP1 static verification: ${checked} orientations, 40 contacts each; art loading and both palette entries passed.`);
