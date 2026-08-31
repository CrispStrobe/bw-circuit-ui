/** Real artifact proof for host circuit exports in every circuit view. */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { startDevServer } from './_dev-server.js';

let server;
let browser;
let page;
const errors = [];

async function bytesOf(download) {
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function exportSpice() {
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('bw-circuit-file', {
    detail: { action: 'export' },
  })));
  const picker = page.locator('[data-host-file-command]');
  await picker.waitFor({ state: 'visible' });
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 5000 }),
    picker.getByRole('button', { name: /SPICE deck/ }).click(),
  ]);
  assert.equal(download.suggestedFilename(), 'circuit.cir');
  return bytesOf(download);
}

before(async () => {
  server = await startDevServer('export-views');
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1400, height: 850 }, acceptDownloads: true });
  page.on('pageerror', error => errors.push(String(error)));
});

after(async () => {
  if (browser) await browser.close();
  if (server) server.stop();
});

describe('host export is independent of circuit view', () => {
  it('downloads identical circuit bytes in Realistic, Schematic and Board exactly once', async () => {
    await page.goto(`${server.url}/?examples=none`, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: /04 Brightness/ }).click();

    let downloads = 0;
    page.on('download', () => { downloads += 1; });
    const artifacts = [];
    for (const view of ['Realistic view', 'Schematic view', 'Board view']) {
      if (view !== 'Realistic view') {
        await page.getByLabel(view, { exact: true }).first().click();
      }
      artifacts.push(await exportSpice());
    }
    await page.waitForTimeout(250);

    assert.equal(downloads, 3, 'one host command must produce exactly one download in each view');
    assert.ok(artifacts[0].length > 80, 'the proof validates artifact bytes, not menu text');
    assert.match(artifacts[0].toString('utf8'), /^\* BrickWright/m);
    const hashes = artifacts.map(bytes => createHash('sha256').update(bytes).digest('hex'));
    assert.deepEqual(hashes, [hashes[0], hashes[0], hashes[0]],
      'view state must not alter the circuit document');
    assert.deepEqual(errors, [], `zero page errors required: ${errors.join('; ')}`);
  });
});
