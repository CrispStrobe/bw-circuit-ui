#!/usr/bin/env node
/**
 * Run a whole corpus of circuits through ngspice and our engine, and record
 * every disagreement.
 *
 * WHY THIS EXISTS. `scripts/spice-oracle.mjs` judges 16 hand-written cases and
 * judges them well — but 16 cases chosen by the person who wrote the exporter
 * cover the shapes that person thought of. Measured before this file: about 107
 * circuits had ever been compared to ngspice against ~1,673 runnable, roughly
 * 6 %, and only 14 of those ran per push. The A/B sweep in
 * `circuit-oracle-corpora` that looked like coverage is our engine against our
 * engine across a version bump — a delta, not an oracle.
 *
 * This reuses `judgeCase` rather than reimplementing the comparison, so the
 * corpus and the 16 cases are judged by ONE set of tolerances and one structural
 * floor. A second judge would drift from the first and the drift would look like
 * a corpus finding.
 *
 * THE ORACLING IS THE DOUBLE-CHECK. Nothing here writes an expected value. A
 * circuit inside tolerance needs no recorded number; one outside it is a defect
 * to fix, and the row says which node and by how much.
 *
 * DURABILITY: one `appendFileSync` per circuit, deliberately. A buffered writer
 * cost a false "this circuit hangs" diagnosis on an earlier sweep — the process
 * was killed and the buffer went with it, so the last-written row named an
 * innocent circuit. Killing this mid-run loses at most the row in flight, and
 * a re-run resumes from what survived.
 *
 *   node scripts/oracle-sweep.mjs <dir-or-glob> [--out results.jsonl] [--limit N]
 *
 * Skips nothing silently: a circuit that cannot be built, exported or simulated
 * gets a row with a `reason`, because the population of failures IS the gap
 * list this exercise is for.
 */
import { readFileSync, appendFileSync, existsSync, mkdtempSync, readdirSync, statSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { judgeCase, haveNgspice } from './spice-oracle.mjs';

// drivePins: a gallery circuit ships with no program run, so every MCU pin is
// high-Z and 127 of 2,163 decks had no source at all. See judgeCase's note.

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const root = args.find(a => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--out'
  && args[args.indexOf(a) - 1] !== '--limit');
if (!root) { console.error('usage: oracle-sweep.mjs <dir> [--out f.jsonl] [--limit N]'); process.exit(2); }
const out = opt('--out', 'oracle-sweep.jsonl');
const limit = Number(opt('--limit', '0')) || Infinity;

if (!haveNgspice()) {
  // BY NAME, never a bare skip: an absent oracle that exits 0 quietly is how a
  // whole comparison goes missing without anyone seeing a line change.
  console.error('ngspice not found on PATH — install it (apt install ngspice). Refusing to '
    + 'report a sweep that measured nothing.');
  process.exit(1);
}

/** Every circuit JSON under `root`, recursively. */
function circuitFiles(dir) {
  const found = [];
  const walk = (d) => {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else if (/^circuit.*\.json$/.test(e)) found.push(p);
    }
  };
  walk(dir);
  return found.sort();
}

const done = new Set();
if (existsSync(out)) {
  for (const l of readFileSync(out, 'utf8').split('\n')) {
    if (!l.trim()) continue;
    try { done.add(JSON.parse(l).file); } catch { /* torn last row: re-run it */ }
  }
  console.error(`resuming: ${done.size} row(s) already recorded in ${out}`);
}

const files = circuitFiles(root).filter(f => !done.has(f)).slice(0, limit);
console.error(`${files.length} circuit(s) to judge`);

const dir = mkdtempSync(join(tmpdir(), 'oracle-sweep-'));
let n = 0, ok = 0, bad = 0, threw = 0;
for (const f of files) {
  n++;
  const name = `${basename(dirname(f))}/${basename(f)}`;
  // judgeCase writes its deck to `<dir>/<name>.cir`, so a name with a path
  // separator asks it to write into a directory that does not exist. Keep the
  // readable name for the row and hand the judge a flat one.
  const deckName = name.replace(/[^A-Za-z0-9._-]+/g, '_');
  let row;
  try {
    const json = JSON.parse(readFileSync(f, 'utf8'));
    const r = judgeCase(deckName, json, dir, { drivePins: true });
    row = { file: f, name, ok: r.ok, compared: r.compared ?? 0, reason: r.reason ?? null,
      worstAbs: r.worstAbs ?? null, worstRel: r.worstRel ?? null, worstAt: r.worstAt ?? null };
    if (r.ok) ok++; else { bad++; row.lines = r.lines.slice(0, 12); }
  } catch (e) {
    threw++;
    row = { file: f, name, ok: false, compared: 0, reason: 'threw: ' + String(e && e.message || e).slice(0, 200) };
  }
  appendFileSync(out, JSON.stringify(row) + '\n');
  if (n % 25 === 0) console.error(`  ${n}/${files.length}  ok=${ok} disagree=${bad} threw=${threw}`);
}
console.error(`\n${n} judged: ${ok} agree, ${bad} disagree, ${threw} could not be judged`);
console.error(`rows: ${out}   decks: ${dir}`);
