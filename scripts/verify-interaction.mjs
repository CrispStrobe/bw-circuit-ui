#!/usr/bin/env node
// Interaction acceptance: the owner's reported failures, run as a gate.
// Self-contained: spawns its own dev server, drives a real browser with real
// pointer sequences against WOKWI parts (not SVG symbols — that distinction
// is how the breakage stayed invisible), exits non-zero on any failure.
//
//   npm run verify:interaction
//
// This gate runs in CI (.github/workflows/ci.yml, job `interaction-gate`).
// It did not, for most of its life, and three of its scenarios had been
// reporting failures nobody saw:
//
//   wheel-pan        — read the viewBox of the fit-to-parts button's ICON,
//                      because `[data-canvas] svg` .first() is an ornament.
//   pin-chooser      — aimed at the parts PALETTE, because "the first div
//                      with scale() in its inline transform" stopped being
//                      the canvas's world layer once thumbnails scaled.
//   scope-panel      — asked for a Scope button inside an instruments column
//                      that is COLLAPSED by default in this harness.
//
// All three were the probe drifting away from the app, not the app breaking;
// the app was fine in each case, and the two DOM hooks the probe now uses
// (`data-canvas-svg`, `data-wokwi-layer`) are named in BoardCanvas.jsx so
// they cannot drift again. Removing either makes this gate fail BY NAME —
// that is the regression test, and it is mutation-proven.
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const PORT = Number(process.env.BW_GATE_PORT || 3142);
const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
  stdio: 'ignore', detached: false,
});
const kill = () => { try { server.kill('SIGTERM'); } catch { /* gone */ } };
process.on('exit', kill);

const waitForServer = async () => {
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(`http://localhost:${PORT}/`);
      if (r.ok) return;
    } catch { /* not up yet */ }
    await new Promise(res => setTimeout(res, 500));
  }
  throw new Error('dev server did not come up');
};

// ── The roll-call ────────────────────────────────────────────────────────
// The scenario count is part of the gate: "run it and it was green" is not a
// result if it silently ran fewer scenarios than last time. Printing the
// number was never enough — nothing compared it to anything. EXPECTED is that
// comparison. Every scenario reports exactly one outcome under its own id;
// a missing id, a duplicate id, or an id nobody expected FAILS the run, and
// says which. A gate that cannot fail is not a gate.
const EXPECTED = [
  'click-select',
  'drag-part',
  'wire-terminals',
  'breadboard-place',
  'seat-part',
  'jumper-holes',
  'wheel-pan',
  'wheel-no-zoom',
  'instruments-expand',
  'scope-panel',
  'scope-channel',
  'fg-waveform',
  'transport-pause',
  'transport-step',
  'transport-resume',
  'schematic-render',
  'nomcu-sim',
  'nomcu-clock',
  'seated-no-wires',
  'seated-moves',
  'pin-chooser-opens',
  'pin-chooser-wires',
  'selectors-collapse',
  'selectors-restore',
  'meter-board-intact',
  'scope-vdiv-per-channel',
  'spectrum-answers',
  'spectrum-peak',
  'sweep-progress',
  'sweep-canvas-live',
  'zero-page-errors',
];

// Scenarios a CI runner cannot honestly host. Empty, and meant to stay so:
// an entry here is printed LOUDLY on every run, by name and with its reason,
// because a silent skip is the failure mode this gate exists to prevent.
// Shape: { id, reason }.
const CI_SKIPS = [];
const isCI = !!process.env.CI;

let passes = 0, fails = 0, skips = 0;
const reported = new Map();          // id -> 'pass' | 'fail' | 'skip'
const protocolErrors = [];

const record = (id, outcome, msg) => {
  if (!EXPECTED.includes(id)) protocolErrors.push(`outcome for unknown scenario id "${id}"`);
  if (reported.has(id)) {
    // First outcome wins. A scenario can abort at several points (its toggle,
    // its panel, its reading) and each of those says WHY; the first one is the
    // cause and the rest are consequences. The one combination that is a
    // harness bug rather than a cascade is a PASS arriving after a FAIL — the
    // gate contradicting itself — and that is reported as a protocol error.
    if (outcome === 'pass' && reported.get(id) === 'fail') {
      protocolErrors.push(`scenario "${id}" reported fail and then pass — the harness contradicted itself`);
    }
    return;
  }
  reported.set(id, outcome);
  if (outcome === 'pass') { passes++; console.log(`✔ [${id}] ${msg}`); }
  else if (outcome === 'skip') { skips++; console.log(`⚠ SKIPPED [${id}] ${msg}`); }
  else { fails++; console.error(`✖ [${id}] ${msg}`); process.exitCode = 1; }
};
const pass = (id, msg) => record(id, 'pass', msg);
const fail = (id, msg) => record(id, 'fail', msg);
const verdict = (id, ok, okMsg, badMsg) => (ok ? pass(id, okMsg) : fail(id, badMsg));
/** Report every scenario in `ids` as failed for one shared reason. */
const failAll = (ids, why) => { for (const id of ids) if (!reported.has(id)) fail(id, why); };

/**
 * Click, and turn a click that cannot happen into a REPORTED failure instead
 * of an uncaught exception.
 *
 * A gate that aborts on the first unclickable button hides every scenario
 * after it: the run died at the transport bar with five scenarios never
 * attempted, and the same at origin/master, so the abort was hiding the
 * health of the rest from anyone running it here. The failure still fails;
 * it just stops being fatal.
 *
 * @returns {Promise<boolean>} whether the click landed
 */
const clickOrFail = async (locator, id, what, opts = {}) => {
  try {
    await locator.click({ timeout: 5000, ...opts });
    return true;
  } catch (e) {
    fail(id, `${what}: ${String(e).split('\n')[0]}`);
    return false;
  }
};

await waitForServer();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 800 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));

/**
 * The instruments column (scope, meter, sweep, simulation transport) is
 * COLLAPSED by default in this harness: `rightOpen` seeds from
 * `debuggerOn || benchOpen`, and the dev page passes neither. Every scenario
 * that reaches into that column has to open it first, by the same labelled
 * control a user has, and after every reload — `rightOpen` is React state,
 * so a reload closes it again while localStorage still says the scope panel
 * inside it is "shown". That mismatch is exactly what "no scope panel in the
 * sidebar" was: the panel was shown, inside a column nobody had opened.
 *
 * @returns {Promise<boolean>} whether the column is open afterwards
 */
const openInstruments = async () => {
  const col = page.locator('[data-instruments-column]');
  if (await col.count()) return true;
  const btn = page.getByRole('button', { name: /Expand instruments panel/i });
  if (await btn.count() === 0) return false;
  try { await btn.first().click({ timeout: 20000 }); } catch { /* reported by caller */ }
  await col.first().waitFor({ state: 'attached', timeout: 20000 }).catch(() => { /* reported by caller */ });
  return (await col.count()) > 0;
};

/**
 * A transport button, by ROLE and accessible name. `getByText(/Pause/i)`
 * found it too, but only while the column happened to be open — and the
 * failure it produced then was a bare five-second timeout that named no
 * cause. Role + name resolves the BUTTON (never a container that merely
 * contains the word), and the caller below opens the column first, so a
 * timeout here means the control is genuinely unreachable.
 */
const transportBtn = (name) => page.getByRole('button', { name });

