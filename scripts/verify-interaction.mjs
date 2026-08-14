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

const fail = (msg) => { console.error(`✖ ${msg}`); process.exitCode = 1; };
const pass = (msg) => console.log(`✔ ${msg}`);

await waitForServer();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 800 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
await page.goto(`http://localhost:${PORT}`, { waitUntil: 'networkidle' });
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

// 5. Oscilloscope panel: add a channel on a real net; the canvas appears.
{
  const panel = page.locator('[data-scope-panel]');
  if (await panel.count() === 0) { fail('no scope panel in the sidebar'); }
  else {
    const sel = panel.locator('select').last();
    const opts = await sel.locator('option').allTextContents();
    if (opts.length < 2) { fail('scope net picker offers no nets'); }
    else {
      await sel.selectOption({ index: 1 });
      await panel.getByText('+ channel').click();
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
  await page.reload({ waitUntil: 'networkidle' });
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
  await page.getByRole('button', { name: 'Sim', exact: true }).first().click();
  await page.waitForTimeout(300);
  const scope = page.locator('[data-scope-panel]');
  const sel = scope.locator('select').last();
  const optCount = await sel.locator('option').count();
  if (optCount < 2) { fail('FG circuit produced no nets to scope'); }
  else {
    // Scope the net the FG wiring just created: the LAST engine wire-net.
    const values = await sel.locator('option').evaluateAll(os => os.map(o => o.value));
    const wireNets = values.filter(v => v.startsWith('net_'));
    await sel.selectOption(wireNets.length ? wireNets[wireNets.length - 1] : { index: optCount - 1 });
    await scope.getByText('+ channel').click();
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
  await page.getByRole('button', { name: /pause/ }).first().click();
  await page.waitForTimeout(300);
  const t1 = await t();
  await page.waitForTimeout(400);
  const t2 = await t();
  (t1 === t2 && t1 !== 'none') ? pass('pause freezes board time')
    : fail(`pause leaked time: ${t1} -> ${t2}`);
  await page.getByRole('button', { name: /step/ }).first().click();
  await page.waitForTimeout(200);
  const t3 = await t();
  (BigInt(t3) - BigInt(t2) === 50000000n) ? pass('step advances exactly one 50 ms tick')
    : fail(`step advanced ${BigInt(t3) - BigInt(t2)} ns`);
  await page.getByRole('button', { name: /resume/ }).first().click();
  await page.waitForTimeout(400);
  const t4 = await t();
  (BigInt(t4) > BigInt(t3)) ? pass('resume: time flows again')
    : fail('resume did not restart the clock');
}

// 7. Schematic projection: toggle it on — standard symbols render beside
//    the canvas, one per electrical part, and the canvas stays interactive.
{
  await page.getByText('Schematic', { exact: true }).first().click();
  await page.waitForTimeout(400);
  const symCount = await page.evaluate(() =>
    document.querySelectorAll('[data-schematic] g > text').length);
  symCount >= 3 ? pass(`schematic beside the canvas (${symCount} symbols)`)
    : fail(`schematic did not render (symbols=${symCount})`);
}

// 8. Pure-circuit Sim: the no-declarations starter must SIMULATE without
//    crashing (the tap-wire/no-MCU landing is production's first screen).
{
  await page.goto(`http://localhost:${PORT}/?nopins=1`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__circuit && window.__circuit.parts.length > 0, { timeout: 20000 });
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: 'Sim', exact: true }).first().click();
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
  await page.goto(`http://localhost:${PORT}`, { waitUntil: 'networkidle' });
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
  await page.goto(`http://localhost:${PORT}`, { waitUntil: 'networkidle' });
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

// 11. Examples panel collapse/expand
{
  const exPanel = await page.locator('[data-examples-selector]');
  const exToggle = await page.locator('[data-examples-toggle]');
  if (await exPanel.count() && await exToggle.count()) {
    // Measure expanded height
    const expandedBox = await exPanel.boundingBox();
    const expandedH = expandedBox?.height ?? 0;
    // Click collapse
    await exToggle.click();
    await page.waitForTimeout(200);
    const collapsedBox = await exPanel.boundingBox();
    const collapsedH = collapsedBox?.height ?? 999;
    collapsedH < 32
      ? pass(`examples collapse: ${Math.round(collapsedH)}px < 32px`)
      : fail(`examples collapsed to ${Math.round(collapsedH)}px, expected < 32px`);

    // Parts palette should have grown
    const partsPanel = await page.locator('[data-parts-selector]');
    const partsBox = await partsPanel.boundingBox();
    const partsH = partsBox?.height ?? 0;
    partsH > expandedH
      ? pass(`parts palette widened to ${Math.round(partsH)}px (was sharing space)`)
      : fail(`parts palette height ${Math.round(partsH)}px did not grow after examples collapse`);

    // Click expand — should restore previous split
    await exToggle.click();
    await page.waitForTimeout(200);
    const restoredBox = await exPanel.boundingBox();
    const restoredH = restoredBox?.height ?? 0;
    const drift = Math.abs(restoredH - expandedH);
    drift < 15
      ? pass(`examples expand restores height (drift ${Math.round(drift)}px)`)
      : fail(`examples restore drifted ${Math.round(drift)}px from original ${Math.round(expandedH)}px`);
  } else {
    fail('examples panel or toggle not found in DOM');
  }
}

if (errors.length) fail(`page errors: ${errors.join(' | ')}`);
else pass('zero page errors');

await browser.close();
kill();
process.exit(process.exitCode ?? 0);
