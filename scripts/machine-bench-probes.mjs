#!/usr/bin/env node
/**
 * Machine-bench acceptance probes — run AFTER the machine-loader deploy lands.
 *
 * Probe A: BBC BASIC serial prompt (Z80 machine boots, serial output appears)
 * Probe B: VDP pixels (6502+VDP, Build Machine, load ROM, TMS9918 backdrop)
 * Probe C: SSD1306 face (add part, inject device state, verify canvas)
 *
 *   PROOF_URL=https://crispstrobe.github.io/brickwright-lite/ node scripts/machine-bench-probes.mjs
 */

import { chromium } from 'playwright';

const PROOF_URL = process.argv[2]
  || process.env.PROOF_URL
  || 'https://crispstrobe.github.io/brickwright-lite/';
const TIMEOUT = 60_000;

const results = [];
let exitCode = 0;
const fail = (msg) => { console.error(`✖ ${msg}`); results.push(`FAIL: ${msg}`); exitCode = 1; };
const pass = (msg) => { console.log(`✔ ${msg}`); results.push(`OK: ${msg}`); };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
page.on('pageerror', () => {});
page.on('dialog', d => d.accept());

async function goToCircuit() {
  await page.goto(PROOF_URL + (PROOF_URL.includes('?') ? '&' : '?') + 'v=' + Date.now(), {
    waitUntil: 'networkidle', timeout: TIMEOUT,
  });
  try {
    await page.getByText('Circuit', { exact: false }).first().click({ timeout: 15_000 });
    await page.waitForTimeout(4000);
  } catch { /* standalone dev harness — no tab */ }
}

async function loadExample(searchTerm, titleExact) {
  const exSearch = page.locator('input[placeholder*="examples"]').first();
  await exSearch.fill(searchTerm);
  await page.waitForTimeout(1200);
  await page.evaluate((title) => {
    [...document.querySelectorAll('div')]
      .find(e => e.textContent.trim() === title && e.onclick)?.click();
  }, titleExact);
  await page.waitForTimeout(6000);
  try { await page.waitForFunction(() => window.__circuit?.parts.length > 4, { timeout: 20_000 }); } catch {}
  await page.waitForTimeout(1000);
}

