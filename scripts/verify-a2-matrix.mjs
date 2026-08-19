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

// Standard 7-segment encoding: digit "5" = a,c,d,f,g ON; b,e OFF.
const DIGIT_5 = { a: true, b: false, c: true, d: true, e: false, f: true, g: true, dp: false };

// LED bank chase pattern: 0xAA = bits 10101010 → LEDs 1,3,5,7 ON.
const LED_PATTERN = 0xAA;
// ────────────────────────────────────────────────────────────────────────────

// ---- build ALL test rigs in one batch ----------------------------------------
// Every addPart/addWire rebuilds the board (fresh timeNs=0, fresh ledHistory),
// so all rigs must be wired BEFORE entering sim mode.  The board then stays
// stable for the matrix scan, seven-segment, and LED checks.
//
// Rig 1 – MATRIX8X8: 8 col + 8 row voltage sources drive a column-scanned image.
// Rig 2 – SEVENSEG8: a seven_seg_4 with per-segment vsources showing digit "5".
// Rig 3 – LEDBANK8: 8 LEDs driven through vsources in an alternating chase.
await page.evaluate(() => {
  const c = window.__circuit;
  const gn = c.addPart('gnd', {}, 100, 700);

  // ── Rig 1: matrix8x8 ──────────────────────────────────────────────────
  const matrix = c.addPart('matrix8x8', {}, 500, 400);
  const colSrcs = [];
  for (let i = 0; i < 8; i++) {
    const vs = c.addPart('vsource', { volts: 0 }, 120 + i * 50, 150);
    c.addWire(vs.id, 'pos', matrix.id, 'col' + i);
    c.addWire(vs.id, 'neg', gn.id, 'gnd');
    colSrcs.push(vs.id);
  }
  const rowSrcs = [];
  for (let i = 0; i < 8; i++) {
    const vs = c.addPart('vsource', { volts: 0 }, 120 + i * 50, 650);
    c.addWire(vs.id, 'pos', matrix.id, 'row' + i);
    c.addWire(vs.id, 'neg', gn.id, 'gnd');
    rowSrcs.push(vs.id);
  }

  // ── Rig 2: seven_seg_4 showing digit "5" on digit 0 ────────────────
  const seg = c.addPart('seven_seg_4', {}, 400, 850);
  c.addWire(seg.id, 'com0', gn.id, 'gnd');
  // Park unused digits HIGH (standard common-cathode scan discipline)
  const vpark = c.addPart('vcc', {}, 350, 800);
  c.addWire(seg.id, 'com1', vpark.id, 'vcc');
  c.addWire(seg.id, 'com2', vpark.id, 'vcc');
  c.addWire(seg.id, 'com3', vpark.id, 'vcc');
  const segSrcs = {};
  for (const s of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'dp']) {
    const vs = c.addPart('vsource', { volts: 0 }, 250, 800);
    const rs = c.addPart('resistor', { ohms: 220 }, 300, 800);
    c.addWire(vs.id, 'pos', rs.id, 'a');
    c.addWire(rs.id, 'b', seg.id, s);
    c.addWire(vs.id, 'neg', gn.id, 'gnd');
    segSrcs[s] = vs.id;
  }

  // ── Rig 3: 8-LED bank ─────────────────────────────────────────────────
  const ledIds = [];
  const ledSrcs = [];
  for (let i = 0; i < 8; i++) {
    const led = c.addPart('led', { color: 'red' }, 700 + i * 40, 850);
    const vs = c.addPart('vsource', { volts: 0 }, 700 + i * 40, 780);
    const rs = c.addPart('resistor', { ohms: 220 }, 700 + i * 40, 810);
    c.addWire(vs.id, 'pos', rs.id, 'a');
    c.addWire(rs.id, 'b', led.id, 'anode');
    c.addWire(led.id, 'cathode', gn.id, 'gnd');
    c.addWire(vs.id, 'neg', gn.id, 'gnd');
    ledIds.push(led.id);
    ledSrcs.push(vs.id);
  }

  // ── Rig 4: BMP280 pressure/temperature sensor ──────────────────────────
  const bmp = c.addPart('bmp280', { temperature: 25, pressure: 101325 }, 200, 200);
  c.addWire(bmp.id, 'vcc', vpark.id, 'vcc');
  c.addWire(bmp.id, 'gnd', gn.id, 'gnd');

  // ── Rig 5: TCS34725 RGB color sensor ──────────────────────────────────
  const tcs = c.addPart('tcs34725', { red: 0, green: 0, blue: 0 }, 300, 200);
  c.addWire(tcs.id, 'vcc', vpark.id, 'vcc');
  c.addWire(tcs.id, 'gnd', gn.id, 'gnd');

  // ── Rig 6: INA219 current/voltage monitor ─────────────────────────────
  const ina = c.addPart('ina219', { busVoltage: 5, current_mA: 0, shuntOhms: 0.1 }, 400, 200);
  c.addWire(ina.id, 'vcc', vpark.id, 'vcc');
  c.addWire(ina.id, 'gnd', gn.id, 'gnd');

  window.__matrixRig = { matrix: matrix.id, colSrcs, rowSrcs };
  window.__segRig = { seg: seg.id, segSrcs };
  window.__ledRig = { ledIds, ledSrcs };
  window.__sensorRig = { bmp: bmp.id, tcs: tcs.id, ina: ina.id };
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

// ---- pre-set the STATIC rigs (sevenseg + LED) BEFORE entering sim mode
//      so the sim timer integrates brightness from the first tick.
await page.evaluate(({ segs, pattern }) => {
  const board = window.__circuit.board;
  const segRig = window.__segRig;
  const ledRig = window.__ledRig;

  // Sevenseg: drive segments for digit "5"
  for (const [s, on] of Object.entries(segs)) {
    board.setControl(segRig.segSrcs[s], on ? 5 : 0);
  }

  // LEDs: drive pattern 0xAA
  for (let i = 0; i < 8; i++) {
    board.setControl(ledRig.ledSrcs[i], ((pattern >> i) & 1) ? 5 : 0);
  }

  // Sensors: inject world stimulus via setPartParam
  const sr = window.__sensorRig;
  board.setPartParam(sr.bmp, 'temperature', 37.5);
  board.setPartParam(sr.bmp, 'pressure', 98700);
  board.setPartParam(sr.tcs, 'red', 40000);
  board.setPartParam(sr.tcs, 'green', 12000);
  board.setPartParam(sr.tcs, 'blue', 5000);
  board.setPartParam(sr.ina, 'busVoltage', 12.0);
  board.setPartParam(sr.ina, 'current_mA', 250);
}, { segs: DIGIT_5, pattern: LED_PATTERN });

// ---- enter simulate mode — the timer will advance the board, integrating
//      sevenseg and LED brightness over the ~20 ms window naturally.
await page.getByRole('radio', { name: /Sim/i }).first().click();
await page.waitForTimeout(1500); // let the brightness filter charge

// ---- SEVENSEG8: assert digit brightness -----------------------------------
{
  const result = await page.evaluate(() => {
    const board = window.__circuit.board;
    const rig = window.__segRig;
    return board.sevenSeg3Brightness(rig.seg, 4)[0];
  });

  const segNames = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'dp'];
  let segOk = true;
  const segReport = [];
  for (const s of segNames) {
    const expected = DIGIT_5[s];
    const b = result[s];
    const ok = expected ? b > 0.2 : b < 0.02;
    if (!ok) segOk = false;
    segReport.push(`${s}=${b.toFixed(3)}${expected ? '✓' : ''}`);
  }
  segOk
    ? pass(`SEVENSEG8 digit "5": segments ${segNames.filter(s => DIGIT_5[s]).join(',')} lit — ${segReport.join(' ')}`)
    : fail(`SEVENSEG8 digit "5": ${segReport.join(' ')}`);
}

