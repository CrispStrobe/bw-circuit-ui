#!/usr/bin/env node
/**
 * Two-finger pinch and pan on the circuit canvas, driven as real touch.
 *
 * The gesture was reported missing on iOS. useTouch implements it, and the
 * object it returns was never attached to anything - so the code read as
 * though pinch worked while no touchscreen could reach it. This drives the
 * real canvas with CDP touch points, which is the only way to produce a
 * SECOND finger: Playwright's own touchscreen API taps with one.
 *
 *   node scripts/verify-touch-pinch.mjs
 */
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const PORT = Number(process.env.BW_TOUCH_PORT || 3149);
const base = `http://localhost:${PORT}/`;

const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
  stdio: 'ignore', detached: false,
});
const stop = () => { try { server.kill('SIGTERM'); } catch { /* already gone */ } };
process.on('exit', stop);

const ready = async () => {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(base); if (r.ok) return true; } catch { /* not yet */ }
    await new Promise(r => setTimeout(r, 1000));
  }
  return false;
};
if (!await ready()) { console.error('dev server never came up'); stop(); process.exit(1); }

const failures = [];
const check = (ok, msg, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}${detail ? ` - ${detail}` : ''}`);
  if (!ok) failures.push(msg);
};

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
  const context = await browser.newContext({
    viewport: { width: 1200, height: 900 }, hasTouch: true, isMobile: false,
  });
  const page = await context.newPage();
  await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.locator('[data-canvas]').waitFor({ state: 'visible', timeout: 60000 });
  await page.locator('[data-wokwi-layer]').waitFor({ state: 'attached', timeout: 30000 });

  /**
   * Zoom read off the world->screen matrix, BY ITS NAME. The zoom percentage
   * lives in the toolbar's "more" popover and is not on screen by default, and
   * BoardCanvas warns in its own comment against finding this layer as "the
   * first div whose transform contains scale(" - palette thumbnails scale
   * themselves and come first in document order.
   */
  const matrix = async () => page.evaluate(() => {
    const el = document.querySelector('[data-wokwi-layer]');
    if (!el) return null;
    const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
    const r = n => Math.round(n * 1000) / 1000;
    return { scale: r(m.a), x: r(m.e), y: r(m.f) };
  });
  const zoom = async () => (await matrix()).scale;
  const box = await page.locator('[data-canvas]').boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  const cdp = await context.newCDPSession(page);
  /** Dispatch a real multi-touch event - two fingers is the whole point. */
  const touch = async (type, points) => {
    await cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: points.map(([x, y], i) => ({ x, y, id: i, radiusX: 4, radiusY: 4, force: 1 })),
    });
  };

  const before = await zoom();
  check(Number.isFinite(before) && before > 0, 'the canvas reports a zoom to begin with', `x${before}`);

  // Fingers 120px apart, spread to 360px: a pinch OUT, so zoom must rise.
  await touch('touchStart', [[cx - 60, cy], [cx + 60, cy]]);
  for (const half of [90, 120, 150, 180]) {
    await touch('touchMove', [[cx - half, cy], [cx + half, cy]]);
    await page.waitForTimeout(60);
  }
  await touch('touchEnd', []);
  await page.waitForTimeout(400);

  const after = await zoom();
  check(after > before, 'pinching out zooms the canvas in', `x${before} -> x${after}`);

  // And back the other way, from wherever we are now.
  await touch('touchStart', [[cx - 180, cy], [cx + 180, cy]]);
  for (const half of [150, 120, 90, 60]) {
    await touch('touchMove', [[cx - half, cy], [cx + half, cy]]);
    await page.waitForTimeout(60);
  }
  await touch('touchEnd', []);
  await page.waitForTimeout(400);

  const back = await zoom();
  check(back < after, 'pinching in zooms the canvas out', `x${after} -> x${back}`);

  // Two fingers moving TOGETHER pan rather than zoom. BOTH halves are
  // asserted: that the zoom holds, AND that the view actually moved. The
  // first half alone passed against the broken build, where nothing moved at
  // all - a check that cannot fail for the reason it was written is not a
  // check.
  const beforeM = await matrix();
  const beforePan = beforeM.scale;
  await touch('touchStart', [[cx - 60, cy], [cx + 60, cy]]);
  for (const dx of [40, 80, 120]) {
    await touch('touchMove', [[cx - 60 + dx, cy], [cx + 60 + dx, cy]]);
    await page.waitForTimeout(60);
  }
  await touch('touchEnd', []);
  await page.waitForTimeout(400);
  const afterM = await matrix();
  const afterPan = afterM.scale;
  const moved = Math.abs(afterM.x - beforeM.x) + Math.abs(afterM.y - beforeM.y);
  check(moved > 4, 'two fingers moving together pan the view',
    `moved ${Math.round(moved)}px`);
  check(Math.abs(afterPan - beforePan) <= 0.02,
    'and panning does not change the zoom', `x${beforePan} -> x${afterPan}`);
  // ── The schematic, which zoomed only from `wheel` ──────────────────
  // A touchscreen has no wheel, so this view could be panned and never
  // magnified. Reached by its aria-label because the toggle has no test id.
  await page.getByRole('radio', { name: 'Schematic view' }).click();
  await page.waitForTimeout(800);
  // BY NAME. Toolbar icons are inline <svg viewBox> too, so "the first svg
  // with a viewBox" aimed the gesture at a 16px icon while the viewBox was
  // read off something else entirely — the box and the reading have to come
  // from the SAME element or the check means nothing.
  const schematic = page.locator('[data-schematic-svg]');
  await schematic.waitFor({ state: 'visible', timeout: 30000 });

  /** The schematic's zoom is its viewBox width: smaller box = closer in. */
  const viewBoxW = async () => schematic.evaluate(el =>
    Math.round(Number(el.getAttribute('viewBox').split(/\s+/)[2]) * 100) / 100);

  const sBox = await schematic.boundingBox();
  const sx = sBox.x + sBox.width / 2;
  const sy = sBox.y + sBox.height / 2;
  const sBefore = await viewBoxW();
  check(Number.isFinite(sBefore) && sBefore > 0, 'the schematic reports a viewBox', `w=${sBefore}`);

  await touch('touchStart', [[sx - 50, sy], [sx + 50, sy]]);
  for (const half of [80, 110, 140, 170]) {
    await touch('touchMove', [[sx - half, sy], [sx + half, sy]]);
    await page.waitForTimeout(60);
  }
  await touch('touchEnd', []);
  await page.waitForTimeout(400);
  const sAfter = await viewBoxW();
  check(sAfter < sBefore, 'pinching out zooms the schematic in',
    `viewBox w ${sBefore} -> ${sAfter}`);
} finally {
  await browser.close();
  stop();
}

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log('\ntwo-finger pinch and pan reach the canvas');
