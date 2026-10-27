/**
 * Scope time-capture selector survives a host re-render between the
 * browser's `input` and `change` events (Lite CircuitUX ADC_POINT_MODE_PUBLICATION).
 * A controlled <select value> is re-synced to stale state by such a render, so
 * the user's choice is lost before React's onChange reads it.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
let chromium, browser, server;
try { ({ chromium } = await import('playwright')); } catch { /* not installed */ }
const PORT = 3191;

describe('Scope time-capture selector', { skip: !chromium && 'playwright not available' }, () => {
  before(async () => {
    server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
      stdio: 'ignore', detached: false, cwd: path.join(here, '..'),
    });
    for (let i = 0; i < 40; i++) {
      try { const r = await fetch(`http://localhost:${PORT}/`); if (r.ok) break; } catch {}
      await new Promise(r => setTimeout(r, 500));
    }
    browser = await chromium.launch();
  });
  after(async () => {
    if (browser) await browser.close();
    if (server) try { server.kill('SIGTERM'); } catch {}
  });

  async function open() {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await page.goto(`http://localhost:${PORT}/test/scope-capture-select.html`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__scopeReady === true, null, { timeout: 15000 });
    const select = page.getByTestId('bw-scope-time-capture');
    assert.equal(await select.inputValue(), 'envelope', 'envelope stays the default');
    assert.equal(await select.isDisabled(), false, 'selectable with no channel attached');
    return {page, select, errors};
  }

  it('control: plain selection switches to point sampling', async () => {
    const {page, select, errors} = await open();
    await select.selectOption('sample');
    await page.waitForFunction(() => document.querySelector('[data-testid="bw-scope-adc-enabled"]').disabled === false);
    assert.equal(await select.inputValue(), 'sample');
    assert.deepEqual(errors, []);
    await page.close();
  });

  it('a re-render between input and change does not discard the choice', async () => {
    const {page, select, errors} = await open();
    const seen = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="bw-scope-time-capture"]');
      const out = {};
      el.addEventListener('input', () => { window.__rerenderNow(); out.afterRerender = el.value; }, {once: true});
      el.addEventListener('change', () => { out.atChange = el.value; }, {once: true, capture: true});
      [...el.options].forEach(o => { o.selected = o.value === 'sample'; });
      el.dispatchEvent(new Event('input', {bubbles: true, composed: true}));
      el.dispatchEvent(new Event('change', {bubbles: true}));
      return out;
    });
    assert.equal(seen.afterRerender, 'sample', 'host re-render kept the user selection');
    assert.equal(seen.atChange, 'sample', 'change event carries the user selection');
    await page.waitForFunction(() => document.querySelector('[data-testid="bw-scope-adc-enabled"]').disabled === false,
      null, {timeout: 5000});
    assert.equal(await select.inputValue(), 'sample');
    // Programmatic state changes still reach the DOM: choosing envelope again
    // (an onChange path that also clears ADC) is reflected.
    await select.selectOption('envelope');
    await page.waitForFunction(() => document.querySelector('[data-testid="bw-scope-adc-enabled"]').disabled === true);
    assert.equal(await select.inputValue(), 'envelope');
    assert.deepEqual(errors, []);
    await page.close();
  });
});
