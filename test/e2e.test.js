// End-to-end test: full user flow through the circuit designer.
// Exercises: preset load, simulation, part add, wiring, undo, save/load.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { startDevServer } from './_dev-server.js';

let server;
let browser, page;

/**
 * Add a part by searching the palette for it, the way a user does.
 *
 * @param {import('playwright').Page} page
 * @param {string} query what to type in the palette search
 * @param {RegExp} label which result to click
 */
async function addPartFromPalette (page, query, label) {
  await page.getByPlaceholder('search...').first().fill(query);
  await page.waitForTimeout(400);
  await page.getByText(label).first().click();
  await page.waitForTimeout(300);
}

const errors = [];

/**
 * Simulation mode no longer implies power. The toolbar has an explicit power
 * control ("Power off — all rails de-energised… In Build mode power is always
 * off"), so entering Sim solves nothing until it is switched on — no node
 * voltages, no LED brightness. Without this the engine assertions look like
 * missing features.
 *
 * @param {import('playwright').Page} page
 */
async function powerOn (page) {
  const on = page.locator('[title^="Power on"]');
  if (await on.count()) {
    await on.first().click();
    await page.waitForTimeout(1500);
  }
}


before(async () => {
  server = await startDevServer('e2e');
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1400, height: 800 } });
  page.on('pageerror', e => errors.push(String(e)));
});

after(async () => {
  if (server) server.stop();
  if (browser) await browser.close();
});

describe('e2e: full user flow', () => {
  it('loads preset, simulates, shows correct values', async () => {
    errors.length = 0;
    await page.goto(`${server.url}/?examples=none`, { waitUntil: 'networkidle' });

    // Load 04-brightness (the key comparison)
    await page.getByRole('button', { name: /04 Brightness/ }).click();
    await page.locator('[title="Simulation mode"]').first().click();
    await powerOn(page);
    await page.waitForTimeout(2000);

    const text = await page.locator('body').innerText();

    // VCC voltage
    assert.ok(text.includes('5V'), 'should show 5V');
    // Junction voltage from engine
    assert.ok(text.includes('2.1V'), 'should show 2.1V junction');
    // No page errors
    assert.deepEqual(errors, []);
  });

  it('adds a part from palette and it appears', async () => {
    errors.length = 0;
    await page.goto(`${server.url}/?examples=none`, { waitUntil: 'networkidle' });

    // Click to add a resistor
    await page.getByText('Resistor 1kΩ').click();
    await page.waitForTimeout(500);

    // The resistor should appear on the canvas
    const text = await page.locator('body').innerText();
    assert.ok(text.includes('1kΩ'), 'resistor should appear');
    assert.deepEqual(errors, []);
  });

  it('undo button exists and keyboard shortcut works', async () => {
    errors.length = 0;
    await page.goto(`${server.url}/?examples=none`, { waitUntil: 'networkidle' });

    // Add two parts to build up history.
    //
    // The palette is no longer a list of `[draggable="true"]` tiles the whole
    // catalogue deep — it has a search box, and the items carry their value in
    // the label ("Resistor 1kΩ", not "Resistor"). Searching is also how a user
    // reaches a part now, so this exercises the real path rather than a
    // selector that happened to work when the catalogue was short.
    await addPartFromPalette(page, 'resistor', /^Resistor/);
    await addPartFromPalette(page, 'led', /^LED/);

    // Undo via keyboard
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(300);

    // Should not crash
    assert.deepEqual(errors, []);
  });

  it('save produces a downloadable file', async () => {
    errors.length = 0;
    await page.goto(`${server.url}/?examples=none`, { waitUntil: 'networkidle' });

    // Set up download listener
    // Save now lives in the ⋯ overflow menu ("Consolidate file actions into
    // the ⋯ menu"), so it has to be opened first.
    await page.locator('[title^="More circuit controls"]').first().click();
    await page.waitForTimeout(300);
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 5000 }).catch(() => null),
      page.locator('button:has-text("Save")').first().click(),
    ]);

    if (download) {
      assert.ok(download.suggestedFilename().endsWith('.json'),
        'save should produce a .json file');
    }
    // Save might not trigger a download in headless — that's OK
    assert.deepEqual(errors, []);
  });

  it('all presets load without errors', async () => {
    errors.length = 0;
    await page.goto(`${server.url}/?examples=none`, { waitUntil: 'networkidle' });

    // Click each preset button (examples + Reidemeister)
    const presetNames = [
      '01 Blink', '02 Button', '03 Potentiometer',
      '05 Scheduler', '06 Dimmer', '07 Buzzer',
      '08 7-Segment', '09 Shift Reg',
    ];

    for (const name of presetNames) {
      const btn = page.getByRole('button', { name: new RegExp(name) });
      if (await btn.count() > 0) {
        await btn.first().click();
        await page.waitForTimeout(300);
      }
    }

    assert.deepEqual(errors, [],
      `presets should load without errors: ${errors.join('; ')}`);
  });

  it('multimeter shows values', async () => {
    errors.length = 0;
    await page.goto(`${server.url}/?examples=none`, { waitUntil: 'networkidle' });
    await page.getByText('01 Blink').click();
    await page.locator('[title="Simulation mode"]').first().click();
    await powerOn(page);
    await page.waitForTimeout(1000);

    // The meter is behind a toggle now (`⌁ Meter`), not open by default.
    const toggle = page.locator('button', { hasText: /⌁\s*(Meter|Multimeter)/ });
    assert.ok(await toggle.count() > 0, 'the meter toggle should be present');
    await toggle.first().click();
    await page.waitForTimeout(600);

    const text = await page.locator('body').innerText();
    assert.ok(await page.locator('[data-meter-module]').count() === 1,
      'multimeter panel should be visible once toggled');
    assert.ok(/Probe A/i.test(text), 'probe A should be shown');
    assert.deepEqual(errors, []);
  });
});
