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
  // New placement flow: a palette click arms a ghost; a canvas click commits.
  const canvasBox = await page.locator('[data-canvas]').boundingBox();
  const drop = async (label, dx, dy) => {
    await page.getByText(label, { exact: label === 'Diode' }).first().click();
    await page.waitForTimeout(120);
    await page.mouse.move(canvasBox.x + canvasBox.width / 2 + dx, canvasBox.y + 60 + dy, { steps: 4 });
    await page.mouse.click(canvasBox.x + canvasBox.width / 2 + dx, canvasBox.y + 60 + dy);
    await page.waitForTimeout(150);
  };
  await drop('Resistor 1kΩ', -120, 0);
  await drop('Diode', 120, 0);
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

// 3b. Palette press → drag onto canvas → release places a breadboard, then
//     a resistor placed over it snaps onto the hole lattice.
{
  const bb = await page.getByText('Breadboard', { exact: true }).first().boundingBox();
  const canvas = await page.locator('[data-canvas]').boundingBox();
  const cx = canvas.x + canvas.width / 2, cy = canvas.y + canvas.height / 2;
  await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
  await page.mouse.down();
  await page.mouse.move(cx, cy, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const boards = await page.evaluate(() =>
    [...document.querySelectorAll('svg rect')].filter(r => r.getAttribute('fill') === '#e8e4d8').length);
  boards >= 1 ? pass('palette drag placed a breadboard substrate')
    : fail('breadboard did not appear after palette drag');
}

// 3c. A part placed ON the breadboard seats: its terminal dots must land
//     exactly on hole centres — the legs visually enter the holes.
{
  const bbRect = await page.evaluate(() => {
    const r = [...document.querySelectorAll('svg rect')].find(el => el.getAttribute('fill') === '#e8e4d8');
    if (!r) return null;
    const b = r.getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height * 0.30 }; // over the a–e block
  });
  if (!bbRect) { fail('no breadboard on canvas for the seating scenario'); }
  else {
    await page.getByText('Resistor 1kΩ', { exact: false }).first().click();
    await page.waitForTimeout(120);
    await page.mouse.move(bbRect.x, bbRect.y, { steps: 4 });
    await page.mouse.click(bbRect.x, bbRect.y);
    await page.waitForTimeout(250);
    const coincident = await page.evaluate(() => {
      const circles = [...document.querySelectorAll('svg circle')];
      // Hole dots: r=2.2 dark dots. Terminal dots: r=6|8 colored.
      const holes = circles.filter(c => c.getAttribute('r') === '2.2')
        .map(c => ({ x: +c.getAttribute('cx'), y: +c.getAttribute('cy') }));
      const terms = circles.filter(c => ['6', '8'].includes(c.getAttribute('r')))
        .map(c => ({ x: +c.getAttribute('cx'), y: +c.getAttribute('cy') }));
      let n = 0;
      for (const t of terms) {
        if (holes.some(h => Math.abs(h.x - t.x) < 0.5 && Math.abs(h.y - t.y) < 0.5)) n++;
      }
      return n;
    });
    coincident >= 2 ? pass(`seated part: ${coincident} terminal dots sit exactly in holes`)
      : fail(`seated part terminals not on holes (coincident=${coincident})`);
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
