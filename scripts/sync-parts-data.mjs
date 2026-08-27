#!/usr/bin/env node
// Vendor bw-parts sidecar JSONs into src/parts-data/ — the same vendoring
// contract the rest of the ecosystem uses. Source of truth stays bw-parts;
// this repo carries a synced copy so the loader can import it eagerly and
// production bundles need no external fetch.
//
//   node scripts/sync-parts-data.mjs [--dir ../bw-parts] [--check]
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const dirIdx = args.indexOf('--dir');
const src = join(HERE, '..', dirIdx !== -1 ? args[dirIdx + 1] : '../bw-parts', 'parts');
const dst = join(HERE, '..', 'src', 'parts-data');
const check = args.includes('--check');

if (!existsSync(src)) {
  console.error(`sync-parts-data: source not found: ${src}`);
  process.exit(1);
}
mkdirSync(dst, { recursive: true });
// Delete files that no longer exist upstream (handles renames).
// A sync that only copies forward leaves both old and new names in place.
/**
 * Sidecars bw-parts carries that the DESIGNER deliberately does not offer.
 *
 * A sidecar here becomes a palette entry, and a palette entry with no engine
 * device empties the board the moment someone seats it — which is what
 * test/palette-engine-coverage.test.js exists to prevent, and why its
 * KNOWN_GAPS list is empty rather than a place to park things. bw-parts is
 * the wider catalogue on purpose: it holds parts that are drawable but not
 * yet modelled, and PARTS-CATALOG.md marks them so.
 *
 * Remove a line here in the same commit that gives the kind an engine device.
 */
const NOT_OFFERED = new Map([
  ['ads1115.json', 'no engine device — 4-channel I2C ADC, drawable only'],
  ['max6675.json', 'no engine device — thermocouple front end, drawable only'],
  ['microbit_arcade.json', 'no engine device — a board, not a component'],
  ['seven_seg_8.json', 'no engine device; the engine models `sevenseg8`, the decoded 13-pin '
    + 'variant, and this is the raw 16-pin one with eight separate commons'],
]);

/**
 * Sidecars the designer DOES offer, but whose upstream terminal NAMES disagree
 * with the engine. Copying them renames pins under every circuit that uses the
 * part: taking char_lcd's upstream names broke the PRECHIN-A2 board preset,
 * which wires lcd.vcc where bw-parts now says vdd. Held at the designer's
 * copy until someone reconciles engine, sidecar and circuits together — the
 * same drift test/terminal-crosscheck.test.js counts per kind.
 *
 * These stay in the index and are NOT stale-swept; only the copy is skipped.
 */
const HELD_BACK = new Map([
  ['char_lcd.json', 'upstream says vss/vdd/v0/a/k; the engine says gnd/vcc/vo/bl_a/bl_k'],
  ['simplevga_card.json', 'upstream has dropped the `bank` terminal the engine still has'],
]);

const skip = (f) => NOT_OFFERED.has(f) || NOT_OFFERED.has(f.replace(/\.svg$/, '.json'));
const held = (f) => HELD_BACK.has(f);

const upstreamJsons = new Set(readdirSync(src).filter(f => f.endsWith('.json') && !skip(f)));
const upstreamSvgs = new Set(readdirSync(src).filter(f => f.endsWith('.svg') && !skip(f)));
let deleted = 0;
if (!check) {
  for (const f of readdirSync(dst).filter(f => f.endsWith('.json'))) {
    if (!upstreamJsons.has(f)) { unlinkSync(join(dst, f)); deleted++; }
  }
  for (const f of readdirSync(dst).filter(f => f.endsWith('.svg'))) {
    if (!upstreamSvgs.has(f)) { unlinkSync(join(dst, f)); deleted++; }
  }
}
let changed = 0, total = 0;
for (const f of readdirSync(src).filter(f => f.endsWith('.json') && !skip(f))) {
  total++;
  if (held(f)) continue;
  const body = readFileSync(join(src, f), 'utf8');
  JSON.parse(body); // refuse to vendor broken JSON
  const target = join(dst, f);
  const prev = existsSync(target) ? readFileSync(target, 'utf8') : null;
  if (prev !== body) {
    changed++;
    if (!check) writeFileSync(target, body);
  }
}
// Also vendor SVG art files — same sync, same check
let svgChanged = 0, svgTotal = 0;
for (const f of readdirSync(src).filter(f => f.endsWith('.svg') && !skip(f))) {
  svgTotal++;
  const body = readFileSync(join(src, f), 'utf8');
  const target = join(dst, f);
  const prev = existsSync(target) ? readFileSync(target, 'utf8') : null;
  if (prev !== body) {
    svgChanged++;
    if (!check) writeFileSync(target, body);
  }
}
// Copy provenance files so licensing travels with the art
for (const prov of ['ART-PROVENANCE.md', 'THIRD-PARTY.md']) {
  const provSrc = join(src, '..', prov);
  if (existsSync(provSrc)) {
    const body = readFileSync(provSrc, 'utf8');
    const target = join(dst, prov);
    const prev = existsSync(target) ? readFileSync(target, 'utf8') : null;
    if (prev !== body) { if (!check) writeFileSync(target, body); }
  }
}
// Emit a static import index: works under ANY bundler (vite, webpack, esbuild)
// - import.meta.glob is a vite-ism and lite builds with webpack.
if (!check) {
  const files = readdirSync(dst).filter(f => f.endsWith('.json')).sort();
  const lines = [
    '// GENERATED by scripts/sync-parts-data.mjs - do not edit.',
    '// Static imports so every bundler can resolve them; no vite-isms here.',
    ...files.map((f, i) => `import s${i} from './${f}';`),
    '',
    `export const SIDECARS = [${files.map((_, i) => `s${i}`).join(', ')}];`,
    '',
  ];
  writeFileSync(join(dst, 'index.js'), lines.join('\n'));
}

if (check && changed > 0) {
  console.error(`sync-parts-data --check: ${changed}/${total} sidecars drifted — re-run the sync`);
  process.exit(1);
}
console.log(`sync-parts-data: ${total} sidecars (${changed} ${check ? 'drifted' : 'updated'}), ${svgTotal} SVGs (${svgChanged} ${check ? 'drifted' : 'updated'}), ${deleted} stale files removed`);