/**
 * Press a transport control without racing the running simulation.
 *
 * The clock is live: the sidebar re-renders on every 50 ms tick, and
 * Playwright's click waits for the element to hold still across consecutive
 * animation frames before it will send a pointer event. On a loaded box those
 * frames do not arrive faster than the re-render, the wait never settles, and
 * a button that a user can hit reports "unclickable". Retrying that until it
 * goes green would be lying about a real race, and deleting the scenarios
 * would be worse.
 *
 * So: the press is a pointer press at the button's own coordinates, aimed
 * once and dispatched once. Position comes from the button's box (measured,
 * not guessed), the hit is verified against elementFromPoint BEFORE the press
 * so a mis-aim is reported rather than silently missing, and nothing waits on
 * visual stability. The ASSERTIONS that follow read board state — the clock
 * itself — not pixels.
 *
 * @returns {Promise<{ok: boolean, why?: string}>}
 */
const pressTransport = async (locator) => {
  try {
    await locator.first().waitFor({ state: 'visible', timeout: 20000 });
  } catch (e) {
    return { ok: false, why: `never became visible: ${String(e).split('\n')[0]}` };
  }
  try { await locator.first().scrollIntoViewIfNeeded({ timeout: 5000 }); } catch { /* box below still measures */ }
  const b = await locator.first().boundingBox();
  if (!b) return { ok: false, why: 'no bounding box' };
  const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
  const hit = await page.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y);
    if (!el) return { over: 'nothing' };
    const btn = el.closest('button');
    return { over: btn ? 'button' : (el.tagName + (el.className && typeof el.className === 'string' ? '.' + el.className : '')),
      text: btn ? (btn.innerText || '').trim() : '' };
  }, { x: cx, y: cy });
  if (hit.over !== 'button') return { ok: false, why: `something else covers it at (${cx.toFixed(0)},${cy.toFixed(0)}): ${hit.over}` };
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.up();
  return { ok: true, why: hit.text };
};

// `domcontentloaded`, not `networkidle`: the house probe traps say the load
// event can hang, and on a loaded box a Vite dev server never went idle
// inside 30 s and the gate died before its first scenario. Readiness here has
// always been a CONDITION rather than a load event, so nothing is lost.
await page.goto(`http://localhost:${PORT}`, { waitUntil: 'domcontentloaded' });
// Readiness is a condition, not a sleep: the circuit is populated and the
// first solve has landed when parts exist and a wokwi element is attached.
await page.waitForFunction(() => window.__circuit && window.__circuit.parts.length > 0
  && document.querySelector('wokwi-led'), { timeout: 30000 });
await page.waitForTimeout(400); // one settle frame for the wokwi layer


const box = async () => await page.locator('wokwi-led').first().boundingBox();
const selectionCount = async () =>
  await page.evaluate(() => document.body.innerText.match(/(\d+)\s*selected/)?.[1] ?? '0');

// 1. Click-select, three times, on the wokwi LED.
{
  const b = await box();
  if (!b) { fail('click-select', 'no wokwi LED on the default board'); }
  else {
    let ok = true;
    for (let i = 0; i < 3; i++) {
      await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
      await page.waitForTimeout(120);
      if (await selectionCount() !== '1') ok = false;
    }
    verdict('click-select', ok, 'click selects the LED, all three times', 'click-to-select is unreliable');
  }
}

// 2. Drag the LED 200 px right; it must arrive (grid snap ±20 px).
{
  const before = await box();
  const cx = before.x + before.width / 2, cy = before.y + before.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let s = 1; s <= 10; s++) { await page.mouse.move(cx + s * 20, cy); await page.waitForTimeout(15); }
  await page.mouse.up();
  await page.waitForTimeout(200);
  const after = await box();
  const dx = after.x - before.x;
  verdict('drag-part', dx > 180 && dx < 220,
    `drag moved the LED ${dx.toFixed(0)} px`,
    `drag moved ${dx.toFixed(0)} px, expected ~200`);
}

