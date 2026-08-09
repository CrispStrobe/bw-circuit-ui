#!/usr/bin/env node
// Interaction acceptance: the owner's reported failures, run as a gate.
// Self-contained: spawns its own dev server, drives a real browser with real
// pointer sequences against WOKWI parts (not SVG symbols — that distinction
// is how the breakage stayed invisible), exits non-zero on any failure.
//
//   npm run verify:interaction
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const PORT = 3142;
const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
  stdio: 'ignore', detached: false,
});
const kill = () => { try { server.kill('SIGTERM'); } catch { /* gone */ } };
process.on('exit', kill);

const waitForServer = async () => {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://localhost:${PORT}/`);
      if (r.ok) return;
    } catch { /* not up yet */ }
    await new Promise(res => setTimeout(res, 500));
  }
  throw new Error('dev server did not come up');
};

const fail = (msg) => { console.error(`✖ ${msg}`); process.exitCode = 1; };
const pass = (msg) => console.log(`✔ ${msg}`);

await waitForServer();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 800 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
await page.goto(`http://localhost:${PORT}`, { waitUntil: 'networkidle' });
await page.waitForTimeout(800);

const box = async () => await page.locator('wokwi-led').first().boundingBox();
const selectionCount = async () =>
  await page.evaluate(() => document.body.innerText.match(/(\d+)\s*selected/)?.[1] ?? '0');

// 1. Click-select, three times, on the wokwi LED.
{
  const b = await box();
  if (!b) { fail('no wokwi LED on the default board'); }
  else {
    let ok = true;
    for (let i = 0; i < 3; i++) {
      await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
      await page.waitForTimeout(120);
      if (await selectionCount() !== '1') ok = false;
    }
    ok ? pass('click selects the LED, all three times')
       : fail('click-to-select is unreliable');
  }
}

// 2. Drag the LED 200 px right; it must arrive (grid snap ±20 px).
{
  const before = await box();
  const cx = before.x + before.width / 2, cy = before.y + before.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let s = 1; s <= 10; s++) { await page.mouse.move(cx + s * 20, cy); await page.waitForTimeout(15); }
  await page.mouse.up();
  await page.waitForTimeout(200);
  const after = await box();
  const dx = after.x - before.x;
  (dx > 180 && dx < 220) ? pass(`drag moved the LED ${dx.toFixed(0)} px`)
    : fail(`drag moved ${dx.toFixed(0)} px, expected ~200`);
}

// 3. Add two fresh parts from the palette, then wire them terminal-to-terminal.
{
  await page.getByText('Resistor 1kΩ', { exact: false }).first().click();
  await page.waitForTimeout(200);
  await page.getByText('Diode', { exact: true }).first().click();
  await page.waitForTimeout(300);
  const wiresBefore = await page.locator('[data-wire]').count();
  // Free terminals render as hollow red dots (r=8, stroke #e74c3c).
  const freeDots = await page.evaluate(() => {
    return [...document.querySelectorAll('svg circle')]
      .filter(el => el.getAttribute('stroke') === '#e74c3c' && el.getAttribute('r') === '8')
      .map(el => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  });
  const dot = freeDots[0];
  // Farthest free dot from the first: guaranteed a different part's terminal.
  const dot2 = freeDots.length >= 2
    ? freeDots.reduce((best, d) => (Math.hypot(d.x - dot.x, d.y - dot.y) > Math.hypot(best.x - dot.x, best.y - dot.y) ? d : best))
    : null;
  if (!dot || !dot2) {
    fail(`could not find two free terminals to wire (found ${freeDots.length})`);
  } else {
    await page.mouse.move(dot.x, dot.y);
    await page.mouse.down();
    await page.mouse.move((dot.x + dot2.x) / 2, (dot.y + dot2.y) / 2, { steps: 5 });
    await page.mouse.move(dot2.x, dot2.y, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(200);
    const wiresAfter = await page.locator('[data-wire]').count();
    (wiresAfter > wiresBefore) ? pass('terminal-to-terminal drag created a wire')
      : fail(`wiring drag created nothing (paths ${wiresBefore} → ${wiresAfter})`);
  }
}

// 4. Trackpad two-finger scroll must PAN the canvas (viewBox moves).
{
  const canvas = await page.locator('[data-canvas] svg').first();
  const vbBefore = await canvas.getAttribute('viewBox');
  const cb = await canvas.boundingBox();
  await page.mouse.move(cb.x + cb.width / 2, cb.y + cb.height / 2);
  await page.mouse.wheel(80, 60); // plain wheel: pan, not zoom
  await page.waitForTimeout(200);
  const vbAfter = await canvas.getAttribute('viewBox');
  (vbBefore !== vbAfter) ? pass('two-finger scroll pans the canvas')
    : fail('wheel did not pan the canvas');
  // And the zoom (width term of the viewBox) must NOT have changed.
  const w0 = Number(vbBefore.split(' ')[2]);
  const w1 = Number(vbAfter.split(' ')[2]);
  (Math.abs(w0 - w1) < 1e-6) ? pass('plain wheel did not zoom')
    : fail(`plain wheel changed zoom: ${w0} → ${w1}`);
}

if (errors.length) fail(`page errors: ${errors.join(' | ')}`);
else pass('zero page errors');

await browser.close();
kill();
process.exit(process.exitCode ?? 0);
