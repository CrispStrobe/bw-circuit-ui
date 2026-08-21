import assert from 'node:assert/strict';
import test from 'node:test';

import {
  availableSampleCount,
  cursorDeltaSeconds,
  findTriggerIndex,
  latestWindowStart,
  triggeredWindowStart,
} from '../src/model/scope-tools.js';

const waveform = values => ({
  samples: Float64Array.from(values.flatMap(value => [value, value])),
  writeIndex: 0,
  count: values.length,
  sampleIntervalNs: 1_000_000n,
});

test('trigger finds the latest crossing in chronological ring-buffer order', () => {
  const data = waveform([-1, 1, -1, 1, -1, 1]);
  assert.equal(availableSampleCount(data), 6);
  assert.equal(findTriggerIndex(data, 'rising', 0), 5);
  assert.equal(findTriggerIndex(data, 'falling', 0), 4);
  assert.equal(findTriggerIndex(data, 'off', 0), null);
});

test('window anchors the trigger with pre-trigger context', () => {
  const data = waveform([0, 1, 2, 3, 4, 5, 6, 7]);
  assert.equal(latestWindowStart(data, 4), 4);
  assert.equal(triggeredWindowStart(data, 4, 6), 5);
  assert.equal(triggeredWindowStart(data, 4, 0), 7);
});

test('time cursors use sample cadence and selected window', () => {
  assert.equal(cursorDeltaSeconds(1_000_000n, 100, 0.25, 0.75), 0.05);
});
