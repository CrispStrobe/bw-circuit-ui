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
]);

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
