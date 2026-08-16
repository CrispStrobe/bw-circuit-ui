/**
 * Probe: 7-segment display — segment cycling.
 *
 * Loads the "Counter" example and verifies:
 * 1. wokwi-7segment elements exist
 * 2. Segment attribute values change between two time samples
 *
 * Attribution on FAIL: face (Wokwi element not updating) or engine (counter sim stalled)
 */
export const ROW = '7seg';

export async function run(page, utils) {
  const ss0 = utils.screenshotPath('7seg-t0');
  const ss1 = utils.screenshotPath('7seg-t1');

  await utils.goToCircuit();
  await utils.loadExample('7-segment');
  await utils.enterSim();
  await page.waitForTimeout(3000);

  const readSegments = () =>
    page.evaluate(() => {
      const segs = document.querySelectorAll('wokwi-7segment');
      if (segs.length === 0) return null;
      // The Wokwi element exposes a `values` property (array of 8 numbers per digit).
      return [...segs]
        .map((el) => (el.values || []).join(','))
        .join('|');
    });

  const sample1 = await readSegments();
  await page.screenshot({ path: ss0 });
  await page.waitForTimeout(2000);
  const sample2 = await readSegments();
  await page.screenshot({ path: ss1 });

  if (sample1 === null || sample2 === null) {
    return {
      row: ROW,
      verdict: 'FAIL',
      screenshot: ss0,
      notes: 'no wokwi-7segment elements found',
      attribution: 'face — Wokwi 7-segment element not rendered',
    };
  }

  if (sample1 !== sample2) {
    return {
      row: ROW,
      verdict: 'PASS',
      screenshot: ss1,
      notes: `segments changed: "${sample1.slice(0, 40)}" → "${sample2.slice(0, 40)}"`,
    };
  }

  // Segments didn't change — still might be displaying something.
  const anyLit = sample1.split(/[,|]/).some((v) => parseFloat(v) > 0);
  return {
    row: ROW,
    verdict: 'FAIL',
    screenshot: ss1,
    notes: `segments unchanged after 1.2s ("${sample1.slice(0, 60)}")${anyLit ? ' — lit but static' : ''}`,
    attribution: 'engine — counter sim not advancing segment state',
  };
}
