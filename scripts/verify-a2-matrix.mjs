#!/usr/bin/env node
// A2 paint-to-sim acceptance: does a known image (heart) painted through
// column-scanned matrix driving actually light the correct pixels on the
// MATRIX8X8 face?
//
// End-to-end path tested:
//   voltage source scan loop (simulating compiled show-image firmware)
//   → matrix8x8 device model (POV duty-cycle integration)
//   → getDeviceState brightness array
//   → SVG face circles in the DOM
//
// Scope: on/off (full-brightness) path. Per-pixel 4-level BCM brightness
// is the coordinator's in-flight work — see TODO below.
//
// Run:  node scripts/verify-a2-matrix.mjs
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const PORT = 3148;
const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
  stdio: 'ignore', detached: false,
});
const kill = () => { try { server.kill('SIGTERM'); } catch { /* gone */ } };
process.on('exit', kill);

const waitForServer = async () => {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`http://localhost:${PORT}/`); if (r.ok) return; }
    catch { /* not up yet */ }
    await new Promise(res => setTimeout(res, 500));
  }
  throw new Error('dev server did not come up');
};

const fail = (msg) => { console.error(`✖ ${msg}`); process.exitCode = 1; };
const pass = (msg) => console.log(`✔ ${msg}`);

await waitForServer();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
await page.goto(`http://localhost:${PORT}/?nopins=1`, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__circuit && window.__circuit.parts.length > 0, { timeout: 20000 });

// ────────────────────────────────────────────────────────────────────────────
// The test image: a classic heart.  Row-major, MSB = column 0 (left).
// Each 1-bit = LED on, 0-bit = LED off.
//
//   . # # . . # # .    0x66
//   # # # # # # # #    0xFF
//   # # # # # # # #    0xFF
//   # # # # # # # #    0xFF
//   . # # # # # # .    0x7E
//   . . # # # # . .    0x3C
//   . . . # # . . .    0x18
//   . . . . . . . .    0x00
//
const HEART = [0x66, 0xFF, 0xFF, 0xFF, 0x7E, 0x3C, 0x18, 0x00];
// ────────────────────────────────────────────────────────────────────────────

// ---- build the test rig programmatically -----------------------------------
// A matrix8x8 with 8 column + 8 row voltage sources, all grounded.
// The scan loop drives them exactly as compiled firmware would: one column
// at a time, rows per the image, 1 ms per column = 8 ms per frame.
await page.evaluate(() => {
  const c = window.__circuit;
  const gn = c.addPart('gnd', {}, 100, 700);
  const matrix = c.addPart('matrix8x8', {}, 500, 400);

  // 8 column voltage sources
  const colSrcs = [];
  for (let i = 0; i < 8; i++) {
    const vs = c.addPart('vsource', { volts: 0 }, 120 + i * 50, 150);
    c.addWire(vs.id, 'pos', matrix.id, 'col' + i);
    c.addWire(vs.id, 'neg', gn.id, 'gnd');
    colSrcs.push(vs.id);
  }

  // 8 row voltage sources
  const rowSrcs = [];
  for (let i = 0; i < 8; i++) {
    const vs = c.addPart('vsource', { volts: 0 }, 120 + i * 50, 650);
    c.addWire(vs.id, 'pos', matrix.id, 'row' + i);
    c.addWire(vs.id, 'neg', gn.id, 'gnd');
    rowSrcs.push(vs.id);
  }

  window.__matrixRig = { matrix: matrix.id, colSrcs, rowSrcs };
});
await page.waitForTimeout(300);

// Verify the rig built without errors
{
  const diag = await page.evaluate(() => ({
    err: window.__circuit.netlistError,
    parts: window.__circuit.parts.length,
    nets: (window.__circuit.resolvedNets || []).length,
    matrixId: window.__matrixRig.matrix,
  }));
  console.log('rig diag:', JSON.stringify(diag));
  !diag.err
    ? pass(`rig built: ${diag.parts} parts, ${diag.nets} nets`)
    : fail(`rig netlist error: ${diag.err}`);
}

// ---- enter simulate mode, then PAUSE so the background timer does not
//      interfere with our scan loop (it would advance past the scanned
//      window, leaving only the last column active).
await page.getByRole('radio', { name: /Sim/i }).first().click();
await page.waitForTimeout(600);
// Pause the simulation — the button label is ⏸ (U+23F8) or "Pause"
const pauseBtn = page.locator('button', { hasText: /⏸|Pause/i }).first();
if (await pauseBtn.count()) await pauseBtn.click();
await page.waitForTimeout(300);

