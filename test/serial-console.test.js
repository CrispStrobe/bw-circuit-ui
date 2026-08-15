/**
 * SerialConsole — Playwright test.
 *
 * Verifies TX output renders as text and keyboard input sends RX bytes.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
let chromium, browser, server;
try { ({ chromium } = await import('playwright')); } catch {}

const PORT = 3195;

describe('SerialConsole', { skip: !chromium && 'playwright not available' }, () => {
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

  it('TX bytes render as text on screen', async () => {
    const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
    await page.goto(`http://localhost:${PORT}/test/serial-console.html`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__serialReady === true, { timeout: 15000 });
    await page.waitForTimeout(300);

    // Send "Hello\r\n" as TX bytes
    await page.evaluate(() => {
      window.__sendTx([72, 101, 108, 108, 111, 13, 10]); // H e l l o CR LF
    });
    await page.waitForTimeout(200);

    const text = await page.locator('[data-serial-console]').innerText();
    assert.ok(/Hello/.test(text), `TX output should show "Hello", got: ${text.slice(0, 50)}`);

    await page.close();
  });

  it('keyboard input sends RX bytes', async () => {
    const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
    await page.goto(`http://localhost:${PORT}/test/serial-console.html`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__serialReady === true, { timeout: 15000 });
    await page.waitForTimeout(300);

    // Click to focus
    await page.locator('[data-serial-console]').click();
    await page.waitForTimeout(100);

    // Type "AB" + Enter
    await page.evaluate(() => { window.__rxCalls = []; });
    await page.keyboard.type('AB');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(100);

    const calls = await page.evaluate(() => window.__rxCalls);
    assert.ok(calls.includes(65), 'sent A (65)');
    assert.ok(calls.includes(66), 'sent B (66)');
    assert.ok(calls.includes(13), 'sent CR (13) on Enter');

    await page.close();
  });

  it('empty state shows waiting message', async () => {
    const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
    await page.goto(`http://localhost:${PORT}/test/serial-console.html`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__serialReady === true, { timeout: 15000 });
    await page.waitForTimeout(300);

    const text = await page.locator('[data-serial-console]').innerText();
    assert.ok(/Waiting|Warte/i.test(text), `should show waiting message, got: ${text.slice(0, 50)}`);

    await page.close();
  });
});