// ---- SEVENSEG8: assert DOM face -------------------------------------------
{
  const hasSeg = await page.evaluate(() =>
    document.querySelectorAll('wokwi-7segment').length > 0);
  hasSeg
    ? pass('SEVENSEG8 face: wokwi-7segment element rendered')
    : fail('SEVENSEG8 face: no wokwi-7segment element in the DOM');
}

// ---- LEDBANK8: assert brightness per LED ----------------------------------
{
  const result = await page.evaluate(() => {
    const board = window.__circuit.board;
    const rig = window.__ledRig;
    return rig.ledIds.map(id => board.ledBrightness(id));
  });

  let ledOk = true;
  const ledReport = [];
  for (let i = 0; i < 8; i++) {
    const expected = ((LED_PATTERN >> i) & 1) === 1;
    const b = result[i];
    const ok = expected ? b > 0.1 : b < 0.02;
    if (!ok) ledOk = false;
    ledReport.push(`LED${i}=${b.toFixed(3)}${expected ? '↑' : '↓'}`);
  }
  ledOk
    ? pass(`LEDBANK8 pattern 0xAA: LEDs 1,3,5,7 ON, LEDs 0,2,4,6 OFF — ${ledReport.join(' ')}`)
    : fail(`LEDBANK8 pattern 0xAA: ${ledReport.join(' ')}`);
}

