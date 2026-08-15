/**
 * MCU device label — Playwright test.
 *
 * Verifies that the canvas MCU body shows the DEVICE-appropriate label
 * (ATtiny88, ATmega328P, etc.) instead of hardcoded STC12.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
let chromium, browser, server;
try { ({ chromium } = await import('playwright')); } catch {}

const PORT = 3194;

describe('MCU device label rendering', { skip: !chromium && 'playwright not available' }, () => {
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

  it('?device=attiny88 shows ATtiny88 label on the MCU body', async () => {
    const page = await browser.newPage({ viewport: { width: 1400, height: 800 } });
    await page.goto(`http://localhost:${PORT}/?device=attiny88`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__circuit && window.__circuit.parts.length > 0, { timeout: 20000 });
    await page.waitForTimeout(500);

    // Check SVG text in the canvas for the ATtiny88 label
    const labels = await page.evaluate(() => {
      return [...document.querySelectorAll('svg text')]
        .map(t => t.textContent)
        .filter(t => /ATtiny|STC12|ATmega|DIP/.test(t));
    });

    assert.ok(labels.some(l => /ATtiny88/.test(l)),
      `expected ATtiny88 label, found: ${labels.join(', ')}`);
    assert.ok(!labels.some(l => /STC12C5A60S2/.test(l)),
      `STC12C5A60S2 should NOT appear for attiny88 device, found: ${labels.join(', ')}`);

    await page.close();
  });

  it('default device shows STC12C5A60S2 label', async () => {
    const page = await browser.newPage({ viewport: { width: 1400, height: 800 } });
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__circuit && window.__circuit.parts.length > 0, { timeout: 20000 });
    await page.waitForTimeout(500);

    const labels = await page.evaluate(() => {
      return [...document.querySelectorAll('svg text')]
        .map(t => t.textContent)
        .filter(t => /ATtiny|STC12|ATmega/.test(t));
    });

    assert.ok(labels.some(l => /STC12/.test(l)),
      `expected STC12 label for default device, found: ${labels.join(', ')}`);

    await page.close();
  });

  it('?device=stc89c52rc shows STC89C52 label', async () => {
    const page = await browser.newPage({ viewport: { width: 1400, height: 800 } });
    await page.goto(`http://localhost:${PORT}/?device=stc89c52rc`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__circuit && window.__circuit.parts.length > 0, { timeout: 20000 });
    await page.waitForTimeout(500);

    const labels = await page.evaluate(() => {
      return [...document.querySelectorAll('svg text')]
        .map(t => t.textContent)
        .filter(t => /ATtiny|STC|ATmega/.test(t));
    });

    assert.ok(labels.some(l => /STC89C52/.test(l)),
      `expected STC89C52 label, found: ${labels.join(', ')}`);

    await page.close();
  });
});
