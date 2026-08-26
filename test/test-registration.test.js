/**
 * EVERY TEST FILE MUST BE RUN BY SOMETHING.
 *
 * `npm test` in this repo enumerates its files explicitly, one long literal
 * list. A test file that is not in that list does not run, does not fail, and
 * does not appear anywhere as missing — it is simply absent from the count,
 * and the count still looks healthy. Measured on 2026-08-25:
 *
 *     17 test files in no npm script and no CI job
 *     87 tests inside them, 5 of which were FAILING
 *
 * Two of those five had been failing since a byte-window scrape stopped
 * covering code that had merely moved; one was an extractor and a machine
 * preset disagreeing about a chip's decode window. None of it was visible.
 *
 * Worse, three whole SCRIPTS — test:boards, test:render, test:a2 — existed and
 * CI invoked none of them, so ten more files were gated on someone
 * remembering. And `easyeda-export.test.js`, whose 2,098-circuit export /
 * re-import round trip docs/SCHEMATIC-AUDIT.md cites as evidence, was BOTH
 * unregistered AND resolving its corpus from a `$HOME/...` path that exists on
 * no machine, so it skipped even when run by hand. That gate had never
 * executed anywhere.
 *
 * This file is the structural fix. Adding a test file is now the only thing
 * you have to do; forgetting to register it fails here, by name.
 *
 * @module
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { vacuousTests, tautologicalTests } from './_vacuity.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..');

/**
 * Files CI deliberately does NOT run, each with the reason.
 *
 * A browser suite needs `npx playwright install`, which is minutes of runner
 * time per build for tests whose failures are visual. They are registered as
 * `npm run test:browser` so they can be run deliberately, and they are named
 * here so "CI does not run them" is a decision on the record rather than an
 * accident nobody can see. If a name leaves this list it must gain a CI step.
 */
const NOT_IN_CI = new Map([
  ['test/debug-status.test.js', 'hard-imports playwright'],
  ['test/e2e.test.js', 'hard-imports playwright'],
  ['test/rendering.test.js', 'hard-imports playwright'],
  ['test/snapshot-render.test.js', 'hard-imports playwright'],
  // These five LOOK safe for `npm test`: they wrap the import in try/catch and
  // skip on `!chromium`. That guard asks whether the PACKAGE is importable,
  // not whether a BROWSER exists — and CI runs `npm install`, which installs
  // playwright (a devDependency) without downloading browsers. So in CI the
  // guard passes, the suite runs, and `chromium.launch()` throws. Registering
  // them into `npm test` would have turned CI red; caught before pushing by
  // reading the guard rather than trusting that it skipped here.
  ['test/faces.test.js', 'skip guard tests the package, not the browser'],
  ['test/serial-console.test.js', 'skip guard tests the package, not the browser'],
  ['test/snapshot-drop.test.js', 'skip guard tests the package, not the browser'],
  ['test/tilevga-face.test.js', 'skip guard tests the package, not the browser'],
  ['test/vdp-keyboard.test.js', 'skip guard tests the package, not the browser'],
  // These two were inside `test:render`, which this lane wired into CI — and
  // CI went red on them for exactly the reason recorded above. They were
  // missed because the detector for "needs a browser" grepped two literal
  // IMPORT forms, and these reach playwright another way. The list is now
  // derived from what a file does (`*.launch(`) rather than how it imports,
  // and the invariant below makes the whole class impossible.
  ['test/mcu-device-label.test.js', 'launches a browser'],
  ['test/pendant-attiny88.test.js', 'launches a browser'],
]);

/**
 * Nothing CI runs may launch a browser.
 *
 * This is the guard that would have caught the mistake above. `npm install`
 * installs playwright without downloading browsers, so a launch in CI throws —
 * and locally, where playwright is absent entirely, the same file skips and
 * looks healthy. Reading the import line is not enough: a file can reach
 * playwright several ways, and two did. What cannot be disguised is the
 * launch itself.
 */
