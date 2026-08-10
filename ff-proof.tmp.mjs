import { firefox } from 'playwright';
const b = await firefox.launch();
const ctx = await b.newContext({ viewport: { width: 1500, height: 900 } });
const p = await ctx.newPage();
const errs = []; p.on('pageerror', e => errs.push(String(e).slice(0, 200)));
const con = []; p.on('console', m => { if (m.type() === 'error') con.push(m.text().slice(0, 200)); });
const URL = 'https://crispstrobe.github.io/brickwright-lite/';

// Visit 1: register the service worker, leave an autosave behind like a real user.
await p.goto(URL, { waitUntil: 'load', timeout: 60000 });
await p.waitForTimeout(8000); // let SW install + precache
// Visit 2: now everything routes through the worker — the user's world.
await p.goto(URL, { waitUntil: 'load', timeout: 60000 });
await p.waitForTimeout(5000);
const R = [];
R.push(`SW controlled: ${await p.evaluate(() => !!navigator.serviceWorker?.controller)}`);
try {
  await p.getByText('Circuit', { exact: false }).first().click({ timeout: 10000 });
  await p.waitForTimeout(3000);
  await p.locator('button', { hasText: 'Examples' }).first().click({ timeout: 10000 });
  await p.waitForTimeout(3000);
  const blink = p.getByText('Blink an LED', { exact: false }).first();
  const n = await blink.count();
  R.push(`examples list: ${n ? 'RENDERS' : 'EMPTY/MISSING'}`);
  if (n) {
    await blink.click({ timeout: 10000 });
    await p.waitForTimeout(3500);
    R.push(`loaded: parts=${await p.evaluate(() => window.__circuit?.parts.length ?? 'NO __circuit')}, designer alive=${await p.evaluate(() => !!document.querySelector('[data-sim-mode]'))}`);
  }
} catch (e) { R.push(`STEP FAILED: ${String(e).split('\n')[0]}`); }
R.push(`crash banner: ${await p.evaluate(() => document.body.innerText.includes('Error:') ? document.body.innerText.match(/Error:[^\n]*/)?.[0] : 'none')}`);
R.push(`pageerrors: ${errs.length ? errs.join(' | ') : 'none'}`);
R.push(`console errors: ${con.length ? con.slice(0,4).join(' | ') : 'none'}`);
console.log(R.join('\n'));
await b.close();
