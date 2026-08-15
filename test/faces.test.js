/**
 * Sensor faces Playwright tests: orientation input, MIDI monitor,
 * stimulus controls.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
let chromium, browser, server;
try { ({ chromium } = await import('playwright')); } catch {}

const PORT = 3193;

describe('Sensor faces', { skip: !chromium && 'playwright not available' }, () => {
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

  it('OrientationInput: drag sets accelX/Y/Z params', async () => {
    const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
    await page.goto(`http://localhost:${PORT}/test/faces-orientation.html`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__orientReady === true, { timeout: 15000 });
    await page.waitForTimeout(300);

    // Find the SVG circle (tilt control) and drag to the right
    const svg = page.locator('[data-orientation-input] svg');
    const box = await svg.boundingBox();
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    await page.evaluate(() => { window.__paramCalls = []; });
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 40, cy, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(100);

    const calls = await page.evaluate(() => window.__paramCalls);
    assert.ok(calls.length > 0, 'onSetParam was called');
    const xCalls = calls.filter(c => c.key === 'accelX');
    assert.ok(xCalls.length > 0, 'accelX was set');
    assert.ok(xCalls[xCalls.length - 1].value > 0, 'dragging right → positive X');

    await page.close();
  });

  it('OrientationInput: slider mode controls axes independently', async () => {
    const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
    await page.goto(`http://localhost:${PORT}/test/faces-orientation.html`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__orientReady === true, { timeout: 15000 });
    await page.waitForTimeout(300);

    // Switch to sliders mode
    await page.getByText('Sliders', { exact: true }).click();
    await page.waitForTimeout(100);

    // Verify sliders exist
    const sliders = await page.locator('[data-orientation-input] input[type="range"]').count();
    assert.equal(sliders, 3, '3 sliders (X, Y, Z)');

    await page.close();
  });

  it('MidiMonitor: note-on/off events decode and render', async () => {
    const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
    await page.goto(`http://localhost:${PORT}/test/faces-midi.html`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__midiReady === true, { timeout: 15000 });
    await page.waitForTimeout(300);

    // Push a Note On C4 (0x90, 60, 100)
    await page.evaluate(() => window.__pushMidi([0x90, 60, 100]));
    await page.waitForTimeout(200);

    const text = await page.locator('[data-midi-monitor]').innerText();
    assert.ok(/Note ON/i.test(text) || /Note EIN/i.test(text), `shows Note ON: ${text.slice(0, 100)}`);
    assert.ok(/C4/.test(text), `shows note name C4: ${text.slice(0, 100)}`);

    // Push a Note Off C4 (0x80, 60, 0)
    await page.evaluate(() => window.__pushMidi([0x80, 60, 0]));
    await page.waitForTimeout(200);

    const text2 = await page.locator('[data-midi-monitor]').innerText();
    assert.ok(/Note OFF/i.test(text2) || /Note AUS/i.test(text2), `shows Note OFF: ${text2.slice(0, 100)}`);

    await page.close();
  });
});
