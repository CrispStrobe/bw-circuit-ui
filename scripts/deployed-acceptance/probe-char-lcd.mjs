/**
 * Probe: character LCD — text present on display.
 *
 * Loads the "LCD hello" example and verifies:
 * 1. char_lcd part exists
 * 2. WokwiLcd1602 element has non-empty text content
 *
 * Attribution on FAIL: face (Wokwi element not rendering) or engine (sim not writing to LCD)
 */
export const ROW = 'char_lcd';

export async function run(page, utils) {
  const ss = utils.screenshotPath('char-lcd');

  await utils.goToCircuit();
  await utils.loadExample('I2C LCD');
  await utils.enterSim();
  await page.waitForTimeout(5000);

  // Retry loop — LCD may take time to populate.
  let result;
  for (let attempt = 0; attempt < 3; attempt++) {
    result = await page.evaluate(() => {
    // Check for Wokwi LCD element.
    const lcd = document.querySelector('wokwi-lcd1602');
    if (lcd) {
      // The Wokwi element renders text via its shadow DOM or attributes.
      const text = lcd.getAttribute('text') || lcd.text || '';
      return { source: 'wokwi', text, found: true };
    }
    // Fallback: check device state.
    const c = window.__circuit;
    const board = window.__activeBoard || window.__board;
    if (!c || !board) return { found: false, err: 'no circuit/board' };
    const lcdPart = c.parts.find(
      (p) => p.kind === 'char_lcd' || p.kind === 'hd44780' || p.kind === 'char_lcd_i2c',
    );
    if (!lcdPart) return { found: false, err: 'no LCD part' };
    const ds = board.getDeviceState?.(lcdPart.id);
    if (ds) {
      const text = ds.text
        ? (Array.isArray(ds.text) ? ds.text.join('\n') : String(ds.text))
        : ds.display
          ? (Array.isArray(ds.display) ? ds.display.join('\n') : String(ds.display))
          : '';
      return { source: 'deviceState', text, found: true };
    }
    return { found: true, err: 'no device state', text: '' };
  });
    const text = (result?.text || '').trim();
    if (text.length > 0) break;
    await page.waitForTimeout(2000);
  }

  await page.screenshot({ path: ss });

  if (!result.found) {
    return {
      row: ROW,
      verdict: 'FAIL',
      screenshot: ss,
      notes: result.err || 'char_lcd part not found',
      attribution: 'example — no LCD part in "LCD hello"',
    };
  }

  const text = (result.text || '').trim();
  if (text.length > 0) {
    return {
      row: ROW,
      verdict: 'PASS',
      screenshot: ss,
      notes: `LCD text: "${text.slice(0, 60)}" (${result.source})`,
    };
  }

  return {
    row: ROW,
    verdict: 'FAIL',
    screenshot: ss,
    notes: `LCD element found (${result.source}) but text empty`,
    attribution: 'engine — sim not writing text to HD44780',
  };
}
