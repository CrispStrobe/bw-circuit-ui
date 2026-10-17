#!/usr/bin/env node
/**
 * Part-face census: which part kinds the canvas draws as a "ghost" (terminal
 * dots and pin names, but no body).
 *
 * A kind whose renderer has no body (BoardCanvas's default branch without a
 * DIP_CHIP_LABELS entry) still gets its terminal dots and pin names, so it
 * shows as floating pins around nothing (the STM32F030 in Lite's LED-dimmer
 * example, 2026-10-17; the ATtiny88 before it).
 *
 * Loading. Each kind is loaded ALONE through the real circuitData path
 * (window.__setCircuitData) with its sidecar terminals and a part id unique
 * to that load. Reusing one id for every load (the first version used 'P1')
 * left the previous kind's drawing on the canvas, so most kinds were never
 * drawn at all and every one read as bodiless.
 *
 * Measuring. The canvas is the svg beside the wokwi element layer (the first
 * version took "the largest svg", which is a background layer that holds no
 * parts). A part's terminal dots carry data-terminal-dot and its terminal
 * stubs data-terminal-stub; everything else it adds is body:
 *   body = drawable svg elements (rect, path, polygon, polyline, ellipse,
 *          line, circle, text, image, use, foreignObject) in the canvas that
 *          are not inside a terminal dot, terminal stub or DRC warning badge
 *          (data-drc-badge: the unknown-kind baseline gets one), plus every
 *          element in the
 *          wokwi layer, minus the same count for a baseline part of an unknown kind.
 * A part with no body is then selected (Ctrl+A) so that many-pin parts,
 * which hide idle dots, show them too:
 *   ghost          body 0, at least one terminal dot drawn
 *   draws nothing  body 0, no terminal dot either
 *
 *   node scripts/census-part-faces.mjs                  report only (exit 0)
 *   node scripts/census-part-faces.mjs --json F         also write lists to F
 *   node scripts/census-part-faces.mjs --shots DIR      clip of each listed kind
 *   node scripts/census-part-faces.mjs --kinds a,b,c    only these kinds
 */
import {mkdirSync, readdirSync, readFileSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import {chromium} from 'playwright';

const arg = name => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : null);
const root = fileURLToPath(new URL('../', import.meta.url));
const dataDir = new URL('../src/parts-data/', import.meta.url);
const jsonOut = arg('--json');
const shotDir = arg('--shots');
const port = Number(arg('--port') || 3201);
if (shotDir) mkdirSync(shotDir, {recursive: true});

// kind -> terminal names, as the shipping save format carries them.
const terminalsOf = new Map();
for (const f of readdirSync(dataDir).filter(f => f.endsWith('.json'))) {
  try {
    const sidecar = JSON.parse(readFileSync(new URL(f, dataDir), 'utf8'));
    if (sidecar.kind && Array.isArray(sidecar.terminals) && sidecar.terminals.length && !terminalsOf.has(sidecar.kind)) {
      terminalsOf.set(sidecar.kind, sidecar.terminals.map(t => t.name));
    }
  } catch { /* not a sidecar */ }
}
const only = arg('--kinds');
const kinds = only ? only.split(',') : [...terminalsOf.keys()].sort();
let serial = 0;
const partOf = kind => ({id: `census${++serial}`, kind, params: {}, x: 420, y: 320,
  terminals: terminalsOf.get(kind) || ['a', 'b']});

const server = await createServer({root, logLevel: 'error',
  server: {host: '127.0.0.1', port, strictPort: true}});
