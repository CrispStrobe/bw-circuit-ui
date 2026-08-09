#!/usr/bin/env node
/**
 * Deployed site check — verifies the Circuit tab exists on the live Vercel app.
 *
 * Run after a brickwright-lite deploy to confirm the circuit designer loads:
 *   node scripts/check-deployed.mjs [url]
 *
 * Exits 0 if the Circuit tab renders. Exits 1 with diagnostics otherwise.
 * Requires: playwright (npm install playwright)
 */

import { chromium } from 'playwright';

const URL = process.argv[2] || 'https://brickwright-lite.vercel.app/';
const TIMEOUT = 60000;

const pageErrors = [];
const failedReqs = [];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 800 } });

page.on('pageerror', e => pageErrors.push(e.message));
page.on('requestfailed', r => failedReqs.push(`${r.url()} ${r.failure()?.errorText || ''}`));

console.log(`Loading ${URL} ...`);
await page.goto(URL, { waitUntil: 'networkidle', timeout: TIMEOUT });

// Wait for the GUI to render (scratch-gui is client-rendered)
let guiRendered = false;
try {
  await page.waitForSelector('[class*="menu-bar"], [class*="gui_"], [role="tab"]', { timeout: TIMEOUT });
  guiRendered = true;
} catch {}

if (!guiRendered) {
  console.error('FAIL: GUI did not render within', TIMEOUT / 1000, 'seconds');
  if (pageErrors.length) console.error('Page errors:', pageErrors.join('\n  '));
  if (failedReqs.length) console.error('Failed requests:', failedReqs.join('\n  '));
  await browser.close();
  process.exit(1);
}

// Check tabs
const tabs = await page.locator('[role=tab]').allInnerTexts();
console.log('Tabs:', tabs.join(', '));

const hasCircuit = tabs.some(t => /circuit/i.test(t));

if (!hasCircuit) {
  console.error('FAIL: Circuit tab not found. Tabs present:', tabs.join(', '));
  if (pageErrors.length) console.error('Page errors:', pageErrors.join('\n  '));
  await browser.close();
  process.exit(1);
}

// Click Circuit tab and verify the designer loads
await page.getByRole('tab', { name: /circuit/i }).click();
await page.waitForTimeout(3000);

const text = await page.locator('body').innerText();
const designerLoaded = text.includes('Parts') || text.includes('Multimeter') || text.includes('Loading');

if (!designerLoaded) {
  console.error('FAIL: Circuit tab clicked but designer did not load');
  console.error('Page text (first 500 chars):', text.substring(0, 500));
  await browser.close();
  process.exit(1);
}

console.log('OK: Circuit tab exists and designer loads');
if (pageErrors.length) console.log('Warnings:', pageErrors.length, 'page errors');
await browser.close();
process.exit(0);