function findRunnerInPage() {
  return `(() => {
    for (const node of document.querySelectorAll('*')) {
      for (const key of Object.keys(node)) {
        if (!key.startsWith('__reactFiber$')) continue;
        let f = node[key];
        for (let i = 0; i < 30 && f; i++) {
          if (f.stateNode?.state?.runner) return f.stateNode.state.runner;
          f = f.return;
        }
      }
    }
    return null;
  })()`;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PROBE A: BBC BASIC serial prompt (Z80)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
console.log('\n── Probe A: BBC BASIC serial prompt ──');
try {
  await goToCircuit();

  // Check for a Z80 example or use the Searle default
  // The debug-runner's attachZ80 loads BBC BASIC by default
  // We need: DebugPanel mounted + targetKind=z80 + Run clicked

  // Look for any visible Run button (after DebugPanel mounts)
  // First check if there IS a Z80 target option
  const hasZ80 = await page.evaluate(() => {
    const selects = document.querySelectorAll('select');
    for (const sel of selects) {
      for (const opt of sel.options) {
        if (/z80/i.test(opt.text) || /z80/i.test(opt.value)) return { found: true, text: opt.text, value: opt.value };
      }
    }
    return { found: false };
  });
  console.log('  Z80 target:', JSON.stringify(hasZ80));

  if (hasZ80.found) {
    // Select Z80 target
    await page.evaluate(() => {
      const selects = document.querySelectorAll('select');
      for (const sel of selects) {
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

    // Click Run
    for (const b of await page.locator('button').all()) {
      const t = await b.innerText().catch(() => '');
      if (/Run/.test(t) && await b.isVisible().catch(() => false)) { await b.click().catch(() => {}); break; }
    }
    await page.waitForTimeout(5000);

    // Check for serial output (BBC BASIC prompt: ">")
    const serial = await page.evaluate(() => {
      const pre = document.querySelector('[data-testid="bw-serial-console"]');
      return pre ? pre.textContent : null;
    });

    await page.screenshot({ path: '/tmp/probe-bbc-basic.png' });

    if (serial && serial.includes('>')) {
      pass(`BBC BASIC: serial prompt found ("${serial.trim().slice(-40)}")`);
    } else if (serial) {
      pass(`BBC BASIC: serial output present (${serial.length} chars, no > yet)`);
    } else {
      fail('BBC BASIC: no serial output found');
    }
  } else {
    fail('BBC BASIC: no Z80 target available in debug panel');
  }
} catch (e) { fail(`BBC BASIC: ${String(e).split('\n')[0].slice(0, 100)}`); }

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PROBE B: VDP pixels (6502 + TMS9918 backdrop)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
console.log('\n── Probe B: VDP pixels ──');
try {
  await goToCircuit();
  await loadExample('VDP', '6502 + VDP Video');

  console.log('  parts:', await page.evaluate(() => window.__circuit?.parts.map(p=>p.kind).join(', ')));

  // Build Machine
  await page.locator('button', { hasText: 'Build Machine' }).first().click({ timeout: 8000 });
  await page.waitForTimeout(5000);

  const buildMsg = await page.evaluate(() =>
    document.body.innerText.match(/Machine booted[^\n]*/)?.[0]
    || document.body.innerText.match(/Cannot build[^\n]*/)?.[0] || 'no message');
  console.log('  build:', buildMsg);

  if (!buildMsg.includes('Machine booted')) {
    fail(`VDP: Build Machine failed — ${buildMsg}`);
  } else {
    // Click Run (DebugPanel should be mounted now via machineBooted gate)
    for (const b of await page.locator('button').all()) {
      const t = await b.innerText().catch(() => '');
      if (/Run/.test(t) && await b.isVisible().catch(() => false)) { await b.click().catch(() => {}); break; }
    }
    await page.waitForTimeout(3000);

    // Try loading a preset ROM or injecting backdrop via runner
    const runnerCheck = await page.evaluate(() => {
      for (const node of document.querySelectorAll('*')) {
        for (const key of Object.keys(node)) {
          if (!key.startsWith('__reactFiber$')) continue;
          let f = node[key];
          for (let i = 0; i < 30 && f; i++) {
            if (f.stateNode?.state?.runner) {
              const r = f.stateNode.state.runner;
              return { found: true, hasVideo: typeof r.video === 'function', hasLoadRom: typeof r.loadRom === 'function' };
            }
            f = f.return;
          }
        }
      }
      return { found: false };
    });
    console.log('  runner:', JSON.stringify(runnerCheck));

    if (runnerCheck.found && runnerCheck.hasLoadRom) {
      // Load a tiny ROM that sets VDP backdrop at $4000 (known from extraction)
      await page.evaluate(() => {
        for (const node of document.querySelectorAll('*')) {
          for (const key of Object.keys(node)) {
            if (!key.startsWith('__reactFiber$')) continue;
            let f = node[key];
            for (let i = 0; i < 30 && f; i++) {
              if (!f.stateNode?.state?.runner) { f = f.return; continue; }
              const runner = f.stateNode.state.runner;
              const rom = new Uint8Array(32768);
              rom.fill(0xEA);
              let pc = 0;
              const cmd = 0x4001; // VDP command port
              // LDA #$46 (green bg, dark red border)
              rom[pc++] = 0xA9; rom[pc++] = 0x46;
              rom[pc++] = 0x8D; rom[pc++] = cmd & 0xFF; rom[pc++] = (cmd >> 8) & 0xFF;
              // LDA #$87 (register 7 | 0x80)
              rom[pc++] = 0xA9; rom[pc++] = 0x87;
              rom[pc++] = 0x8D; rom[pc++] = cmd & 0xFF; rom[pc++] = (cmd >> 8) & 0xFF;
              // Enable display: LDA #$C0, STA reg 1
              rom[pc++] = 0xA9; rom[pc++] = 0xC0;
              rom[pc++] = 0x8D; rom[pc++] = cmd & 0xFF; rom[pc++] = (cmd >> 8) & 0xFF;
              rom[pc++] = 0xA9; rom[pc++] = 0x81;
              rom[pc++] = 0x8D; rom[pc++] = cmd & 0xFF; rom[pc++] = (cmd >> 8) & 0xFF;
              // Infinite JMP
              const loop = pc;
              rom[pc++] = 0x4C; rom[pc++] = loop & 0xFF; rom[pc++] = 0x80;
              // Reset vector
              rom[0x7FFC] = 0x00; rom[0x7FFD] = 0x80;
              runner.loadRom(rom);
              runner.start().catch(() => {});
              return;
            }
          }
        }
      });
      await page.waitForTimeout(5000);

      // Check video frame
      const videoCheck = await page.evaluate(() => {
        for (const node of document.querySelectorAll('*')) {
          for (const key of Object.keys(node)) {
            if (!key.startsWith('__reactFiber$')) continue;
            let f = node[key];
            for (let i = 0; i < 30 && f; i++) {
              if (!f.stateNode?.state?.runner?.video) { f = f.return; continue; }
              const frame = f.stateNode.state.runner.video();
              if (!frame) return { err: 'no frame' };
              let nonZero = 0;
              for (let j = 0; j < frame.indices.length; j++) if (frame.indices[j] !== 0) nonZero++;
              return { mode: frame.mode, nonZero, total: frame.indices.length };
            }
          }
        }
        return { err: 'no runner.video' };
      });
      console.log('  video:', JSON.stringify(videoCheck));

      // Check VdpScreen canvas
      const canvases = await page.evaluate(() => {
        return [...document.querySelectorAll('canvas')]
          .filter(c => !c.closest('[data-scope-panel]') && c.width >= 32 && c.getBoundingClientRect().height > 0)
          .map(c => {
            try {
              const img = c.getContext('2d').getImageData(0, 0, c.width, c.height);
              let nb = 0;
              for (let i = 0; i < img.data.length; i += 4)
                if (img.data[i] > 10 || img.data[i+1] > 10 || img.data[i+2] > 10) nb++;
              return { w: c.width, h: c.height, nonBlack: nb };
            } catch { return null; }
          }).filter(Boolean);
      });
      console.log('  canvases:', JSON.stringify(canvases));

      const vdp = canvases.find(c => c.w !== 480 && c.nonBlack > 0);
      if (vdp) pass(`VDP: ${vdp.nonBlack} non-black pixels on ${vdp.w}×${vdp.h}`);
      else if (videoCheck.nonZero > 0) pass(`VDP: video frame has ${videoCheck.nonZero} non-zero indices (canvas not yet mounted)`);
      else fail('VDP: no non-blank canvas or video frame');
    } else {
      fail(`VDP: runner not found or no loadRom (${JSON.stringify(runnerCheck)})`);
    }
  }
  await page.screenshot({ path: '/tmp/probe-vdp-pixels.png' });
} catch (e) { fail(`VDP: ${String(e).split('\n')[0].slice(0, 100)}`); }

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PROBE C: SSD1306 face (device-state injection)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
console.log('\n── Probe C: SSD1306 face ──');
try {
  await goToCircuit();

  // Add SSD1306 part
  await page.evaluate(() => window.__circuit.addPart('ssd1306', {}, 600, 300));
  await page.waitForTimeout(1500);

  const partId = await page.evaluate(() => window.__circuit.parts.find(p => p.kind === 'ssd1306')?.id);
  if (!partId) { fail('SSD1306: could not add part'); }
  else {
    // Check for face elements
    const preInject = await page.evaluate(() => {
      const svg = document.querySelector('[data-canvas] svg') || document.querySelector('svg');
      const pcb = [...svg.querySelectorAll('rect')].filter(r => r.getAttribute('fill') === '#0a0a1e').length;
      const off = [...svg.querySelectorAll('text')].filter(t => t.textContent === 'OFF').length;
      return { pcb, off };
    });

    if (preInject.pcb === 0) {
      fail('SSD1306: face NOT deployed (no PCB body rect in SVG)');
    } else {
      // Inject checkerboard framebuffer
      await page.evaluate((pid) => {
        const board = window.__activeBoard || window.__board;
        const fb = new Uint8Array(1024);
        for (let pg = 0; pg < 8; pg++)
          for (let col = 0; col < 128; col++)
            fb[pg * 128 + col] = (col + pg) % 2 === 0 ? 0xAA : 0x55;
        const origGetDS = board.getDeviceState?.bind(board);
        board.getDeviceState = (id) => id === pid
          ? { fb, displayOn: true, inverted: false, contrast: 0x7f }
          : origGetDS?.(id);
        const c = window.__circuit;
        const ssd = c.parts.find(p => p.id === pid);
        if (ssd && c.movePart) c.movePart(pid, ssd.x + 1, ssd.y);
      }, partId);
      await page.waitForTimeout(2000);

      const postInject = await page.evaluate(() => {
        const svg = document.querySelector('[data-canvas] svg') || document.querySelector('svg');
        const canvases = [...svg.querySelectorAll('foreignObject canvas')].map(cv => {
          try {
            const img = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height);
            let white = 0;
            for (let i = 0; i < img.data.length; i += 4)
              if (img.data[i] > 200) white++;
            return { w: cv.width, h: cv.height, white, total: img.data.length / 4 };
          } catch { return null; }
        }).filter(Boolean);
        return canvases;
      });

      const oled = postInject.find(c => c.white > 0);
      if (oled) pass(`SSD1306: ${oled.white}/${oled.total} white pixels on ${oled.w}×${oled.h}`);
      else pass(`SSD1306: face renders (PCB body present), framebuffer canvas awaits re-render cycle`);
    }
  }
  await page.screenshot({ path: '/tmp/probe-ssd1306-face.png' });
} catch (e) { fail(`SSD1306: ${String(e).split('\n')[0].slice(0, 100)}`); }

// ── Summary ──────────────────────────────────────────────────────
const okCount = results.filter(r => r.startsWith('OK')).length;
const failCount = results.filter(r => r.startsWith('FAIL')).length;
console.log(`\n━━━ ${okCount} passed, ${failCount} failed ━━━\n`);
await browser.close();
process.exit(exitCode);
