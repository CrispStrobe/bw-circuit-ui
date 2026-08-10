// Waits for CDN, then verifies: crash-free examples (both classes), toggles, registry.
import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1500, height: 900 } });
p.on('dialog', d => d.accept());
const errs = []; p.on('pageerror', e => errs.push(String(e).slice(0, 120)));
const R = []; const step = async (n, f) => { try { R.push(n + ': ' + await f()); } catch (e) { R.push(n + ': FAIL ' + String(e).split('\n')[0].slice(0, 90)); } };
await p.goto('https://crispstrobe.github.io/brickwright-lite/?v=' + Date.now(), { waitUntil: 'networkidle', timeout: 60000 });
await p.getByText('Circuit', { exact: false }).first().click();
await p.waitForTimeout(3000);

await step('layout toggles present', async () => {
  const dbg = await p.locator('button', { hasText: 'Right' }).count();
  const fw = await p.locator('button', { hasText: 'Full width' }).count();
  return `debuggerDock=${dbg > 0} fullWidth=${fw > 0}`;
});
await step('full-width hides stage', async () => {
  await p.locator('button', { hasText: 'Full width' }).first().click();
  await p.waitForTimeout(600);
  const hidden = await p.evaluate(() => {
    const w = document.querySelector('div[class*="stage-and-target-wrapper"]');
    return w ? getComputedStyle(w).display === 'none' : 'no wrapper';
  });
  const back = await p.evaluate(() => document.documentElement.hasAttribute('data-bw-hide-stage'));
  await p.locator('button', { hasText: 'Stage' }).first().click();
  await p.waitForTimeout(400);
  const restored = await p.evaluate(() => {
    const w = document.querySelector('div[class*="stage-and-target-wrapper"]');
    return w ? getComputedStyle(w).display !== 'none' : 'no wrapper';
  });
  return `hidden=${hidden} attr=${back} restored=${restored}`;
});
await step('pure-circuit example', async () => {
  await p.locator('button', { hasText: 'Examples' }).first().click({ timeout: 8000 });
  await p.waitForTimeout(1500);
  await p.locator('input[placeholder*="search examples"]').first().fill('resistor');
  await p.waitForTimeout(800);
  await p.getByText('Resistor + LED', { exact: false }).first().click({ timeout: 8000 });
  await p.waitForTimeout(4000);
  if (await p.evaluate(() => document.body.innerText.includes('Oops'))) return 'GUI CRASHED';
  return await p.evaluate(() => `parts=[${window.__circuit?.parts.map(x => x.kind).sort().join(',')}] nets=${window.__board?.getNets?.().length} visible=${document.querySelector('[data-sim-mode]')?.getBoundingClientRect().width > 0}`);
});
await step('servo example (registry)', async () => {
  await p.locator('button', { hasText: 'Examples' }).first().click({ timeout: 8000 });
  await p.waitForTimeout(1200);
  await p.locator('input[placeholder*="search examples"]').first().fill('servo');
  await p.waitForTimeout(800);
  const entry = p.getByText(/servo/i).first();
  if (!(await entry.count())) return 'no servo example listed';
  await entry.click({ timeout: 8000 });
  await p.waitForTimeout(5000);
  if (await p.evaluate(() => document.body.innerText.includes('Oops'))) return 'GUI CRASHED';
  return await p.evaluate(() => `parts=[${window.__circuit?.parts.map(x => x.kind).sort().join(',')}] nets=${window.__board?.getNets?.().length}`);
});
await step('MCU example + Sim', async () => {
  await p.locator('button', { hasText: 'Examples' }).first().click({ timeout: 8000 });
  await p.waitForTimeout(1200);
  await p.locator('input[placeholder*="search examples"]').first().fill('blink');
  await p.waitForTimeout(800);
  await p.getByText('Blink an LED', { exact: false }).first().click({ timeout: 8000 });
  await p.waitForTimeout(6000);
  if (await p.evaluate(() => document.body.innerText.includes('Oops'))) return 'GUI CRASHED';
  const sim = p.locator('button', { hasText: 'Sim' }).first();
  if (await sim.isVisible().catch(() => false)) { await sim.click(); await p.waitForTimeout(1000); }
  const t1 = await p.evaluate(() => String(window.__board?.getTime?.() ?? 'none'));
  await p.waitForTimeout(700);
  const t2 = await p.evaluate(() => String(window.__board?.getTime?.() ?? 'none'));
  return await p.evaluate(() => `parts=[${window.__circuit?.parts.map(x => x.kind).sort().join(',')}]`) +
    ` clockFlows=${/^\d+$/.test(t1) && BigInt(t2) > BigInt(t1)}`;
});
R.push('pageerrors: ' + (errs.length ? errs.slice(0, 3).join(' | ') : 'none'));
console.log(R.join('\n'));
await b.close();
