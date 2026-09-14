/**
 * The foreign-deck sweep RUNNER, not the judge.
 *
 * `judgeForeignDeck` has its own tests in `spice-foreign-deck.test.js`. This
 * covers the driver around it, because every ADI number this programme has
 * reported came from a throwaway script in /tmp until the driver was promoted —
 * and an uncommitted, untested runner is a measurement nobody can reproduce.
 *
 * What is asserted here is the runner's CONTRACT, which is what a peer reusing
 * it depends on:
 *
 *   - a directory of `.cir` files and a JSONL corpus both work;
 *   - one row per deck, appended, so a kill loses at most the row in flight;
 *   - a re-run RESUMES and judges nothing twice — and says how many it skipped,
 *     which is the line that stops a stale file reading as a fresh result;
 *   - the exit summary's agree count matches the rows on disk.
 *
 * The fixture is self-authored. No corpus row is redistributable, and a private
 * path in a test would make the suite pass or fail on what is mounted.
 */
import './_setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { haveNgspice } from '../scripts/spice-oracle.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const RUNNER = join(HERE, '..', 'scripts', 'foreign-deck-sweep.mjs');
const FIXTURE_DIR = join(HERE, 'fixtures');
const SKIP = haveNgspice() ? false : 'ngspice not installed';

const run = (args) => spawnSync(process.execPath, [RUNNER, ...args], { encoding: 'utf8' });
const rows = (f) => readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);

test('refuses without a corpus path, by name', () => {
  const r = run([]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /usage: foreign-deck-sweep/);
});

test('a directory of .cir files sweeps, and the cascode agrees',
  { skip: SKIP }, () => {
    const dir = mkdtempSync(join(tmpdir(), 'fds-'));
    try {
      const out = join(dir, 'r.jsonl');
      const r = run([FIXTURE_DIR, '--out', out]);
      assert.equal(r.status, 0, r.stderr);
      const got = rows(out);
      assert.ok(got.length >= 1, `no rows written:\n${r.stderr}`);
      const cascode = got.find(x => /foreign-cascode/.test(x.id));
      assert.ok(cascode, `the fixture was not swept: ${got.map(x => x.id).join(', ')}`);
      assert.equal(cascode.ok, true,
        `the self-authored cascode must agree with ngspice: ${JSON.stringify(cascode)}`);
      assert.ok(cascode.compared >= 4,
        `only ${cascode.compared} node(s) compared — a pass on nothing is not a pass`);
      // The summary and the file must say the same thing.
      const agreed = got.filter(x => x.ok).length;
      assert.match(r.stderr, new RegExp(`${agreed} agree`));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

test('a JSONL corpus sweeps, and --limit is honoured', { skip: SKIP }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'fds-'));
  try {
    const deck = readFileSync(join(FIXTURE_DIR, 'foreign-cascode.cir'), 'utf8');
    const corpus = join(dir, 'corpus.jsonl');
    // Three rows, the middle one using ` | ` for newlines the way the ADI sets
    // ship a deck inside one JSON string.
    writeFileSync(corpus, [
      JSON.stringify({ output: deck }),
      JSON.stringify({ output: deck.split('\n').join(' | ') }),
      JSON.stringify({ output: deck }),
    ].join('\n') + '\n');

    const out = join(dir, 'r.jsonl');
    const r = run([corpus, '--out', out, '--limit', '2']);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(rows(out).length, 2, '--limit did not bound the run');
    // The ` | ` row must read as the same circuit as the plain one.
    assert.deepEqual(rows(out).map(x => x.ok), [true, true],
      `a pipe-joined deck must import identically: ${JSON.stringify(rows(out))}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a re-run resumes and judges nothing twice', { skip: SKIP }, () => {
  // THE TRAP THIS CLOSES. A resumable writer cannot tell "finished" from
  // "already there". Reusing a filled --out once printed `resuming: 2163 rows`
  // and `0 judged`, and reading only the JSONL made that look like a
  // fourteen-point regression that had not happened. The runner says what it
  // skipped; this asserts it says so.
  const dir = mkdtempSync(join(tmpdir(), 'fds-'));
  try {
    const out = join(dir, 'r.jsonl');
    const first = run([FIXTURE_DIR, '--out', out]);
    assert.equal(first.status, 0, first.stderr);
    const before = rows(out);
    assert.ok(before.length >= 1);

    const second = run([FIXTURE_DIR, '--out', out]);
    assert.equal(second.status, 0, second.stderr);
    assert.match(second.stderr, new RegExp(`resuming: ${before.length} row`),
      'a resumed run did not report how many rows it skipped');
    assert.match(second.stderr, /^0 judged/m,
      'a resumed run judged decks it had already judged');
    assert.deepEqual(rows(out), before, 'the resumed run rewrote rows');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a JSONL row with no deck field is refused by name, not skipped',
  { skip: SKIP }, () => {
    // A row that quietly vanishes is a denominator that quietly shrinks.
    const dir = mkdtempSync(join(tmpdir(), 'fds-'));
    try {
      const corpus = join(dir, 'corpus.jsonl');
      writeFileSync(corpus, JSON.stringify({ notADeck: 'x' }) + '\n');
      const out = join(dir, 'r.jsonl');
      const r = run([corpus, '--out', out]);
      assert.equal(r.status, 0, r.stderr);
      assert.ok(existsSync(out), 'no row was written for a deckless corpus row');
      const got = rows(out);
      assert.equal(got.length, 1);
      assert.equal(got[0].ok, false);
      assert.match(got[0].reason, /no output field/);
      assert.match(r.stderr, /1 had no deck/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
