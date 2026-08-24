// Profile the running calculator: 12 s CPU profile + sim-vs-wall clock ratio.
import { chromium } from 'playwright';
import fs from 'node:fs';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1760, height: 1100 } });
page.on('dialog', d => d.accept());
await page.addInitScript(() => { localStorage.clear(); });
await page.goto('http://localhost:8931/', { waitUntil: 'networkidle', timeout: 90000 });
await page.waitForSelector('[role="tab"]', { timeout: 60000 });
try { await page.locator('button', { hasText: 'Not now' }).first().click({ timeout: 3000 }); } catch {}
await page.locator('[role="tab"]', { hasText: /Circuit/ }).first().click({ force: true });
await page.waitForTimeout(2500);
await page.locator('input[type="search"], input[placeholder*="earch"]').first().fill('calculator');
await page.waitForTimeout(800);
await page.locator('text=Pocket Calculator').first().click();
try { await page.locator('button', { hasText: 'OK' }).first().click({ timeout: 5000 }); } catch {}
await page.waitForTimeout(5000);
await page.locator('button[title*="Run"], button:has-text("▶")').first().click({ force: true });
await page.waitForTimeout(6000);
// sim-vs-wall: sample board time twice
const t1 = await page.evaluate(() => ({ wall: performance.now(), sim: Number(window.__board?.timeNs ?? 0n) }));
const cdp = await page.context().newCDPSession(page);
await cdp.send('Profiler.enable');
await cdp.send('Profiler.start');
await page.waitForTimeout(12000);
const { profile } = await cdp.send('Profiler.stop');
const t2 = await page.evaluate(() => ({ wall: performance.now(), sim: Number(window.__board?.timeNs ?? 0n) }));
const wallMs = t2.wall - t1.wall;
const simMs = (t2.sim - t1.sim) / 1e6;
console.log(`CLOCK: wall ${wallMs.toFixed(0)} ms, sim ${simMs.toFixed(0)} ms, ratio ${(simMs / wallMs).toFixed(3)}`);
fs.writeFileSync('/private/tmp/claude-501/-Users-christianstrobele-code-lego-brickwright-lite/01dedbed-4ab0-4c4f-8804-052b633df685/scratchpad/calc.cpuprofile', JSON.stringify(profile));
// top self-time
const nodes = new Map(profile.nodes.map(n => [n.id, n]));
const self = new Map();
const dt = profile.timeDeltas || [];
profile.samples.forEach((id, i) => self.set(id, (self.get(id) || 0) + (dt[i] || 0)));
const top = [...self.entries()].map(([id, us]) => {
  const n = nodes.get(id); const f = n.callFrame;
  return { us, fn: f.functionName || '(anon)', url: (f.url || '').split('/').pop().slice(0, 40), line: f.lineNumber };
}).sort((a, b) => b.us - a.us).slice(0, 18);
for (const t of top) console.log(`${(t.us / 1000).toFixed(0).padStart(6)} ms  ${t.fn}  ${t.url}:${t.line}`);
await browser.close();
