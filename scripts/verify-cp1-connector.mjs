#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Real-browser companion to verify-cp1-static.mjs. No vendor ROM is used.
// Run: npm run verify:cp1:browser
// Optionally set BW_CHROMIUM_EXECUTABLE to an installed Chromium binary.
import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';
import {createCp1ConnectorAssets} from './generate-cp1-connector.mjs';

const base = process.argv[2];
assert.ok(base, 'Pass the URL of this checkout’s dev harness (serve-and-verify.mjs does this).');
const output = path.resolve(process.env.BW_CP1_BROWSER_OUT || 'test-results/cp1-connector-browser');
await mkdir(output, {recursive: true});
let browser, page;
const pageErrors = [];
const checks = [];
const {sidecar} = createCp1ConnectorAssets();
const fixture = (rotation = 0, flipped = false) => ({vcc: 5, fileOnly: true, parts: [{
  id: 'computer', kind: 'kosmos-cp1', x: 350, y: 250, rotation, flipped,
  params: {expansion: true, clockHz: 6000000}, terminals: sidecar.terminals.map(t => t.name),
}], wires: [], holeWires: []});
try {
  browser = await chromium.launch({headless: true,
    ...(process.env.BW_CHROMIUM_EXECUTABLE ? {executablePath: process.env.BW_CHROMIUM_EXECUTABLE} : {})});
  page = await browser.newPage({viewport: {width: 1400, height: 960}});
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(`${base}/?examples=none&nopins`, {waitUntil: 'networkidle'});
  await page.waitForFunction(() => typeof window.__setCircuitData === 'function');
  assert.equal(await page.getByRole('button', {name: 'Kosmos CP1', exact: true}).count(), 1);
  assert.equal(await page.getByRole('button', {name: 'Kosmos CP1 + CP3', exact: true}).count(), 1);
  checks.push('base and CP3 palette entries');
  for (const rotation of [0, 90, 180, 270]) {
    for (const flipped of [false, true]) {
      await page.evaluate(data => window.__setCircuitData(data), fixture(rotation, flipped));
      await page.waitForSelector('[data-canvas] [data-part-id="computer"][data-art-loaded="true"]');
      await page.waitForFunction(({rotation, flipped}) => {
        const p = window.__circuit?.parts.find(p => p.id === 'computer');
        return p?.rotation === rotation && !!p.flipped === flipped;
      }, {rotation, flipped});
      // Dense connectors reveal their wire targets when selected.
      await page.locator('[data-canvas] [data-part-id="computer"]').click();
      await page.waitForSelector('[data-canvas] [data-terminal-dot="computer:P1.0"]');
      const errors = await page.evaluate(async terminals => {
        const face = document.querySelector('[data-canvas] [data-part-id="computer"]');
        const image = face.querySelector('image');
        const art = new DOMParser().parseFromString(await (await fetch(image.getAttribute('href'))).text(), 'image/svg+xml');
        const failures = [];
        for (const t of terminals) {
          const contact = art.querySelector(`[data-terminal="${t.name}"] circle`);
          const dot = document.querySelector(`[data-canvas] [data-terminal-dot="computer:${t.name}"] circle`);
          if (!contact || !dot) { failures.push(`Missing ${t.name}`); continue; }
          const drawn = new DOMPoint(+image.getAttribute('x') + +contact.getAttribute('cx'),
            +image.getAttribute('y') + +contact.getAttribute('cy')).matrixTransform(face.getCTM());
          const wired = new DOMPoint(+dot.getAttribute('cx'), +dot.getAttribute('cy')).matrixTransform(dot.getCTM());
          if (Math.hypot(drawn.x - wired.x, drawn.y - wired.y) > 0.01) failures.push(`Displaced ${t.name}`);
        }
        return failures;
      }, sidecar.terminals);
      assert.deepEqual(errors, [], `rotation ${rotation}, flipped ${flipped}`);
      checks.push(`40 contacts: rotation ${rotation}, flipped ${flipped}`);
      if (rotation === 0 && !flipped) {
        await page.screenshot({path: path.join(output, 'connector-desktop.png'), fullPage: true});
      }
    }
  }
  await page.evaluate(() => {
    window.__cp1Build = null; window.__cp1Media = [];
    window.addEventListener('bw-machine-extracted', event => { window.__cp1Build = event.detail; });
    window.addEventListener('bw-machine-media-load', event => { window.__cp1Media.push({
      kind: event.detail.kind, slotId: event.detail.slotId, length: event.detail.bytes.length,
      first: event.detail.bytes[0], name: event.detail.name,
    }); });
  });
  await page.getByRole('button', {name: 'Machine bench help', exact: true}).click();
  const help = page.getByRole('dialog', {name: 'Machine bench', exact: true});
  await help.waitFor();
  assert.match(await help.innerText(), /built-in monitor/);
  await help.getByRole('button', {name: 'Close', exact: true}).click();
  checks.push('compact machine bench help describes the bundled CP1 monitor');
  await page.locator('[data-build-machine]').getByRole('button', {name: /Build Machine$/}).click();
  await page.waitForFunction(() => window.__cp1Build?.kind === 'cp1');
  assert.deepEqual(await page.evaluate(() => window.__cp1Build),
    {kind: 'cp1', config: {partId: 'computer', expansion: true, clockHz: 6000000}});
  checks.push('Build Machine configuration handoff');
  assert.equal(await page.locator('[data-build-machine] [data-testid^="bw-machine-preset-"]').count(), 0,
    'CP1 firmware overrides use the custom ROM input');
  assert.equal(await page.locator('[data-build-machine] details').filter({hasText: 'Open custom ROM'}).getAttribute('open'), null,
    'the custom ROM override stays collapsed until requested');
  await page.getByText('Open custom ROM', {exact: true}).click();
  const upload = page.getByTestId('bw-machine-load-file');
  await upload.setInputFiles({name: 'wrong-size.bin', mimeType: 'application/octet-stream', buffer: Buffer.alloc(17)});
  await page.waitForFunction(() => document.querySelector('[data-loader-note]')?.textContent.includes('exactly 2048'));
  assert.equal(await page.evaluate(() => window.__cp1Media.length), 0);
  checks.push('wrong-size ROM refusal');
  const rom = Buffer.alloc(2048); rom[0] = 0x04; // Authored JMP 0, never a vendor ROM.
  await upload.setInputFiles({name: 'authored-test.rom', mimeType: 'application/octet-stream', buffer: rom});
  await page.waitForFunction(() => window.__cp1Media.length === 1);
  assert.deepEqual(await page.evaluate(() => window.__cp1Media[0]),
    {kind: 'cp1', slotId: 'rom', length: 2048, first: 4, name: 'authored-test.rom'});
  checks.push('original synthetic ROM import');
  assert.deepEqual(pageErrors, []);
  const result = {status: 'passed', browser: browser.version(), checks,
    scope: 'Actual CircuitDesigner connector interactions; no historical firmware or full Lite application',
    fullApplicationBuild: false};
  await writeFile(path.join(output, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result));
} catch (error) {
  if (page && !page.isClosed()) {
    await page.screenshot({path: path.join(output, 'failure.png'), fullPage: true}).catch(() => {});
  }
  await writeFile(path.join(output, 'result.json'), `${JSON.stringify({status: 'failed',
    message: error.message, browserErrors: pageErrors, completedChecks: checks,
    fullApplicationBuild: false}, null, 2)}\n`);
  throw error;
} finally {
  if (browser) await browser.close();
}