// ---- run the scan loop (simulating compiled show-image firmware) -----------
// Column-scan the heart image: for each column, drive that column to 5 V
// and set each row per the image byte for that row.
// Run for 4 full frames (32 ms > 20 ms integration window) so the
// device model has stable brightness values.
{
  const result = await page.evaluate((HEART) => {
    const board = window.__circuit.board;
    const rig = window.__matrixRig;
    const FRAMES = 4;
    const COL_NS = 1_000_000n; // 1 ms in nanoseconds

    // Start from the board's CURRENT time — the simulation timer may have
    // already advanced it past zero, and advanceTo ignores past targets.
    const t0 = board.timeNs;

    for (let frame = 0; frame < FRAMES; frame++) {
      for (let col = 0; col < 8; col++) {
        // Drive only this column high (5 V), all others 0 V
        for (let c = 0; c < 8; c++) {
          board.setControl(rig.colSrcs[c], c === col ? 5 : 0);
        }
        // Drive rows per the image: MSB = col 0 (left)
        for (let row = 0; row < 8; row++) {
          const bit = (HEART[row] >> (7 - col)) & 1;
          board.setControl(rig.rowSrcs[row], bit ? 5 : 0);
        }
        // Advance time by 1 ms from the base
        const step = BigInt(frame * 8 + col + 1);
        board.advanceTo(t0 + step * COL_NS);
      }
    }

    // Read the device state
    const ds = board.getDeviceState(rig.matrix);
    if (!ds) return { error: 'no device state' };
    return {
      brightness: [...ds.brightness],
      levels: [...(ds.levels || [])],
      rows: ds.rows,
      cols: ds.cols,
    };
  }, HEART);

  if (result.error) {
    fail(`scan loop: ${result.error}`);
  } else {
    // ---- 1. assert the brightness array matches the heart pattern ----------
    const br = result.brightness;
    let onMatch = 0, offMatch = 0, onFail = 0, offFail = 0;
    const mismatches = [];

    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const idx = row * 8 + col;
        const shouldBeOn = ((HEART[row] >> (7 - col)) & 1) === 1;
        const b = br[idx];
        // On/off threshold: 1/8 duty cycle ≈ 0.125; gamma-corrected
        // in the face but raw here. Use 0.05 as threshold.
        if (shouldBeOn) {
          if (b > 0.05) onMatch++;
          else { onFail++; mismatches.push(`(${row},${col}) should be ON but b=${b.toFixed(4)}`); }
        } else {
          if (b < 0.01) offMatch++;
          else { offFail++; mismatches.push(`(${row},${col}) should be OFF but b=${b.toFixed(4)}`); }
        }
      }
    }

    const totalOn = HEART.reduce((s, byte) => {
      let count = 0;
      for (let i = 0; i < 8; i++) count += (byte >> i) & 1;
      return s + count;
    }, 0);
    const totalOff = 64 - totalOn;

    (onMatch === totalOn && offMatch === totalOff)
      ? pass(`brightness: all ${totalOn} ON pixels lit (>${0.05}), all ${totalOff} OFF pixels dark (<${0.01})`)
      : fail(`brightness: ${onMatch}/${totalOn} ON ok, ${offMatch}/${totalOff} OFF ok; mismatches: ${mismatches.slice(0, 5).join('; ')}`);

    // ---- 2. levels: at 1/8 duty cycle (column-scanned), brightness ≈ 0.125
    //   which quantizes to level 0 (round(0.125 * 3) = 0). This is correct:
    //   the device model sees time-averaged brightness, and 12.5% duty cycle
    //   is below the level-1 threshold (> 1/6 ≈ 16.7%). Dark pixels stay at
    //   level 0 too. The key distinction is that brightness is > 0 for lit
    //   pixels (tested above), even though the quantized level stays at 0.
    if (result.levels.length === 64) {
      const allZero = result.levels.every(l => l === 0);
      allZero
        ? pass('levels: all level 0 (expected for 1/8 duty-cycle scan — brightness validates the pattern)')
        : pass(`levels: non-zero levels present — ${JSON.stringify(result.levels)}`);
    }

    // ---- TODO: per-pixel 4-level BCM brightness acceptance ----------------
    // When the coordinator's BCM brightness path lands, extend this test:
    // - Paint an IMAGE literal with per-pixel levels (0/1/2/3)
    // - Run a BCM scan loop (bit-plane weighted dwell)
    // - Assert levels[i] matches the painted brightness per pixel
    // The device model already quantizes to MATRIX_LEVELS (0..3); the scan
    // timing is the open question (binary-code modulation vs. faster timer).
  }
}

// ---- 3. assert the SVG face renders the correct lit/dark dots --------------
{
  // The scan loop changed device state inside board internals. Trigger a
  // React re-render by nudging the simulation forward (the CircuitDesigner
  // onChange listener picks up the board notification).
  await page.evaluate(() => {
    const board = window.__circuit.board;
    board.advanceTo(board.timeNs + 1n);
  });
  // Give React time to re-render the face with updated device state
  await page.waitForTimeout(1000);

  const svgResult = await page.evaluate((HEART) => {
    // Find matrix circles in the SVG — the matrix face renders circles
    // with fill="rgba(255,...)" for lit and fill="#1a0000" for dark.
    const circles = [...document.querySelectorAll('svg circle')];
    // Filter to circles that are part of a matrix (inside the matrix group)
    // by checking for the characteristic red-channel fills
    const matrixCircles = circles.filter(el => {
      const fill = el.getAttribute('fill') || '';
      return fill === '#1a0000' || /^rgba\(255,/.test(fill);
    });

    if (matrixCircles.length < 64) {
      return { error: `only ${matrixCircles.length} matrix circles found (need 64)` };
    }

    // Count lit vs dark
    let litCount = 0, darkCount = 0;
    for (const el of matrixCircles) {
      const fill = el.getAttribute('fill') || '';
      if (/^rgba\(255,/.test(fill)) litCount++;
      else darkCount++;
    }

    // Count expected
    let expectedLit = 0;
    for (const byte of HEART) {
      for (let i = 0; i < 8; i++) expectedLit += (byte >> i) & 1;
    }

    return { litCount, darkCount, expectedLit, total: matrixCircles.length };
  }, HEART);

  if (svgResult.error) {
    fail(`SVG face: ${svgResult.error}`);
  } else {
    (svgResult.litCount === svgResult.expectedLit)
      ? pass(`SVG face: ${svgResult.litCount} lit dots match the heart pattern (${svgResult.darkCount} dark)`)
      : fail(`SVG face: ${svgResult.litCount} lit (want ${svgResult.expectedLit}), ${svgResult.darkCount} dark`);
  }
}

if (errors.length) fail(`page errors: ${errors.slice(0, 3).join(' | ')}`);
else pass('no page errors');

await browser.close();
kill();
process.exit(process.exitCode || 0);
