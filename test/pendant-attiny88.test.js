/**
 * Pendant example — ATtiny88 label verification.
 *
 * Loads the blinkenrocket-pendant circuit.json from sb3-creator and
 * verifies that the MCU part, when loaded with device=attiny88,
 * produces the correct chip label on the canvas.
 *
 * Playwright: starts a dev server with ?device=attiny88, loads the
 * pendant circuit, and checks the SVG text for "ATtiny88".
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
let chromium, browser, server;
try { ({ chromium } = await import('playwright')); } catch {}

const PORT = 3195;

// Locate pendant circuit in sibling sb3-creator checkout
const CANDIDATES = [
  process.env.EXAMPLES_DIR && path.join(process.env.EXAMPLES_DIR, 'blinkenrocket-pendant'),
  path.join(here, '../../sb3-creator/examples/blinkenrocket-pendant'),
].filter(Boolean);
const PENDANT_DIR = CANDIDATES.find(d => existsSync(path.join(d, 'circuit.json')));

describe('pendant example ATtiny88 label', {
  skip: (!chromium && 'playwright not available') || (!PENDANT_DIR && 'pendant example not found'),
}, () => {
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

  it('pendant circuit.json has an MCU part with ATtiny88-compatible pins', () => {
    const circuit = JSON.parse(readFileSync(path.join(PENDANT_DIR, 'circuit.json'), 'utf8'));
    // Pendant may use device-true 'attiny88' kind or generic 'mcu'
    const mcu = circuit.parts.find(p => p.kind === 'attiny88' || p.kind === 'mcu');
    assert.ok(mcu, 'pendant circuit must have an MCU or ATtiny88 part');
    if (mcu.kind === 'mcu') {
      // Generic MCU: verify ATtiny88 port-B pins in params
      assert.ok(mcu.params.pins.some(p => /^PB/.test(p)),
        'MCU pins should include ATtiny88 port-B pins');
    }
    // Device-true attiny88: pin names come from sidecar, no params.pins needed
  });

  it('canvas renders ATtiny88 label (not STC12) for device=attiny88', async () => {
    const page = await browser.newPage({ viewport: { width: 1400, height: 800 } });
    await page.goto(`http://localhost:${PORT}/?device=attiny88`, { waitUntil: 'networkidle' });
    await page.waitForFunction(
      () => window.__circuit && window.__circuit.parts.length > 0,
      { timeout: 20000 },
    );
    await page.waitForTimeout(500);

    const labels = await page.evaluate(() => {
      return [...document.querySelectorAll('svg text')]
        .map(t => t.textContent)
        .filter(t => /ATtiny|STC12|ATmega|DIP|micro/i.test(t));
    });

    assert.ok(labels.some(l => /ATtiny88/.test(l)),
      `pendant device=attiny88 must show ATtiny88 label, found: ${labels.join(', ')}`);
    assert.ok(!labels.some(l => /STC12C5A60S2/.test(l)),
      `STC12C5A60S2 must not appear for ATtiny88 device, found: ${labels.join(', ')}`);

    await page.close();
  });
});