await server.listen();
const browser = await chromium.launch();
const ghost = [], nothing = [], counts = [], errors = [];
try {
  const page = await browser.newPage({viewport: {width: 1200, height: 800}});
  page.on('pageerror', e => errors.push(String(e).split('\n')[0]));
  await page.goto(`http://127.0.0.1:${port}/`, {waitUntil: 'domcontentloaded', timeout: 300000});
  await page.waitForFunction(() => window.__circuit && window.__setCircuitData, null, {timeout: 300000});

  // {body, dots, n, box}: n is a whole-canvas element count for the
  // steadiness wait; box is the screen box of this part's dots.
  const measure = id => page.evaluate(id => {
    const layer = document.querySelector('[data-wokwi-layer]');
    if (!layer) return null;
    const area = el => { const r = el.getBoundingClientRect(); return r.width * r.height; };
    const canvas = [...layer.parentElement.querySelectorAll(':scope > svg')].sort((a, b) => area(b) - area(a))[0];
    if (!canvas) return null;
    const drawable = [...canvas.querySelectorAll('rect, path, polygon, polyline, ellipse, line, circle, text, image, use, foreignObject')];
    const body = drawable.filter(e => !e.closest('[data-terminal-dot], [data-terminal-stub], [data-drc-badge]')).length
      + layer.querySelectorAll('*').length;
    // (body is relative: the caller subtracts the baseline part's count)
    const dots = [...canvas.querySelectorAll('[data-terminal-dot]')].filter(e => e.dataset.terminalDot.startsWith(id + ':'));
    let box = null;
    for (const d of dots) {
      const r = d.getBoundingClientRect();
      box = box ? {l: Math.min(box.l, r.left), t: Math.min(box.t, r.top), r: Math.max(box.r, r.right), b: Math.max(box.b, r.bottom)}
        : {l: r.left, t: r.top, r: r.right, b: r.bottom};
    }
    return {body, dots: dots.length, n: canvas.querySelectorAll('*').length + layer.querySelectorAll('*').length, box};
  }, id);
  // Drawing takes about a second; wait until the count holds for a second.
  const settle = async id => {
    let last = -1, steady = 0, m = null;
    for (const started = Date.now(); Date.now() - started < 10000 && steady < 4;) {
      await page.waitForTimeout(250);
      m = await measure(id);
      const now = m ? m.n : -1;
      steady = now === last ? steady + 1 : 0;
      last = now;
    }
    return m;
  };
  const load = async parts => {
    await page.evaluate(parts => window.__setCircuitData({version: 1, parts, wires: []}), parts);
    await page.waitForFunction(ids => JSON.stringify((window.__circuit?.parts || []).map(p => p.id)) === ids,
      JSON.stringify(parts.map(p => p.id)), {timeout: 20000});
    return settle(parts[0]?.id ?? '-');
  };
  const selectAll = async id => {
    await page.mouse.click(260, 760); // empty canvas corner: focus, deselect
    await page.keyboard.press('Control+a');
    return settle(id);
  };

  // Baseline: one part of a kind no renderer knows. It takes the bodiless
  // default branch by construction, and it also removes the empty-canvas
  // hint that a bare empty canvas would count.
  const unknown = {...partOf('census_no_such_kind'), terminals: ['a', 'b']};
  const base = await load([unknown]);
  const empty = base.body;
  if (!(base.dots > 0)) throw new Error(`baseline part drew no terminal dots (${base.dots})`);
  const classify = async kind => {
    const part = partOf(kind);
    const m = await load([part]);
    const body = m.body - empty;
    let {dots, box} = m;
    if (body <= 0) ({dots, box} = await selectAll(part.id));
    return {part, body, dots, box};
  };
  // Controls: a resistor (wokwi body) and a capacitor (line-only schematic
  // symbol) both have bodies. If either reads bodiless the census is
  // measuring an undrawn canvas or miscounting, and its list means nothing.
  for (const control of ['resistor', 'capacitor']) {
    const {body} = await classify(control);
    if (body <= 0) throw new Error(`census sees no body for the ${control} control (added ${body})`);
  }

  for (const kind of kinds) {
    try {
      const {body, dots, box} = await classify(kind);
      counts.push([kind, body, dots]);
      if (body <= 0) {
        (dots > 0 ? ghost : nothing).push(kind);
        if (shotDir) {
          const cx = box ? (box.l + box.r) / 2 : 700, cy = box ? (box.t + box.b) / 2 : 425;
          const w = Math.min(560, Math.max(240, box ? box.r - box.l + 80 : 240)), h = Math.min(560, Math.max(200, box ? box.b - box.t + 80 : 200));
          await page.screenshot({path: `${shotDir}/${dots > 0 ? 'ghost' : 'nothing'}-${kind}.png`,
            clip: {x: Math.max(0, cx - w / 2), y: Math.max(0, cy - h / 2), width: w, height: h}});
        }
      }
    } catch (e) {
      errors.push(`${kind}: ${e.message.split('\n')[0]}`);
    }
  }
} finally {
  await browser.close();
  await server.close();
}
console.log(`part-face census: ${kinds.length} kinds, ${ghost.length} ghosts, ${nothing.length} draw nothing`);
console.log('fewest added body elements: ' + counts.sort((a, b) => a[1] - b[1]).slice(0, 30).map(([k, n]) => `${k}=${n}`).join(' '));
for (const kind of ghost) console.log(`  ghost: ${kind}`);
for (const kind of nothing) console.log(`  draws nothing: ${kind}`);
for (const e of errors) console.log(`  error: ${e}`);
if (jsonOut) writeFileSync(jsonOut, JSON.stringify({kinds: kinds.length, ghost, nothing, errors}, null, 2) + '\n');
