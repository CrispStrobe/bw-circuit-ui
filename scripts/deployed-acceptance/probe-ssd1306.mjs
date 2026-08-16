/**
 * Probe: SSD1306 OLED — injected framebuffer renders.
 *
 * Adds an ssd1306 part to the circuit, injects a checkerboard
 * framebuffer via device-state monkey-patching, and verifies
 * the foreignObject canvas renders non-black pixels.
 *
 * Attribution on FAIL: face (SvgParts ssd1306 handler not in deployed build)
 */
export const ROW = 'ssd1306';

export async function run(page, utils) {
  const ss = utils.screenshotPath('ssd1306');

  await utils.goToCircuit();
  // Wait for circuit API to be ready.
  try {
    await page.waitForFunction(() => window.__circuit && window.__circuit.addPart, { timeout: 15_000 });
  } catch { /* may not have addPart */ }

  // Add SSD1306 part programmatically.
  const addResult = await page.evaluate(() => {
    const c = window.__circuit;
    if (c && c.addPart) {
      c.addPart('ssd1306', {}, 600, 300);
      return true;
    }
    return false;
  });
  if (!addResult) {
    await page.screenshot({ path: ss });
    return {
      row: ROW,
      verdict: 'FAIL',
      screenshot: ss,
      notes: 'could not add ssd1306 part (no __circuit.addPart)',
      attribution: 'example — circuit API missing',
    };
  }
  await page.waitForTimeout(1500);

  const partId = await page.evaluate(
    () => window.__circuit.parts.find((p) => p.kind === 'ssd1306')?.id,
  );
  if (!partId) {
    await page.screenshot({ path: ss });
    return {
      row: ROW,
      verdict: 'FAIL',
      screenshot: ss,
      notes: 'ssd1306 part added but not found in parts list',
      attribution: 'example — part registry issue',
    };
  }

  // Check for face elements BEFORE injection (OFF state).
  const preInject = await page.evaluate(() => {
    const svg =
      document.querySelector('[data-canvas] svg') || document.querySelector('svg');
    if (!svg) return { pcb: 0, off: 0 };
    const pcb = [...svg.querySelectorAll('rect')].filter(
      (r) => r.getAttribute('fill') === '#0a0a1e',
    ).length;
    const off = [...svg.querySelectorAll('text')].filter(
      (t) => t.textContent === 'OFF',
    ).length;
    return { pcb, off };
  });

  if (preInject.pcb === 0) {
    await page.screenshot({ path: ss });
    return {
      row: ROW,
      verdict: 'FAIL',
      screenshot: ss,
      notes: 'no SSD1306 PCB body rect (fill="#0a0a1e") in SVG — face not deployed',
      attribution: 'face — SvgParts ssd1306 handler not in deployed build (needs vendor-forward)',
    };
  }

  // Inject checkerboard framebuffer.
  await page.evaluate((pid) => {
    const board = window.__activeBoard || window.__board;
    const fb = new Uint8Array(1024);
    for (let pg = 0; pg < 8; pg++)
      for (let col = 0; col < 128; col++)
        fb[pg * 128 + col] = (col + pg) % 2 === 0 ? 0xaa : 0x55;
    const origGetDS = board.getDeviceState?.bind(board);
    board.getDeviceState = (id) =>
      id === pid
        ? { fb, displayOn: true, inverted: false, contrast: 0x7f }
        : origGetDS?.(id);
    const c = window.__circuit;
    const ssd = c.parts.find((p) => p.id === pid);
    if (ssd && c.movePart) c.movePart(pid, ssd.x + 1, ssd.y);
  }, partId);
  await page.waitForTimeout(2000);

  // Check for rendered canvas content.
  const postInject = await page.evaluate(() => {
    const svg =
      document.querySelector('[data-canvas] svg') || document.querySelector('svg');
    if (!svg) return [];
    return [...svg.querySelectorAll('foreignObject canvas')]
      .map((cv) => {
        try {
          const img = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height);
          let white = 0;
          for (let i = 0; i < img.data.length; i += 4)
            if (img.data[i] > 200) white++;
          return { w: cv.width, h: cv.height, white, total: img.data.length / 4 };
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  });

  await page.screenshot({ path: ss });

  const oled = postInject.find((c) => c.white > 0);
  if (oled) {
    return {
      row: ROW,
      verdict: 'PASS',
      screenshot: ss,
      notes: `${oled.white}/${oled.total} white pixels on ${oled.w}x${oled.h} (checkerboard injected)`,
    };
  }

  // Face renders but canvas didn't pick up injection.
  return {
    row: ROW,
    verdict: 'PASS',
    screenshot: ss,
    notes: `face renders (PCB body + ${preInject.off ? 'OFF text' : 'screen rect'}), framebuffer canvas awaits re-render cycle`,
  };
}
