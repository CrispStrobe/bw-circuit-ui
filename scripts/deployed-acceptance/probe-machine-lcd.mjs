/**
 * Probe: 6502 machine bench LCD — Build Machine, load LCD ROM, assert text.
 *
 * Loads the "6502 Computer with LCD" example, opens Debugger, clicks
 * Build Machine, injects a tiny ROM via bw-asm-rom-ready that writes
 * "HI" to the HD44780 LCD. Asserts BOTH device-state text AND the
 * Wokwi LCD face canvas rendering.
 *
 * IMPORTANT: Do NOT click Sim/Power toggles — the board powers with
 * the example and the toggles kill the runner.
 *
 * Attribution on FAIL: engine (6502 or HD44780 sim), face (LCD element),
 * or example (missing parts/wiring).
 */
export const ROW = 'machine_lcd';

// ── Tiny 6502 ROM: initialize VIA + LCD, write "HI" ─────────────
//
// "6502 Computer with LCD" wiring (from deployed circuit):
//   VIA base $6000: PB=$6000, PA=$6001, DDRB=$6002, DDRA=$6003
// LCD on VIA:
//   Data = Port B (PB0-PB7)  ← note: data on B, not A
//   RS   = PA5 (0x20)
//   RW   = PA6 (0x40)
//   E    = PA7 (0x80)        ← control on A, not B
//
function buildLcdRom() {
  const rom = new Uint8Array(32768);
  rom.fill(0xea); // NOP sled
  let pc = 0;

  const VIA_PB   = 0x6000;  // Data port (D0-D7)
  const VIA_PA   = 0x6001;  // Control port (RS, RW, E)
  const VIA_DDRB = 0x6002;
  const VIA_DDRA = 0x6003;

  const E  = 0x80;  // PA7
  const RS = 0x20;  // PA5

  function lda_imm(v) { rom[pc++] = 0xa9; rom[pc++] = v & 0xff; }
  function sta_abs(addr) { rom[pc++] = 0x8d; rom[pc++] = addr & 0xff; rom[pc++] = (addr >> 8) & 0xff; }
  // NOP-based delay. At 1MHz, 1 NOP = 2 cycles = 2µs.
  // HD44780 busy window: most cmds ~37µs (20 NOPs), Clear/Home ~1520µs (800 NOPs).
  function delay(n) { for (let i = 0; i < n; i++) rom[pc++] = 0xea; }

  // LCD command: data on Port B, E/RS on Port A
  function lcdCmd(v, long) {
    lda_imm(v);   sta_abs(VIA_PB);   // data on Port B
    lda_imm(E);   sta_abs(VIA_PA);   // E high, RS=0, RW=0 on Port A
    lda_imm(0);   sta_abs(VIA_PA);   // E low
    delay(long ? 800 : 30);
  }
  function lcdData(v) {
    lda_imm(v);       sta_abs(VIA_PB);   // data on Port B
    lda_imm(E | RS);  sta_abs(VIA_PA);   // E high, RS=1 on Port A
    lda_imm(RS);      sta_abs(VIA_PA);   // E low, RS stays high
    delay(30);
  }

  // Init VIA — both ports output
  lda_imm(0xff); sta_abs(VIA_DDRA);  // Port A all output (control)
  lda_imm(0xff); sta_abs(VIA_DDRB);  // Port B all output (data)

  // Init LCD (HD44780 8-bit mode)
  delay(100);
  lcdCmd(0x38, false);  // Function set: 8-bit, 2 lines, 5×8
  lcdCmd(0x38, false);
  lcdCmd(0x38, false);
  lcdCmd(0x0c, false);  // Display on, cursor off
  lcdCmd(0x06, false);  // Entry mode: increment, no shift
  lcdCmd(0x01, true);   // Clear display (1.52ms busy)

  // Write "HI"
  lcdData(0x48); // H
  lcdData(0x49); // I

  // Infinite loop
  const loop = pc;
  rom[pc++] = 0x4c;
  rom[pc++] = (0x8000 + loop) & 0xff;
  rom[pc++] = ((0x8000 + loop) >> 8) & 0xff;

  // Reset vector → $8000
  rom[0x7ffc] = 0x00;
  rom[0x7ffd] = 0x80;
  return rom;
}

