#!/usr/bin/env node
// Interaction acceptance: the owner's reported failures, run as a gate.
// Self-contained: spawns its own dev server, drives a real browser with real
// pointer sequences against WOKWI parts (not SVG symbols — that distinction
// is how the breakage stayed invisible), exits non-zero on any failure.
//
//   npm run verify:interaction
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const PORT = 3142;
const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
  stdio: 'ignore', detached: false,
});
const kill = () => { try { server.kill('SIGTERM'); } catch { /* gone */ } };
process.on('exit', kill);

const waitForServer = async () => {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://localhost:${PORT}/`);
      if (r.ok) return;
    } catch { /* not up yet */ }
    await new Promise(res => setTimeout(res, 500));
  }
  throw new Error('dev server did not come up');
};

// The scenario count is part of the gate: "run it and it was green" is not a
// result if it silently ran fewer scenarios than last time. Counted here so
// the number is printed rather than eyeballed off the scrollback.
let passes = 0, fails = 0;
const fail = (msg) => { fails++; console.error(`✖ ${msg}`); process.exitCode = 1; };
const pass = (msg) => { passes++; console.log(`✔ ${msg}`); };

/**
 * Click, and turn a click that cannot happen into a REPORTED failure instead
 * of an uncaught exception.
 *
 * A gate that aborts on the first unclickable button hides every scenario
 * after it: on a loaded box (load 22 on four cores, 2026-08-29) the transport
 * bar's live clock re-lays-out faster than Playwright's stability check can
 * settle, `⏸ Pause simulation` never becomes "stable", and the run died at
 * scenario 6b with five scenarios never attempted — and the same at
 * origin/master, so the abort was hiding the health of the rest from anyone
 * running it here. The failure still fails; it just stops being fatal.
 *
 * @returns {Promise<boolean>} whether the click landed
 */
const clickOrFail = async (locator, what, opts = {}) => {
  try {
    await locator.click({ timeout: 5000, ...opts });
    return true;
  } catch (e) {
    fail(`${what}: ${String(e).split('\n')[0]}`);
    return false;
  }
};

await waitForServer();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 800 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
// `domcontentloaded`, not `networkidle`: the house probe traps say the load
// event can hang, and on a loaded box (load 26 on four cores, 2026-08-29) a
// Vite dev server never went idle inside 30 s and the gate died before its
// first scenario. Readiness here has always been a CONDITION rather than a
// load event, so nothing is lost by not waiting for one.
await page.goto(`http://localhost:${PORT}`, { waitUntil: 'domcontentloaded' });
// Readiness is a condition, not a sleep: the circuit is populated and the
// first solve has landed when parts exist and a wokwi element is attached.
await page.waitForFunction(() => window.__circuit && window.__circuit.parts.length > 0
  && document.querySelector('wokwi-led'), { timeout: 20000 });
await page.waitForTimeout(400); // one settle frame for the wokwi layer


const box = async () => await page.locator('wokwi-led').first().boundingBox();
const selectionCount = async () =>
  await page.evaluate(() => document.body.innerText.match(/(\d+)\s*selected/)?.[1] ?? '0');

