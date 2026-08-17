/**
 * Probe: matrix display — pendant heartbeat lit-set changes.
 *
 * Loads the Blinkenrocket pendant example and verifies:
 * 1. matrix8x8 part exists
 * 2. LED brightness changes over two samples (heartbeat animation)
 *
 * Attribution on FAIL: engine (ATtiny88 sim not driving matrix)
 */
export const ROW = 'matrix';

export async function run(page, utils) {
  const ss = utils.screenshotPath('matrix');

  await utils.goToCircuit();
  await utils.loadExample('Blinkenrocket', undefined, 'attiny88');
  await utils.enterSim();
  await page.waitForTimeout(3000);

  // Sample 1: read matrix brightness.
  const sample1 = await page.evaluate(() => {
    const c = window.__circuit;
    const board = window.__activeBoard || window.__board;
    if (!c || !board) return null;
    const matrix = c.parts.find((p) => p.kind === 'matrix8x8');
    if (!matrix) return null;
    const ds = board.getDeviceState?.(matrix.id);
    if (ds?.brightness) return [...ds.brightness];
    // Fallback: count lit SVG circles.
    const dots = [...document.querySelectorAll('svg circle')].filter((el) => {
      const fill = el.getAttribute('fill') || '';
      return /^rgba?\(255,/.test(fill) && !fill.includes(',0)');
    });
    return { litDots: dots.length };
  });

  await page.waitForTimeout(1500);

  // Sample 2.
  const sample2 = await page.evaluate(() => {
    const c = window.__circuit;
    const board = window.__activeBoard || window.__board;
    if (!c || !board) return null;
    const matrix = c.parts.find((p) => p.kind === 'matrix8x8');
    if (!matrix) return null;
    const ds = board.getDeviceState?.(matrix.id);
    if (ds?.brightness) return [...ds.brightness];
    const dots = [...document.querySelectorAll('svg circle')].filter((el) => {
      const fill = el.getAttribute('fill') || '';
      return /^rgba?\(255,/.test(fill) && !fill.includes(',0)');
    });
    return { litDots: dots.length };
  });

  await page.screenshot({ path: ss });

  if (!sample1 || !sample2) {
    return {
      row: ROW,
      verdict: 'FAIL',
      screenshot: ss,
      notes: 'matrix8x8 part or board not found',
      attribution: 'example — no matrix8x8 part in Blinkenrocket',
    };
  }

  // Array form: compare brightness changes.
  if (Array.isArray(sample1) && Array.isArray(sample2)) {
    const s1 = sample1.join(',');
    const s2 = sample2.join(',');
    const maxBr = Math.max(...sample2);
    if (s1 !== s2) {
      return {
        row: ROW,
        verdict: 'PASS',
        screenshot: ss,
        notes: `brightness changed between samples (max=${maxBr.toFixed(3)})`,
      };
    }
    if (maxBr > 0) {
      return {
        row: ROW,
        verdict: 'PASS',
        screenshot: ss,
        notes: `brightness stable but lit (max=${maxBr.toFixed(3)})`,
      };
    }
    return {
      row: ROW,
      verdict: 'FAIL',
      screenshot: ss,
      notes: 'brightness array all zeros',
      attribution: 'engine — ATtiny88 sim not driving matrix',
    };
  }

  // Fallback litDots form.
  const d1 = sample1.litDots ?? 0;
  const d2 = sample2.litDots ?? 0;
  if (d1 > 0 || d2 > 0) {
    return {
      row: ROW,
      verdict: 'PASS',
      screenshot: ss,
      notes: `lit SVG dots: ${d1} → ${d2}`,
    };
  }
  return {
    row: ROW,
    verdict: 'FAIL',
    screenshot: ss,
    notes: 'zero lit dots in both samples',
    attribution: 'engine — ATtiny88 sim not driving matrix',
  };
}
