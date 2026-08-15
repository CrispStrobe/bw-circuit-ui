/**
 * TileVGA face — Playwright acceptance test.
 *
 * Verifies that VdpScreen correctly renders a 320x240 tilevga frame:
 * - Canvas native resolution matches 320x240
 * - CSS display size is 2x scaled (640x480) with crisp pixels
 * - The frame contains visible drawing (non-black pixels)
 * - Keyboard input works at the tilevga resolution too
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
let chromium, browser, server;
try { ({ chromium } = await import('playwright')); } catch {}

const PORT = 3191;

describe('TileVGA 320x240 face', { skip: !chromium && 'playwright not available' }, () => {
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

  it('canvas renders at 320x240 native, 2x CSS scale', async () => {
    const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
    await page.goto(`http://localhost:${PORT}/test/tilevga-face.html`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__tilevgaReady === true, { timeout: 15000 });
    await page.waitForTimeout(500);

    const dims = await page.evaluate(() => {
      const c = document.querySelector('canvas');
      if (!c) return null;
      return {
        nativeW: c.width,
        nativeH: c.height,
        cssW: Math.round(parseFloat(c.style.width)),
        cssH: Math.round(parseFloat(c.style.height)),
        rendering: c.style.imageRendering,
      };
    });

    assert.ok(dims, 'canvas element exists');
    assert.equal(dims.nativeW, 320, 'native width = 320');
    assert.equal(dims.nativeH, 240, 'native height = 240');
    assert.equal(dims.cssW, 640, 'CSS width = 640 (2x scale)');
    assert.equal(dims.cssH, 480, 'CSS height = 480 (2x scale)');
    assert.equal(dims.rendering, 'pixelated', 'crisp pixel scaling');

    await page.close();
  });

  it('frame contains visible drawing (hello-world idiom)', async () => {
    const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
    await page.goto(`http://localhost:${PORT}/test/tilevga-face.html`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__tilevgaReady === true, { timeout: 15000 });
    await page.waitForTimeout(500);

    const nonBlack = await page.evaluate(() => {
      const c = document.querySelector('canvas');
      if (!c) return 0;
      const ctx = c.getContext('2d');
      const data = ctx.getImageData(0, 0, c.width, c.height).data;
      let count = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i] > 30 || data[i+1] > 30 || data[i+2] > 40) count++;
      }
      return count;
    });

    assert.ok(nonBlack > 100, `frame has visible content (${nonBlack} non-dark pixels)`);
    await page.close();
  });

  it('keyboard input works at 320x240 resolution', async () => {
    const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
    await page.goto(`http://localhost:${PORT}/test/tilevga-face.html`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__tilevgaReady === true, { timeout: 15000 });
    await page.waitForTimeout(300);

    await page.locator('canvas').first().click();
    await page.waitForTimeout(100);
    await page.evaluate(() => { window.__buttonCalls = []; });

    await page.keyboard.down('ArrowUp');
    await page.waitForTimeout(50);
    const calls = await page.evaluate(() => window.__buttonCalls);
    assert.ok(calls.length > 0, 'setButtons called');
    assert.equal(calls[calls.length - 1] & 0b0010, 0b0010, 'ArrowUp sets bit 1');
    await page.keyboard.up('ArrowUp');

    await page.close();
  });
});
