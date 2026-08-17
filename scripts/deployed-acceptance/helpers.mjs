/**
 * Shared helpers for the deployed-acceptance probe suite.
 *
 * Each probe script imports { createHarness } and calls it to get a
 * page + utility bag. The run-all harness manages browser lifetime and
 * result collection externally.
 */
import { chromium } from 'playwright';

export const DEFAULT_URL =
  'https://crispstrobe.github.io/brickwright-lite/';

/** Resolve the proof URL from argv / env / default. */
export function resolveUrl() {
  return (
    process.argv[2] ||
    process.env.PROOF_URL ||
    DEFAULT_URL
  );
}

/** Launch browser + page for a single standalone probe run. */
export async function createHarness(opts = {}) {
  const url = opts.url || resolveUrl();
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1500, height: 900 },
  });
  page.on('pageerror', () => {});
  page.on('dialog', (d) => d.accept());

  return { browser, page, url, ...makeUtils(page, url) };
}

/** Build a utility bag around an existing page (used by run-all). */
export function makeUtils(page, url) {
  return {
    goToCircuit: () => _goToCircuit(page, url),
    loadExample: (search, exact, device) => _loadExample(page, search, exact, device),
    waitForCircuit: () =>
      page.waitForFunction(
        () => window.__circuit && window.__circuit.parts.length > 0,
        { timeout: 20_000 },
      ),
    enterSim: () => _enterSim(page),
    findRunner: () => page.evaluate(_findRunnerCode),
    screenshotPath: (name) => `/tmp/accept-${name}.png`,
    openDebugger: () => _openDebugger(page),
  };
}

// ── internal helpers ────────────────────────────────────────────────

async function _goToCircuit(page, url) {
  await page.goto(
    url + (url.includes('?') ? '&' : '?') + 'v=' + Date.now(),
    { waitUntil: 'networkidle', timeout: 60_000 },
  );
  try {
    await page
      .getByText('Circuit', { exact: false })
      .first()
      .click({ timeout: 15_000 });
    await page.waitForTimeout(3000);
  } catch {
    /* standalone dev harness — no tab */
  }
}

async function _loadExample(page, searchTerm, exactTitle, deviceHint) {
  // Open examples panel if needed.
  const exBtn = page.locator('button', { hasText: 'Examples' }).first();
  if (await exBtn.count()) {
    await exBtn.click({ timeout: 10_000 });
    await page.waitForTimeout(1500);
  }
  // Clear stale device choices so the dialog picks the authoring device.
  await page.evaluate(() => {
    try { localStorage.removeItem('bw-example-device'); } catch { /* */ }
  });
  // Type into search.
  const search = page.locator('input[placeholder*="example"]').first();
  if (await search.count()) {
    await search.fill(searchTerm);
    await page.waitForTimeout(1200);
  }
  // Click the matching entry via evaluate — target divs with onclick + cursor:pointer.
  const target = exactTitle || searchTerm;
  const clicked = await page.evaluate((term) => {
    const entry = [...document.querySelectorAll('div')].find(
      (e) =>
        e.onclick &&
        getComputedStyle(e).cursor === 'pointer' &&
        e.textContent.includes(term),
    );
    if (entry) { entry.click(); return true; }
    return false;
  }, target);
  if (!clicked) {
    await search.fill('');
    await page.waitForTimeout(500);
    await search.fill(searchTerm);
    await page.waitForTimeout(1500);
    await page.evaluate((term) => {
      const entry = [...document.querySelectorAll('div')].find(
        (e) =>
          e.onclick &&
          getComputedStyle(e).cursor === 'pointer' &&
          e.textContent.includes(term),
      );
      if (entry) entry.click();
    }, target);
  }
  // If a confirm dialog appeared (device-chooser from task 2), select
  // the requested device in the dropdown (if specified), then click OK.
  await page.waitForTimeout(800);
  try {
    const okBtn = page.locator('button', { hasText: 'OK' }).first();
    if (await okBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      // If a specific device was requested, select it in the dialog's
      // dropdown and wait for React to re-render.
      if (deviceHint) {
        try {
          const sel = page.locator('[data-device-chooser-select]').first();
          if (await sel.isVisible({ timeout: 500 }).catch(() => false)) {
            await sel.selectOption(deviceHint);
            await page.waitForTimeout(500);
          } else {
            // Fallback: try the label-adjacent select.
            const chipLabel = page.locator('label', { hasText: 'Chip' });
            if (await chipLabel.isVisible({ timeout: 300 }).catch(() => false)) {
              const fallbackSel = chipLabel.locator('..').locator('select').first();
              if (await fallbackSel.isVisible({ timeout: 300 }).catch(() => false)) {
                await fallbackSel.selectOption(deviceHint);
                await page.waitForTimeout(500);
              }
            }
          }
        } catch { /* no dropdown or device not available */ }
      }
      await okBtn.click();
    }
  } catch { /* no dialog — direct load (pre-task-2 deploy) */ }
  await page.waitForTimeout(5000);
  try {
    await page.waitForFunction(
      () => window.__circuit && window.__circuit.parts.length > 0,
      { timeout: 20_000 },
    );
  } catch { /* may already be ready */ }
  await page.waitForTimeout(500);
}

async function _enterSim(page) {
  try {
    // Try Sim button (standalone circuit UI).
    const simBtn = page.locator('button', { hasText: /Sim/i }).first();
    if (await simBtn.isVisible().catch(() => false)) {
      await simBtn.click();
      await page.waitForTimeout(1500);
      return;
    }

    // Try green flag / play button (Scratch GUI drives the circuit sim).
    const greenFlag = page.locator('img[title="Go"]').first();
    if (await greenFlag.isVisible().catch(() => false)) {
      await greenFlag.click();
      await page.waitForTimeout(2000);
      return;
    }
  } catch { /* might already be in Sim */ }
}

async function _openDebugger(page) {
  try {
    const btn = page.locator('button[title="Debugger"]').first();
    if (await btn.isVisible().catch(() => false)) {
      await btn.click();
      await page.waitForTimeout(2000);
    }
  } catch { /* debugger panel might already be open or not available */ }
}

const _findRunnerCode = `(() => {
  for (const node of document.querySelectorAll('*')) {
    for (const key of Object.keys(node)) {
      if (!key.startsWith('__reactFiber\$')) continue;
      let f = node[key];
      for (let i = 0; i < 30 && f; i++) {
        if (f.stateNode?.state?.runner) {
          const r = f.stateNode.state.runner;
          return {
            found: true,
            hasVideo: typeof r.video === 'function',
            hasLoadRom: typeof r.loadRom === 'function',
          };
        }
        f = f.return;
      }
    }
  }
  return { found: false };
})()`;
