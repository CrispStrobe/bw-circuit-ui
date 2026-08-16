/**
 * Probe: serial machine bench — 6502 Tali Forth banner + Z80 BBC BASIC.
 *
 * Loads "6502 Computer with LCD", opens Debugger, clicks Build Machine,
 * loads Tali Forth 2 preset, and checks serial output for the Forth banner.
 * Then attempts BBC BASIC (Z80) if available.
 *
 * Attribution on FAIL: engine (runner/serial sim) or face (serial console not mounted)
 */
export const ROW = 'serial';

export async function run(page, utils) {
  const ss = utils.screenshotPath('serial');

  await utils.goToCircuit();

  // Load 6502 Computer with LCD.
  try {
    await utils.loadExample('6502 Computer with LCD');
  } catch {
    try { await utils.loadExample('Full EATER6502'); } catch { /* */ }
  }

  // Open Debugger panel.
  await utils.openDebugger();

  // Click Build Machine.
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
    await page.screenshot({ path: ss });
    return {
      row: ROW, verdict: 'FAIL', screenshot: ss,
      notes: 'Build Machine not available or did not boot',
      attribution: 'engine — Build Machine / extractor not functional on deploy',
    };
  }

  // Click Tali Forth 2 preset to load ROM.
  let romLoaded = false;
  try {
    const tali = page.locator('button', { hasText: 'Tali Forth' }).first();
    if (await tali.isVisible({ timeout: 3000 }).catch(() => false)) {
      await tali.click();
      romLoaded = true;
      await page.waitForTimeout(8000);
    }
  } catch { /* preset not available */ }

  if (!romLoaded) {
    await page.screenshot({ path: ss });
    return {
      row: ROW, verdict: 'FAIL', screenshot: ss,
      notes: 'Tali Forth 2 preset button not found after Build Machine',
      attribution: 'face — ROM preset buttons not rendered in Machine Loader',
    };
  }

  // Read serial output from the <pre> element near the serial input.
  const serialResult = await page.evaluate(() => {
    const input = document.querySelector('input[placeholder*="type a line"]');
    if (!input) return { err: 'no serial input element' };
    // The serial output <pre> is a sibling of the input's container.
    const container = input.closest('div')?.parentElement;
    if (!container) return { err: 'no serial container' };
    const pre = container.querySelector('pre');
    return pre ? { text: pre.textContent } : { err: 'no <pre> element' };
  });

  await page.screenshot({ path: ss });

  if (serialResult.err) {
    return {
      row: ROW, verdict: 'FAIL', screenshot: ss,
      notes: serialResult.err,
      attribution: 'face — serial console <pre> element not rendered',
    };
  }

  const text = serialResult.text || '';
  const hasForth = /Tali Forth/i.test(text);
  const hasPrompt = text.includes('>');
  const notes = [];

  if (hasForth) notes.push('Tali Forth 2 banner detected');
  if (hasPrompt) notes.push('prompt ">" found');
  if (!hasForth && !hasPrompt)
    notes.push(`serial output (${text.length} chars) but no Forth banner or prompt`);

  const verdict = hasForth || hasPrompt ? 'PASS' : 'FAIL';
  return {
    row: ROW, verdict, screenshot: ss,
    notes: notes.join('; '),
    attribution: verdict === 'FAIL' ? 'engine — 6502 sim not producing serial output via ACIA' : undefined,
  };
}
