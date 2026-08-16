#!/usr/bin/env node
/**
 * Deployed-page probes — permanent regression gate for the live GH Pages site.
 *
 * Runs Playwright against an already-deployed URL (no local server) and
 * verifies rendering invariants, z-ordering, simulation acceptance, and
 * circuit-data fidelity that unit tests cannot reach.
 *
 * Usage:
 *   PROOF_URL=https://crispstrobe.github.io/brickwright-lite/ node scripts/deployed-probes.mjs
 *   node scripts/deployed-probes.mjs https://crispstrobe.github.io/brickwright-lite/
 *
 * Requires: playwright (npm install playwright)
 */

import { chromium } from 'playwright';

const PROOF_URL = process.argv[2]
  || process.env.PROOF_URL
  || 'https://crispstrobe.github.io/brickwright-lite/';
const TIMEOUT = 60_000;

const results = [];
let exitCode = 0;
const fail = (msg) => { console.error(`✖ ${msg}`); results.push(`FAIL: ${msg}`); exitCode = 1; };
const pass = (msg) => { console.log(`✔ ${msg}`); results.push(`OK: ${msg}`); };
const step = async (name, fn) => {
  try { await fn(); } catch (e) {
    fail(`${name}: ${String(e).split('\n')[0].slice(0, 120)}`);
  }
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(String(e).slice(0, 200)));
page.on('dialog', d => d.accept());

// ── Navigate to the Circuit tab ────────────────────────────────────
console.log(`\nDeployed probes against ${PROOF_URL}\n`);
await page.goto(PROOF_URL + (PROOF_URL.includes('?') ? '&' : '?') + 'v=' + Date.now(), {
  waitUntil: 'networkidle', timeout: TIMEOUT,
});
// brickwright-lite is a tabbed GUI; click the Circuit tab.
try {
  await page.getByText('Circuit', { exact: false }).first().click({ timeout: 15_000 });
  await page.waitForTimeout(3000);
} catch {
  // Standalone dev harness has no tabs — circuit is already visible.
}

