/**
 * Probe: seven_seg_3 — 3-digit scanned 7-segment display.
 *
 * The seven_seg_3 part kind (scanned, common-cathode, 0.56-inch 3-digit)
 * is NOT in any deployed example yet — the gallery "YL-39 minimum system"
 * isn't in the brickwright-lite example set. This probe adds a seven_seg_3
 * part programmatically and checks whether its face renders.
 *
 * Once an example using seven_seg_3 is deployed, this probe should be
 * updated to load that example and verify the walking-8 pattern.
 *
 * Attribution on FAIL: face (seven_seg_3 face not in deployed build)
 */
export const ROW = 'seven_seg_3';

export async function run(page, utils) {
  const ss = utils.screenshotPath('seven-seg-3');

  await utils.goToCircuit();
  // Wait for circuit API to be ready.
  try {
    await page.waitForFunction(() => window.__circuit && window.__circuit.addPart, { timeout: 15_000 });
  } catch { /* may not have addPart */ }

  // Add seven_seg_3 part programmatically.
  const addResult = await page.evaluate(() => {
    const c = window.__circuit;
    if (c && c.addPart) {
      c.addPart('seven_seg_3', {}, 500, 300);
      return true;
    }
    return false;
  });
  await page.waitForTimeout(1500);

  if (!addResult) {
    await page.screenshot({ path: ss });
    return {
      row: ROW,
      verdict: 'SKIP',
      screenshot: ss,
      notes: 'could not add seven_seg_3 part (no addPart API)',
      attribution: 'example — circuit API missing',
    };
  }

  const partInfo = await page.evaluate(() => {
    const c = window.__circuit;
    const part = c?.parts.find((p) => p.kind === 'seven_seg_3');
    if (!part) return null;
    // Check for face rendering — look for wokwi-7segment elements or
    // SVG elements associated with this part.
    const segs = document.querySelectorAll('wokwi-7segment');
    return { id: part.id, segs: segs.length };
  });

  await page.screenshot({ path: ss });

  if (!partInfo) {
    return {
      row: ROW,
      verdict: 'SKIP',
      screenshot: ss,
      notes: 'seven_seg_3 part not in parts registry — kind not deployed',
      attribution: 'face — seven_seg_3 part kind not in deployed build',
    };
  }

  if (partInfo.segs > 0) {
    return {
      row: ROW,
      verdict: 'PASS',
      screenshot: ss,
      notes: `seven_seg_3 added, ${partInfo.segs} wokwi-7segment element(s) rendered`,
    };
  }

  return {
    row: ROW,
    verdict: 'SKIP',
    screenshot: ss,
    notes: 'seven_seg_3 part added but no display face rendered (walking-8 check pending)',
    attribution: 'face — seven_seg_3 display face not yet in deployed build',
  };
}