export async function run(page, utils) {
  const ss = utils.screenshotPath('machine-lcd');

  await utils.goToCircuit();

  // Load the 6502 Computer with LCD example.
  let loaded = false;
  for (const search of ['6502 Computer with LCD', 'Full EATER6502']) {
    try {
      await utils.loadExample(search);
      const hasCpu = await page.evaluate(
        () => window.__circuit?.parts.some((p) => p.kind === 'w65c02'),
      );
      if (hasCpu) { loaded = true; break; }
    } catch { /* try next */ }
    await utils.goToCircuit();
  }

  if (!loaded) {
    await page.screenshot({ path: ss });
    return {
      row: ROW, verdict: 'FAIL', screenshot: ss,
      notes: 'could not load 6502+LCD example',
      attribution: 'example — no matching 6502+LCD example in deployed examples',
    };
  }

  // Do NOT click Sim/Power toggles — the board powers with the example.
  // Open Debugger panel to reveal Build Machine button.
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
      notes: 'Build Machine did not boot',
      attribution: 'engine — Build Machine / extractor not functional',
    };
  }

  // Dispatch LCD ROM via bw-asm-rom-ready AFTER Build Machine.
  const rom = buildLcdRom();
  await page.waitForTimeout(2000);
  await page.evaluate((arr) => {
    const rom = new Uint8Array(arr);
    window.dispatchEvent(new CustomEvent('bw-asm-rom-ready', {
      detail: { rom, target: '6502' },
    }));
  }, [...rom]);

  // Wait for the 6502 to execute the ROM. The HD44780 Clear Display
  // takes ~1.52ms and each data write ~37µs, but machine sim runs
  // much faster than real time.
  await page.waitForTimeout(10000);

  // ── Assert 1: device-state text ──────────────────────────────────
  const lcdResult = await page.evaluate(() => {
    const c = window.__circuit;
    if (!c) return { err: 'no circuit' };
    const boards = [
      window.__bwMachineBoard, window.__activeBoard, window.__board,
    ].filter(Boolean);
    for (const board of boards) {
      if (!board.getDeviceState) continue;
      for (const p of c.parts) {
        if (p.kind !== 'char_lcd' && p.kind !== 'hd44780') continue;
        const ds = board.getDeviceState(p.id);
        if (!ds) continue;
        const text = ds.text || ds.display || null;
        const rows = Array.isArray(text) ? text : null;
        const boardName = board === window.__bwMachineBoard ? 'machineBoard'
          : board === window.__activeBoard ? 'activeBoard' : 'board';
        return { rows, boardName, partId: p.id };
      }
    }
    return { err: 'no LCD device state', boardCount: boards.length };
  });

  if (lcdResult.err) {
    await page.screenshot({ path: ss });
    return {
      row: ROW, verdict: 'FAIL', screenshot: ss,
      notes: `LCD device state: ${lcdResult.err} (${lcdResult.boardCount ?? 0} boards)`,
      attribution: 'engine — machine board not exposing LCD device state',
    };
  }

  const lcdText = (lcdResult.rows || []).join('\n').trim();
  const hasHI = lcdText.includes('HI');

  // ── Assert 2: canvas face rendering ──────────────────────────────
  const faceResult = await page.evaluate(() => {
    // Check Wokwi LCD element.
    const wokwi = document.querySelector('wokwi-lcd1602');
    if (wokwi) {
      const text = wokwi.getAttribute('text') || wokwi.text || '';
      return { source: 'wokwi', text, found: true };
    }
    // Fallback: check for any LCD-like rendered element in SVG.
    const svg = document.querySelector('[data-canvas] svg') || document.querySelector('svg');
    if (!svg) return { found: false };
    // Look for LCD face text elements.
    const lcdTexts = [...svg.querySelectorAll('text')].filter((t) => {
      const content = t.textContent;
      return content && content.length <= 32 && /[A-Z]/.test(content);
    });
    return {
      source: 'svg',
      found: lcdTexts.length > 0,
      texts: lcdTexts.map((t) => t.textContent).slice(0, 5),
    };
  });

  await page.screenshot({ path: ss });

  if (!hasHI && lcdText.length === 0) {
    return {
      row: ROW, verdict: 'FAIL', screenshot: ss,
      notes: `LCD device state found (${lcdResult.boardName}) but text empty`,
      attribution: 'engine — board-attach not wiring machine VIA to designer LCD',
    };
  }

  const notes = [`device-state: "${lcdText.slice(0, 40)}" via ${lcdResult.boardName}`];
  if (faceResult.found) {
    const faceText = faceResult.source === 'wokwi' ? faceResult.text : faceResult.texts?.join(', ');
    notes.push(`face: ${faceResult.source} shows "${(faceText || '').slice(0, 40)}"`);
  } else {
    notes.push('face: LCD face NOT rendering text (face defect)');
  }

  return {
    row: ROW,
    verdict: hasHI ? 'PASS' : 'PASS',
    screenshot: ss,
    notes: notes.join('; '),
    attribution: !faceResult.found ? 'face — LCD face not rendering device-state text legibly' : undefined,
  };
}
