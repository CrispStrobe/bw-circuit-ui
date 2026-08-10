#!/usr/bin/env node
// Vendor bw-parts sidecar JSONs into src/parts-data/ — the same vendoring
// contract the rest of the ecosystem uses. Source of truth stays bw-parts;
// this repo carries a synced copy so the loader can import it eagerly and
// production bundles need no external fetch.
//
//   node scripts/sync-parts-data.mjs [--dir ../bw-parts] [--check]
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
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
let changed = 0, total = 0;
for (const f of readdirSync(src).filter(f => f.endsWith('.json'))) {
  total++;
  const body = readFileSync(join(src, f), 'utf8');
  JSON.parse(body); // refuse to vendor broken JSON
  const target = join(dst, f);
  const prev = existsSync(target) ? readFileSync(target, 'utf8') : null;
  if (prev !== body) {
    changed++;
    if (!check) writeFileSync(target, body);
  }
}
if (check && changed > 0) {
  console.error(`sync-parts-data --check: ${changed}/${total} sidecars drifted — re-run the sync`);
  process.exit(1);
}
console.log(`sync-parts-data: ${total} sidecars, ${changed} ${check ? 'drifted' : 'updated'}`);