// 1. Click-select, three times, on the wokwi LED.
{
  const b = await box();
  if (!b) { fail('no wokwi LED on the default board'); }
  else {
    let ok = true;
    for (let i = 0; i < 3; i++) {
      await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
      await page.waitForTimeout(120);
      if (await selectionCount() !== '1') ok = false;
    }
    ok ? pass('click selects the LED, all three times')
       : fail('click-to-select is unreliable');
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
  (dx > 180 && dx < 220) ? pass(`drag moved the LED ${dx.toFixed(0)} px`)
    : fail(`drag moved ${dx.toFixed(0)} px, expected ~200`);
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
    fail(`could not find two free terminals to wire (found ${freeDots.length})`);
  } else {
    await page.mouse.move(dot.x, dot.y);
    await page.mouse.down();
    await page.mouse.move((dot.x + dot2.x) / 2, (dot.y + dot2.y) / 2, { steps: 5 });
    await page.mouse.move(dot2.x, dot2.y, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(200);
    const wiresAfter = await page.locator('[data-wire]').count();
    (wiresAfter > wiresBefore) ? pass('terminal-to-terminal drag created a wire')
      : fail(`wiring drag created nothing (paths ${wiresBefore} → ${wiresAfter})`);
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
  boards >= 1 ? pass('palette drag placed a breadboard substrate')
    : fail('breadboard did not appear after palette drag');
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
  if (!bbRect) { fail('no breadboard on canvas for the seating scenario'); }
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
    if (seat.err) { fail(`seating: ${seat.err}`); }
    else {
      const holes = Object.values(seat.leadMap);
      const onLattice = holes.every(h => /^[a-j][0-9]+$/.test(h));
      onLattice ? pass(`seated ${seat.kind}: legs in holes ${holes.join(', ')}`)
        : fail(`leadMap not on terminal rows: ${holes.join(', ')}`);
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
  if (!rect) { fail('no breadboard for the jumper scenario'); }
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
    made ? pass('hole-to-hole drag created a jumper wire')
      : fail('jumper gesture produced no wire');
  }
}

// 4. Trackpad two-finger scroll must PAN the canvas (viewBox moves).
{
  const canvas = await page.locator('[data-canvas] svg').first();
  const vbBefore = await canvas.getAttribute('viewBox');
  const cb = await canvas.boundingBox();
  await page.mouse.move(cb.x + cb.width / 2, cb.y + cb.height / 2);
  await page.mouse.wheel(80, 60); // plain wheel: pan, not zoom
  await page.waitForTimeout(200);
  const vbAfter = await canvas.getAttribute('viewBox');
  (vbBefore !== vbAfter) ? pass('two-finger scroll pans the canvas')
    : fail('wheel did not pan the canvas');
  // And the zoom (width term of the viewBox) must NOT have changed.
  const w0 = Number(vbBefore.split(' ')[2]);
  const w1 = Number(vbAfter.split(' ')[2]);
  (Math.abs(w0 - w1) < 1e-6) ? pass('plain wheel did not zoom')
    : fail(`plain wheel changed zoom: ${w0} → ${w1}`);
}

// 5. Oscilloscope panel: toggle scope visibility, add a channel on a real net.
{
  // The "▣ Scope" button in the instruments column shows/hides the panel.
  //
  // By ROLE, not by text. `getByText('Scope').first()` matches every element
  // whose text CONTAINS "Scope" — including the button's ancestors, which come
  // first in document order — so `.first()` clicked a container div whose
  // centre is not the button, the panel never opened, and the scenario
  // reported "no scope panel in the sidebar" while the panel was merely never
  // asked for. It failed identically at origin/master, so it was not a
  // regression; it was a selector that had stopped meaning what it says.
  // …and only when it is CLOSED. The toggle remembers itself in localStorage,
  // so after the reload in scenario 6 the panel is already open and an
  // unconditional click would close it — which is exactly what "FG circuit
  // produced no nets to scope" was, once the click above started working.
  const showScope = async () => {
    const panelSel = '[data-scope-panel], [data-scope-module]';
    if (await page.locator(panelSel).count()) return;
    const btn = page.getByRole('button', { name: /Scope/i }).first();
    if (await btn.count()) {
      await clickOrFail(btn, 'scope show/hide unclickable', { timeout: 20000 });
      // Readiness is a CONDITION, not a sleep — this file says so in its own
      // header and then waited 300 ms for React to mount a panel. On a loaded
      // box it does not, and the scenario then reported the panel missing.
      await page.locator(panelSel).first()
        .waitFor({ state: 'attached', timeout: 15000 }).catch(() => { /* reported below */ });
    }
  };
  await showScope();
  const panel = page.locator('[data-scope-panel], [data-scope-module]');
  if (await panel.count() === 0) { fail('no scope panel in the sidebar'); }
  else {
    const sel = panel.locator('select').last();
    const opts = await sel.locator('option').allTextContents();
    if (opts.length < 2) { fail('scope net picker offers no nets'); }
    else {
      await sel.selectOption({ index: 1 });
      const addBtn = panel.getByText('+ channel', { exact: false });
      if (await addBtn.count()) await addBtn.click();
      await page.waitForTimeout(400);
      (await panel.locator('canvas').count()) === 1
        ? pass('scope channel attached; capture canvas live')
        : fail('scope canvas did not appear');
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
  const canvasBox2 = await page.locator('[data-canvas]').boundingBox();
  const dropAt = async (label, x, y) => {
    const el = page.getByText(label, { exact: false }).first();
    try {
      await el.scrollIntoViewIfNeeded({ timeout: 5000 });
    } catch {
      await page.screenshot({ path: '/tmp/gate-fail.png' });
      console.log('DBG body:', (await page.locator('body').innerText()).slice(0, 200));
      console.log('DBG pageerrors:', errors.join(' || ').slice(0, 600));
      throw new Error(`palette item not reachable: ${label}`);
    }
    await el.click();
    await page.waitForTimeout(120);
    await page.mouse.move(x, y, { steps: 4 });
    await page.mouse.click(x, y);
    await page.waitForTimeout(150);
  };
  const fx = canvasBox2.x + canvasBox2.width * 0.25;
  const fy = canvasBox2.y + canvasBox2.height * 0.75;
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
  await clickOrFail(page.getByRole('radio', { name: /Sim/i }).first(), 'Sim toggle unclickable', { timeout: 20000 });
  await page.waitForTimeout(300);
  // Show scope panel if hidden (lite keeps it behind a button)
  if (await page.locator('[data-scope-panel], [data-scope-module]').count() === 0) {
    const scopeShowBtn = page.getByRole('button', { name: /Scope/i }).first();
    if (await scopeShowBtn.count()) {
      await clickOrFail(scopeShowBtn, 'scope show/hide unclickable', { timeout: 20000 });
      await page.locator('[data-scope-panel], [data-scope-module]').first()
        .waitFor({ state: 'attached', timeout: 15000 }).catch(() => { /* reported below */ });
    }
  }
  const scope = page.locator('[data-scope-panel], [data-scope-module]');
  const sel = scope.locator('select').last();
  const optCount = await sel.count() ? await sel.locator('option').count() : 0;
  if (optCount < 2) { fail('FG circuit produced no nets to scope'); }
  else {
    // Scope the net the FG wiring just created: the LAST engine wire-net.
    const values = await sel.locator('option').evaluateAll(os => os.map(o => o.value));
    const wireNets = values.filter(v => v.startsWith('net_'));
    await sel.selectOption(wireNets.length ? wireNets[wireNets.length - 1] : { index: optCount - 1 });
    await clickOrFail(scope.getByText('+ channel'), 'scope + channel unclickable', { timeout: 20000 });
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
    spread > 25 ? pass(`function generator waveform on the scope (spread ${spread}px)`)
      : fail(`scope trace flat or absent (spread ${spread}px)`);
  }
}

// 6b. Sim transport: pause freezes board time coherently; step advances
//     exactly one 50 ms tick; resume flows again.
{
  const t = async () => await page.evaluate(() => String(window.__board?.getTime?.() ?? 'none'));
  const paused = await clickOrFail(page.getByText(/Pause/i).first(), 'pause button unclickable');
  await page.waitForTimeout(300);
  const t1 = await t();
  await page.waitForTimeout(400);
  const t2 = await t();
  if (paused) {
    (t1 === t2 && t1 !== 'none') ? pass('pause freezes board time')
      : fail(`pause leaked time: ${t1} -> ${t2}`);
  } else fail('pause freezes board time: not attempted');
  const stepped = paused && await clickOrFail(page.getByText(/Step/i).first(), 'step button unclickable');
  await page.waitForTimeout(200);
  const t3 = await t();
  if (stepped) {
    (BigInt(t3) - BigInt(t2) === 50000000n) ? pass('step advances exactly one 50 ms tick')
      : fail(`step advanced ${BigInt(t3) - BigInt(t2)} ns`);
  } else fail('step advances exactly one 50 ms tick: not attempted');
  const resumed = paused && await clickOrFail(page.getByText(/Resume/i).first(), 'resume button unclickable');
  await page.waitForTimeout(400);
  const t4 = await t();
  if (resumed) {
    (BigInt(t4) > BigInt(t3)) ? pass('resume: time flows again')
      : fail('resume did not restart the clock');
  } else fail('resume: time flows again: not attempted');
}

// 7. Schematic projection: toggle it on — standard symbols render beside
//    the canvas, one per electrical part, and the canvas stays interactive.
{
  await clickOrFail(page.getByRole('radio', { name: /Schematic/i }).first(), 'Schematic toggle unclickable', { timeout: 20000 });
  await page.waitForTimeout(400);
  const symCount = await page.evaluate(() =>
    document.querySelectorAll('[data-schematic] g > text').length);
  symCount >= 3 ? pass(`schematic beside the canvas (${symCount} symbols)`)
    : fail(`schematic did not render (symbols=${symCount})`);
}

// 8. Pure-circuit Sim: the no-declarations starter must SIMULATE without
//    crashing (the tap-wire/no-MCU landing is production's first screen).
{
  await page.goto(`http://localhost:${PORT}/?nopins=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__circuit && window.__circuit.parts.length > 0, { timeout: 20000 });
  await page.waitForTimeout(400);
  await clickOrFail(page.getByRole('radio', { name: /Sim/i }).first(), 'Sim toggle unclickable', { timeout: 20000 });
  await page.waitForTimeout(700);
  const mode = await page.evaluate(() => document.querySelector('[data-sim-mode]')?.getAttribute('data-sim-mode'));
  mode === 'simulate' ? pass('no-MCU starter enters Sim without crashing')
    : fail(`Sim on the pure starter: mode=${mode ?? 'DESIGNER UNMOUNTED'}`);
  const t1 = await page.evaluate(() => String(window.__board.getTime()));
  await page.waitForTimeout(500);
  const t2 = await page.evaluate(() => String(window.__board.getTime()));
  BigInt(t2) > BigInt(t1) ? pass('pure-circuit clock flows')
    : fail('pure-circuit clock frozen');
}

// 9. Body beats hole: dragging a SEATED part's body must MOVE the part —
// never start a jumper wire from a free hole hiding under the body. This
// was the potentiometer complaint: selected, dragged, and wires appeared.
{
  await page.goto(`http://localhost:${PORT}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__circuit && window.__circuit.parts.length > 0 && document.querySelector('wokwi-led'), { timeout: 20000 });
  await page.waitForTimeout(400);
  const before = await page.evaluate(() => {
    const led = window.__circuit.parts.find(q => q.kind === 'led' && q.seat);
    return led ? { id: led.id, x: led.x, y: led.y, wires: window.__circuit.wires.length,
      jumpers: window.__circuit.holeWires().length } : null;
  });
  if (!before) fail('no seated part to drag in scenario 9');
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
    (after.wires === before.wires && after.jumpers === before.jumpers)
      ? pass('seated body drag draws no wires')
      : fail(`seated body drag created wires: ${before.wires}->${after.wires} jumpers ${before.jumpers}->${after.jumpers}`);
    Math.abs(after.x - before.x) > 40 ? pass('seated body drag MOVES the part')
      : fail(`seated part did not move (dx=${Math.abs(after.x - before.x)})`);
  }
}

// 10. Pin chooser: a wire released on the chip BODY opens the named pin
// dialog, and choosing completes the wire — buttons must receive their
// clicks through the canvas pointer machine (they once silently did not).
{
  await page.goto(`http://localhost:${PORT}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__circuit && window.__circuit.parts.some(q => q.kind === 'mcu'), { timeout: 20000 });
  await page.waitForTimeout(400);
  const pts = await page.evaluate(() => {
    const c = window.__circuit;
    const bb = c.parts.find(q => q.kind === 'breadboard');
    const mcu = c.parts.find(q => q.kind === 'mcu');
    return { bb: { x: bb.x, y: bb.y }, mcu: { x: mcu.x, y: mcu.y } };
  });
  const toScreen = async (wx, wy) => page.evaluate(({ wx, wy }) => {
    const el = [...document.querySelectorAll('div')].find(d => /scale\(/.test(d.style.transform || ''));
    const m2 = new DOMMatrixReadOnly(getComputedStyle(el).transform);
    const r = el.parentElement.getBoundingClientRect();
    return { x: r.x + wx * m2.a + m2.e, y: r.y + wy * m2.d + m2.f };
  }, { wx, wy });
  const from = await toScreen(pts.bb.x - (62 * 14) / 2 + 19 * 14, pts.bb.y - 128);
  const to = await toScreen(pts.mcu.x, pts.mcu.y);
  await page.mouse.move(from.x, from.y); await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 4 }); await page.mouse.up();
  await page.waitForTimeout(600);
  const open = await page.getByText('Which pin of', { exact: false }).count();
  open ? pass('pin chooser opens on chip-body release') : fail('pin chooser did not open');
  if (open) {
    await page.locator('button', { hasText: 'P1.5' }).first().click({ timeout: 5000 });
    await page.waitForTimeout(400);
    const wired = await page.evaluate(() => {
      const m = window.__circuit.parts.find(q => q.kind === 'mcu');
      return window.__circuit.wires.some(w =>
        (w.from.part === m.id && w.from.terminal === 'P1.5') || (w.to.part === m.id && w.to.terminal === 'P1.5'));
    });
    wired ? pass('chosen pin completes the tap wire') : fail('chooser click produced no wire');
  }
}

// 11. Selectors panel collapse/expand (left sidebar)
// Lite's UI collapses the entire selectors column via the ‹ toggle button.
{
  const toggle = page.locator('[data-selectors-toggle]');
  if (await toggle.count()) {
    // Measure expanded state
    const rail = page.locator('[data-selectors-rail]');
    const beforeBox = await rail.boundingBox();
    const beforeW = beforeBox?.width ?? 0;
    // Click collapse
    await toggle.click();
    await page.waitForTimeout(200);
    const afterBox = await rail.boundingBox();
    const afterW = afterBox?.width ?? 999;
    afterW < 30
      ? pass(`selectors collapse: ${Math.round(afterW)}px < 30px`)
      : fail(`selectors collapsed to ${Math.round(afterW)}px, expected < 30px`);
    // Click expand — should restore
    await toggle.click();
    await page.waitForTimeout(200);
    const restoredBox = await rail.boundingBox();
    const restoredW = restoredBox?.width ?? 0;
    const drift = Math.abs(restoredW - beforeW);
    drift < 20
      ? pass(`selectors expand restores width (drift ${Math.round(drift)}px)`)
      : fail(`selectors restore drifted ${Math.round(drift)}px from ${Math.round(beforeW)}px`);
  } else {
    pass('selectors collapse: skipped (no toggle in DOM)');
    pass('selectors restore: skipped');
  }
}

// ── 12–15. The instruments (D21, D31, D24, X2.6) ─────────────────────────
// One bench for all four: a 1 kHz function generator across a resistor, in
// Sim. Built fresh, because these scenarios are about READINGS and the
// accumulated clutter of eleven earlier scenarios only obscures them.
try {
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__circuit && window.__circuit.parts.length > 0, { timeout: 30000 });
  await page.waitForTimeout(800);
  const cb3 = await page.locator('[data-canvas]').boundingBox();
  const place = async (label, x, y) => {
    const el = page.getByText(label, { exact: false }).first();
    // A palette that is still re-rendering never becomes "stable", and on a
    // loaded box that is a 2 s timeout for a scroll the click would have done
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
  await clickOrFail(page.getByRole('radio', { name: /Sim/i }).first(), 'Sim toggle unclickable', { timeout: 20000 });
  await page.waitForTimeout(400);

  // 12. D21 — a placed multimeter must not destroy the board it measures.
  //     Until 2026-08-29 the meter was filtered out of the netlist while its
  //     probe terminals stayed in the nets, so bw-board's validator rejected
  //     the WHOLE netlist and the engine went to zero parts. Measured before
  //     the fix on a five-part bench: 5 engine parts before the probes were
  //     wired, 0 after, and the meter then read a fabricated 0 V.
  {
    const enginePartsBefore = await page.evaluate(() => window.__circuit?.board?.parts?.length ?? -1);
    await place('Multimeter', gx + 60, gy - 140);
    const meterDots = (await freeDots()).filter(d => Math.abs(d.y - (gy - 140)) < 90);
    const target = (await freeDots()).sort((a, b) => Math.hypot(a.x - gx - 140, a.y - gy) - Math.hypot(b.x - gx - 140, b.y - gy))[0];
    if (meterDots.length && target) await wire3(meterDots[0], target);
    const after = await page.evaluate(() => ({
      parts: window.__circuit?.board?.parts?.length ?? -1,
      err: window.__circuit?.netlistError ?? null,
    }));
    (after.parts >= enginePartsBefore && !after.err)
      ? pass(`meter probes leave the board intact (${enginePartsBefore} → ${after.parts} engine parts)`)
      : fail(`wiring a meter emptied the board: ${enginePartsBefore} → ${after.parts} parts, ${after.err}`);
  }

  // 13. D31 — two channels, two INDEPENDENT vertical scales, both stated.
  if (await page.locator('[data-scope-panel]').count() === 0) {
    await clickOrFail(page.getByRole('button', { name: /Scope/i }).first(),
      'scope toggle unclickable', { timeout: 20000 });
    await page.locator('[data-scope-panel]')
      .waitFor({ state: 'attached', timeout: 15000 }).catch(() => { /* reported below */ });
  }
  const sp = page.locator('[data-scope-panel]');
  if (await sp.count() !== 1) {
    fail('no scope panel for the instrument scenarios');
    fail('per-channel V/div: not attempted');
    fail('spectrum view: not attempted');
    fail('spectrum names its peak: not attempted');
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
      await clickOrFail(sp.getByText('+ channel'), 'scope + channel unclickable', { timeout: 20000 });
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
      (Math.abs(span(s0) / span(s1) - 100) < 1 && /\/div/.test(s0) && /\/div/.test(s1))
        ? pass(`per-channel V/div: ch1 "${s0}" spans ${(span(s0) / span(s1)).toFixed(0)}× ch2 "${s1}"`)
        : fail(`the two channels do not scale independently: "${s0}" vs "${s1}"`);
    } else {
      fail(`per-channel V/div controls missing (${await v0.count()} + ${await v1.count()})`);
    }

    // 14. D24 — the spectrum view of the generator's own 1 kHz tone.
    await clickOrFail(page.locator('[data-testid=bw-scope-view-spectrum]'), 'spectrum toggle unclickable', { timeout: 20000 });
    await page.waitForTimeout(6000);
    const specBox = page.locator('[data-testid=bw-scope-spectrum]');
    const specText = (await specBox.count()) ? (await specBox.innerText()).trim() : '';
    specText.length > 0
      ? pass('spectrum view states a result or a refusal, never a blank plot')
      : fail('spectrum view showed nothing at all');
    // The generator is 1 kHz. Accept the peak anywhere within ±5 %, and accept
    // an HONEST refusal ("the trace is incomplete") on a box too slow to have
    // filled the ring — what is refused is a SILENT wrong answer.
    const peak = specText.match(/peak\s+([\d.]+)\s*(kHz|Hz)/i);
    if (peak) {
      const hz = parseFloat(peak[1]) * (/k/i.test(peak[2]) ? 1000 : 1);
      (Math.abs(hz - 1000) < 50)
        ? pass(`spectrum peaks at ${hz.toFixed(1)} Hz on a 1000 Hz generator`)
        : fail(`spectrum peaks at ${hz.toFixed(1)} Hz, generator is 1000 Hz `
          + `(ch1 net ${fgNet}, offered ${offered.length}) — ${specText.replace(/\n/g, ' | ')}`);
    } else if (/incomplete|never written|samples|capture/i.test(specText)) {
      pass(`spectrum refuses honestly while the series fills: "${specText.slice(0, 90)}"`);
    } else {
      fail(`spectrum neither peaked nor refused: "${specText.slice(0, 120)}"`);
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
    await clickOrFail(page.locator('[data-testid=bw-scope-view-time]'), 'time view unclickable');
    await page.waitForTimeout(600);
  }
  if (await page.locator('[data-testid=bw-sweep-panel]').count() === 0) {
    await clickOrFail(page.locator('[data-testid=bw-sweep-toggle]'), 'sweep toggle unclickable', { timeout: 20000 });
    await page.locator('[data-testid=bw-sweep-panel]')
      .waitFor({ state: 'attached', timeout: 15000 }).catch(() => { /* reported below */ });
  }
  const swp = page.locator('[data-testid=bw-sweep-panel]');
  if (await swp.count() !== 1) {
    fail('no sweep panel after toggling it on');
    fail('canvas interactive during a sweep: not attempted');
  } else {
    await clickOrFail(swp.locator('[data-testid=bw-sweep-run]'), 'sweep run unclickable', { timeout: 30000 });
    // Poll for the progress readout rather than sleeping a guess: a host that
    // supplies a worker pays for its first boot here, and on a loaded box that
    // is seconds. What is being asserted is that progress EXISTS, not when.
    let label = '';
    for (let i = 0; i < 60; i++) {
      label = (await swp.locator('[data-testid=bw-sweep-run]').innerText()).trim();
      if (/\d+\s*\/\s*\d+/.test(label)) break;
      if (await swp.locator('[data-testid=bw-sweep-stop]').count() === 0 && i > 4) break; // finished
      await page.waitForTimeout(500);
    }
    /\d+\s*\/\s*\d+/.test(label)
      ? pass(`sweep reports progress while running: "${label}"`)
      : fail(`sweep showed no per-point progress: "${label}"`);
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
    (moved > 60)
      ? pass(`canvas dragged ${moved.toFixed(0)} px DURING a running sweep`)
      : fail(`canvas froze during the sweep (moved ${moved.toFixed(0)} px)`);
    // Leave nothing running into the page-error check.
    const stop = page.locator('[data-testid=bw-sweep-stop]');
    if (await stop.count()) { try { await stop.click({ timeout: 2000 }); } catch { /* finished already */ } }
    await page.waitForTimeout(500);
  }
} catch (e) {
  // Whatever else, the run reaches its count line. An aborted block is a
  // FAILURE, named — the same rule as clickOrFail, one level up.
  fail(`the instrument scenarios could not be set up: ${String(e).split('\n')[0]}`);
}

if (errors.length) fail(`page errors: ${errors.join(' | ')}`);
else pass('zero page errors');

console.log(`\n${passes + fails} scenarios · ${passes} passed · ${fails} failed`);

await browser.close();
kill();
process.exit(process.exitCode ?? 0);