// 3. Add two fresh parts from the palette, then wire them terminal-to-terminal.
{
  // New placement flow: a palette click arms a ghost; a canvas click commits.
  const canvasBox = await page.locator('[data-canvas]').boundingBox();
  const drop = async (label, dx, dy) => {
    const el = page.getByText(label, { exact: label === 'Diode' }).first();
    await el.scrollIntoViewIfNeeded();
    await el.click();
    await page.waitForTimeout(120);
    const cb = await page.locator('[data-canvas]').boundingBox(); // re-measure: palette may have scrolled
    await page.mouse.move(cb.x + cb.width / 2 + dx, cb.y + 60 + dy, { steps: 4 });
    await page.mouse.click(cb.x + cb.width / 2 + dx, cb.y + 60 + dy);
    await page.waitForTimeout(150);
  };
  await drop('Resistor 1kΩ', -120, 0);
  await drop('Diode', 120, 0);
  const wiresBefore = await page.locator('[data-wire]').count();
  // Free terminals render as hollow red dots (r=8, stroke #e74c3c).
  const freeDots = (await page.evaluate(() => {
    return [...document.querySelectorAll('svg circle')]
      .filter(el => el.getAttribute('stroke') === '#e74c3c' && el.getAttribute('r') === '8')
      .map(el => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  }))
    // Only dots actually visible inside the canvas — the demo circuit keeps
    // clipped terminals whose DOM rects sit far off-screen.
    .filter(d => d.x > canvasBox.x && d.x < canvasBox.x + canvasBox.width
              && d.y > canvasBox.y && d.y < canvasBox.y + canvasBox.height
              );
  const dot = freeDots[0];
  // Farthest free dot from the first: guaranteed a different part's terminal.
  const dot2 = freeDots.length >= 2
    ? freeDots.reduce((best, d) => (Math.hypot(d.x - dot.x, d.y - dot.y) > Math.hypot(best.x - dot.x, best.y - dot.y) ? d : best))
    : null;
  if (!dot || !dot2) {
    fail('wire-terminals', `could not find two free terminals to wire (found ${freeDots.length})`);
  } else {
    await page.mouse.move(dot.x, dot.y);
    await page.mouse.down();
    await page.mouse.move((dot.x + dot2.x) / 2, (dot.y + dot2.y) / 2, { steps: 5 });
    await page.mouse.move(dot2.x, dot2.y, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(200);
    const wiresAfter = await page.locator('[data-wire]').count();
    verdict('wire-terminals', wiresAfter > wiresBefore,
      'terminal-to-terminal drag created a wire',
      `wiring drag created nothing (paths ${wiresBefore} → ${wiresAfter})`);
  }
}

// 3b. Palette press → drag onto canvas → release places a breadboard, then
//     a resistor placed over it snaps onto the hole lattice.
{
  const bbEl = page.getByText('Breadboard', { exact: true }).first();
  await bbEl.scrollIntoViewIfNeeded();
  const bb = await bbEl.boundingBox();
  const canvas = await page.locator('[data-canvas]').boundingBox();
  const cx = canvas.x + canvas.width / 2, cy = canvas.y + canvas.height / 2;
  await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
  await page.mouse.down();
  await page.mouse.move(cx, cy, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const boards = await page.evaluate(() =>
    [...document.querySelectorAll('svg rect')].filter(r => r.getAttribute('fill') === '#e8e4d8').length);
  verdict('breadboard-place', boards >= 1,
    'palette drag placed a breadboard substrate',
    'breadboard did not appear after palette drag');
}

// 3c. A part placed ON the breadboard SEATS: model ground truth (the part
//     holds a seat whose terminals are lattice holes) plus a pixel sanity
//     check that its dots sit on drawn holes.
{
  const bbRect = await page.evaluate(() => {
    const r = [...document.querySelectorAll('svg rect')].find(el => el.getAttribute('fill') === '#e8e4d8');
    if (!r) return null;
    const b = r.getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height * 0.30 };
  });
  if (!bbRect) { fail('seat-part', 'no breadboard on canvas for the seating scenario'); }
  else {
    const rEl = page.getByText('Resistor 1kΩ', { exact: false }).first();
    await rEl.scrollIntoViewIfNeeded();
    await rEl.click();
    await page.waitForTimeout(120);
    await page.mouse.move(bbRect.x, bbRect.y, { steps: 4 });
    await page.mouse.click(bbRect.x, bbRect.y);
    await page.waitForTimeout(300);
    const seat = await page.evaluate(() => {
      const c = window.__circuit;
      if (!c) return { err: 'no __circuit' };
      const seated = c.parts.filter(p => p.seat);
      if (seated.length === 0) return { err: 'nothing seated', kinds: c.parts.map(p => p.kind) };
      const p = seated[seated.length - 1];
      return { kind: p.kind, boardId: p.seat.boardId, leadMap: p.seat.leadMap };
    });
    if (seat.err) { fail('seat-part', `seating: ${seat.err}`); }
    else {
      const holes = Object.values(seat.leadMap);
      const onLattice = holes.every(h => /^[a-j][0-9]+$/.test(h));
      verdict('seat-part', onLattice,
        `seated ${seat.kind}: legs in holes ${holes.join(', ')}`,
        `leadMap not on terminal rows: ${holes.join(', ')}`);
    }
  }
}

// 3d. Hole-to-hole jumper: press a free hole, drag, release on another —
//     a colored jumper arc appears.
{
  const rect = await page.evaluate(() => {
    const r = [...document.querySelectorAll('svg rect')].find(el => el.getAttribute('fill') === '#e8e4d8');
    if (!r) return null;
    const b = r.getBoundingClientRect();
    return { x: b.x, y: b.y, w: b.width, h: b.height };
  });
  if (!rect) { fail('jumper-holes', 'no breadboard for the jumper scenario'); }
  else {
    let made = false;
    for (const fy of [0.62, 0.66, 0.70]) {   // hunt a bottom-block row
      const y = rect.y + rect.h * fy;
      await page.mouse.move(rect.x + rect.w * 0.30, y);
      await page.mouse.down();
      await page.mouse.move(rect.x + rect.w * 0.60, y, { steps: 6 });
      await page.mouse.up();
      await page.waitForTimeout(200);
      if (await page.locator('[data-jumper]').count() > 0) { made = true; break; }
    }
    verdict('jumper-holes', made,
      'hole-to-hole drag created a jumper wire',
      'jumper gesture produced no wire');
  }
}

// 4. Trackpad two-finger scroll must PAN the canvas (viewBox moves).
{
  // BY NAME. `[data-canvas] svg` matches five elements on this page and the
  // FIRST in document order is the fit-to-parts button's 18x18 icon, whose
  // viewBox is the constant "0 0 24 24". Reading that constant before and
  // after a wheel event and finding it unchanged is not evidence that the
  // wheel failed to pan — it is evidence that nothing was measured. The
  // camera svg carries `data-canvas-svg`; if that hook is gone this scenario
  // FAILS rather than quietly measuring an ornament again.
  const canvas = page.locator('[data-canvas] svg[data-canvas-svg]');
  if (await canvas.count() !== 1) {
    failAll(['wheel-pan', 'wheel-no-zoom'],
      `no unique [data-canvas-svg] camera to measure (found ${await canvas.count()}) — the hook BoardCanvas.jsx names was removed or duplicated`);
  } else {
    const vbBefore = await canvas.getAttribute('viewBox');
    const cb = await page.locator('[data-canvas]').boundingBox();
    await page.mouse.move(cb.x + cb.width / 2, cb.y + cb.height / 2);
    await page.mouse.wheel(80, 60); // plain wheel: pan, not zoom
    await page.waitForTimeout(250);
    const vbAfter = await canvas.getAttribute('viewBox');
    verdict('wheel-pan', vbBefore !== vbAfter,
      `two-finger scroll pans the canvas (${vbBefore.split(' ').slice(0, 2).map(n => (+n).toFixed(0)).join(',')} → ${vbAfter.split(' ').slice(0, 2).map(n => (+n).toFixed(0)).join(',')})`,
      `wheel did not pan the canvas (viewBox stayed ${vbBefore})`);
    // And the zoom (width term of the viewBox) must NOT have changed.
    const w0 = Number(vbBefore.split(' ')[2]);
    const w1 = Number(vbAfter.split(' ')[2]);
    verdict('wheel-no-zoom', Math.abs(w0 - w1) < 1e-6,
      'plain wheel did not zoom',
      `plain wheel changed zoom: ${w0} → ${w1}`);
  }
}

// 5. Oscilloscope panel: open the instruments column, toggle scope
//    visibility, add a channel on a real net.
{
  // The instruments column is collapsed until asked for. Opening it is a
  // scenario in its own right — it is the only route a user has to the
  // scope, the meter, the sweep and the simulation transport, and when it
  // silently failed to open, FOUR later scenarios reported their controls
  // "unclickable" and named the wrong cause.
  const opened = await openInstruments();
  verdict('instruments-expand', opened,
    'collapsed instruments column expands by its own labelled control',
    'no way to open the instruments column (Expand instruments panel button missing or inert)');

  // The "▣ Scope" button in the instruments column shows/hides the panel.
  //
  // By ROLE, not by text. `getByText('Scope').first()` matches every element
  // whose text CONTAINS "Scope" — including the button's ancestors, which come
  // first in document order. …and only when the panel is CLOSED: the toggle
  // remembers itself in localStorage, so after a reload the panel is already
  // shown and an unconditional click would hide it.
  const panelSel = '[data-scope-panel], [data-scope-module]';
  const showScope = async () => {
    if (await page.locator(panelSel).count()) return;
    const btn = page.getByRole('button', { name: /Scope/i }).first();
    if (await btn.count() === 0) return;
    try { await btn.click({ timeout: 20000 }); } catch { /* reported below */ }
    // Readiness is a CONDITION, not a sleep.
    await page.locator(panelSel).first()
      .waitFor({ state: 'attached', timeout: 20000 }).catch(() => { /* reported below */ });
  };
  await showScope();
  const panel = page.locator(panelSel);
  if (await panel.count() === 0) {
    failAll(['scope-panel', 'scope-channel'], 'no scope panel in the sidebar');
  } else {
    pass('scope-panel', 'scope panel opens from the instruments column');
    const sel = panel.locator('select').last();
    const opts = await sel.locator('option').allTextContents();
    if (opts.length < 2) { fail('scope-channel', `scope net picker offers no nets (${opts.length} options)`); }
    else {
      await sel.selectOption({ index: 1 });
      const addBtn = panel.getByText('+ channel', { exact: false });
      if (await addBtn.count()) await addBtn.click();
      await page.waitForTimeout(400);
      const canvases = await panel.locator('canvas').count();
      verdict('scope-channel', canvases === 1,
        `scope channel attached; capture canvas live (${opts.length} nets offered)`,
        `scope canvas did not appear (${canvases} canvases)`);
    }
  }
}

// 6. Function generator end to end: place FG + resistor, wire the loop,
//    SIMULATE, scope the net — the envelope must actually move.
{
  // Fresh page: this scenario is an end-to-end circuit of its own, and the
  // accumulated clutter of earlier scenarios only obscures its failures.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__circuit && window.__circuit.parts.length > 0,
    { timeout: 30000 });
  await page.waitForTimeout(800);
  // A reload closes the instruments column again (React state, not storage).
  await openInstruments();
  const canvasBox2 = await page.locator('[data-canvas]').boundingBox();
  const dropAt = async (label, x, y) => {
    const el = page.getByText(label, { exact: false }).first();
    try {
      await el.scrollIntoViewIfNeeded({ timeout: 10000 });
    } catch {
      await page.screenshot({ path: '/tmp/gate-fail.png' });
      console.log('DBG body:', (await page.locator('body').innerText()).slice(0, 200));
      console.log('DBG pageerrors:', errors.join(' || ').slice(0, 600));
      throw new Error(`palette item not reachable: ${label}`);
    }
    await el.click({ timeout: 20000 });
    await page.waitForTimeout(120);
    await page.mouse.move(x, y, { steps: 4 });
    await page.mouse.click(x, y);
    await page.waitForTimeout(150);
  };
  const fx = canvasBox2.x + canvasBox2.width * 0.25;
  const fy = canvasBox2.y + canvasBox2.height * 0.75;
  try {
    await dropAt('Function Gen', fx, fy);
    await dropAt('Resistor 1kΩ', fx + 140, fy);
    const dots = await page.evaluate(() => {
      return [...document.querySelectorAll('svg circle')]
        .filter(el => el.getAttribute('stroke') === '#e74c3c' && el.getAttribute('r') === '8')
        .map(el => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
    });
    // FG dots stack vertically at ~fx; resistor dots sit horizontally at fy.
    const near = (px, py) => dots.slice().sort((a, b) => Math.hypot(a.x - px, a.y - py) - Math.hypot(b.x - px, b.y - py))[0];
    // Locate the placed instruments from their rendered boxes — auto-fit may
    // have moved the view since placement.
    const fgBox = await page.locator('div').filter({ hasText: /^.*1000 Hz.*$/ }).last().boundingBox();
    const rBox = await page.locator('wokwi-resistor').last().boundingBox();
    const nearBox = (bx, px, py) => near(bx.x + bx.width / 2 + px, bx.y + bx.height / 2 + py);
    const fgTop = nearBox(fgBox, -24, 32), fgBot = nearBox(fgBox, 24, 32);
    const rA = nearBox(rBox, -34, 0), rB = nearBox(rBox, 34, 0);
    const dragWire = async (a, b) => {
      await page.mouse.move(a.x, a.y); await page.mouse.down();
      await page.mouse.move(b.x, b.y, { steps: 6 }); await page.mouse.up();
      await page.waitForTimeout(150);
    };
    await dragWire(fgTop, rA);
    await dragWire(fgBot, rB);
    await clickOrFail(page.getByRole('radio', { name: /Sim/i }).first(), 'fg-waveform', 'Sim toggle unclickable', { timeout: 20000 });
    await page.waitForTimeout(300);
    // Show scope panel if hidden (the toggle keeps it behind a button)
    if (await page.locator('[data-scope-panel], [data-scope-module]').count() === 0) {
      const scopeShowBtn = page.getByRole('button', { name: /Scope/i }).first();
      if (await scopeShowBtn.count()) {
        try { await scopeShowBtn.click({ timeout: 20000 }); } catch { /* reported below */ }
        await page.locator('[data-scope-panel], [data-scope-module]').first()
          .waitFor({ state: 'attached', timeout: 20000 }).catch(() => { /* reported below */ });
      }
    }
    const scope = page.locator('[data-scope-panel], [data-scope-module]');
    const sel = scope.locator('select').last();
    const optCount = await sel.count() ? await sel.locator('option').count() : 0;
    if (optCount < 2) { fail('fg-waveform', `FG circuit produced no nets to scope (${optCount} options)`); }
    else {
      // Scope the net the FG wiring just created: the LAST engine wire-net.
      const values = await sel.locator('option').evaluateAll(os => os.map(o => o.value));
      const wireNets = values.filter(v => v.startsWith('net_'));
      await sel.selectOption(wireNets.length ? wireNets[wireNets.length - 1] : { index: optCount - 1 });
      await clickOrFail(scope.getByText('+ channel'), 'fg-waveform', 'scope + channel unclickable', { timeout: 20000 });
      await page.waitForTimeout(1500); // ~30 sim ticks of 50 ms
      const spread = await page.evaluate(() => {
        const cv = document.querySelector('[data-scope-panel] canvas');
        if (!cv) return -1;
        const g = cv.getContext('2d');
        const img = g.getImageData(0, 0, cv.width, cv.height).data;
        let minY = 1e9, maxY = -1;
        for (let y = 0; y < cv.height; y++) {
          for (let x = 0; x < cv.width; x++) {
            const i = (y * cv.width + x) * 4;
            // The channel trace is green-dominant over the dark background.
            const isTrace = (img[i + 1] > 120 && img[i + 1] > img[i] + 40)
              || (img[i + 2] > 120 && img[i + 2] > img[i] + 40);
            if (isTrace) {
              if (y < minY) minY = y;
              if (y > maxY) maxY = y;
            }
          }
        }
        return maxY - minY;
      });
      if (!reported.has('fg-waveform')) {
        verdict('fg-waveform', spread > 25,
          `function generator waveform on the scope (spread ${spread}px)`,
          `scope trace flat or absent (spread ${spread}px)`);
      }
    }
  } catch (e) {
    if (!reported.has('fg-waveform')) fail('fg-waveform', `FG bench could not be built: ${String(e).split('\n')[0]}`);
  }
}

// 6b. Sim transport: pause freezes board time coherently; step advances
//     exactly one 50 ms tick; resume flows again.
//
//     The four assertions here read the BOARD CLOCK, not the screen. The
//     presses are aimed pointer presses (see pressTransport) rather than
//     Playwright clicks, because a Playwright click waits for the sidebar to
//     stop moving and the sidebar is re-rendering on every 50 ms tick — that
//     wait, not the app, is what used to report these four as "unclickable".
{
  const t = async () => await page.evaluate(() => String(window.__board?.getTime?.() ?? 'none'));
  await openInstruments();
  const pauseRes = await pressTransport(transportBtn(/Pause simulation/i));
  await page.waitForTimeout(300);
  const t1 = await t();
  await page.waitForTimeout(400);
  const t2 = await t();
  if (pauseRes.ok) {
    verdict('transport-pause', t1 === t2 && t1 !== 'none',
      `pause freezes board time (${t1} ns held)`,
      `pause leaked time: ${t1} -> ${t2}`);
  } else fail('transport-pause', `pause button unreachable: ${pauseRes.why}`);

  let stepRes = { ok: false, why: 'not attempted — the simulation never paused' };
  if (pauseRes.ok) stepRes = await pressTransport(transportBtn(/Step one tick|Advance one 50/i));
  await page.waitForTimeout(250);
  const t3 = await t();
  if (stepRes.ok) {
    const advanced = (t3 !== 'none' && t2 !== 'none') ? BigInt(t3) - BigInt(t2) : -1n;
    verdict('transport-step', advanced === 50000000n,
      'step advances exactly one 50 ms tick',
      `step advanced ${advanced} ns, expected 50000000`);
  } else fail('transport-step', `step button unreachable: ${stepRes.why}`);

  let resumeRes = { ok: false, why: 'not attempted — the simulation never paused' };
  if (pauseRes.ok) resumeRes = await pressTransport(transportBtn(/Resume simulation/i));
  await page.waitForTimeout(500);
  const t4 = await t();
  if (resumeRes.ok) {
    verdict('transport-resume', t4 !== 'none' && t3 !== 'none' && BigInt(t4) > BigInt(t3),
      'resume: time flows again',
      `resume did not restart the clock (${t3} -> ${t4})`);
  } else fail('transport-resume', `resume button unreachable: ${resumeRes.why}`);
}

// 7. Schematic projection: toggle it on — standard symbols render beside
//    the canvas, one per electrical part, and the canvas stays interactive.
{
  const ok = await clickOrFail(page.getByRole('radio', { name: /Schematic/i }).first(),
    'schematic-render', 'Schematic toggle unclickable', { timeout: 20000 });
  if (ok) {
    await page.waitForTimeout(500);
    const symCount = await page.evaluate(() =>
      document.querySelectorAll('[data-schematic] g > text').length);
    verdict('schematic-render', symCount >= 3,
      `schematic beside the canvas (${symCount} symbols)`,
      `schematic did not render (symbols=${symCount})`);
  }
}

// 8. Pure-circuit Sim: the no-declarations starter must SIMULATE without
//    crashing (the tap-wire/no-MCU landing is production's first screen).
{
  await page.goto(`http://localhost:${PORT}/?nopins=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__circuit && window.__circuit.parts.length > 0, { timeout: 30000 });
  await page.waitForTimeout(400);
  const ok = await clickOrFail(page.getByRole('radio', { name: /Sim/i }).first(),
    'nomcu-sim', 'Sim toggle unclickable', { timeout: 20000 });
  if (ok) {
    await page.waitForTimeout(700);
    const mode = await page.evaluate(() => document.querySelector('[data-sim-mode]')?.getAttribute('data-sim-mode'));
    verdict('nomcu-sim', mode === 'simulate',
      'no-MCU starter enters Sim without crashing',
      `Sim on the pure starter: mode=${mode ?? 'DESIGNER UNMOUNTED'}`);
  }
  const t1 = await page.evaluate(() => String(window.__board?.getTime?.() ?? 'none'));
  await page.waitForTimeout(600);
  const t2 = await page.evaluate(() => String(window.__board?.getTime?.() ?? 'none'));
  verdict('nomcu-clock', t1 !== 'none' && t2 !== 'none' && BigInt(t2) > BigInt(t1),
    'pure-circuit clock flows',
    `pure-circuit clock frozen (${t1} -> ${t2})`);
}

// 9. Body beats hole: dragging a SEATED part's body must MOVE the part —
// never start a jumper wire from a free hole hiding under the body. This
// was the potentiometer complaint: selected, dragged, and wires appeared.
{
  await page.goto(`http://localhost:${PORT}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__circuit && window.__circuit.parts.length > 0 && document.querySelector('wokwi-led'), { timeout: 30000 });
  await page.waitForTimeout(400);
  const before = await page.evaluate(() => {
    const led = window.__circuit.parts.find(q => q.kind === 'led' && q.seat);
    return led ? { id: led.id, x: led.x, y: led.y, wires: window.__circuit.wires.length,
      jumpers: window.__circuit.holeWires().length } : null;
  });
  if (!before) failAll(['seated-no-wires', 'seated-moves'], 'no seated part to drag in the body-beats-hole scenario');
  else {
    const ledBox = await page.locator('wokwi-led').first().boundingBox();
    const toScreen = { x: ledBox.x + ledBox.width / 2, y: ledBox.y + ledBox.height / 2 };
    await page.mouse.move(toScreen.x, toScreen.y);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) { await page.mouse.move(toScreen.x + i * 15, toScreen.y + 40); await page.waitForTimeout(15); }
    await page.mouse.up();
    await page.waitForTimeout(300);
    const after = await page.evaluate(() => ({
      wires: window.__circuit.wires.length,
      jumpers: window.__circuit.holeWires().length,
      x: window.__circuit.parts.find(q => q.kind === 'led')?.x,
    }));
    verdict('seated-no-wires', after.wires === before.wires && after.jumpers === before.jumpers,
      'seated body drag draws no wires',
      `seated body drag created wires: ${before.wires}->${after.wires} jumpers ${before.jumpers}->${after.jumpers}`);
    verdict('seated-moves', Math.abs(after.x - before.x) > 40,
      'seated body drag MOVES the part',
      `seated part did not move (dx=${Math.abs(after.x - before.x)})`);
  }
}

// 10. Pin chooser: a wire released on the chip BODY opens the named pin
// dialog, and choosing completes the wire — buttons must receive their
// clicks through the canvas pointer machine (they once silently did not).
{
  await page.goto(`http://localhost:${PORT}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__circuit && window.__circuit.parts.some(q => q.kind === 'mcu'), { timeout: 30000 });
  await page.waitForTimeout(400);
  // world -> screen through the canvas's OWN world layer, found BY NAME.
  // The old form — "the first div whose inline transform contains scale(" —
  // silently started matching a palette thumbnail, so this gesture was drawn
  // inside the parts palette at x~135 while the canvas begins at x~214: no
  // wire, no dialog, and a scenario reporting that the pin chooser was
  // broken when nothing had ever been dragged onto the chip.
  const layer = page.locator('[data-wokwi-layer]');
  if (await layer.count() !== 1) {
    failAll(['pin-chooser-opens', 'pin-chooser-wires'],
      `no unique [data-wokwi-layer] world layer to aim through (found ${await layer.count()}) — the hook BoardCanvas.jsx names was removed or duplicated`);
  } else {
    // The wire has to START on a hole that is actually there and actually
    // free. The old aim was arithmetic — `bb.x - (62*14)/2 + 19*14`, a column
    // count and a pitch and a row offset written down once and never checked
    // against the board being drawn. A full-size breadboard has 63 columns,
    // so that expression is half a pitch out and the press landed between
    // holes: no wire ever started, nothing was ever released on the chip, and
    // the scenario reported the pin chooser broken.
    //
    // Two sources of truth, each used for what it knows. The MODEL
    // (`__circuit.breadboards.get(id).occupantOf(hole)`) says which holes a
    // leg or jumper already owns — asking the DOM that question fails,
    // because the canvas hit-tests pointers in WORLD space and the element
    // under the cursor is the one big svg, never the hole circle. The DOM
    // (`[data-hole]`, which every hole carries) says where that hole is on
    // screen, which no amount of arithmetic can get wrong.
    const aim = await page.evaluate(() => {
      const c = window.__circuit;
      const mcu = c.parts.find(q => q.kind === 'mcu');
      if (!mcu) return { err: 'no mcu on the demo board' };
      const bbPart = c.parts.find(q => q.kind === 'breadboard');
      const bb = bbPart && c.breadboards ? c.breadboards.get(bbPart.id) : null;
      if (!bb) return { err: 'no breadboard model on the demo board' };
      const el = document.querySelector('[data-wokwi-layer]');
      const m2 = new DOMMatrixReadOnly(getComputedStyle(el).transform);
      const pr = el.parentElement.getBoundingClientRect();
      const chip = { x: pr.x + mcu.x * m2.a + m2.e, y: pr.y + mcu.y * m2.d + m2.f };
      // BODY BEATS HOLE (scenario 9 is the law): a press on a hole that lies
      // under a seated part's BODY drags that part instead of starting a
      // wire. A DIP-40 is twenty columns long, so "90 px from the chip
      // centre" picked hole i35 — squarely under the chip — and the gesture
      // dragged the chip rather than pulling a wire off the board. Every
      // seated part's leadMap names the COLUMNS it stands on; stay two clear
      // of all of them.
      const spans = [];
      for (const p of c.parts) {
        if (!p.seat || !p.seat.leadMap) continue;
        const cols = Object.values(p.seat.leadMap)
          .map(h => parseInt(String(h).replace(/^[^0-9]+/, ''), 10)).filter(n => Number.isFinite(n));
        if (cols.length) spans.push({ id: p.id, min: Math.min(...cols), max: Math.max(...cols) });
      }
      const clearOfBodies = (col) => spans.every(s => col < s.min - 2 || col > s.max + 2);
      const holes = [...document.querySelectorAll('[data-hole]')];
      let occupied = 0, offscreen = 0, tooClose = 0, underABody = 0;
      const free = [];
      for (const h of holes) {
        const id = h.getAttribute('data-hole');
        const m = /^([a-j])(\d+)$/.exec(id);           // terminal rows only, not the rails
        if (!m) continue;
        if (bb.occupantOf(id)) { occupied++; continue; }
        if (!clearOfBodies(Number(m[2]))) { underABody++; continue; }
        const r = h.getBoundingClientRect();
        const x = r.x + r.width / 2, y = r.y + r.height / 2;
        if (x < pr.x + 6 || x > pr.x + pr.width - 6 || y < pr.y + 6 || y > pr.y + pr.height - 6) { offscreen++; continue; }
        const d = Math.hypot(x - chip.x, y - chip.y);
        if (d < 90) { tooClose++; continue; }          // far enough to be a real drag
        free.push({ id, x, y, d });
      }
      free.sort((a, b) => a.d - b.d);                  // the shortest honest drag
      const over = document.elementFromPoint(chip.x, chip.y);
      return { chip, free: free.slice(0, 3), holes: holes.length, occupied, offscreen, tooClose, underABody,
        spans: spans.map(s => `${s.id}:${s.min}-${s.max}`).join(' '),
        chipCovered: over ? over.tagName : 'nothing' };
    });
    if (aim.err || !aim.free || aim.free.length === 0) {
      failAll(['pin-chooser-opens', 'pin-chooser-wires'],
        `no free breadboard hole to start the tap wire from (${aim.err
          ?? `${aim.holes} holes drawn, ${aim.occupied} occupied, ${aim.underABody} under a seated body `
             + `(columns ${aim.spans}), ${aim.offscreen} off-canvas, ${aim.tooClose} too close to the chip`})`);
    } else {
      const from = aim.free[0];
      const to = aim.chip;
      await page.mouse.move(from.x, from.y); await page.mouse.down();
      await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 });
      await page.mouse.move(to.x, to.y, { steps: 4 }); await page.mouse.up();
      await page.waitForTimeout(700);
      const open = await page.getByText('Which pin of', { exact: false }).count();
      verdict('pin-chooser-opens', !!open,
        `pin chooser opens on chip-body release (hole ${from.id} → chip)`,
        `pin chooser did not open (hole ${from.id} at ${from.x.toFixed(0)},${from.y.toFixed(0)} → chip at `
          + `${to.x.toFixed(0)},${to.y.toFixed(0)}, which covers ${aim.chipCovered})`);
      if (open) {
        await clickOrFail(page.locator('button', { hasText: 'P1.5' }).first(), 'pin-chooser-wires', 'P1.5 button unclickable', { timeout: 10000 });
        await page.waitForTimeout(400);
        if (!reported.has('pin-chooser-wires')) {
          const wired = await page.evaluate(() => {
            const m = window.__circuit.parts.find(q => q.kind === 'mcu');
            return window.__circuit.wires.some(w =>
              (w.from.part === m.id && w.from.terminal === 'P1.5') || (w.to.part === m.id && w.to.terminal === 'P1.5'));
          });
          verdict('pin-chooser-wires', wired,
            'chosen pin completes the tap wire',
            'chooser click produced no wire');
        }
      } else {
        fail('pin-chooser-wires', 'chosen pin completes the tap wire: not attempted (the chooser never opened)');
      }
    }
  }
}

// 11. Selectors panel collapse/expand (left sidebar)
// The UI collapses the entire selectors column via the ‹ toggle button.
{
  const toggle = page.locator('[data-selectors-toggle]');
  if (await toggle.count()) {
    // Measure expanded state
    const rail = page.locator('[data-selectors-rail]');
    const beforeBox = await rail.boundingBox();
    const beforeW = beforeBox?.width ?? 0;
    // Click collapse
    await toggle.click();
    await page.waitForTimeout(250);
    const afterBox = await rail.boundingBox();
    const afterW = afterBox?.width ?? 999;
    verdict('selectors-collapse', afterW < 30,
      `selectors collapse: ${Math.round(afterW)}px < 30px`,
      `selectors collapsed to ${Math.round(afterW)}px, expected < 30px`);
    // Click expand — should restore
    await toggle.click();
    await page.waitForTimeout(250);
    const restoredBox = await rail.boundingBox();
    const restoredW = restoredBox?.width ?? 0;
    const drift = Math.abs(restoredW - beforeW);
    verdict('selectors-restore', drift < 20,
      `selectors expand restores width (drift ${Math.round(drift)}px)`,
      `selectors restore drifted ${Math.round(drift)}px from ${Math.round(beforeW)}px`);
  } else {
    // Not "skipped": the toggle is part of the UI this gate describes. If it
    // is gone, say so as a failure rather than passing two empty lines.
    failAll(['selectors-collapse', 'selectors-restore'],
      'no [data-selectors-toggle] in the DOM — the collapsible selectors column is gone');
  }
}

// ── 12–15. The instruments (D21, D31, D24, X2.6) ─────────────────────────
// One bench for all four: a 1 kHz function generator across a resistor, in
// Sim. Built fresh, because these scenarios are about READINGS and the
// accumulated clutter of eleven earlier scenarios only obscures them.
const INSTRUMENT_IDS = ['meter-board-intact', 'scope-vdiv-per-channel', 'spectrum-answers', 'spectrum-peak',
  'sweep-progress', 'sweep-canvas-live'];
try {
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__circuit && window.__circuit.parts.length > 0, { timeout: 30000 });
  await page.waitForTimeout(800);
  await openInstruments();
  const cb3 = await page.locator('[data-canvas]').boundingBox();
  const place = async (label, x, y) => {
    const el = page.getByText(label, { exact: false }).first();
    // A palette that is still re-rendering never becomes "stable", and on a
    // loaded box that is a timeout for a scroll the click would have done
    // anyway. Not fatal, and never silently skipped — the placement that
    // follows either works or the scenario below says what it could not find.
    try { await el.scrollIntoViewIfNeeded({ timeout: 10000 }); } catch { /* click scrolls too */ }
    await el.click({ timeout: 20000 });
    await page.waitForTimeout(200);
    await page.mouse.move(x, y, { steps: 4 });
    await page.mouse.click(x, y);
    await page.waitForTimeout(250);
  };
  const gx = cb3.x + cb3.width * 0.25, gy = cb3.y + cb3.height * 0.75;
  await place('Function Gen', gx, gy);
  await place('Resistor 1kΩ', gx + 140, gy);
  const freeDots = async () => await page.evaluate(() => [...document.querySelectorAll('svg circle')]
    .filter(el => el.getAttribute('stroke') === '#e74c3c' && el.getAttribute('r') === '8')
    .map(el => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }));
  const dots3 = await freeDots();
  const near3 = (px, py) => dots3.slice().sort((a, b) => Math.hypot(a.x - px, a.y - py) - Math.hypot(b.x - px, b.y - py))[0];
  const fg3 = await page.locator('div').filter({ hasText: /^.*1000 Hz.*$/ }).last().boundingBox();
  const r3 = await page.locator('wokwi-resistor').last().boundingBox();
  const nb3 = (bx, dx, dy) => near3(bx.x + bx.width / 2 + dx, bx.y + bx.height / 2 + dy);
  const wire3 = async (a, b) => {
    await page.mouse.move(a.x, a.y); await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 6 }); await page.mouse.up();
    await page.waitForTimeout(200);
  };
  await wire3(nb3(fg3, -24, 32), nb3(r3, -34, 0));
  await wire3(nb3(fg3, 24, 32), nb3(r3, 34, 0));
  await clickOrFail(page.getByRole('radio', { name: /Sim/i }).first(), 'meter-board-intact', 'Sim toggle unclickable', { timeout: 20000 });
  await page.waitForTimeout(400);

  // 12. D21 — a placed multimeter must not destroy the board it measures.
  //     Until 2026-08-29 the meter was filtered out of the netlist while its
  //     probe terminals stayed in the nets, so bw-board's validator rejected
  //     the WHOLE netlist and the engine went to zero parts. Measured before
  //     the fix on a five-part bench: 5 engine parts before the probes were
  //     wired, 0 after, and the meter then read a fabricated 0 V.
  if (!reported.has('meter-board-intact')) {
    const enginePartsBefore = await page.evaluate(() => window.__circuit?.board?.parts?.length ?? -1);
    await place('Multimeter', gx + 60, gy - 140);
    const meterDots = (await freeDots()).filter(d => Math.abs(d.y - (gy - 140)) < 90);
    const target = (await freeDots()).sort((a, b) => Math.hypot(a.x - gx - 140, a.y - gy) - Math.hypot(b.x - gx - 140, b.y - gy))[0];
    if (meterDots.length && target) await wire3(meterDots[0], target);
    const after = await page.evaluate(() => ({
      parts: window.__circuit?.board?.parts?.length ?? -1,
      err: window.__circuit?.netlistError ?? null,
    }));
    verdict('meter-board-intact', after.parts >= enginePartsBefore && !after.err,
      `meter probes leave the board intact (${enginePartsBefore} → ${after.parts} engine parts)`,
      `wiring a meter emptied the board: ${enginePartsBefore} → ${after.parts} parts, ${after.err}`);
  }

  // 13. D31 — two channels, two INDEPENDENT vertical scales, both stated.
  if (await page.locator('[data-scope-panel]').count() === 0) {
    await clickOrFail(page.getByRole('button', { name: /Scope/i }).first(),
      'scope-vdiv-per-channel', 'scope toggle unclickable', { timeout: 20000 });
    await page.locator('[data-scope-panel]')
      .waitFor({ state: 'attached', timeout: 20000 }).catch(() => { /* reported below */ });
  }
  const sp = page.locator('[data-scope-panel]');
  if (await sp.count() !== 1) {
    failAll(['scope-vdiv-per-channel', 'spectrum-answers', 'spectrum-peak'],
      `no scope panel for the instrument scenarios (found ${await sp.count()})`);
  } else {
    const netSel = () => sp.locator('select').last();
    const offered = await netSel().locator('option').evaluateAll(os => os.map(o => o.value).filter(Boolean));
    // Channel 1 must be the net the GENERATOR drives, asked for by name rather
    // than guessed: "the newest net_*" picked the meter's own probe wire here,
    // and a spectrum of an isolated 0 V net peaks in bin 1 and proves nothing.
    const fgNet = await page.evaluate(() => {
      const c = window.__circuit;
      // The LAST vsource: the demo board this harness starts from may already
      // carry one, and the first match is then not the generator just placed.
      const src = (c?.parts || []).filter(p => p.kind === 'vsource').at(-1);
      if (!src) return null;
      const n = (c.board.getNets() || []).find(net =>
        (net.terminals || []).some(t => t.part === src.id && t.terminal === 'pos'));
      return n ? n.id : null;
    });
    const pick = [fgNet, offered.find(v => v !== fgNet)].filter(v => v && offered.includes(v));
    for (const v of pick) {
      await netSel().selectOption(v);
      try { await sp.getByText('+ channel').click({ timeout: 20000 }); } catch { /* reported below */ }
      await page.waitForTimeout(400);
    }
    const v0 = page.locator('[data-testid=bw-scope-vdiv-0]');
    const v1 = page.locator('[data-testid=bw-scope-vdiv-1]');
    if (await v0.count() === 1 && await v1.count() === 1) {
      await v0.selectOption('5');
      await v1.selectOption('0.05');
      await page.waitForTimeout(300);
      const s0 = (await page.locator('[data-testid=bw-scope-span-0]').innerText()).trim();
      const s1 = (await page.locator('[data-testid=bw-scope-span-1]').innerText()).trim();
      // 5 V/div against 0.05 V/div: a hundredfold difference, which under one
      // global setting could not exist. Both are STATED, which is the other
      // half — a scale nobody can read is a scale nobody can reason about.
      const span = (s) => { const m = s.match(/(-?[\d.]+)\s*…\s*(-?[\d.]+)/); return m ? Math.abs(+m[2] - +m[1]) : NaN; };
      verdict('scope-vdiv-per-channel', Math.abs(span(s0) / span(s1) - 100) < 1 && /\/div/.test(s0) && /\/div/.test(s1),
        `per-channel V/div: ch1 "${s0}" spans ${(span(s0) / span(s1)).toFixed(0)}× ch2 "${s1}"`,
        `the two channels do not scale independently: "${s0}" vs "${s1}"`);
    } else {
      fail('scope-vdiv-per-channel', `per-channel V/div controls missing (${await v0.count()} + ${await v1.count()})`);
    }

    // 14. D24 — the spectrum view of the generator's own 1 kHz tone.
    await clickOrFail(page.locator('[data-testid=bw-scope-view-spectrum]'), 'spectrum-answers', 'spectrum toggle unclickable', { timeout: 20000 });
    await page.waitForTimeout(6000);
    const specBox = page.locator('[data-testid=bw-scope-spectrum]');
    const specText = (await specBox.count()) ? (await specBox.innerText()).trim() : '';
    if (!reported.has('spectrum-answers')) {
      verdict('spectrum-answers', specText.length > 0,
        'spectrum view states a result or a refusal, never a blank plot',
        'spectrum view showed nothing at all');
    }
    // The generator is 1 kHz. Accept the peak anywhere within ±5 %, and accept
    // an HONEST refusal ("the trace is incomplete") on a box too slow to have
    // filled the ring — what is refused is a SILENT wrong answer.
    const peak = specText.match(/peak\s+([\d.]+)\s*(kHz|Hz)/i);
    if (peak) {
      const hz = parseFloat(peak[1]) * (/k/i.test(peak[2]) ? 1000 : 1);
      verdict('spectrum-peak', Math.abs(hz - 1000) < 50,
        `spectrum peaks at ${hz.toFixed(1)} Hz on a 1000 Hz generator`,
        `spectrum peaks at ${hz.toFixed(1)} Hz, generator is 1000 Hz `
          + `(ch1 net ${fgNet}, offered ${offered.length}) — ${specText.replace(/\n/g, ' | ')}`);
    } else if (/incomplete|never written|samples|capture/i.test(specText)) {
      pass('spectrum-peak', `spectrum refuses honestly while the series fills: "${specText.slice(0, 90)}"`);
    } else {
      fail('spectrum-peak', `spectrum neither peaked nor refused: "${specText.slice(0, 120)}"`);
    }
  }

  // 15. X2.6 — the sweep runs off the critical path: progress is a number and
  //     the canvas still drags while it runs. The old synchronous call left no
  //     moment at which either could happen.
  //
  //     Back to the time view first, and not to be tidy: a spectrum tap puts a
  //     solve point on every sample instant, so leaving it open costs the sim
  //     ~30 000 solves per simulated second and the page has no time left to
  //     answer a click. That is the honest cost of the second tap and the
  //     reason it exists only while the view is open.
  if (await page.locator('[data-testid=bw-scope-view-time]').count()) {
    try { await page.locator('[data-testid=bw-scope-view-time]').click({ timeout: 10000 }); } catch { /* reported by 15 */ }
    await page.waitForTimeout(600);
  }
  if (await page.locator('[data-testid=bw-sweep-panel]').count() === 0) {
    await clickOrFail(page.locator('[data-testid=bw-sweep-toggle]'), 'sweep-progress', 'sweep toggle unclickable', { timeout: 20000 });
    await page.locator('[data-testid=bw-sweep-panel]')
      .waitFor({ state: 'attached', timeout: 20000 }).catch(() => { /* reported below */ });
  }
  const swp = page.locator('[data-testid=bw-sweep-panel]');
  if (await swp.count() !== 1) {
    failAll(['sweep-progress', 'sweep-canvas-live'], `no sweep panel after toggling it on (found ${await swp.count()})`);
  } else {
    // RECORD the run button's label instead of sampling it. Polling every
    // 500 ms and asking "does it say N/60 right now" races a sweep that may
    // be over in under a second on a quiet runner: the sweep ran, reported
    // every point, finished, and the poll saw only "▶ Sweep" at both ends and
    // called that "no per-point progress". A MutationObserver installed
    // BEFORE the run cannot miss a label the button ever wore.
    await page.evaluate(() => {
      window.__sweepLabels = [];
      const read = () => (document.querySelector('[data-testid=bw-sweep-run]')?.innerText || '').trim();
      const push = () => {
        const t = read();
        if (t && window.__sweepLabels[window.__sweepLabels.length - 1] !== t) window.__sweepLabels.push(t);
      };
      push();
      const panel = document.querySelector('[data-testid=bw-sweep-panel]');
      window.__sweepObs = new MutationObserver(push);
      window.__sweepObs.observe(panel, { childList: true, subtree: true, characterData: true });
    });
    await clickOrFail(swp.locator('[data-testid=bw-sweep-run]'), 'sweep-progress', 'sweep run unclickable', { timeout: 30000 });

    // The drag goes FIRST, immediately, while the sweep is still working —
    // that is the whole claim of X2.6 and the reason this scenario exists.
    // Whether it was still running is recorded, not assumed: a drag that
    // happens after the sweep has finished proves nothing about the sweep,
    // and this scenario says so rather than passing on it.
    const running = async () => await swp.locator('[data-testid=bw-sweep-stop]').count() > 0;
    const runningBefore = await running();
    const rb = await page.locator('wokwi-resistor').first().boundingBox();
    const x0 = rb.x;
    await page.mouse.move(rb.x + rb.width / 2, rb.y + rb.height / 2);
    await page.mouse.down();
    for (let s = 1; s <= 8; s++) {
      await page.mouse.move(rb.x + rb.width / 2 + s * 15, rb.y + rb.height / 2);
      await page.waitForTimeout(20);
    }
    await page.mouse.up();
    await page.waitForTimeout(300);
    const rb2 = await page.locator('wokwi-resistor').first().boundingBox();
    const moved = rb2.x - x0;
    if (!runningBefore) {
      fail('sweep-canvas-live',
        `the sweep was not running when the canvas was dragged (moved ${moved.toFixed(0)} px) — `
        + 'a drag against an idle page proves nothing about a sweep off the critical path');
    } else {
      verdict('sweep-canvas-live', moved > 60,
        `canvas dragged ${moved.toFixed(0)} px DURING a running sweep`,
        `canvas froze during the sweep (moved ${moved.toFixed(0)} px)`);
    }

    // Let it finish (or give up saying so), then read what the button wore.
    for (let i = 0; i < 60 && await running(); i++) await page.waitForTimeout(500);
    const labels = await page.evaluate(() => {
      try { window.__sweepObs.disconnect(); } catch { /* already gone */ }
      return window.__sweepLabels || [];
    });
    const rowCount = await swp.locator('[data-testid=bw-sweep-readout]').count();
    if (!reported.has('sweep-progress')) {
      verdict('sweep-progress', labels.some(l => /\d+\s*\/\s*\d+/.test(l)),
        `sweep reports progress while running: ${labels.filter(l => /\d+\s*\/\s*\d+/.test(l)).length} `
          + `per-point labels, last "${labels.filter(l => /\d+\s*\/\s*\d+/.test(l)).at(-1)}"`,
        `sweep showed no per-point progress — the run button only ever read `
          + `${JSON.stringify(labels)} (readout panels: ${rowCount}, still running: ${await running()})`);
    }
    // Leave nothing running into the page-error check.
    const stop = page.locator('[data-testid=bw-sweep-stop]');
    if (await stop.count()) { try { await stop.click({ timeout: 2000 }); } catch { /* finished already */ } }
    await page.waitForTimeout(500);
  }
} catch (e) {
  // Whatever else, the run reaches its roll-call. An aborted block is a
  // FAILURE, named — the same rule as clickOrFail, one level up. Every
  // instrument scenario the block never reached is failed by name rather
  // than left unreported, so the roll-call below stays a count assertion
  // instead of collapsing into "the harness crashed".
  failAll(INSTRUMENT_IDS, `the instrument scenarios could not be set up: ${String(e).split('\n')[0]}`);
}

verdict('zero-page-errors', errors.length === 0,
  'zero page errors',
  `page errors: ${errors.join(' | ')}`);

// ── Roll-call: the count is asserted, not admired ────────────────────────
for (const s of CI_SKIPS) {
  if (isCI && !reported.has(s.id)) record(s.id, 'skip', `${s.id} IS NOT RUN IN CI — ${s.reason}`);
}
const missing = EXPECTED.filter(id => !reported.has(id));
const unexpected = [...reported.keys()].filter(id => !EXPECTED.includes(id));

console.log(`\n${reported.size} scenarios · ${passes} passed · ${fails} failed`
  + (skips ? ` · ${skips} skipped` : ''));
console.log(`roll-call: ${reported.size}/${EXPECTED.length} expected scenarios reported an outcome`);

if (missing.length) {
  console.error(`\n✖ ROLL-CALL FAILED: ${missing.length} scenario(s) never reported: ${missing.join(', ')}`);
  console.error('  A run that silently ran fewer scenarios than it declares is not a green run.');
  process.exitCode = 1;
}
if (unexpected.length) {
  console.error(`\n✖ ROLL-CALL FAILED: outcome(s) for scenario id(s) not in EXPECTED: ${unexpected.join(', ')}`);
  process.exitCode = 1;
}
for (const p of protocolErrors) {
  console.error(`\n✖ ROLL-CALL FAILED: ${p}`);
  process.exitCode = 1;
}
if (skips) {
  console.error(`\n⚠ ${skips} scenario(s) were SKIPPED IN CI and prove nothing today:`);
  for (const s of CI_SKIPS) console.error(`    - ${s.id}: ${s.reason}`);
}

await browser.close();
kill();
process.exit(process.exitCode ?? 0);
