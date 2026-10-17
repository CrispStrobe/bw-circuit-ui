#!/usr/bin/env node
/**
 * Part-face census: which part kinds the canvas draws without a body.
 *
 * A kind whose renderer has no body (BoardCanvas's default branch without a
 * DIP_CHIP_LABELS entry) still gets its terminal dots and pin names, so it
 * shows as a "ghost": floating pins around nothing (the STM32F030 in Lite's
 * LED-dimmer example, 2026-10-17; the ATtiny88 before it).
 *
 * Each kind with sidecar terminals is loaded ALONE through the real
 * circuitData path (window.__setCircuitData) and the page's body shapes are
 * counted: rect/path/polygon/polyline/ellipse/image/foreignObject in any
 * svg, plus wokwi-* elements. Terminal dots are circles and pin names are
 * text, and terminal stubs are lines, so none of those count. A kind that
 * adds no body shape over an empty circuit is faceless.
 *
 *   node scripts/census-part-faces.mjs            report only (exit 0)
 *   node scripts/census-part-faces.mjs --json F   also write the list to F
 */
import {readdirSync, readFileSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import {chromium} from 'playwright';

const root = fileURLToPath(new URL('../', import.meta.url));
const dataDir = new URL('../src/parts-data/', import.meta.url);
const jsonOut = process.argv.includes('--json') ? process.argv[process.argv.indexOf('--json') + 1] : null;

// kind -> terminal names. A loaded part carries its terminals, as the
// shipping save format does: without them the canvas drew nothing even for
// a resistor (calibration run 3: resistor, led and battery all added 0).
const terminalsOf = new Map();
for (const f of readdirSync(dataDir).filter(f => f.endsWith('.json'))) {
  try {
    const sidecar = JSON.parse(readFileSync(new URL(f, dataDir), 'utf8'));
    if (sidecar.kind && Array.isArray(sidecar.terminals) && sidecar.terminals.length && !terminalsOf.has(sidecar.kind)) {
      terminalsOf.set(sidecar.kind, sidecar.terminals.map(t => t.name));
    }
  } catch { /* not a sidecar */ }
}
const kinds = [...terminalsOf.keys()].sort();
const partOf = kind => ({id: 'P1', kind, params: {}, x: 420, y: 320, terminals: terminalsOf.get(kind) || ['a', 'b']});

const server = await createServer({root, logLevel: 'error',
  server: {host: '127.0.0.1', port: 3197, strictPort: true}});
await server.listen();
const browser = await chromium.launch();
const faceless = [];
const counts = [];
const errors = [];
try {
  const page = await browser.newPage({viewport: {width: 1200, height: 800}});
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto('http://127.0.0.1:3197/', {waitUntil: 'domcontentloaded', timeout: 120000});
  await page.waitForFunction(() => window.__circuit && window.__setCircuitData, null, {timeout: 120000});
  // Only the canvas counts: the largest svg on the page. Counting the whole
  // document let panels that react to ANY loaded part (inspector, lists)
  // supply "body" shapes, and the first CI run reported 0 of 287 faceless.
  const bodyShapes = () => page.evaluate(() => {
    const svgs = [...document.querySelectorAll('svg')].filter(svg => !svg.parentElement?.closest('svg'));
    const area = svg => { const r = svg.getBoundingClientRect(); return r.width * r.height; };
    const canvas = svgs.sort((a, b) => area(b) - area(a))[0];
    if (!canvas) return -1;
    return canvas.querySelectorAll('rect, path, polygon, polyline, ellipse, image, foreignObject').length
      + [...document.querySelectorAll('*')].filter(e => e.tagName.startsWith('WOKWI-')).length;
  });
  // Drawing a loaded part takes about a second (measured ~1.3 s); a fixed
  // two-frame wait sampled an undrawn canvas and listed every kind. Wait
  // until the canvas element count holds steady for a second.
  const canvasSize = () => page.evaluate(() => {
    const svgs = [...document.querySelectorAll('svg')].filter(svg => !svg.parentElement?.closest('svg'));
    const area = svg => { const r = svg.getBoundingClientRect(); return r.width * r.height; };
    const canvas = svgs.sort((x, y) => area(y) - area(x))[0];
    return (canvas ? canvas.querySelectorAll('*').length : 0)
      + [...document.querySelectorAll('*')].filter(e => e.tagName.startsWith('WOKWI-')).length;
  });
  const load = async parts => {
    await page.evaluate(parts => window.__setCircuitData({version: 1, parts, wires: []}), parts);
    await page.waitForFunction(n => (window.__circuit?.parts?.length ?? -1) === n, parts.length, {timeout: 20000});
    let last = -1, steady = 0;
    for (const started = Date.now(); Date.now() - started < 10000 && steady < 4;) {
      await page.waitForTimeout(250);
      const now = await canvasSize();
      steady = now === last ? steady + 1 : 0;
      last = now;
    }
  };
  await load([]);
  const empty = await bodyShapes();
  // Control: a kind no renderer knows must come out faceless, or this census
  // cannot see a ghost at all and its list means nothing.
  // Positive control: a resistor has a body (a wokwi-resistor). If it reads
  // as faceless the census is measuring an undrawn canvas.
  await load([partOf('resistor')]);
  const resistorAdded = (await bodyShapes()) - empty;
  await load([]);
  if (empty < 0 || resistorAdded <= 0) {
    throw new Error(`census sees no body even for a resistor (added ${resistorAdded}, empty canvas ${empty})`);
  }
  for (const kind of kinds) {
    try {
      await load([partOf(kind)]);
      const added = (await bodyShapes()) - empty;
      counts.push([kind, added]);
      if (added <= 0) faceless.push(kind);
    } catch (e) {
      errors.push(`${kind}: ${e.message.split('\n')[0]}`);
    }
    await load([]);
  }
} finally {
  await browser.close();
  await server.close();
}
console.log(`part-face census: ${kinds.length} kinds, ${faceless.length} drawn without a body`);
console.log('fewest added shapes: ' + counts.sort((a, b) => a[1] - b[1]).slice(0, 40).map(([k, n]) => `${k}=${n}`).join(' '));
for (const kind of faceless) console.log(`  faceless: ${kind}`);
for (const e of errors) console.log(`  error: ${e}`);
if (jsonOut) writeFileSync(jsonOut, JSON.stringify({kinds: kinds.length, faceless, errors}, null, 2) + '\n');
