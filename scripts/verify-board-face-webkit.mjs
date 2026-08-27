#!/usr/bin/env node
/**
 * The licensed board faces must PAINT in the same place in WebKit as in
 * Chromium.
 *
 * A Wokwi face is HTML inside a <foreignObject>. When the scaling was a CSS
 * transform on the inner div, WebKit laid it out correctly and painted it
 * somewhere else: in Safari the Arduino appeared up and to the left of its own
 * outline and cropped, so the pins the wires ran to sat in empty space and the
 * board floated above them, unreachable (owner report, 2026-08-28).
 *
 * NOTHING MEASURABLE CAUGHT IT. getBoundingClientRect returned the correct box
 * for the foreignObject, the div, the custom element AND its shadow-root svg —
 * dx, dy, dw all 0.0 — while the screenshot plainly showed the board elsewhere.
 * The layout tree was right and the paint was wrong, so only pixels can tell.
 *
 * Hence this: render the same circuit in both engines, crop the board's own
 * rectangle, and require the two crops to agree. Anti-aliasing and font
 * hinting differ between engines, so the comparison is coarse — it is looking
 * for a board in the wrong PLACE, not for a pixel-perfect match.
 *
 * Usage: node scripts/verify-board-face-webkit.mjs [--port 3179]
 */
import { spawn } from 'node:child_process';
import { chromium, webkit } from 'playwright';
import { inflateSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const portArg = process.argv.indexOf('--port');
const port = portArg > 0 ? Number(process.argv[portArg + 1]) : 3179;

// A bench with a Wokwi-faced board and wires that run to its headers, so a
// displaced face shows up as wires ending in space.
const FIXTURE = {
  vcc: 5,
  parts: [
    { id: 'bb1', kind: 'breadboard', x: 470, y: 330, params: { size: 'full' }, terminals: [] },
    { id: 'uno1', kind: 'arduino_uno', x: 392, y: 150, params: {}, terminals: ['d13', '5v', 'gnd2'] },
    { id: 'led1', kind: 'led', x: 120, y: 150, params: { color: 'red' } },
  ],
  wires: [
    { id: 'w1', from: { part: 'uno1', terminal: 'd13' }, to: { part: 'led1', terminal: 'anode' } },
    { id: 'w2', from: { part: 'uno1', terminal: 'gnd2' }, to: { part: 'led1', terminal: 'cathode' } },
  ],
  holeWires: [], fileOnly: true,
};

const server = spawn('node_modules/.bin/vite', ['--port', String(port), '--strictPort'],
  { cwd: join(here, '..'), stdio: 'ignore' });
const stop = () => { try { server.kill('SIGTERM'); } catch { /* gone */ } };
process.on('exit', stop);

// vite binds ::1 on this machine, so localhost — not 127.0.0.1 — is what
// reaches it. Polling the IPv4 literal reports "did not start" forever.
for (let i = 0; i < 90; i++) {
  try { if ((await fetch(`http://localhost:${port}/`)).ok) break; } catch { /* starting */ }
  if (i === 89) { stop(); throw new Error('vite did not start'); }
  await new Promise(r => setTimeout(r, 250));
}

/** Render the fixture and return a PNG of the board's own rectangle. */
async function shot(engine) {
  const browser = await engine.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await page.goto(`http://localhost:${port}/`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => typeof window.__setCircuitData === 'function');
    await page.evaluate(d => window.__setCircuitData(d), FIXTURE);
    await page.waitForSelector('g[data-board-face="arduino_uno"]');
    await page.waitForTimeout(1200);
    const box = await page.evaluate(() => {
      const r = document.querySelector('g[data-board-face="arduino_uno"] > rect');
      const b = r.getBoundingClientRect();
      return { x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) };
    });
    return { png: await page.screenshot({ clip: box }), box };
  } finally { await browser.close(); }
}

