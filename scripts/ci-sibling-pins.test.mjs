import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { readSiblingPins } from './checkout-ci-sibling.mjs';

const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
const reviewedCorpus = JSON.parse(
  readFileSync(new URL('../docs/schematic-baselines/CORPUS.json', import.meta.url), 'utf8'),
);

function assertReviewedCorpusPin(pins, corpus) {
  assert.equal(
    pins['sb3-creator']?.sha,
    corpus.corpusSha,
    'recorded CI sibling sb3-creator must match the reviewed schematic corpus',
  );
}

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
  assert.doesNotMatch(source, /git clone[^\n]*github\.com\/CrispStrobe\//, 'workflow must not clone an unpinned sibling tip');
}

test('CI sibling pins are exact and the workflow uses every recorded pin', () => {
  const pins = readSiblingPins();
  assert.deepEqual(Object.keys(pins).sort(), ['bw-board', 'bw-parts', 'sb3-creator']);
  assertWorkflowMatchesPins(workflow, pins);
  assertReviewedCorpusPin(pins, reviewedCorpus);
});

test('CI sibling pin gate fails by dependency name when the reviewed corpus moves alone', () => {
  const pins = readSiblingPins();
  assert.throws(
    () => assertReviewedCorpusPin(pins, { corpusSha: '0'.repeat(40) }),
    /recorded CI sibling sb3-creator must match the reviewed schematic corpus/,
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
