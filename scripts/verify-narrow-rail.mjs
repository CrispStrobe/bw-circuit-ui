#!/usr/bin/env node
/**
 * The parts rail must start CLOSED on a phone and OPEN on a desktop, and the
 * canvas must actually gain the width — measured, not inferred from the flag.
 *
 * Run against a served build:  node scripts/verify-narrow-rail.mjs http://127.0.0.1:PORT
 */
import {chromium} from 'playwright';

const BASE = process.argv[2] || 'http://127.0.0.1:8711';
const fails = [];
const ok = [];
const check = (cond, msg) => (cond ? ok : fails).push(msg);

const until = async (page, expr, timeout = 20000) => {
  const t0 = Date.now();
  for (;;) {
    if (await page.evaluate(expr).catch(() => false)) return true;
    if (Date.now() - t0 > timeout) return false;
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => r())));
  }
};

const measure = async (ctx, width, height) => {
  const page = await ctx.newPage();
  await page.setViewportSize({width, height});
  await page.goto(BASE, {waitUntil: 'domcontentloaded'});
  if (!await until(page, () => !!document.querySelector('[data-selectors-open]'))) {
    return {err: 'designer never mounted'};
  }
  await until(page, () => !!document.querySelector('[data-canvas]'));
  return await page.evaluate(() => {
    const root = document.querySelector('[data-selectors-open]');
    const rail = document.querySelector('[data-selectors-rail]');
    const canvas = document.querySelector('[data-canvas]');
    return {
      open: root.getAttribute('data-selectors-open'),
      railW: rail ? Math.round(rail.getBoundingClientRect().width) : null,
      canvasW: canvas ? Math.round(canvas.getBoundingClientRect().width) : null,
      rootW: Math.round(root.getBoundingClientRect().width),
      rootScrollW: root.scrollWidth,
      docScrollW: document.documentElement.scrollWidth,
      effective: (window.visualViewport ? window.visualViewport.width * (window.visualViewport.scale || 1) : innerWidth),
    };
  }).finally(() => page.close());
};

const browser = await chromium.launch();
try {
  const phone = await browser.newContext({deviceScaleFactor: 3, hasTouch: true, isMobile: true});
  const p = await measure(phone, 430, 930);
  console.log('phone portrait 430x930 ->', JSON.stringify(p));
  check(!p.err, `phone mounts (${p.err || 'ok'})`);
  check(p.open === 'false', `rail starts closed on a phone (data-selectors-open=${p.open})`);
  check(p.railW === 0, `closed rail occupies no width (${p.railW}px)`);
  // THE WHOLE POINT, and stated so it cannot pass on the unfixed build: the
  // bench must FIT the screen. A canvas wider than its own root is a bench
  // running off the side of the phone, which is what a 700px floor did.
  check(p.canvasW !== null && p.canvasW <= p.rootW + 1,
    `canvas fits inside the designer, not off the side (${p.canvasW} of ${p.rootW})`);
  check(p.canvasW !== null && p.canvasW > p.rootW * 0.9,
    `and still takes >90% of it (${p.canvasW} of ${p.rootW})`);
  check(p.docScrollW <= 431, `no horizontal page overflow (scrollWidth ${p.docScrollW} vs 430)`);

  const land = await measure(phone, 930, 430);
  console.log('phone landscape 930x430 ->', JSON.stringify(land));
  // 930 effective points is NOT a small screen by this threshold, and should
  // not be: 190 of 930 is 20% for the rail, and the bench keeps 740. The
  // threshold means phone-portrait, not phone-anything.
  check(land.open === 'true', `landscape 930 keeps its rail — 700 is a portrait threshold (${land.open})`);
  check(land.canvasW <= land.rootW + 1, `landscape bench still fits (${land.canvasW} of ${land.rootW})`);

  // The toggle still works — a default, not a removal.
  const page = await phone.newPage();
  await page.setViewportSize({width: 430, height: 930});
  await page.goto(BASE, {waitUntil: 'domcontentloaded'});
  await until(page, () => !!document.querySelector('[data-selectors-open]'));
  const btn = page.getByRole('button', {name: 'Expand Selectors Panel'});
  const visible = await btn.isVisible().catch(() => false);
  check(visible, 'the expand toggle is visible on a phone');
  if (visible) {
    await btn.click();
    const opened = await until(page, () => document.querySelector('[data-selectors-open]')?.getAttribute('data-selectors-open') === 'true', 5000);
    check(opened, 'tapping the toggle opens the rail');
    const w = await page.evaluate(() => Math.round(document.querySelector('[data-selectors-rail]').getBoundingClientRect().width));
    check(w >= 180, `an opened rail is the full 190px, not a sliver (${w}px)`);
  }
  await page.close();

  const desk = await measure(await browser.newContext(), 1440, 900);
  console.log('desktop 1440x900 ->', JSON.stringify(desk));
  check(desk.open === 'true', `DESKTOP IS UNCHANGED: rail still starts open (${desk.open})`);
  check(desk.railW >= 180, `desktop rail is the full 190px (${desk.railW}px)`);
} finally {
  await browser.close();
}

for (const m of ok) console.log(`  ok   ${m}`);
for (const m of fails) console.log(`  FAIL ${m}`);
console.log(`\n${ok.length} passed, ${fails.length} failed`);
process.exit(fails.length ? 1 : 0);
