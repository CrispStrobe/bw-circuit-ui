import { chromium } from 'playwright';
const idx = await (await fetch('https://crispstrobe.github.io/brickwright-lite/examples/index.json')).json();
const list = Array.isArray(idx) ? idx : idx.examples;
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1500, height: 900 } });
p.on('dialog', d => d.accept());
let pageErrs = []; p.on('pageerror', e => pageErrs.push(String(e).slice(0, 80)));

async function boot() {
  await p.goto('https://crispstrobe.github.io/brickwright-lite/?v=' + Date.now(), { waitUntil: 'networkidle', timeout: 60000 });
  await p.getByText('Circuit', { exact: false }).first().click();
  await p.waitForTimeout(2500);
}
await boot();
const results = [];
for (const ex of list) {
  const title = (ex.title && (ex.title.en || ex.title)) || ex.id;
  const isProgram = !!(ex.files && ex.files.program && ex.kind !== 'circuit');
  pageErrs = [];
  let verdict = '';
  try {
    // open gallery, search, click
    await p.locator('button', { hasText: 'Examples' }).first().click({ timeout: 8000 });
    await p.waitForTimeout(800);
    const search = p.locator('input[placeholder*="search examples"]').first();
    await search.fill(title.slice(0, 24));
    await p.waitForTimeout(600);
    const entry = p.getByText(title, { exact: false }).first();
    if (!(await entry.count())) { results.push(`${ex.id}: NOT-IN-GALLERY`); continue; }
    await entry.click({ timeout: 8000 });
    await p.waitForTimeout(isProgram ? 5000 : 3000);
    if (await p.evaluate(() => document.body.innerText.includes('Oops! Something went wrong'))) {
      results.push(`${ex.id}: CRASH`); await boot(); continue;
    }
    const st = await p.evaluate(() => {
      const parts = window.__circuit ? window.__circuit.parts.length : -1;
      const kinds = window.__circuit ? [...new Set(window.__circuit.parts.map(x => x.kind))].join('/') : '';
      const vis = !!document.querySelector('[data-sim-mode]') && document.querySelector('[data-sim-mode]').getBoundingClientRect().width > 0;
      let nets = -1; try { nets = window.__board.getNets().length; } catch {}
      return { parts, kinds, vis, nets };
    });
    verdict = `parts=${st.parts} nets=${st.nets} vis=${st.vis}`;
    if (st.parts <= 0) { results.push(`${ex.id}: EMPTY (${verdict})`); continue; }
    if (!st.vis) { results.push(`${ex.id}: DESIGNER-HIDDEN (${verdict})`); continue; }
    if (isProgram) {
      const run = p.locator('button', { hasText: 'Run' }).first();
      if (await run.isVisible().catch(() => false)) {
        await run.click(); await p.waitForTimeout(3000);
        const seen = new Set();
        for (let i = 0; i < 8; i++) {
          seen.add(await p.evaluate(() =>
            [...document.querySelectorAll('wokwi-led')].map(l => (l.value ? '1' : '0')).join('') || '-'));
          await p.waitForTimeout(450);
        }
        const stop = p.locator('button', { hasText: 'Stop' }).first();
        if (await stop.isVisible().catch(() => false)) await stop.click().catch(() => {});
        const errTxt = await p.evaluate(() => (document.body.innerText.match(/(Could not|failed|error)[^\n]{0,60}/i) || [''])[0]);
        verdict += ` runStates=${[...seen].join(',')}${errTxt ? ' MSG:' + errTxt.slice(0, 50) : ''}`;
      } else verdict += ' NO-RUN-BUTTON';
    }
    if (pageErrs.length) verdict += ` ERRS:${pageErrs[0]}`;
    results.push(`${ex.id}: ${verdict}`);
  } catch (e) {
    results.push(`${ex.id}: PROBE-FAIL ${String(e).split('\n')[0].slice(0, 60)}`);
    try { await boot(); } catch {}
  }
}
console.log(results.join('\n'));
await b.close();
