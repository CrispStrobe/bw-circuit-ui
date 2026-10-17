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
 * text, and terminal stubs are lines, so none of those count. A kind that adds no body shape over an empty
 * circuit is faceless.
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
const CONTROL = 'bw_census_ghost_control';
const jsonOut = process.argv.includes('--json') ? process.argv[process.argv.indexOf('--json') + 1] : null;

const kinds = [...new Set(readdirSync(dataDir).filter(f => f.endsWith('.json')).map(f => {
  try {
    const sidecar = JSON.parse(readFileSync(new URL(f, dataDir), 'utf8'));
    return sidecar.kind && Array.isArray(sidecar.terminals) && sidecar.terminals.length ? sidecar.kind : null;
  } catch { return null; }
}).filter(Boolean))].sort();

const server = await createServer({root, logLevel: 'error',
  server: {host: '127.0.0.1', port: 3197, strictPort: true}});
await server.listen();
const browser = await chromium.launch();
const faceless = [];
const errors = [];
try {
  const page = await browser.newPage({viewport: {width: 1200, height: 800}});
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto('http://127.0.0.1:3197/', {waitUntil: 'domcontentloaded', timeout: 120000});
  await page.waitForFunction(() => window.__circuit && window.__setCircuitData, null, {timeout: 120000});
  const settle = () => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
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
  const load = async parts => {
    await page.evaluate(parts => window.__setCircuitData({version: 1, parts, wires: []}), parts);
    await page.waitForFunction(n => (window.__circuit?.parts?.length ?? -1) === n, parts.length, {timeout: 20000});
    await settle();
  };
  await load([]);
  const empty = await bodyShapes();
  // Control: a kind no renderer knows must come out faceless, or this census
  // cannot see a ghost at all and its list means nothing.
  await load([{id: 'P1', kind: CONTROL, params: {}, x: 420, y: 320}]);
  const controlAdded = (await bodyShapes()) - empty;
  await load([]);
  if (empty < 0 || controlAdded > 0) {
    throw new Error(`census cannot see a ghost: control kind added ${controlAdded} body shapes (empty canvas ${empty})`);
  }
  for (const kind of kinds) {
    try {
      await load([{id: 'P1', kind, params: {}, x: 420, y: 320}]);
      const added = (await bodyShapes()) - empty;
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
for (const kind of faceless) console.log(`  faceless: ${kind}`);
for (const e of errors) console.log(`  error: ${e}`);
if (jsonOut) writeFileSync(jsonOut, JSON.stringify({kinds: kinds.length, faceless, errors}, null, 2) + '\n');
