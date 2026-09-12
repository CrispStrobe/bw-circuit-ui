import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {workflowSources, assertCheckoutPins, assertNoRawClones, assertInvokedScriptsPinned} from './ci-workflow-inputs.mjs';

import { readSiblingPins } from './checkout-ci-sibling.mjs';

const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
const corpusCheckout = `          corpus_sha=$(node -p "require('./docs/schematic-baselines/CORPUS.json').corpusSha")
          git clone --filter=blob:none --no-checkout https://github.com/CrispStrobe/sb3-creator.git ../sb3-creator
          git -C ../sb3-creator fetch --depth 1 origin "$corpus_sha"
          git -C ../sb3-creator checkout --detach FETCH_HEAD`;

function assertWorkflowMatchesPins(source, pins) {
  for (const name of Object.keys(pins)) {
    const invocation = `node scripts/checkout-ci-sibling.mjs ${name} ../${name}`;
    assert.ok(
      source.includes(invocation),
      `workflow must checkout recorded CI sibling ${name}`,
    );
  }

  const invoked = [...source.matchAll(/node scripts\/checkout-ci-sibling\.mjs ([\w-]+) \.\.\/\1/g)]
    .map((match) => match[1]);
  assert.deepEqual(
    [...new Set(invoked)].sort(),
    Object.keys(pins).sort(),
    'workflow CI sibling names must equal the recorded pin names',
  );
  assert.ok(source.includes(corpusCheckout), 'workflow must checkout CI sibling sb3-creator at the reviewed corpus SHA');
  assert.doesNotMatch(
    source.replace(corpusCheckout, ''),
    /git clone[^\n]*github\.com\/CrispStrobe\//,
    'workflow must not clone an unpinned sibling tip',
  );
}

test('CI sibling pins are exact and the workflow uses every recorded pin', () => {
  const pins = readSiblingPins();
  assert.deepEqual(Object.keys(pins).sort(), ['bw-parts']);
  assertWorkflowMatchesPins(workflow, pins);
});

test('CI sibling pin gate fails by dependency name when the corpus checkout loses its pin', () => {
  const pins = readSiblingPins();
  const withoutFetch = workflow.replace(
    '          git -C ../sb3-creator fetch --depth 1 origin "$corpus_sha"\n',
    '',
  );
  assert.throws(
    () => assertWorkflowMatchesPins(withoutFetch, pins),
    /workflow must checkout CI sibling sb3-creator at the reviewed corpus SHA/,
  );
});

test('CI sibling pin gate fails by dependency name when workflow and record disagree', () => {
  const pins = readSiblingPins();
  const withoutParts = workflow.replaceAll(
    'node scripts/checkout-ci-sibling.mjs bw-parts ../bw-parts',
    'node scripts/checkout-ci-sibling.mjs sb3-creator ../sb3-creator',
  );
  assert.throws(
    () => assertWorkflowMatchesPins(withoutParts, pins),
    /workflow must checkout recorded CI sibling bw-parts/,
  );
});

// The engine is not a CI sibling any more: it is the `bw-board` package,
// pinned to a git sha in package.json, and every import names it. A sibling
// path (two dots up, then the engine dir) resolves only in a clone-beside-clone layout
// and was the reason CI had to clone the engine four times over.
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const siblingReach = new RegExp(String.raw`['"\`](?:\.\./)+bw` + `-board(?:/|['"\`])`);
function sourceFiles(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) sourceFiles(p, out);
    else if (/\.(m?js|jsx)$/.test(e.name)) out.push(p);
  }
  return out;
}
test('the engine is the pinned bw-board package, imported by name, never by sibling path', () => {
  assert.match(pkg.devDependencies['bw-board'] ?? '', /^github:CrispStrobe\/bw-board#[0-9a-f]{40}$/,
    'devDependencies.bw-board must be an exact 40-hex github sha');
  assert.equal(pkg.peerDependencies['bw-board'], '*',
    'the host supplies ONE engine copy; a git spec here would install a second');
  const root = fileURLToPath(new URL('..', import.meta.url));
  // dev/ holds the Vite harness's sweep worker, which is a SEPARATE module graph
  // (new Worker(new URL(...))) — it reached the engine by sibling path after every
  // src/ import had moved, failed to load in CI, and the sweep fell back to the main
  // thread, which the browser gate reported as "canvas froze during the sweep".
  const files = ['src', 'test', 'bin', 'scripts', 'dev'].flatMap((d) => sourceFiles(join(root, d)));
  assert.ok(files.length > 100, `only ${files.length} source files scanned`);
  const offenders = files.filter((f) => siblingReach.test(readFileSync(f, 'utf8'))).map((f) => f.slice(root.length));
  assert.deepEqual(offenders, []);
  // The scanner fires at the shape it guards against, and sees the by-name form.
  assert.ok(siblingReach.test("import { BoardImpl } from '../../bw" + "-board/src/board.js';"));
  assert.ok(readFileSync(join(root, 'test/_setup.js'), 'utf8').includes("from 'bw-board/board.js'"));
});

