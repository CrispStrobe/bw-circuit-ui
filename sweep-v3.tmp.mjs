// v3: program examples wait for the debugger to reach 'running', then sample
// LEDs over a 10s window. Pure-circuit examples check load + conduction.
import { chromium } from 'playwright';
const idx = await (await fetch('https://crispstrobe.github.io/brickwright-lite/examples/index.json')).json();
const list = Array.isArray(idx) ? idx : idx.examples;
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1500, height: 900 } });
p.on('dialog', d => d.accept());
let pageErrs = []; p.on('pageerror', e => pageErrs.push(String(e).slice(0, 70)));
async function boot() {
  await p.goto('https://crispstrobe.github.io/brickwright-lite/?v=' + Date.now(), { waitUntil: 'load', timeout: 90000 });
  await p.waitForTimeout(6000);
  await p.getByText('Circuit', { exact: false }).first().click();
  await p.waitForTimeout(2500);
}
const panel = () => p.locator('div[class*="tab-panel"]');
await boot();
const results = [];
for (const ex of list) {
  const title = (ex.title && (ex.title.en || ex.title)) || ex.id;
  const isProgram = !!(ex.files && ex.files.program && ex.kind !== 'circuit');
  pageErrs = [];
  try {
    await p.getByText('Circuit', { exact: false }).first().click().catch(() => {});
    await p.waitForTimeout(600);
    await panel().locator('button', { hasText: 'Examples' }).first().click({ timeout: 8000 });
    await p.waitForTimeout(800);
    const search = panel().locator('input[placeholder*="search examples"]').first();
    await search.fill(title.slice(0, 22));
    await p.waitForTimeout(500);
    const entry = panel().getByText(title, { exact: false }).first();
    if (!(await entry.count())) { results.push(`${ex.id}: NOT-IN-GALLERY`); continue; }
    await entry.click({ timeout: 8000 });
    await p.waitForTimeout(isProgram ? 5000 : 3000);
    if (await p.evaluate(() => document.body.innerText.includes('Oops! Something went wrong'))) {
      results.push(`${ex.id}: CRASH`); await boot(); continue;
    }
    const st = await p.evaluate(() => ({
      parts: window.__circuit ? window.__circuit.parts.length : -1,
      nets: (() => { try { return window.__board.getNets().length; } catch { return -1; } })(),
    }));
    let verdict = `parts=${st.parts} nets=${st.nets}`;
    if (st.parts <= 0) { results.push(`${ex.id}: EMPTY`); continue; }
    if (isProgram) {
      await p.getByText('Circuit', { exact: false }).first().click().catch(() => {});
      await p.waitForTimeout(600);
      const run = panel().locator('button', { hasText: 'Run' }).first();
      if (await run.isVisible().catch(() => false)) {
        await run.click();
        // wait for 'running' (compile can take seconds)
        let running = false;
        for (let i = 0; i < 30; i++) {
          if (await p.evaluate(() => /\brunning\b/.test(document.body.innerText))) { running = true; break; }
          await p.waitForTimeout(500);
        }
        const seen = new Set();
        for (let i = 0; i < 20; i++) {
          seen.add(await p.evaluate(() =>
            [...document.querySelectorAll('wokwi-led')].map(l => (l.value ? '1' : '0')).join('') || '-'));
          await p.waitForTimeout(500);
        }
        const stop = panel().locator('button', { hasText: 'Stop' }).first();
        if (await stop.isVisible().catch(() => false)) await stop.click().catch(() => {});
        verdict += ` running=${running} states=${[...seen].slice(0, 6).join(',')}`;
      } else verdict += ' NO-RUN';
    }
    if (pageErrs.length) verdict += ` ERR:${pageErrs[0].slice(0, 50)}`;
    results.push(`${ex.id}: ${verdict}`);
  } catch (e) {
    results.push(`${ex.id}: PROBE-FAIL ${String(e).split('\n')[0].slice(0, 50)}`);
    try { await boot(); } catch {}
  }
}
console.log(results.join('\n'));
await b.close();
