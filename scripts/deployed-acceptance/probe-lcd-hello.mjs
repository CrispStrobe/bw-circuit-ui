/**
 * Probe: LCD Hello preset — shows HI BRICKWRIGHT on the LCD.
 *
 * Loads "6502 Computer with LCD", opens Debugger, clicks Build Machine,
 * then clicks the "LCD Hello" preset button. Asserts device-state text
 * contains "HI BRICKWRIGHT" (or at least "HI").
 *
 * Do NOT click Sim/Power toggles — the board powers with the example.
 *
 * Attribution on FAIL: engine (ROM/VIA/LCD sim), face (LCD text not rendered)
 */
export const ROW = 'lcd_hello';

export async function run(page, utils) {
  const ss = utils.screenshotPath('lcd-hello');

  await utils.goToCircuit();

  let loaded = false;
  for (const name of ['6502 Computer with LCD', 'Full EATER6502']) {
    try {
      await utils.loadExample(name);
      const hasCpu = await page.evaluate(
        () => window.__circuit?.parts.some((p) => p.kind === 'w65c02'),
      );
      if (hasCpu) { loaded = true; break; }
    } catch { /* try next */ }
    await utils.goToCircuit();
  }

  if (!loaded) {
    await page.screenshot({ path: ss, timeout: 10000 }).catch(() => {});
    return {
      row: ROW, verdict: 'FAIL', screenshot: ss,
      notes: 'could not load 6502+LCD example',
      attribution: 'example — no 6502+LCD example in deployed app',
    };
  }

  await utils.openDebugger();

  // Build Machine.
  let machineBooted = false;
  try {
    const bmBtn = page.locator('button', { hasText: 'Build Machine' }).first();
    if (await bmBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await bmBtn.click();
      await page.waitForTimeout(5000);
      machineBooted = await page.evaluate(
        () => /Machine booted/i.test(document.body.innerText),
      );
    }
  } catch { /* not available */ }

  if (!machineBooted) {
    await page.screenshot({ path: ss, timeout: 10000 }).catch(() => {});
    return {
      row: ROW, verdict: 'FAIL', screenshot: ss,
      notes: 'Build Machine did not boot',
      attribution: 'engine — Build Machine / extractor not functional',
    };
  }

  // Click "LCD Hello" preset.
  let presetClicked = false;
  try {
    const btn = page.locator('button', { hasText: 'LCD Hello' }).first();
    if (await btn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await btn.click();
      presetClicked = true;
      await page.waitForTimeout(15000);
    }
  } catch { /* not available */ }

  if (!presetClicked) {
    await page.screenshot({ path: ss, timeout: 10000 }).catch(() => {});
    return {
      row: ROW, verdict: 'FAIL', screenshot: ss,
      notes: 'LCD Hello preset button not found after Build Machine',
      attribution: 'face — LCD Hello preset not in deployed Machine Loader',
    };
  }

  // Check LCD device state (retry — the HD44780 busy window means
  // characters arrive one at a time with delays).
  let lcd;
  for (let attempt = 0; attempt < 3; attempt++) {
    lcd = await page.evaluate(() => {
    const c = window.__circuit;
    const boards = [
      window.__bwMachineBoard?.board, window.__activeBoard, window.__board,
    ].filter(Boolean);
    for (const b of boards) {
      if (!b.getDeviceState) continue;
      for (const p of c?.parts || []) {
        if (p.kind !== 'char_lcd' && p.kind !== 'hd44780') continue;
        const ds = b.getDeviceState(p.id);
        if (ds) return { text: ds.text || ds.display };
      }
    }
    return null;
  });
    const text = (lcd?.text || []).join('').trim();
    if (text.length >= 2) break;
    await page.waitForTimeout(5000);
  }

  await page.screenshot({ path: ss, timeout: 10000 }).catch(() => {});

  if (!lcd) {
    return {
      row: ROW, verdict: 'FAIL', screenshot: ss,
      notes: 'no LCD device state found after LCD Hello preset',
      attribution: 'engine — LCD device state not populated',
    };
  }

  const text = (lcd.text || []).join('\n').trim();
  const hasHI = /HI/i.test(text);
  const hasBW = /BRICKWRIGHT/i.test(text);

  if (hasHI) {
    return {
      row: ROW, verdict: 'PASS', screenshot: ss,
      notes: `LCD text: "${text.slice(0, 40)}"${hasBW ? ' (full greeting)' : ''}`,
    };
  }

  return {
    row: ROW, verdict: 'FAIL', screenshot: ss,
    notes: `LCD text: "${text.slice(0, 40)}" — expected HI BRICKWRIGHT`,
    attribution: 'engine — LCD Hello ROM not writing expected text',
  };
}