const LAUNCHES_BROWSER = /(?:chromium|firefox|webkit|browserType)\s*\.\s*launch\s*\(/;

const scripts = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf-8')).scripts;

/**
 * The COMMANDS in the workflow, not its prose.
 *
 * The first version of this gate matched `npm (run )?<name>` against the whole
 * file — and the explanatory comment two steps above, which mentions
 * "`npm run test:browser`", counted as CI running the browser suite. The gate
 * then reported every file as covered. A detector that reads text which
 * merely LOOKS like a command is the same mistake as a detector that reads a
 * `data-testid` as a storage key, and it happened here while writing the gate
 * against exactly that failure. So: only the value of a `run:` key, block
 * scalars included, and comments stripped.
 */
function workflowCommands (yaml) {
  const out = [];
  let blockIndent = null;
  for (const raw of yaml.split('\n')) {
    const line = raw.replace(/#.*$/, '');
    if (blockIndent !== null) {
      const indent = line.match(/^\s*/)[0].length;
      if (line.trim() && indent <= blockIndent) blockIndent = null;
      else { out.push(line); continue; }
    }
    const m = /^(\s*)(?:-\s*)?run:\s*(.*)$/.exec(line);
    if (!m) continue;
    if (m[2].trim() === '|' || m[2].trim() === '>') blockIndent = m[1].length;
    else out.push(m[2]);
  }
  return out.join('\n');
}

const workflow = workflowCommands(
  readFileSync(path.join(ROOT, '.github/workflows/ci.yml'), 'utf-8'));
const testFile = /test\/[\w.-]+\.test\.[a-z]+/g;
const filesIn = (text) => new Set(String(text).match(testFile) || []);

/** Every test file a given npm script runs, following `npm run` indirection. */
function filesRunBy (scriptName, seen = new Set()) {
  if (seen.has(scriptName) || !scripts[scriptName]) return new Set();
  seen.add(scriptName);
  const body = scripts[scriptName];
  const out = filesIn(body);
  for (const m of body.matchAll(/npm run ([\w:-]+)/g)) {
    for (const f of filesRunBy(m[1], seen)) out.add(f);
  }
  return out;
}

describe('every test file is run by something', () => {
  const onDisk = readdirSync(path.join(ROOT, 'test'))
    .filter((f) => /\.test\.(js|mjs)$/.test(f))
    .map((f) => `test/${f}`)
    .sort();

  const inScripts = new Set();
  for (const name of Object.keys(scripts)) for (const f of filesRunBy(name)) inScripts.add(f);

  // What CI actually invokes: files named directly in a workflow step, plus
  // every file reachable from an npm script the workflow runs.
  const ciFiles = filesIn(workflow);
  for (const m of workflow.matchAll(/npm (?:run )?([\w:-]+)/g)) {
    for (const f of filesRunBy(m[1] === 'test' ? 'test' : m[1])) ciFiles.add(f);
  }

  test('the corpus of test files is non-trivial', () => {
    console.log(`\n  ${onDisk.length} test files on disk, ${inScripts.size} reachable from an `
      + `npm script, ${ciFiles.size} reachable from CI`);
    assert.ok(onDisk.length > 100,
      `only ${onDisk.length} test files found — this gate is reading the wrong directory`);
  });

  test('no test file is missing from every npm script and every CI step', () => {
    const orphans = onDisk.filter((f) => !inScripts.has(f) && !ciFiles.has(f));
    assert.deepEqual(orphans, [],
      `${orphans.length} test file(s) are run by nothing: they cannot fail, cannot be counted, `
      + 'and will rot silently — which is exactly how 5 broken tests survived in this repo. '
      + 'Add each to the `test` script in package.json, or to `test:browser` if it needs a '
      + 'browser, or give it its own CI step.');
  });

  test('nothing CI runs launches a browser', () => {
    const offenders = [...ciFiles].filter((f) => {
      if (f.endsWith('test-registration.test.js')) return false;   // names the pattern, does not launch
      const full = path.join(ROOT, f);
      return existsSync(full) && LAUNCHES_BROWSER.test(readFileSync(full, 'utf-8'));
    }).sort();
    assert.deepEqual(offenders, [],
      `${offenders.length} test file(s) reachable from CI launch a browser. CI installs `
      + 'playwright (a devDependency) WITHOUT downloading browsers, so the launch throws there '
      + 'while the same file skips silently on a machine that has no playwright at all — which '
      + 'is how this exact failure reached CI once already. Move them to `test:browser` and add '
      + 'them to NOT_IN_CI.');
  });

  test('every browser test has its own port, and the table matches the files', () => {
    // The browser suite is outside CI by design, so nothing else here would
    // ever notice these drifting. This check does not launch anything — it
    // reads the port table and the files — so it runs on every build.
    //
    // It exists because two files (serial-console, pendant-attiny88) both
    // claimed 3195, and `node --test` runs files concurrently while vite is
    // started with --strictPort: the loser dies rather than falling back. That
    // was a flake waiting for an unlucky schedule, invisible while the suite
    // could not run at all.
    const table = readFileSync(path.join(ROOT, 'test/_dev-server.js'), 'utf-8');
    const reserved = new Map(
      [...table.matchAll(/'([\w-]+)':\s*(\d+),/g)].map((m) => [m[1], Number(m[2])]));
    assert.ok(reserved.size >= 10, `only ${reserved.size} ports reserved — table not parsed`);

    const byPort = new Map();
    for (const [name, port] of reserved) {
      assert.ok(!byPort.has(port),
        `${name} and ${byPort.get(port)} both reserve port ${port} in test/_dev-server.js`);
      byPort.set(port, name);
    }

    // A file that spawns its own vite must use the port reserved for it.
    const mismatched = [];
    for (const f of readdirSync(path.join(ROOT, 'test')).filter((x) => x.endsWith('.test.js'))) {
      const body = readFileSync(path.join(ROOT, 'test', f), 'utf-8');
      const own = /const PORT = (\d+);/.exec(body);
      if (!own) continue;
      const name = f.replace(/\.test\.js$/, '');
      if (reserved.get(name) !== Number(own[1])) {
        mismatched.push(`${name} uses ${own[1]}, reserved ${reserved.get(name) ?? 'nothing'}`);
      }
    }
    assert.deepEqual(mismatched, [],
      'a browser test spawns vite on a port other than the one reserved for it in '
      + 'test/_dev-server.js. Keep the two in step, or move the file onto startDevServer().');
  });

  test('no browser test navigates to a server it did not start', () => {
    // Four files (debug-status, e2e, rendering, snapshot-render) navigated to
    // a hardcoded localhost:3100 and started nothing, so run unattended they
    // produced 19 failures — every one ERR_CONNECTION_REFUSED, which reads as
    // nineteen broken features and is one missing server.
    const offenders = [];
    for (const f of readdirSync(path.join(ROOT, 'test')).filter((x) => x.endsWith('.test.js'))) {
      const body = readFileSync(path.join(ROOT, 'test', f), 'utf-8');
      if (!LAUNCHES_BROWSER.test(body)) continue;
      const startsOne = body.includes('startDevServer') || /spawn\(\s*'npx'/.test(body);
      const hardcoded = /localhost:\d+/.test(body) && !body.includes('${PORT}')
        && !body.includes('server.url');
      if (!startsOne || hardcoded) offenders.push(f);
    }
    assert.deepEqual(offenders, [],
      'a browser test navigates to a URL it does not serve. It then passes only when someone '
      + 'happens to have `npm run dev` open, and fails as ERR_CONNECTION_REFUSED otherwise — '
      + 'which looks like broken features rather than a missing server.');
  });

/**
 * Files whose individual tests deliberately COLLECT rather than assert, with
 * the reason. Each names a summary test that does the asserting.
 *
 * The pattern is legitimate — 251 per-kind cross-checks that each fail
 * separately would bury the one number that matters — but it must be declared,
 * because until 2026-08-26 it was exempted by ACCIDENT. assertingHelpers()
 * treats a helper as asserting if any `assert` appears within 40 lines of its
 * definition, and in terminal-crosscheck an unrelated assert.ok(true) in a
 * skip branch happened to land inside that window for terminalsForKind(). Take
 * the unrelated line away and 251 tests turn out to assert nothing. An
 * exemption that depends on where a coincidence sits is not an exemption.
 */
const COLLECTORS = new Map([
  ['serialiser-roundtrip.test.js',
    'per-file tests push into allLosses; "summary: report all losses across corpus" asserts the ratchet'],
  ['terminal-crosscheck.test.js',
    'per-kind tests push into namingDiffs/coverageGaps; the two summary tests assert the populations'],
]);

  test('no test asserts nothing', () => {
    // A test with no assertion cannot fail. It reports green from the slot the
    // real check would occupy, which is strictly worse than not existing:
    // test/debug-status.test.js had one that navigated, waited 500 ms and
    // closed the page, under a comment explaining what should have happened.
    //
    // Swept across every test file 2026-08-25: four, all now fixed — two
    // `no crashes` smoke tests where the throw was the only (implicit) check,
    // and two `summary:` reporters that printed numbers and could not fail.
    // The list is EMPTY on purpose; there is no allowance to hide a new one in.
    const offenders = [];
    const collectorsSeen = new Set();
    for (const f of readdirSync(path.join(ROOT, 'test')).filter((x) => /\.test\.(js|mjs)$/.test(x))) {
      const found = vacuousTests(readFileSync(path.join(ROOT, 'test', f), 'utf-8'));
      if (COLLECTORS.has(f)) {
        if (found.length) collectorsSeen.add(f);
        continue;
      }
      for (const v of found) offenders.push(`${f}:${v.line} — ${v.name}`);
    }
    // A stale allowance is as bad as a missing one: if a collector starts
    // asserting, it must leave the record rather than sit there excusing
    // nothing.
    assert.deepEqual([...collectorsSeen].sort(), [...COLLECTORS.keys()].sort(),
      'a file on the COLLECTORS record no longer has a collecting test — remove it from the '
      + 'record, or it will excuse a real vacuous test added there later.');
    assert.deepEqual(offenders, [],
      `${offenders.length} test(s) contain no assertion and call no helper that asserts. Give `
      + 'each one a real check, or delete it. A reporter that only console.logs should assert '
      + 'a ratchet on the number it prints, so the number cannot move in silence.');
  });

  test('no test asserts only things that are true by construction', () => {
    // The sibling gate above asks whether a test asserts AT ALL, so
    // assert.ok(true) satisfies it. That is precisely the shape a
    // missing-prerequisite branch reaches for, and five files had one:
    // `it('SKIP: <thing> not available', () => assert.ok(true))` reports a
    // green TICK, not a skip, so a suite that checked nothing was
    // indistinguishable from one that passed. A real `{ skip: reason }` says
    // so in the summary; a tautology hides it.
    const offenders = [];
    for (const f of readdirSync(path.join(ROOT, 'test')).filter((x) => /\.test\.(js|mjs)$/.test(x))) {
      for (const t of tautologicalTests(readFileSync(path.join(ROOT, 'test', f), 'utf-8'))) {
        offenders.push(`${f}:${t.line} — ${t.name}`);
      }
    }
    assert.deepEqual(offenders, [],
      `${offenders.length} test(s) assert only tautologies (assert.ok(true), assert.equal(1, 1)) `
      + 'and cannot fail. If the point is to skip, use `it(name, { skip: reason }, () => {})` so '
      + 'it is COUNTED as a skip. If the point is to record a limitation, assert the limitation '
      + 'itself, so the note goes red when it stops being true.');
  });

  test('the files CI does not run are exactly the ones on the record', () => {
    const missed = onDisk.filter((f) => !ciFiles.has(f));
    assert.deepEqual(missed.sort(), [...NOT_IN_CI.keys()].sort(),
      'a test file is registered in an npm script that CI never invokes. That is the failure '
      + 'this repo already had three times over (test:boards, test:render, test:a2 all existed '
      + 'and CI ran none of them). Either give it a CI step, or add it to NOT_IN_CI with the '
      + 'reason — being unrun must be a decision, not an oversight.');
    for (const [f, why] of NOT_IN_CI) {
      assert.ok(existsSync(path.join(ROOT, f)),
        `${f} is on the NOT_IN_CI list but no longer exists — delete the entry (${why})`);
    }
  });
});
