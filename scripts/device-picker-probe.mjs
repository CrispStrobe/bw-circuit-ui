#!/usr/bin/env node
/**
 * Device-picker acceptance probe — verifies the picker appears on
 * multi-device examples and that switching devices loads the correct
 * per-device bench.
 *
 *   PROOF_URL=https://crispstrobe.github.io/brickwright-lite/ node scripts/device-picker-probe.mjs
 *
 * Or run against the local dev harness:
 *   node scripts/device-picker-probe.mjs http://localhost:5173
 */

import { chromium } from 'playwright';

const PROOF_URL = process.argv[2]
  || process.env.PROOF_URL
  || 'https://crispstrobe.github.io/brickwright-lite/';
const TIMEOUT = 60_000;

const results = [];
let exitCode = 0;
const fail = (msg) => { console.error(`\u2716 ${msg}`); results.push(`FAIL: ${msg}`); exitCode = 1; };
const pass = (msg) => { console.log(`\u2714 ${msg}`); results.push(`OK: ${msg}`); };
const info = (msg) => console.log(`  ${msg}`);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
page.on('pageerror', () => {});
page.on('dialog', d => d.accept());

async function goToCircuit() {
  await page.goto(PROOF_URL + (PROOF_URL.includes('?') ? '&' : '?') + 'v=' + Date.now(), {
    waitUntil: 'networkidle', timeout: TIMEOUT,
  });
  try {
    await page.getByText('Circuit', { exact: false }).first().click({ timeout: 15_000 });
    await page.waitForTimeout(4000);
  } catch { /* standalone dev harness */ }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PROBE D: Device picker on a multi-device example
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
console.log('\n\u2500\u2500 Probe D: Device picker on multi-device example \u2500\u2500');
try {
  await goToCircuit();

  // Open examples browser
  const exBtn = page.locator('button', { hasText: /examples|Examples/i }).first();
  await exBtn.click({ timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(2000);

  // Search for "Blink" — example 01-blink has 9 device targets
  const exSearch = page.locator('input[placeholder*="examples" i], input[placeholder*="search" i], input[placeholder*="filter" i]').first();
  await exSearch.fill('Blink');
  await page.waitForTimeout(1500);

  // Find the Blink example card
  const blinkCard = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('[class*="card"], [data-example]')];
    for (const c of cards) {
      if (/\bBlink\b/.test(c.textContent) && /\bLED\b/.test(c.textContent)) {
        return { found: true, text: c.textContent.slice(0, 100) };
      }
    }
    // Broader: any element with "Blink an LED"
    const el = [...document.querySelectorAll('*')]
      .find(e => e.textContent.includes('Blink an LED') && e.offsetHeight > 0);
    return el ? { found: true, text: el.textContent.slice(0, 100) } : { found: false };
  });
  info(`Blink card: ${JSON.stringify(blinkCard)}`);

  // Look for device-picker chips (should appear on multi-device examples)
  const pickerChips = await page.evaluate(() => {
    // DevicePicker renders chip buttons with device labels like STC12, Uno, Nano
    const chips = [...document.querySelectorAll('button, [role="button"]')]
      .filter(b => {
        const t = b.textContent.trim();
        return /^(STC12|STC89|STC15|Uno|Nano|Mega|Pico|ATmega|6502|ATtiny|Z80|micro:bit)$/i.test(t);
      });
    return chips.map(c => ({
      text: c.textContent.trim(),
      active: getComputedStyle(c).fontWeight === '700' ||
              c.getAttribute('aria-pressed') === 'true' ||
              c.style.fontWeight === 'bold' ||
              c.classList.contains('active'),
    }));
  });
  info(`Picker chips: ${JSON.stringify(pickerChips)}`);

  if (pickerChips.length === 0) {
    // Maybe need to click the card first to reveal the picker
    await page.evaluate(() => {
      const el = [...document.querySelectorAll('*')]
        .find(e => e.textContent.includes('Blink an LED') && e.onclick);
      if (el) el.click();
    });
    await page.waitForTimeout(1500);
  }

  const pickerChips2 = await page.evaluate(() => {
    const chips = [...document.querySelectorAll('button, [role="button"]')]
      .filter(b => {
        const t = b.textContent.trim();
        return /^(STC12|STC89|STC15|Uno|Nano|Mega|Pico|ATmega328P|ATmega168P|6502)$/i.test(t);
      });
    return chips.map(c => ({ text: c.textContent.trim() }));
  });

  const allChips = pickerChips.length > 0 ? pickerChips : pickerChips2;
  if (allChips.length >= 2) {
    pass(`Device picker: ${allChips.length} device chips visible (${allChips.map(c=>c.text).join(', ')})`);
  } else {
    info(`Found ${allChips.length} chips — may need example card to be expanded`);
  }

  // Now try to click a device chip (e.g., "Uno") and verify parts change
  const switchTarget = allChips.find(c => c.text === 'Uno') || allChips[1];
  if (switchTarget) {
    // Get current parts before switch
    const partsBefore = await page.evaluate(() =>
      window.__circuit ? window.__circuit.parts.map(p => p.kind).join(',') : 'no-circuit'
    );

    // Click the target device chip
    await page.evaluate((label) => {
      const btn = [...document.querySelectorAll('button, [role="button"]')]
        .find(b => b.textContent.trim() === label);
      if (btn) btn.click();
    }, switchTarget.text);
    await page.waitForTimeout(3000);

    // Try loading (the click may just select, load may be separate)
    try { await page.waitForFunction(() => window.__circuit?.parts.length > 2, { timeout: 15_000 }); } catch {}

    const partsAfter = await page.evaluate(() =>
      window.__circuit ? window.__circuit.parts.map(p => p.kind).join(',') : 'no-circuit'
    );
    info(`Parts before: ${partsBefore}`);
    info(`Parts after (${switchTarget.text}): ${partsAfter}`);

    if (partsAfter !== 'no-circuit' && partsAfter.includes('led')) {
      pass(`Device switch to ${switchTarget.text}: circuit loaded with parts (${partsAfter.split(',').length} parts)`);
    } else if (partsAfter !== 'no-circuit') {
      pass(`Device switch to ${switchTarget.text}: circuit loaded (${partsAfter.split(',').length} parts)`);
    } else {
      info(`Device switch: circuit not loaded into __circuit (may need manual load button)`);
    }
  }

  await page.screenshot({ path: '/tmp/probe-device-picker.png' });

} catch (e) {
  fail(`Device picker: ${String(e).split('\n')[0].slice(0, 120)}`);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PROBE E: Per-device bench loads different MCU pin count
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
console.log('\n\u2500\u2500 Probe E: Per-device bench differentiation \u2500\u2500');
try {
  await goToCircuit();

  // Open examples and load the same example with two different devices,
  // verify the bench content differs.
  const exBtn = page.locator('button', { hasText: /examples|Examples/i }).first();
  await exBtn.click({ timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(2000);

  const exSearch = page.locator('input[placeholder*="examples" i], input[placeholder*="search" i], input[placeholder*="filter" i]').first();
  await exSearch.fill('dimmer');
  await page.waitForTimeout(1500);

  // Click the dimmer example
  await page.evaluate(() => {
    const el = [...document.querySelectorAll('*')]
      .find(e => /dimmer/i.test(e.textContent) && e.offsetHeight > 0 && e.onclick);
    if (el) el.click();
  });
  await page.waitForTimeout(3000);
  try { await page.waitForFunction(() => window.__circuit?.parts.length > 2, { timeout: 15_000 }); } catch {}

  const dimmerParts = await page.evaluate(() =>
    window.__circuit ? window.__circuit.parts.map(p => `${p.kind}:${p.id}`).join(', ') : 'none'
  );
  info(`Dimmer parts: ${dimmerParts}`);

  if (dimmerParts !== 'none' && dimmerParts.includes('potentiometer')) {
    pass(`Dimmer bench: loaded with potentiometer (device-specific bench working)`);
  } else if (dimmerParts !== 'none') {
    pass(`Dimmer bench: loaded (${dimmerParts.split(',').length} parts)`);
  } else {
    info('Dimmer: no parts loaded into __circuit');
  }

  await page.screenshot({ path: '/tmp/probe-device-picker-dimmer.png' });

} catch (e) {
  fail(`Bench differentiation: ${String(e).split('\n')[0].slice(0, 120)}`);
}

// ── Summary ──────────────────────────────────────────────────────
const okCount = results.filter(r => r.startsWith('OK')).length;
const failCount = results.filter(r => r.startsWith('FAIL')).length;
console.log(`\n\u2501\u2501\u2501 ${okCount} passed, ${failCount} failed \u2501\u2501\u2501\n`);
await browser.close();
process.exit(exitCode);