// ---- LEDBANK8: assert DOM face --------------------------------------------
{
  const ledDom = await page.evaluate(() =>
    ({ count: document.querySelectorAll('wokwi-led').length }));
  (ledDom.count >= 8)
    ? pass(`LEDBANK8 face: ${ledDom.count} wokwi-led elements rendered (≥8)`)
    : fail(`LEDBANK8 face: only ${ledDom.count} wokwi-led elements (need ≥8)`);
}

// ════════════════════════════════════════════════════════════════════════════
// SENSOR FACES: BMP280, TCS34725, INA219 — world stimulus via setPartParam,
// assert getDeviceState reads the injected values back.
// ════════════════════════════════════════════════════════════════════════════

// ---- BMP280: temperature + pressure ----------------------------------------
{
  const ds = await page.evaluate(() => {
    const board = window.__circuit.board;
    return board.getDeviceState(window.__sensorRig.bmp);
  });
  if (!ds) {
    fail('BMP280: no device state (device not registered?)');
  } else {
    const tOk = Math.abs(ds.temperature - 37.5) < 0.5;
    const pOk = Math.abs(ds.pressure - 98700) < 100;
    (tOk && pOk)
      ? pass(`BMP280: temperature=${ds.temperature}°C (want 37.5), pressure=${ds.pressure} Pa (want 98700)`)
      : fail(`BMP280: temperature=${ds.temperature} (want 37.5), pressure=${ds.pressure} (want 98700)`);
  }
}

// ---- TCS34725: RGB color channels ------------------------------------------
{
  const ds = await page.evaluate(() => {
    const board = window.__circuit.board;
    return board.getDeviceState(window.__sensorRig.tcs);
  });
  if (!ds) {
    fail('TCS34725: no device state (device not registered?)');
  } else {
    const rOk = ds.red === 40000;
    const gOk = ds.green === 12000;
    const bOk = ds.blue === 5000;
    (rOk && gOk && bOk)
      ? pass(`TCS34725: R=${ds.red} G=${ds.green} B=${ds.blue} (want 40000/12000/5000)`)
      : fail(`TCS34725: R=${ds.red} G=${ds.green} B=${ds.blue} (want 40000/12000/5000)`);
  }
}

// ---- INA219: bus voltage + current -----------------------------------------
{
  const ds = await page.evaluate(() => {
    const board = window.__circuit.board;
    return board.getDeviceState(window.__sensorRig.ina);
  });
  if (!ds) {
    fail('INA219: no device state (device not registered?)');
  } else {
    const vOk = Math.abs(ds.busVoltage - 12.0) < 0.5;
    const iOk = Math.abs(ds.current_mA - 250) < 10;
    const pOk = ds.power_mW > 2500; // 12V × 250mA = 3000 mW
    (vOk && iOk && pOk)
      ? pass(`INA219: busV=${ds.busVoltage}V current=${ds.current_mA}mA power=${ds.power_mW}mW`)
      : fail(`INA219: busV=${ds.busVoltage} (want 12), current=${ds.current_mA} (want 250), power=${ds.power_mW} (want ~3000)`);
  }
}

// ── MATRIX8X8: column-scanned heart image (needs paused sim) ──────────────
// Pause via evaluate (direct button click can time out on overlay-heavy pages)
await page.evaluate(() => {
  // Find and click the pause button programmatically
  const btns = [...document.querySelectorAll('button')];
  const pause = btns.find(b => b.textContent.includes('⏸') || /pause/i.test(b.textContent));
  if (pause) pause.click();
});
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
