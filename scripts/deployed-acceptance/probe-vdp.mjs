/**
 * Probe: VDP display — ASM-driven TMS9918 backdrop.
 *
 * Loads "Eater 6502", enters Sim, and checks for non-blank pixels
 * on the VdpScreen canvas. If a runner with loadRom is available,
 * injects a tiny ROM that sets the VDP backdrop color.
 *
 * Attribution on FAIL: engine (6502 sim / TMS9918 emulation) or face (VdpScreen canvas not mounted)
 */
export const ROW = 'vdp';

export async function run(page, utils) {
  const ss = utils.screenshotPath('vdp');

  await utils.goToCircuit();
  await utils.loadExample('VDP Video');

  // VDP machine bench path: try Build Machine first (requires vendor-forward).
  let machineBooted = false;
  try {
    const bmBtn = page.locator('button', { hasText: 'Build Machine' }).first();
    if (await bmBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await bmBtn.click();
      await page.waitForTimeout(5000);
      machineBooted = await page.evaluate(() =>
        /Machine booted/i.test(document.body.innerText),
      );
    }
  } catch { /* Build Machine not available yet */ }

  // If Build Machine booted, click Run.
  if (machineBooted) {
    for (const b of await page.locator('button').all()) {
      const t = await b.innerText().catch(() => '');
      if (/Run/.test(t) && (await b.isVisible().catch(() => false))) {
        await b.click().catch(() => {});
        break;
      }
    }
    await page.waitForTimeout(3000);
  } else {
    // Fallback: enter Sim mode for non-machine-bench path.
    await utils.enterSim();
    await page.waitForTimeout(3000);
  }

  // Check for non-blank canvas (VdpScreen).
  const canvasCheck = await page.evaluate(() => {
    const canvases = document.querySelectorAll('canvas');
    for (const cv of canvases) {
      if (cv.closest('[data-scope-panel]') || cv.closest('[data-scope-module]')) continue;
      if (cv.width < 64 || cv.height < 48) continue;
      try {
        const ctx = cv.getContext('2d');
        if (!ctx) continue;
        const img = ctx.getImageData(0, 0, cv.width, cv.height);
        let nonBlack = 0;
        for (let i = 0; i < img.data.length; i += 4)
          if (img.data[i] > 10 || img.data[i + 1] > 10 || img.data[i + 2] > 10)
            nonBlack++;
        if (nonBlack > 0)
          return { w: cv.width, h: cv.height, nonBlack, total: img.data.length / 4 };
      } catch { /* tainted canvas */ }
    }
    return { canvasCount: canvases.length };
  });

  if (canvasCheck.nonBlack > 0) {
    await page.screenshot({ path: ss });
    return {
      row: ROW,
      verdict: 'PASS',
      screenshot: ss,
      notes: `${canvasCheck.nonBlack} non-black pixels on ${canvasCheck.w}x${canvasCheck.h} VDP canvas`,
    };
  }

  // Canvas blank or missing — try ROM injection via runner.
  const runnerInfo = await utils.findRunner();
  if (!runnerInfo.found || !runnerInfo.hasLoadRom) {
    await page.screenshot({ path: ss });
    return {
      row: ROW,
      verdict: 'FAIL',
      screenshot: ss,
      notes: `no runner or loadRom (canvases: ${canvasCheck.canvasCount ?? '?'})`,
      attribution: 'engine — debug runner not mounted or missing loadRom',
    };
  }

  // Inject a tiny 6502 ROM that sets VDP backdrop.
  await page.evaluate(() => {
    for (const node of document.querySelectorAll('*')) {
      for (const key of Object.keys(node)) {
        if (!key.startsWith('__reactFiber$')) continue;
        let f = node[key];
        for (let i = 0; i < 30 && f; i++) {
          if (!f.stateNode?.state?.runner) { f = f.return; continue; }
          const runner = f.stateNode.state.runner;
          const rom = new Uint8Array(32768);
          rom.fill(0xea);
          let pc = 0;
          const cmd = 0x4001;
          // Set VDP register 7 = 0x46 (green bg, dark-red border).
          rom[pc++] = 0xa9; rom[pc++] = 0x46;
          rom[pc++] = 0x8d; rom[pc++] = cmd & 0xff; rom[pc++] = (cmd >> 8) & 0xff;
          rom[pc++] = 0xa9; rom[pc++] = 0x87;
          rom[pc++] = 0x8d; rom[pc++] = cmd & 0xff; rom[pc++] = (cmd >> 8) & 0xff;
          // Enable display (register 1 = 0xC0).
          rom[pc++] = 0xa9; rom[pc++] = 0xc0;
          rom[pc++] = 0x8d; rom[pc++] = cmd & 0xff; rom[pc++] = (cmd >> 8) & 0xff;
          rom[pc++] = 0xa9; rom[pc++] = 0x81;
          rom[pc++] = 0x8d; rom[pc++] = cmd & 0xff; rom[pc++] = (cmd >> 8) & 0xff;
          const loop = pc;
          rom[pc++] = 0x4c; rom[pc++] = loop & 0xff; rom[pc++] = 0x80;
          rom[0x7ffc] = 0x00; rom[0x7ffd] = 0x80;
          runner.loadRom(rom);
          runner.start().catch(() => {});
          return;
        }
      }
    }
  });
  await page.waitForTimeout(5000);

  // Re-check canvas.
  const afterRom = await page.evaluate(() => {
    const canvases = document.querySelectorAll('canvas');
    for (const cv of canvases) {
      if (cv.closest('[data-scope-panel]') || cv.closest('[data-scope-module]')) continue;
      if (cv.width < 64 || cv.height < 48) continue;
      try {
        const ctx = cv.getContext('2d');
        if (!ctx) continue;
        const img = ctx.getImageData(0, 0, cv.width, cv.height);
        let nonBlack = 0;
        for (let i = 0; i < img.data.length; i += 4)
          if (img.data[i] > 10 || img.data[i + 1] > 10 || img.data[i + 2] > 10)
            nonBlack++;
        if (nonBlack > 0)
          return { w: cv.width, h: cv.height, nonBlack, total: img.data.length / 4 };
      } catch { /* tainted */ }
    }
    return null;
  });

  await page.screenshot({ path: ss });

  if (afterRom) {
    return {
      row: ROW,
      verdict: 'PASS',
      screenshot: ss,
      notes: `${afterRom.nonBlack} non-black pixels on ${afterRom.w}x${afterRom.h} after ROM injection`,
    };
  }

  return {
    row: ROW,
    verdict: 'FAIL',
    screenshot: ss,
    notes: 'VDP canvas still blank after ROM injection',
    attribution: 'face — VdpScreen canvas not mounted or TMS9918 render not wired',
  };
}
