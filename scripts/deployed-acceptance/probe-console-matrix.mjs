/**
 * Probe: console matrix — retro console display visible while scanning.
 *
 * Loads "Retro console: self-test", clicks green flag to run, and checks
 * for non-zero brightness on the scan-duty matrix display. The ledDisplayLevel
 * gamma curve (deploy 72f1398) makes previously dark scan-duty matrices visible.
 *
 * Attribution on FAIL: engine (matrix scan sim), face (gamma/brightness curve)
 */
export const ROW = 'console_matrix';

export async function run(page, utils) {
  const ss = utils.screenshotPath('console-matrix');

  await utils.goToCircuit();
  await utils.loadExample('Retro console: self-test', undefined, 'stc15f2k60s2');
  await utils.enterSim();
  await page.waitForTimeout(5000);

  // Check rendered SVG circles for lit dots. The ledDisplayLevel gamma
  // curve boosts scan-duty brightness in the rendering even though raw
  // device-state brightness may be 0 — check the SVG, not device state.
  const result = await page.evaluate(() => {
    // Count SVG circles with non-transparent, non-black fills.
    const dots = [...document.querySelectorAll('svg circle')].filter((el) => {
      const fill = el.getAttribute('fill') || '';
      if (!/^rgba?\(/.test(fill)) return false;
      // Parse rgba(r,g,b,a) — exclude fully transparent (a=0) and black (rgb all <5)
      const m = fill.match(/[\d.]+/g);
      if (!m || m.length < 3) return false;
      const [r, g, b] = m.map(Number);
      const a = m.length >= 4 ? Number(m[3]) : 1;
      return a > 0.01 && (r > 5 || g > 5 || b > 5);
    });
    return { litDots: dots.length };
  });

  await page.screenshot({ path: ss });

  if (result.litDots > 0) {
    return {
      row: ROW, verdict: 'PASS', screenshot: ss,
      notes: `${result.litDots} lit SVG dots (scan-duty gamma visible)`,
    };
  }

  return {
    row: ROW, verdict: 'FAIL', screenshot: ss,
    notes: 'zero lit dots in SVG — scan-duty gamma not producing visible pixels',
    attribution: 'face — ledDisplayLevel gamma curve not applied',
  };
}
