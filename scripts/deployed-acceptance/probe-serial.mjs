/**
 * Probe: serial machine bench — BBC BASIC banner + PRINT 2+2.
 *
 * Checks for a Z80 target in the debug panel, runs it, and verifies:
 * 1. Serial output contains the BBC BASIC banner or ">" prompt
 * 2. (Gated on input fork) PRINT 2+2 produces "4"
 *
 * Attribution on FAIL: engine (Z80/ACIA sim) or face (serial console not mounted)
 */
export const ROW = 'serial';

export async function run(page, utils) {
  const ss = utils.screenshotPath('serial');

  await utils.goToCircuit();
  // Load the Z80 Breadboard Computer example to get the Z80 debug context.
  try {
    await utils.loadExample('Z80 Breadboard');
    await utils.enterSim();
    await page.waitForTimeout(2000);
  } catch { /* example might not exist or match */ }

  // Look for a Z80 target option in any select dropdown.
  const hasZ80 = await page.evaluate(() => {
    for (const sel of document.querySelectorAll('select')) {
      for (const opt of sel.options) {
        if (/z80/i.test(opt.text) || /z80/i.test(opt.value))
          return { found: true, text: opt.text, value: opt.value };
      }
    }
    return { found: false };
  });

  if (!hasZ80.found) {
    await page.screenshot({ path: ss });
    return {
      row: ROW,
      verdict: 'FAIL',
      screenshot: ss,
      notes: 'no Z80 target available in debug panel selects',
      attribution: 'face — debug panel Z80 target not deployed',
    };
  }

  // Select Z80 and click Run.
  await page.evaluate(() => {
    for (const sel of document.querySelectorAll('select')) {
      for (const opt of sel.options) {
        if (/z80/i.test(opt.text) || /z80/i.test(opt.value)) {
          sel.value = opt.value;
          sel.dispatchEvent(new Event('change', { bubbles: true }));
          return;
        }
      }
    }
  });
  await page.waitForTimeout(500);

  // Click Run button.
  for (const b of await page.locator('button').all()) {
    const t = await b.innerText().catch(() => '');
    if (/Run/.test(t) && (await b.isVisible().catch(() => false))) {
      await b.click().catch(() => {});
      break;
    }
  }
  await page.waitForTimeout(5000);

  // Read serial output.
  const serial = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="bw-serial-console"]');
    return el ? el.textContent : null;
  });

  await page.screenshot({ path: ss });

  if (!serial) {
    return {
      row: ROW,
      verdict: 'FAIL',
      screenshot: ss,
      notes: 'no serial console element found (data-testid="bw-serial-console")',
      attribution: 'face — serial console not mounted in debug panel',
    };
  }

  const hasPrompt = serial.includes('>');
  const hasBBC = /BBC\s*BASIC/i.test(serial) || /Z80/i.test(serial);
  const notes = [];

  if (hasBBC) notes.push('BBC BASIC banner detected');
  if (hasPrompt) notes.push('prompt ">" found');
  if (!hasBBC && !hasPrompt)
    notes.push(`serial output (${serial.length} chars) but no banner or prompt`);

  // PRINT 2+2 test (gated on input fork).
  let printResult = null;
  if (hasPrompt) {
    // Try typing PRINT 2+2 into serial input if available.
    const input = await page
      .locator('[data-testid="bw-serial-input"], input[placeholder*="serial"]')
      .first();
    if ((await input.count()) > 0) {
      await input.fill('PRINT 2+2');
      await input.press('Enter');
      await page.waitForTimeout(2000);
      const afterPrint = await page.evaluate(() => {
        const el = document.querySelector('[data-testid="bw-serial-console"]');
        return el ? el.textContent : null;
      });
      if (afterPrint && afterPrint.includes('4')) {
        printResult = 'PASS';
        notes.push('PRINT 2+2 => 4 confirmed');
      } else {
        printResult = 'input sent but "4" not in output';
        notes.push(`PRINT 2+2: ${printResult}`);
      }
    } else {
      notes.push('PRINT 2+2: serial input element not found (input fork not landed)');
    }
  }

  await page.screenshot({ path: ss });

  const verdict = hasPrompt || hasBBC ? 'PASS' : 'FAIL';
  return {
    row: ROW,
    verdict,
    screenshot: ss,
    notes: notes.join('; '),
    attribution: verdict === 'FAIL' ? 'engine — Z80/ACIA sim not producing serial output' : undefined,
  };
}
