/**
 * Probe: contrast pot sweep — adjusting potentiometer fades LCD text.
 *
 * On the "6502 Computer with LCD" example, after loading LCD Hello
 * preset, sweeps the potentiometer control between 0 and 1 and checks
 * that the LCD contrast (physical LCD model) changes — specifically
 * that the Wokwi element's rendered appearance differs between extremes.
 *
 * Attribution on FAIL: engine (contrast model), face (pot/LCD wiring)
 */
export const ROW = 'contrast_pot';

export async function run(page, utils) {
  const ss = utils.screenshotPath('contrast-pot');

  await utils.goToCircuit();

  let loaded = false;
  for (const name of ['6502 Computer with LCD', 'Full EATER6502']) {
    try {
      await utils.loadExample(name);
      const hasCpu = await page.evaluate(
        () => window.__circuit?.parts.some((p) => p.kind === 'w65c02'),
      );
      if (hasCpu) { loaded = true; break; }
    } catch { /* */ }
    await utils.goToCircuit();
  }

  if (!loaded) {
    await page.screenshot({ path: ss });
    return {
      row: ROW, verdict: 'FAIL', screenshot: ss,
      notes: 'could not load example',
      attribution: 'example — no 6502+LCD example',
    };
  }

  await utils.openDebugger();

  // Build Machine + LCD Hello.
  try {
    await page.locator('button', { hasText: 'Build Machine' }).first().click({ timeout: 5000 });
    await page.waitForTimeout(5000);
    const hello = page.locator('button', { hasText: 'LCD Hello' }).first();
    if (await hello.isVisible({ timeout: 3000 }).catch(() => false)) {
      await hello.click();
      await page.waitForTimeout(8000);
    }
  } catch { /* */ }

  // Find the potentiometer part.
  const potInfo = await page.evaluate(() => {
    const c = window.__circuit;
    const pot = c?.parts.find((p) => p.kind === 'potentiometer');
    if (!pot) return null;
    return { id: pot.id, kind: pot.kind };
  });

  if (!potInfo) {
    await page.screenshot({ path: ss });
    return {
      row: ROW, verdict: 'SKIP', screenshot: ss,
      notes: 'no potentiometer part in example',
      attribution: 'example — no contrast pot in circuit',
    };
  }

  // Read LCD contrast at default pot position.
  const readContrast = () =>
    page.evaluate(() => {
      const c = window.__circuit;
      const boards = [
        window.__bwMachineBoard?.board, window.__activeBoard, window.__board,
      ].filter(Boolean);
      for (const b of boards) {
        if (!b.getDeviceState) continue;
        for (const p of c?.parts || []) {
          if (p.kind !== 'char_lcd' && p.kind !== 'hd44780') continue;
          const ds = b.getDeviceState(p.id);
          if (ds) return { contrast: ds.contrast, text: (ds.text || ds.display || []).join('').trim() };
        }
      }
      return null;
    });

  const before = await readContrast();

  // Sweep pot to extreme (0.0).
  await page.evaluate((potId) => {
    const c = window.__circuit;
    if (c?.setControl) c.setControl(potId, 0);
  }, potInfo.id);
  await page.waitForTimeout(2000);

  const atZero = await readContrast();

  // Sweep pot to other extreme (1.0).
  await page.evaluate((potId) => {
    const c = window.__circuit;
    if (c?.setControl) c.setControl(potId, 1);
  }, potInfo.id);
  await page.waitForTimeout(2000);

  const atOne = await readContrast();

  await page.screenshot({ path: ss });

  if (!before && !atZero && !atOne) {
    return {
      row: ROW, verdict: 'FAIL', screenshot: ss,
      notes: 'no LCD contrast data available',
      attribution: 'engine — LCD contrast model not exposing data',
    };
  }

  const c0 = atZero?.contrast;
  const c1 = atOne?.contrast;
  const changed = c0 !== undefined && c1 !== undefined && c0 !== c1;

  if (changed) {
    return {
      row: ROW, verdict: 'PASS', screenshot: ss,
      notes: `contrast swept: ${c0} → ${c1} (pot 0→1)`,
    };
  }

  // Even without explicit contrast field, check if text visibility changed.
  const textBefore = before?.text || '';
  const textAtZero = atZero?.text || '';
  const textAtOne = atOne?.text || '';

  return {
    row: ROW, verdict: 'FAIL', screenshot: ss,
    notes: `contrast did not change: ${c0} at pot=0, ${c1} at pot=1 (text: "${textBefore.slice(0, 20)}")`,
    attribution: 'engine — pot sweep not affecting LCD contrast',
  };
}