const workflows = workflowSources(new URL('..', import.meta.url).pathname);
test('all workflow files reject new unpinned checkout or raw clone sites', () => {
  assertCheckoutPins(workflows);
  const remaining = new Map([...workflows].map(([file, source]) => [file,
    file === '.github/workflows/ci.yml' ? source.replace(corpusCheckout, '') : source]));
  assertNoRawClones(remaining);
  for (const [file, source] of workflows) {
    for (const match of source.matchAll(/node scripts\/checkout-ci-sibling\.mjs ([\w-]+)/g)) {
      assert.ok(readSiblingPins()[match[1]], `${file}: unrecorded CI sibling ${match[1]}`);
    }
  }
});

test('a clone or checkout in a newly added workflow cannot escape the census', () => {
  assert.throws(() => assertNoRawClones(new Map([['.github/workflows/new.yml',
    'steps:\n  - run: git clone https://example.invalid/new.git\n']])), /new.yml: unreviewed raw clone/);
  const source = 'steps:\n  - uses: actions/checkout@full\n    with:\n      repository: Acme/new\n';
  assert.throws(() => assertCheckoutPins(new Map([['.github/workflows/new.yml', source]])), /Acme\/new: expected a full/);
  assert.throws(() => assertCheckoutPins(new Map([['new.yml', source + '      ref: main\n']])), /got main/);
  assert.equal(assertCheckoutPins(new Map([['new.yml', source + '      ref: ' + 'a'.repeat(40) + '\n']])).length, 1);
  // A later step's valid pin must not accidentally bless the preceding one.
  assert.throws(() => assertCheckoutPins(new Map([['new.yml', source +
    '  - uses: actions/checkout@full\n    with:\n      repository: Acme/pinned\n      ref: ' + 'a'.repeat(40) + '\n']])), /Acme\/new: expected a full/);
});

test('workflow-invoked scripts cannot hide an unreviewed clone', () => {
    const root = new URL('..', import.meta.url);
    const workflows = workflowSources(root.pathname);
    assertInvokedScriptsPinned(workflows, file => readFileSync(new URL(file, root), 'utf8'));
    const fixture = new Map([['new.yml', 'run: node scripts/new.mjs']]);
    assert.throws(() => assertInvokedScriptsPinned(fixture,
        () => "run('git', ['clone', 'example.invalid']);"), /scripts\/new.mjs: unreviewed script clone/);
    assert.throws(() => assertInvokedScriptsPinned(fixture, file => file === 'scripts/new.mjs'
        ? "import './nested.mjs';" : "git('clone', 'example.invalid');"), /scripts\/nested.mjs: unreviewed script clone/);
});

test('duplicate-ref fixture: a checkout has exactly one ref field', () => {
    const base = 'steps:\n  - uses: actions/checkout@full\n    with:\n      repository: Acme/duplicate\n      ref: ' + 'a'.repeat(40) + '\n';
    assert.equal(assertCheckoutPins(new Map([['duplicate.yml', base]])).length, 1);
    assert.throws(() => assertCheckoutPins(new Map([['duplicate.yml', base + '      ref: ' + 'b'.repeat(40) + '\n']])), /duplicate checkout ref/);
});

function assertCorpusPin(sha) {
  assert.match(sha ?? '', /^[a-f0-9]{40}$/, 'sb3-creator corpus must use a full reviewed SHA');
}
test('the separate corpus authority is immutable too', () => {
  const stamp = JSON.parse(readFileSync(new URL('../docs/schematic-baselines/CORPUS.json', import.meta.url), 'utf8'));
  assertCorpusPin(stamp.corpusSha);
  for (const bad of [undefined, 'main', stamp.corpusSha.slice(0, 7)]) {
    assert.throws(() => assertCorpusPin(bad), /sb3-creator corpus must use a full reviewed SHA/);
  }
});
