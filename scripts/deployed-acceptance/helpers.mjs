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
    loadExample: (search, exact) => _loadExample(page, search, exact),
    waitForCircuit: () =>
      page.waitForFunction(
        () => window.__circuit && window.__circuit.parts.length > 0,
        { timeout: 20_000 },
      ),
    enterSim: () => _enterSim(page),
    findRunner: () => page.evaluate(_findRunnerCode),
    screenshotPath: (name) => `/tmp/accept-${name}.png`,
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

async function _loadExample(page, searchTerm, exactTitle) {
  // Open examples panel if needed.
  const exBtn = page.locator('button', { hasText: 'Examples' }).first();
  if (await exBtn.count()) {
    await exBtn.click({ timeout: 10_000 });
    await page.waitForTimeout(1500);
  }
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
    // Fallback: try getByText click on the filtered list.
    await page.getByText(target, { exact: false }).last().click({ timeout: 10_000 });
  }
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
