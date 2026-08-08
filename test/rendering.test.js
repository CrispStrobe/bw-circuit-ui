/**
 * Rendering regression test — headless Chromium via Playwright.
 *
 * Loads the app, clicks a preset, enters simulation, and asserts
 * that the engine-driven values appear in the rendered page.
 *
 * This is the only test that covers the full chain:
 *   engine → React state → DOM → visible text
 *
 * Requires: dev server on port 3100, Playwright chromium cached.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

let browser, page;
const pageErrors = [];

before(async () => {
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1400, height: 760 } });
  page.on('pageerror', e => pageErrors.push(String(e)));
});

after(async () => {
  if (browser) await browser.close();
});

describe('rendering: active-low LED preset', () => {
  it('loads preset, enters sim, shows correct engine values', async () => {
    await page.goto('http://localhost:3100', { waitUntil: 'networkidle' });

    // Load the active-low LED preset
    await page.getByText('Correct (active-low)').click();

    // Switch to simulate mode
    await page.getByText('Sim', { exact: true }).click();

    // Wait for simulation to run a few ticks
    await page.waitForTimeout(1500);

    // Grab all visible text
    const text = await page.locator('body').innerText();

    // LED brightness should show ~14.5% (from engine: ~0.1449)
    // The exact percentage depends on PWM duty in the sim loop.
    // When pin is LOW (active-low → on), brightness ≈ 14.5%.
    // The sim blinks, so we might catch it on or off. Check either.
    const hasLedReading = text.includes('14.') || text.includes('off');
    assert.ok(hasLedReading,
      `should show LED percentage or "off", got: ${text.substring(0, 500)}`);

    // Node voltages from engine — three values in the active-low circuit:
    // VCC net = 5.000 V
    assert.ok(text.includes('5.000'), `should show 5.000 V on VCC net`);

    // Junction voltage: R1.b / LED1.anode ≈ 2.101 V
    // (hand-computed: VCC - I*R = 5 - 0.002899*1000 = 2.101)
    const hasJunction = text.includes('2.10') || text.includes('2.09') || text.includes('2.11');
    assert.ok(hasJunction,
      `should show ~2.101 V junction voltage, text: ${text.substring(0, 500)}`);

    // No page errors
    assert.deepEqual(pageErrors, [],
      `page should have no JS errors: ${pageErrors.join('; ')}`);
  });
});

describe('rendering: active-high (naive) preset comparison', () => {
  it('loads naive preset, LED is dim or off in quasi mode', async () => {
    pageErrors.length = 0;
    await page.goto('http://localhost:3100', { waitUntil: 'networkidle' });

    // Load the naive wiring preset
    await page.getByText('Naive (active-high)').click();

    // Switch to simulate mode
    await page.getByText('Sim', { exact: true }).click();
    await page.waitForTimeout(1500);

    const text = await page.locator('body').innerText();

    // Naive wiring with quasi-bidir: LED should be very dim (<1%) or off.
    // The sim drives P1.0 quasi HIGH (which sources only ~230 µA).
    // We should NOT see 14.5% — that would mean the engine is wrong.
    const has14pct = /14\.\d%/.test(text);
    assert.ok(!has14pct,
      `naive wiring should NOT show ~14.5% brightness (that would be wrong)`);

    assert.deepEqual(pageErrors, [],
      `no JS errors: ${pageErrors.join('; ')}`);
  });
});

describe('rendering: no page errors on fresh load', () => {
  it('blank page loads without JS errors', async () => {
    pageErrors.length = 0;
    await page.goto('http://localhost:3100', { waitUntil: 'networkidle' });

    await page.waitForTimeout(500);

    assert.deepEqual(pageErrors, [],
      `fresh load should have no JS errors: ${pageErrors.join('; ')}`);

    // Should show the UI structure
    const text = await page.locator('body').innerText();
    assert.ok(text.includes('Parts'), 'should show Parts palette');
    assert.ok(text.includes('Controls'), 'should show Controls panel');
    assert.ok(text.includes('Multimeter'), 'should show Multimeter');
  });
});
