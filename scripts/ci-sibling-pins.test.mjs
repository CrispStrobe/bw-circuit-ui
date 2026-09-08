import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

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
  assert.deepEqual(Object.keys(pins).sort(), ['bw-board', 'bw-parts']);
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
  const withoutBoard = workflow.replaceAll(
    'node scripts/checkout-ci-sibling.mjs bw-board ../bw-board',
    'node scripts/checkout-ci-sibling.mjs sb3-creator ../sb3-creator',
  );
  assert.throws(
    () => assertWorkflowMatchesPins(withoutBoard, pins),
    /workflow must checkout recorded CI sibling bw-board/,
  );
});
