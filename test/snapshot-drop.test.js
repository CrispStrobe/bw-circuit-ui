/**
 * VdpScreen snapshot drop-zone — Playwright acceptance test.
 *
 * Verifies that dragging .sna and .z80 files onto the VdpScreen
 * calls loadSnapshotFn with the file contents.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { writeFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
let chromium, browser, server;
try { ({ chromium } = await import('playwright')); } catch {}

const PORT = 3192;

describe('VdpScreen snapshot drop-zone', { skip: !chromium && 'playwright not available' }, () => {
  before(async () => {
    server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
      stdio: 'ignore', detached: false, cwd: path.join(here, '..'),
    });
    for (let i = 0; i < 40; i++) {
      try { const r = await fetch(`http://localhost:${PORT}/`); if (r.ok) break; } catch {}
      await new Promise(r => setTimeout(r, 500));
    }
    browser = await chromium.launch();
  });

  after(async () => {
    if (browser) await browser.close();
    if (server) try { server.kill('SIGTERM'); } catch {}
  });

  it('dropping a .sna file calls loadSnapshot', async () => {
    const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
    await page.goto(`http://localhost:${PORT}/test/snapshot-drop.html`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__dropReady === true, { timeout: 15000 });
    await page.waitForTimeout(300);

    // Create a fake .sna file (49179 bytes = real SNA size)
    const snaPath = path.join(here, '_test_snapshot.sna');
    writeFileSync(snaPath, Buffer.alloc(49179, 0xea));

    const vdp = page.locator('[data-vdp-screen]');
    const box = await vdp.boundingBox();

    // Use Playwright's file chooser / drag simulation
    // Playwright can dispatch drop events with DataTransfer via evaluate
    await page.evaluate(async ({ x, y, w, h }) => {
      const buf = new Uint8Array(49179).fill(0xea);
      const file = new File([buf], 'test.sna', { type: 'application/octet-stream' });
      const dt = new DataTransfer();
      dt.items.add(file);

      const target = document.querySelector('[data-vdp-screen]');
      target.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
      target.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    }, { x: box.x, y: box.y, w: box.width, h: box.height });

    await page.waitForTimeout(500);

    const calls = await page.evaluate(() => window.__snapshotCalls);
    assert.ok(calls.length > 0, 'loadSnapshot was called');
    assert.equal(calls[0].size, 49179, '.sna file size = 49179');

    try { unlinkSync(snaPath); } catch {}
    await page.close();
  });

  it('dropping a .z80 file calls loadSnapshot', async () => {
    const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
    await page.goto(`http://localhost:${PORT}/test/snapshot-drop.html`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__dropReady === true, { timeout: 15000 });
    await page.waitForTimeout(300);

    await page.evaluate(() => {
      const buf = new Uint8Array(30000).fill(0);
      const file = new File([buf], 'game.z80', { type: 'application/octet-stream' });
      const dt = new DataTransfer();
      dt.items.add(file);
      const target = document.querySelector('[data-vdp-screen]');
      target.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
      target.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    });

    await page.waitForTimeout(500);
    const calls = await page.evaluate(() => window.__snapshotCalls);
    assert.ok(calls.length > 0, 'loadSnapshot was called for .z80');

    await page.close();
  });

  it('dropping a non-snapshot file does NOT call loadSnapshot', async () => {
    const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
    await page.goto(`http://localhost:${PORT}/test/snapshot-drop.html`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__dropReady === true, { timeout: 15000 });
    await page.waitForTimeout(300);

    await page.evaluate(() => {
      window.__snapshotCalls = [];
      const buf = new Uint8Array(100).fill(0);
      const file = new File([buf], 'readme.txt', { type: 'text/plain' });
      const dt = new DataTransfer();
      dt.items.add(file);
      const target = document.querySelector('[data-vdp-screen]');
      target.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
      target.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    });

    await page.waitForTimeout(500);
    const calls = await page.evaluate(() => window.__snapshotCalls);
    assert.equal(calls.length, 0, 'non-snapshot file rejected');

    await page.close();
  });
});
