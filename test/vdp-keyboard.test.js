/**
 * VdpScreen keyboard-focus routing — Playwright acceptance test.
 *
 * Renders a standalone VdpScreen with mock videoFn + setButtonsFn,
 * drives arrow keys, asserts setButtons was called with the correct mask.
 *
 * Mask bits: 0=down, 1=up, 2=right, 3=left (active semantics machine-side).
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
let chromium, browser, server;

try { ({ chromium } = await import('playwright')); } catch { /* not installed */ }

const PORT = 3189;

describe('VdpScreen keyboard input', { skip: !chromium && 'playwright not available' }, () => {
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

  it('arrow key press calls setButtons, release clears it', async () => {
    const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
    await page.goto(`http://localhost:${PORT}/test/vdp-keyboard.html`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__vdpReady === true, { timeout: 15000 });
    await page.waitForTimeout(300);

    // Click the VdpScreen to focus it
    const canvas = page.locator('canvas').first();
    await canvas.click();
    await page.waitForTimeout(100);

    // Clear any calls from the focus event
    await page.evaluate(() => { window.__buttonCalls = []; });

    // Press ArrowRight → bit 2 set
    await page.keyboard.down('ArrowRight');
    await page.waitForTimeout(50);
    let calls = await page.evaluate(() => window.__buttonCalls);
    assert.ok(calls.length > 0, 'setButtons called on key down');
    assert.equal(calls[calls.length - 1] & 0b0100, 0b0100, 'ArrowRight sets bit 2');

    // Release → mask cleared
    await page.keyboard.up('ArrowRight');
    await page.waitForTimeout(50);
    calls = await page.evaluate(() => window.__buttonCalls);
    assert.equal(calls[calls.length - 1], 0, 'release clears all bits');

    // Press ArrowUp → bit 1
    await page.evaluate(() => { window.__buttonCalls = []; });
    await page.keyboard.down('ArrowUp');
    await page.waitForTimeout(50);
    calls = await page.evaluate(() => window.__buttonCalls);
    assert.equal(calls[calls.length - 1] & 0b0010, 0b0010, 'ArrowUp sets bit 1');
    await page.keyboard.up('ArrowUp');

    // Two keys simultaneously: ArrowDown + ArrowLeft → bits 0 + 3
    await page.evaluate(() => { window.__buttonCalls = []; });
    await page.keyboard.down('ArrowDown');
    await page.keyboard.down('ArrowLeft');
    await page.waitForTimeout(50);
    calls = await page.evaluate(() => window.__buttonCalls);
    const last = calls[calls.length - 1];
    assert.equal(last & 0b0001, 0b0001, 'ArrowDown sets bit 0');
    assert.equal(last & 0b1000, 0b1000, 'ArrowLeft sets bit 3');
    await page.keyboard.up('ArrowDown');
    await page.keyboard.up('ArrowLeft');

    await page.close();
  });

  it('WASD maps to same bits as arrows', async () => {
    const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
    await page.goto(`http://localhost:${PORT}/test/vdp-keyboard.html`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__vdpReady === true, { timeout: 15000 });
    await page.waitForTimeout(300);

    await page.locator('canvas').first().click();
    await page.waitForTimeout(100);

    for (const [key, bit, label] of [['w', 1, 'up'], ['a', 3, 'left'], ['s', 0, 'down'], ['d', 2, 'right']]) {
      await page.evaluate(() => { window.__buttonCalls = []; });
      await page.keyboard.down(key);
      await page.waitForTimeout(50);
      const calls = await page.evaluate(() => window.__buttonCalls);
      assert.ok(calls.length > 0, `${key} key fires setButtons`);
      assert.equal(calls[calls.length - 1] & (1 << bit), 1 << bit, `${key} = ${label} (bit ${bit})`);
      await page.keyboard.up(key);
    }

    await page.close();
  });

  it('blur releases all buttons', async () => {
    const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
    await page.goto(`http://localhost:${PORT}/test/vdp-keyboard.html`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__vdpReady === true, { timeout: 15000 });
    await page.waitForTimeout(300);

    await page.locator('canvas').first().click();
    await page.waitForTimeout(100);

    // Hold a key
    await page.keyboard.down('ArrowRight');
    await page.waitForTimeout(50);

    // Tab away to blur the VdpScreen
    await page.evaluate(() => { window.__buttonCalls = []; });
    await page.evaluate(() => document.activeElement?.blur());
    await page.waitForTimeout(100);

    const calls = await page.evaluate(() => window.__buttonCalls);
    assert.ok(calls.length > 0, 'blur fires setButtons');
    assert.equal(calls[calls.length - 1], 0, 'blur releases all buttons (mask=0)');

    await page.close();
  });

  it('click-to-play hint visible before first interaction', async () => {
    const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
    await page.goto(`http://localhost:${PORT}/test/vdp-keyboard.html`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__vdpReady === true, { timeout: 15000 });
    await page.waitForTimeout(300);

    // Hint should be visible before clicking
    const hint = await page.evaluate(() => {
      const spans = [...document.querySelectorAll('span')];
      return spans.some(s => /click to play|klicken/i.test(s.textContent));
    });
    assert.ok(hint, '"click to play" hint visible before interaction');

    // Click → hint disappears
    await page.locator('canvas').first().click();
    await page.waitForTimeout(200);
    const hintAfter = await page.evaluate(() => {
      const spans = [...document.querySelectorAll('span')];
      return spans.some(s => /click to play|klicken/i.test(s.textContent));
    });
    assert.ok(!hintAfter, 'hint disappears after first interaction');

    await page.close();
  });
});
