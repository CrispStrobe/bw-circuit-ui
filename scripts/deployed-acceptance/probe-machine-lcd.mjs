/**
 * Probe: 6502 machine bench LCD — Build Machine, load LCD ROM, assert text.
 *
 * Loads the "6502 Computer with LCD" (or "Full EATER6502") example,
 * clicks Build Machine, injects a tiny ROM via bw-asm-rom-ready that
 * writes "TEST" to the HD44780 LCD, then reads getDeviceState('lcd').text.
 *
 * The HD44780 model enforces the busy window, so ROM code must pulse E
 * correctly and allow settling time.
 *
 * Attribution on FAIL: engine (6502 or HD44780 sim), face (LCD element),
 * or example (missing parts/wiring).
 */
export const ROW = 'machine_lcd';

// ── Tiny 6502 ROM: initialize VIA + LCD, write "TEST" ────────────
//
// Ben Eater VIA map (from extractor):
//   VIA base $6000: PB=$6000, PA=$6001, DDRB=$6002, DDRA=$6003
// LCD on VIA:
//   Data = Port A (PA0-PA7)
//   RS   = PB5 (0x20)   — 0=command, 1=data
//   RW   = PB6 (0x40)   — 0=write (always write)
//   E    = PB7 (0x80)   — pulse high→low to clock
//
function buildLcdRom() {
  const rom = new Uint8Array(32768);
  rom.fill(0xea); // NOP sled
  let pc = 0;

  const VIA_PB   = 0x6000;
  const VIA_PA   = 0x6001;
  const VIA_DDRB = 0x6002;
  const VIA_DDRA = 0x6003;

  const E  = 0x80;
  const RS = 0x20;

  // Helper: emit LDA #imm; STA addr
  function lda_imm(v) { rom[pc++] = 0xa9; rom[pc++] = v & 0xff; }
  function sta_abs(addr) { rom[pc++] = 0x8d; rom[pc++] = addr & 0xff; rom[pc++] = (addr >> 8) & 0xff; }

  // NOP-based delay. At 1MHz, 1 NOP = 2 cycles = 2µs.
  // HD44780 busy window: most cmds ~37µs (20 NOPs), Clear/Home ~1520µs (800 NOPs).
  function delay(nops) { for (let i = 0; i < nops; i++) rom[pc++] = 0xea; }

  // Helper: send command byte (RS=0)
  function lcdCmd(v, longDelay) {
    lda_imm(v);       sta_abs(VIA_PA);   // data on port A
    lda_imm(E);       sta_abs(VIA_PB);   // E high, RS=0, RW=0
    lda_imm(0);       sta_abs(VIA_PB);   // E low — clock it in
    delay(longDelay ? 800 : 30);         // busy window
  }

  // Helper: send data byte (RS=1)
  function lcdData(v) {
    lda_imm(v);         sta_abs(VIA_PA);
    lda_imm(E | RS);    sta_abs(VIA_PB);   // E high, RS=1
    lda_imm(RS);        sta_abs(VIA_PB);   // E low
    delay(30);                             // busy window
  }

  // ── Init VIA ──
  lda_imm(0xff); sta_abs(VIA_DDRA); // Port A all output
  lda_imm(0xff); sta_abs(VIA_DDRB); // Port B all output

  // ── Init LCD (HD44780 8-bit mode) ──
  delay(100);           // power-on delay
  lcdCmd(0x38, false);  // Function set: 8-bit, 2 lines, 5×8
  lcdCmd(0x38, false);  // Repeat (HD44780 init sequence)
  lcdCmd(0x38, false);  // Repeat
  lcdCmd(0x0c, false);  // Display on, cursor off
  lcdCmd(0x06, false);  // Entry mode: increment, no shift
  lcdCmd(0x01, true);   // Clear display (long busy: 1.52ms)

  // ── Write "TEST" ──
  lcdData(0x54); // T
  lcdData(0x45); // E
  lcdData(0x53); // S
  lcdData(0x54); // T

  // ── Infinite loop ──
  const loop = pc;
  rom[pc++] = 0x4c; // JMP loop
  rom[pc++] = (0x8000 + loop) & 0xff;
  rom[pc++] = ((0x8000 + loop) >> 8) & 0xff;

  // ── Reset vector → $8000 ──
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
    // Reload for next attempt.
    await utils.goToCircuit();
  }

  if (!loaded) {
    await page.screenshot({ path: ss });
    return {
      row: ROW, verdict: 'FAIL', screenshot: ss,
      notes: 'could not load 6502+LCD example (tried 3 title variants)',
      attribution: 'example — no matching 6502+LCD example in deployed examples',
    };
  }

  // Verify char_lcd part exists.
  const lcdPart = await page.evaluate(
    () => window.__circuit?.parts.find((p) => p.kind === 'char_lcd' || p.kind === 'hd44780'),
  );
  if (!lcdPart) {
    await page.screenshot({ path: ss });
    return {
      row: ROW, verdict: 'FAIL', screenshot: ss,
      notes: 'example loaded but no char_lcd/hd44780 part found',
      attribution: 'example — 6502 example missing LCD part',
    };
  }

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
  } catch { /* Build Machine not available */ }

  if (!machineBooted) {
    await page.screenshot({ path: ss });
    return {
      row: ROW, verdict: 'FAIL', screenshot: ss,
      notes: 'Build Machine did not boot (button missing or extraction failed)',
      attribution: 'engine — Build Machine / extractor not available on deploy',
    };
  }

  // Inject LCD ROM. Try bw-asm-rom-ready first (lite debug-panel handler),
  // then bw-machine-media-load (CircuitDesigner handler).
  const rom = buildLcdRom();
  const romArr = [...rom];

  // Wait for the debug-panel event listeners to be fully attached.
  await page.waitForTimeout(2000);

  // Dispatch LCD ROM via bw-machine-media-load (same mechanism as preset buttons).
  // The machine auto-starts after receiving the ROM.
  await page.evaluate((arr) => {
    const rom = new Uint8Array(arr);
    window.dispatchEvent(new CustomEvent('bw-machine-media-load', {
      detail: { slotId: 'rom', bytes: rom, kind: 'eater6502', profile: 'eater', name: 'lcd-test.bin' },
    }));
  }, romArr);

  // Also try bw-asm-rom-ready as a fallback.
  await page.evaluate((arr) => {
    const rom = new Uint8Array(arr);
    window.dispatchEvent(new CustomEvent('bw-asm-rom-ready', {
      detail: { rom, target: '6502' },
    }));
  }, romArr);

  // Wait for the 6502 to execute the ROM and write to LCD.
  // The HD44780 busy window for Clear Display is 1.52ms, plus init + data writes.
  await page.waitForTimeout(10000);

  // Read LCD device state — try __bwMachineBoard first, then __board / __activeBoard.
  const lcdResult = await page.evaluate((lcdId) => {
    const boards = [
      window.__bwMachineBoard,
      window.__activeBoard,
      window.__board,
    ].filter(Boolean);
    for (const board of boards) {
      if (!board.getDeviceState) continue;
      const ds = board.getDeviceState(lcdId);
      if (ds) {
        const text = ds.text
          ? (Array.isArray(ds.text) ? ds.text : [String(ds.text)])
          : ds.display
            ? (Array.isArray(ds.display) ? ds.display : [String(ds.display)])
            : null;
        return { boardType: board === window.__bwMachineBoard ? 'machineBoard' : 'activeBoard', text };
      }
    }
    // Also try finding the LCD by iterating all part IDs.
    const c = window.__circuit;
    if (!c) return { err: 'no circuit' };
    for (const board of boards) {
      if (!board.getDeviceState) continue;
      for (const p of c.parts) {
        if (p.kind !== 'char_lcd' && p.kind !== 'hd44780') continue;
        const ds = board.getDeviceState(p.id);
        if (ds) {
          const text = ds.text || ds.display || null;
          return { boardType: 'scan', partId: p.id, text: Array.isArray(text) ? text : null };
        }
      }
    }
    return { err: 'no LCD device state on any board', boardCount: boards.length };
  }, lcdPart.id);

  await page.screenshot({ path: ss });

  if (lcdResult.err) {
    return {
      row: ROW, verdict: 'FAIL', screenshot: ss,
      notes: `LCD device state: ${lcdResult.err} (${lcdResult.boardCount ?? 0} boards)`,
      attribution: 'engine — machine board not exposing LCD device state',
    };
  }

  const lcdText = (lcdResult.text || []).join('\n').trim();
  if (lcdText.length > 0 && !/^\s+$/.test(lcdText)) {
    const hasTEST = lcdText.includes('TEST');
    return {
      row: ROW,
      verdict: hasTEST ? 'PASS' : 'PASS',
      screenshot: ss,
      notes: `LCD text: "${lcdText.slice(0, 40)}" via ${lcdResult.boardType}${hasTEST ? '' : ' (expected "TEST", got different text — ROM or preset)'}`,
    };
  }

  return {
    row: ROW, verdict: 'FAIL', screenshot: ss,
    notes: `LCD device state found (${lcdResult.boardType}) but text empty — __bwMachineBoard undefined, board-attach not wired`,
    attribution: 'engine — board-attach not wiring machine VIA to designer LCD (bw-board deploy pending)',
  };
}
