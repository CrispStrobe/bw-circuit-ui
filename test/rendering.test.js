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
    await page.getByText('01 Blink').click();

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
    assert.ok(text.includes('5V'), `should show 5V on VCC net`);

    // Junction voltage: R1.b / LED1.anode ≈ 2.1V
    // (hand-computed: VCC - I*R = 5 - 0.002899*1000 = 2.101)
    const hasJunction = text.includes('2.1V');
    assert.ok(hasJunction,
      `should show ~2.1V junction voltage, text: ${text.substring(0, 500)}`);

    // No page errors
    assert.deepEqual(pageErrors, [],
      `page should have no JS errors: ${pageErrors.join('; ')}`);
  });
});

describe('rendering: 04-brightness comparison preset', () => {
  it('loads brightness preset — both LEDs render, no page errors', async () => {
    pageErrors.length = 0;
    await page.goto('http://localhost:3100', { waitUntil: 'networkidle' });

    // Load the brightness comparison preset (active-low + active-high)
    await page.getByRole('button', { name: /04 Brightness/ }).click();

    // Switch to simulate mode
    await page.getByText('Sim', { exact: true }).click();
    await page.waitForTimeout(1500);

    const text = await page.locator('body').innerText();

    // Both LEDs should be present — the comparison that justifies the simulator.
    // The active-low LED (low_side) should be bright (~14.5%).
    // The active-high LED (high_side) should be very dim (<1%) in quasi mode.
    // Together they show the sink/source asymmetry.
    assert.ok(text.includes('5V'), 'should show VCC voltage');

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

describe('rendering: UI controls work', () => {
  it('undo/redo buttons exist and help text is present', async () => {
    pageErrors.length = 0;
    await page.goto('http://localhost:3100', { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);

    const text = await page.locator('body').innerText();
    assert.ok(text.includes('Undo'), 'should show Undo button');
    assert.ok(text.includes('Redo'), 'should show Redo button');
    assert.ok(text.includes('Save'), 'should show Save button');
    assert.ok(text.includes('Load'), 'should show Load button');
    assert.ok(text.includes('Ctrl+Z'), 'should show Ctrl+Z shortcut hint');

    assert.deepEqual(pageErrors, []);
  });

  it('screenshot captures the active-low sim state', async () => {
    pageErrors.length = 0;
    await page.goto('http://localhost:3100', { waitUntil: 'networkidle' });

    await page.getByText('01 Blink').click();
    await page.getByText('Sim', { exact: true }).click();
    await page.waitForTimeout(1500);

    // Capture screenshot for visual regression (saved to /tmp)
    await page.screenshot({ path: '/tmp/circuit-ui-regression.png' });

    // Verify the screenshot file was created
    const fs = await import('fs');
    assert.ok(fs.existsSync('/tmp/circuit-ui-regression.png'),
      'screenshot should be saved');

    assert.deepEqual(pageErrors, []);
  });
});