// Helper: load an example by name via the Examples browser.
async function loadExample(name) {
  const exBtn = page.locator('button', { hasText: 'Examples' }).first();
  if (await exBtn.count()) {
    await exBtn.click({ timeout: 10_000 });
    await page.waitForTimeout(1500);
  }
  const search = page.locator('input[placeholder*="search"]').first();
  if (await search.count()) {
    await search.fill(name);
    await page.waitForTimeout(800);
  }
  await page.getByText(name, { exact: false }).first().click({ timeout: 10_000 });
  await page.waitForTimeout(5000);
  // Wait for circuit model to be ready.
  await page.waitForFunction(
    () => window.__circuit && window.__circuit.parts.length > 0,
    { timeout: 20_000 },
  );
  await page.waitForTimeout(500);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PROBE 4: Blink an LED — exactly 3 tagged jumpers, zero untagged twins
// (Run first because it sets up the circuit the other probes also use.)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
await step('probe 4: Blink an LED', async () => {
  await loadExample('Blink an LED');

  // 4a. Count tagged jumpers ([data-jumper] groups in the SVG).
  const taggedCount = await page.locator('[data-jumper]').count();

  // 4b. Count untagged twins: stroked <path> elements inside the canvas
  // SVG that share endpoints with a tagged jumper but lack data-jumper.
  // These would be duplicate renders from a second renderer.
  const untaggedTwins = await page.evaluate(() => {
    const svg = document.querySelector('[data-canvas] svg') || document.querySelector('svg');
    if (!svg) return -1;
    // Collect endpoint pairs from tagged jumpers.
    const tagged = new Set();
    for (const g of svg.querySelectorAll('[data-jumper]')) {
      const p = g.querySelector('path');
      if (!p) continue;
      const d = p.getAttribute('d') || '';
      // Extract start M and end coordinates.
      const mMatch = d.match(/^M\s*([\d.e+-]+)\s+([\d.e+-]+)/);
      const coords = d.match(/[\d.e+-]+/g);
      if (mMatch && coords && coords.length >= 2) {
        const key = `${mMatch[1]},${mMatch[2]}→${coords[coords.length - 2]},${coords[coords.length - 1]}`;
        tagged.add(key);
      }
    }
    // Now find stroked paths NOT inside a [data-jumper] that share those endpoints.
    let twins = 0;
    for (const p of svg.querySelectorAll('path')) {
      if (p.closest('[data-jumper]')) continue;
      const stroke = p.getAttribute('stroke');
      if (!stroke || stroke === 'none') continue;
      const d = p.getAttribute('d') || '';
      const mMatch = d.match(/^M\s*([\d.e+-]+)\s+([\d.e+-]+)/);
      const coords = d.match(/[\d.e+-]+/g);
      if (mMatch && coords && coords.length >= 2) {
        const key = `${mMatch[1]},${mMatch[2]}→${coords[coords.length - 2]},${coords[coords.length - 1]}`;
        if (tagged.has(key)) twins++;
      }
    }
    return twins;
  });

  taggedCount === 3
    ? pass(`Blink an LED: exactly ${taggedCount} tagged jumpers`)
    : fail(`Blink an LED: expected 3 tagged jumpers, got ${taggedCount}`);
  untaggedTwins === 0
    ? pass('Blink an LED: zero untagged twins')
    : fail(`Blink an LED: ${untaggedTwins} untagged twin(s) found`);
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PROBE 1: Single-renderer guard
// No two stroked elements may share endpoints for one jumper.
// Drawing one wire via addHoleWire must add EXACTLY one element.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
await step('probe 1: single-renderer guard', async () => {
  // 1a. Check existing jumpers: each [data-jumper] path's endpoints must
  // not appear in any other stroked element (no double-draw).
  const dupes = await page.evaluate(() => {
    const svg = document.querySelector('[data-canvas] svg') || document.querySelector('svg');
    if (!svg) return { err: 'no svg' };
    const jumperPaths = svg.querySelectorAll('[data-jumper] path');
    let dupeCount = 0;
    for (const jp of jumperPaths) {
      const d = jp.getAttribute('d') || '';
      const coords = d.match(/[\d.e+-]+/g);
      if (!coords || coords.length < 4) continue;
      // Start and end of this jumper path.
      const startX = parseFloat(coords[0]), startY = parseFloat(coords[1]);
      const endX = parseFloat(coords[coords.length - 2]), endY = parseFloat(coords[coords.length - 1]);
      // Find any OTHER stroked element with matching endpoints.
      for (const el of svg.querySelectorAll('path, line, polyline')) {
        if (el === jp) continue;
        if (el.closest('[data-jumper]') === jp.closest('[data-jumper]')) continue;
        const stroke = el.getAttribute('stroke');
        if (!stroke || stroke === 'none') continue;
        const ed = el.getAttribute('d') || '';
        const ec = ed.match(/[\d.e+-]+/g);
        if (!ec || ec.length < 4) continue;
        const esx = parseFloat(ec[0]), esy = parseFloat(ec[1]);
        const eex = parseFloat(ec[ec.length - 2]), eey = parseFloat(ec[ec.length - 1]);
        const eps = 0.5;
        const matchStart = Math.abs(esx - startX) < eps && Math.abs(esy - startY) < eps;
        const matchEnd = Math.abs(eex - endX) < eps && Math.abs(eey - endY) < eps;
        if (matchStart && matchEnd) dupeCount++;
      }
    }
    return { dupeCount };
  });

  (dupes.dupeCount === 0)
    ? pass('single-renderer: no two stroked elements share endpoints for one jumper')
    : fail(`single-renderer: ${dupes.dupeCount} duplicate endpoint pair(s) found`);

  // 1b. addHoleWire must add EXACTLY one [data-jumper] element.
  const addResult = await page.evaluate(() => {
    const c = window.__circuit;
    if (!c) return { err: 'no __circuit' };
    const bb = c.parts.find(p => p.kind === 'breadboard');
    if (!bb) return { err: 'no breadboard' };
    const svg = document.querySelector('[data-canvas] svg') || document.querySelector('svg');
    const before = svg ? svg.querySelectorAll('[data-jumper]').length : -1;
    // Find two free holes to wire. Pick bottom-row holes far from existing
    // parts/wires: row 'j' columns 55 and 60.
    const ref = c.addHoleWire(bb.id, 'j55', 'j60', '#00ff00');
    return { ref, before };
  });

  if (addResult.err) {
    fail(`addHoleWire setup: ${addResult.err}`);
  } else {
    // Wait a frame for React to re-render.
    await page.waitForTimeout(600);
    const after = await page.evaluate(() => {
      const svg = document.querySelector('[data-canvas] svg') || document.querySelector('svg');
      return svg ? svg.querySelectorAll('[data-jumper]').length : -1;
    });
    const added = after - addResult.before;
    if (addResult.ref && added === 1) {
      pass('addHoleWire adds EXACTLY one [data-jumper] element');
    } else if (!addResult.ref) {
      // Holes might be occupied — try alternative holes.
      fail(`addHoleWire returned null (holes occupied or invalid); before=${addResult.before}`);
    } else {
      fail(`addHoleWire added ${added} element(s), expected exactly 1`);
    }

    // Clean up: remove the test wire.
    if (addResult.ref) {
      await page.evaluate((ref) => window.__circuit.removeHoleWire(ref), addResult.ref);
      await page.waitForTimeout(300);
    }
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PROBE 2: Z spot-check — jumper paths must be AFTER chip bodies
// in SVG document order (later = painted on top).
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
await step('probe 2: z spot-check', async () => {
  const zOrder = await page.evaluate(() => {
    const svg = document.querySelector('[data-canvas] svg') || document.querySelector('svg');
    if (!svg) return { err: 'no svg' };
    // Collect all elements in document order.
    const all = [...svg.querySelectorAll('*')];
    // Find the LAST chip body element (MCU DIP rect with fill="#1a1a1a",
    // or any [data-dip-body] group).
    let lastChipIdx = -1;
    for (let i = 0; i < all.length; i++) {
      const el = all[i];
      if (el.getAttribute('data-dip-body')
        || (el.tagName === 'rect' && el.getAttribute('fill') === '#1a1a1a'
            && el.closest('g[pointer-events="none"], g[pointerevents="none"]')
            && !el.closest('[data-jumper]'))) {
        lastChipIdx = i;
      }
    }
    // Find the FIRST jumper path.
    let firstJumperIdx = -1;
    for (let i = 0; i < all.length; i++) {
      if (all[i].closest('[data-jumper]')) { firstJumperIdx = i; break; }
    }
    return { lastChipIdx, firstJumperIdx };
  });

  if (zOrder.err) {
    fail(`z spot-check: ${zOrder.err}`);
  } else if (zOrder.firstJumperIdx === -1) {
    // No jumpers on this circuit — vacuously true.
    pass('z spot-check: no jumpers present (vacuous)');
  } else if (zOrder.lastChipIdx === -1) {
    pass('z spot-check: no chip bodies present (vacuous)');
  } else if (zOrder.firstJumperIdx > zOrder.lastChipIdx) {
    pass(`z spot-check: jumper paths after chip bodies (idx ${zOrder.firstJumperIdx} > ${zOrder.lastChipIdx})`);
  } else {
    fail(`z spot-check: first jumper at idx ${zOrder.firstJumperIdx}, last chip body at idx ${zOrder.lastChipIdx} — jumpers must come after`);
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PROBE 3: Blinkenrocket pendant acceptance
// Engine=ATtiny88, matrix brightness > 0, button press reading.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
await step('probe 3: Blinkenrocket pendant', async () => {
  // Reload to clear previous circuit state.
  await page.goto(PROOF_URL + (PROOF_URL.includes('?') ? '&' : '?') + 'v=' + Date.now(), {
    waitUntil: 'networkidle', timeout: TIMEOUT,
  });
  try {
    await page.getByText('Circuit', { exact: false }).first().click({ timeout: 15_000 });
    await page.waitForTimeout(3000);
  } catch { /* standalone — no tab */ }

  await loadExample('Blinkenrocket');

  await page.screenshot({ path: '/tmp/probe-pendant-matrix.png' });

  // 3a. Engine should be ATtiny88 — chip label must read "ATtiny88".
  const chipLabel = await page.evaluate(() => {
    const texts = [...document.querySelectorAll('svg text')];
    return texts.map(t => t.textContent).find(t => /ATtiny88/i.test(t)) || null;
  });
  chipLabel
    ? pass(`pendant: engine label "${chipLabel}"`)
    : fail('pendant: ATtiny88 chip label not found');

  // 3b. Matrix brightness > 0 — the 8x8 LED matrix must have at least one
  // lit dot. Use the board's getDeviceState or check rendered SVG fill.
  const matrixBright = await page.evaluate(() => {
    const board = window.__activeBoard || window.__board;
    if (!board) return { err: 'no board' };
    // Check device state for matrix brightness.
    const c = window.__circuit;
    if (!c) return { err: 'no circuit' };
    const matrix = c.parts.find(p => p.kind === 'matrix8x8');
    if (!matrix) return { err: 'no matrix8x8 part' };
    if (board.getDeviceState) {
      const ds = board.getDeviceState(matrix.id);
      if (ds && ds.brightness) {
        const maxBr = Math.max(...ds.brightness);
        return { maxBrightness: maxBr, source: 'deviceState' };
      }
    }
    // Fallback: check rendered SVG dots (circle fills).
    const dots = [...document.querySelectorAll('svg circle')]
      .filter(el => {
        const fill = el.getAttribute('fill') || '';
        return /^rgba?\(255,/.test(fill) && !fill.includes(',0)');
      });
    return { litDots: dots.length, source: 'svg' };
  });

  if (matrixBright.err) {
    fail(`pendant matrix: ${matrixBright.err}`);
  } else if (matrixBright.source === 'deviceState') {
    matrixBright.maxBrightness > 0
      ? pass(`pendant: matrix brightness ${matrixBright.maxBrightness.toFixed(3)} > 0`)
      : fail('pendant: matrix brightness is 0 (all LEDs dark)');
  } else {
    matrixBright.litDots > 0
      ? pass(`pendant: ${matrixBright.litDots} lit matrix dots in SVG`)
      : fail('pendant: zero lit matrix dots in SVG');
  }

  // 3c. Button press: press btnL, verify getControl reads 1 and PC3 reads 1.
  const btnResult = await page.evaluate(() => {
    const c = window.__circuit;
    const board = window.__activeBoard || window.__board;
    if (!c || !board) return { err: 'no circuit or board' };
    // Find the button part labelled 'btnL' (by declName or id pattern).
    const btn = c.parts.find(p =>
      p.kind === 'button' && (p.declName === 'btnL' || (p.id && /btnL/i.test(p.id)))
    ) || c.parts.find(p => p.kind === 'button'); // fallback: first button
    if (!btn) return { err: 'no button part found' };
    // Press the button.
    c.setControl(btn.id, 1);
    // Read the control value.
    const controls = board.getControls ? board.getControls() : [];
    const ctrl = controls.find(x => x.id === btn.id);
    const controlVal = ctrl ? ctrl.value : null;
    // Read pin PC3.
    let pinVal = null;
    try { pinVal = board.readPin ? board.readPin('PC3') : null; } catch { /* pin may not exist */ }
    // Release.
    c.setControl(btn.id, 0);
    return { btnId: btn.id, controlVal, pinVal };
  });

  if (btnResult.err) {
    fail(`pendant button: ${btnResult.err}`);
  } else {
    btnResult.controlVal === 1
      ? pass(`pendant: getControl('${btnResult.btnId}') === 1 while held`)
      : fail(`pendant: control value ${btnResult.controlVal}, expected 1`);
    btnResult.pinVal === 1
      ? pass('pendant: readPin(\'PC3\') === 1 while held')
      : fail(`pendant: readPin('PC3') = ${btnResult.pinVal}, expected 1`);
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PROBE 5: 05-counter-7seg — seven-segment values must change over time
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
await step('probe 5: counter 7-seg', async () => {
  // Reload for a clean circuit.
  await page.goto(PROOF_URL + (PROOF_URL.includes('?') ? '&' : '?') + 'v=' + Date.now(), {
    waitUntil: 'networkidle', timeout: TIMEOUT,
  });
  try {
    await page.getByText('Circuit', { exact: false }).first().click({ timeout: 15_000 });
    await page.waitForTimeout(3000);
  } catch { /* standalone */ }

  await loadExample('Counter');

  // Enter Sim mode so the engine runs.
  try {
    const simBtn = page.locator('button', { hasText: /Sim/i }).first();
    if (await simBtn.isVisible().catch(() => false)) {
      await simBtn.click();
      await page.waitForTimeout(1500);
    }
  } catch { /* might already be in Sim */ }

  // Sample 1: read all WokwiSevenSegment values via their segment attributes.
  const sample1 = await page.evaluate(() => {
    const segs = document.querySelectorAll('wokwi-7segment');
    if (segs.length === 0) return null;
    return [...segs].map(el => {
      // Read the values prop or the element's displayed segments.
      const vals = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'dp']
        .map(s => el.getAttribute(s) || el[s] || '0');
      return vals.join(',');
    }).join('|');
  });

  await page.screenshot({ path: '/tmp/probe-counter-7seg-t0.png' });

  // Wait 1 second for the counter to advance.
  await page.waitForTimeout(1200);

  const sample2 = await page.evaluate(() => {
    const segs = document.querySelectorAll('wokwi-7segment');
    if (segs.length === 0) return null;
    return [...segs].map(el => {
      const vals = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'dp']
        .map(s => el.getAttribute(s) || el[s] || '0');
      return vals.join(',');
    }).join('|');
  });

  await page.screenshot({ path: '/tmp/probe-counter-7seg-t1.png' });

  if (sample1 === null || sample2 === null) {
    fail('counter 7-seg: no wokwi-7segment elements found');
  } else if (sample1 !== sample2) {
    pass(`counter 7-seg: segments changed ("${sample1.slice(0, 40)}" → "${sample2.slice(0, 40)}")`);
  } else {
    fail(`counter 7-seg: segments unchanged after 1s ("${sample1.slice(0, 60)}")`);
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PROBE 6: eater6502-vdp-hello — VdpScreen canvas must be non-blank
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
await step('probe 6: eater6502 VDP hello', async () => {
  // Reload for a clean circuit.
  await page.goto(PROOF_URL + (PROOF_URL.includes('?') ? '&' : '?') + 'v=' + Date.now(), {
    waitUntil: 'networkidle', timeout: TIMEOUT,
  });
  try {
    await page.getByText('Circuit', { exact: false }).first().click({ timeout: 15_000 });
    await page.waitForTimeout(3000);
  } catch { /* standalone */ }

  await loadExample('Eater 6502');

  // Enter Sim mode.
  try {
    const simBtn = page.locator('button', { hasText: /Sim/i }).first();
    if (await simBtn.isVisible().catch(() => false)) {
      await simBtn.click();
      await page.waitForTimeout(2000);
    }
  } catch { /* might already be in Sim */ }

  // Let the 6502 execute for a few seconds to fill the VDP framebuffer.
  await page.waitForTimeout(3000);

  // Check the VdpScreen canvas for non-blank content.
  const vdpResult = await page.evaluate(() => {
    // VdpScreen renders a <canvas> — find it.
    const canvases = document.querySelectorAll('canvas');
    for (const cv of canvases) {
      // Skip scope canvases (they have data-scope parents).
      if (cv.closest('[data-scope-panel]') || cv.closest('[data-scope-module]')) continue;
      // Skip tiny canvases (wokwi elements, etc.)
      if (cv.width < 64 || cv.height < 48) continue;
      const ctx = cv.getContext('2d');
      if (!ctx) continue;
      const img = ctx.getImageData(0, 0, cv.width, cv.height);
      // Count non-black pixels.
      let nonBlack = 0;
      for (let i = 0; i < img.data.length; i += 4) {
        if (img.data[i] > 10 || img.data[i + 1] > 10 || img.data[i + 2] > 10) nonBlack++;
      }
      if (nonBlack > 0) return { w: cv.width, h: cv.height, nonBlack, total: img.data.length / 4 };
    }
    return { err: 'no non-blank canvas found', canvasCount: canvases.length };
  });

  await page.screenshot({ path: '/tmp/probe-eater6502-vdp.png' });

  if (vdpResult.err) {
    fail(`VDP hello: ${vdpResult.err} (${vdpResult.canvasCount} canvases)`);
  } else {
    pass(`VDP hello: ${vdpResult.nonBlack} non-black pixels on ${vdpResult.w}×${vdpResult.h} canvas`);
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PROBE 7: matrix display (pendant already covers this — screenshot only)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Probe 3 above already validates matrix8x8 brightness > 0.
// This section just takes a dedicated screenshot for the coordinator.
// (No separate step needed — probe 3's screenshot is at /tmp/probe-pendant-matrix.png
//  if we add it there.)

// ── Summary ──────────────────────────────────────────────────────
if (pageErrors.length) {
  console.log(`\n⚠ ${pageErrors.length} page error(s):`);
  pageErrors.slice(0, 5).forEach(e => console.log(`  ${e}`));
}

const okCount = results.filter(r => r.startsWith('OK')).length;
const failCount = results.filter(r => r.startsWith('FAIL')).length;
console.log(`\n━━━ ${okCount} passed, ${failCount} failed ━━━\n`);

await browser.close();
process.exit(exitCode);