/**
 * Minimal PNG reader for Playwright screenshots: non-interlaced, 8-bit RGBA.
 * Byte length was the first proxy for "is the board painted here" and it is
 * NOT one — the displaced face still left plenty of ink in the crop (ratio
 * 0.86 against a 0.55 threshold), so the guard passed on the very bug it was
 * written for. Only the actual pixels answer the question.
 */
function decodePng(buf) {
  let pos = 8, w = 0, h = 0, colorType = 6;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); colorType = data[9]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  // Playwright emits colour type 2 (RGB, THREE bytes per pixel), not the RGBA
  // I first assumed. With bpp hard-coded to 4 the unfilter walked the rows out
  // of step and every sample came back near-black — which read as "Chromium
  // did not paint the board" on a render that was plainly correct.
  const bpp = colorType === 2 ? 3 : colorType === 6 ? 4 : colorType === 0 ? 1 : 4;
  const stride = w * bpp;
  const out = Buffer.alloc(h * stride);
  let p = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[p++];
    for (let x = 0; x < stride; x++) {
      const cur = raw[p + x];
      const a = x >= bpp ? out[y * stride + x - bpp] : 0;
      const b = y > 0 ? out[(y - 1) * stride + x] : 0;
      const c = (x >= bpp && y > 0) ? out[(y - 1) * stride + x - bpp] : 0;
      let v;
      switch (filter) {
        case 0: v = cur; break;
        case 1: v = cur + a; break;
        case 2: v = cur + b; break;
        case 3: v = cur + ((a + b) >> 1); break;
        case 4: {
          const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
          v = cur + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); break;
        }
        default: v = cur;
      }
      out[y * stride + x] = v & 0xff;
    }
    p += stride;
  }
  return { w, h, data: out, bpp };
}

/** Mean RGB of a small patch, as a fraction of the crop's own dimensions. */
function patch(png, fx, fy, n = 12) {
  const { w, h, data, bpp } = png;
  const cx = Math.round(fx * w), cy = Math.round(fy * h);
  let r = 0, g = 0, b = 0, count = 0;
  for (let y = cy - n; y <= cy + n; y++) {
    for (let x = cx - n; x <= cx + n; x++) {
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const i = (y * w + x) * bpp;
      r += data[i]; g += data[i + 1]; b += data[i + 2]; count++;
    }
  }
  return [Math.round(r / count), Math.round(g / count), Math.round(b / count)];
}

const a = await shot(chromium);
const b = await shot(webkit);
stop();

console.log(`chromium board rect: ${JSON.stringify(a.box)}`);
console.log(`webkit   board rect: ${JSON.stringify(b.box)}`);
const dx = Math.abs(a.box.x - b.box.x), dy = Math.abs(a.box.y - b.box.y);
if (dx > 2 || dy > 2) { console.error(`FAIL: board rect differs (dx=${dx} dy=${dy})`); process.exit(1); }

// Five points inside the board's OWN rectangle. If the face paints where it
// belongs, every one of them lands on the PCB in both engines; a displaced
// face leaves them on the dark canvas.
const POINTS = [[0.5,0.5],[0.25,0.3],[0.75,0.3],[0.25,0.7],[0.75,0.7]];
const pa = decodePng(a.png), pb = decodePng(b.png);
let worst = 0, bad = 0;
for (const [fx, fy] of POINTS) {
  const ca = patch(pa, fx, fy), cb = patch(pb, fx, fy);
  const d = Math.max(Math.abs(ca[0]-cb[0]), Math.abs(ca[1]-cb[1]), Math.abs(ca[2]-cb[2]));
  worst = Math.max(worst, d);
  const flag = d > 40 ? '  <== DIFFERS' : '';
  if (d > 40) bad++;
  console.log(`  (${fx},${fy})  chromium rgb(${ca})  webkit rgb(${cb})  delta=${d}${flag}`);
}
if (bad) {
  console.error(`FAIL: ${bad}/${POINTS.length} points inside the board rect are painted`);
  console.error('      differently by the two engines — the licensed face is landing');
  console.error('      outside its own outline in one of them.');
  process.exit(1);
}
console.log(`OK: the face paints inside its rectangle in both engines (worst delta ${worst}).`);
