import test from 'node:test';
import assert from 'node:assert/strict';
import {scopeDisplayStatus, scopeDisplayLabel, scopeViewportWarning} from '../src/model/scope-display-status.js';
const record = (pairs, extra = {}) => ({samples: Float64Array.from(pairs.flat()),
  writeIndex: 0, count: pairs.length, sampleIntervalNs: 1000n, startTNs: 0n, capture: 'envelope', ...extra});
const viewport = {vLo: 0, vHi: 5};
const read = (data, options = {}) => scopeDisplayStatus(data, {range: viewport, ...options});

test('exact viewport boundaries are visible, with distinct positive overrange controls', () => {
  const inside = read(record([[0, 5], [1, 2]]));
  assert.equal(inside.above, false); assert.equal(inside.below, false);
  assert.equal(scopeViewportWarning(inside), '');
  assert.equal(scopeViewportWarning(read(record([[1, 5.001]]))), 'Above viewport');
  assert.equal(scopeViewportWarning(read(record([[-.001, 4]]))), 'Below viewport');
  assert.equal(scopeViewportWarning(read(record([[-1, 6]]))), 'Below and above viewport');
});

test('zoom tests only its visible ring window, excluding old extremes', () => {
  const d = record([[-99, 99], [2, 3], [0, 5], [2, 4]]);
  assert.equal(scopeViewportWarning(read(d, {start: 1, windowSamples: 3})), '');
  assert.equal(scopeViewportWarning(read(d)), 'Below and above viewport');
});

test('prefix count is authoritative even with finite poison in unwritten memory', () => {
  const s = read(record([[1, 2], [3, 4], [-99, 99], [-99, 99]], {count: 2, writeIndex: 2}));
  assert.equal(s.retained, 2); assert.equal(s.visible, 2); assert.equal(s.gaps, 2);
  assert.equal(s.wrapped, false); assert.equal(scopeViewportWarning(s), '');
});

test('wrapped windows follow actual write index and preserve missing values', () => {
  const d = record([[4, 5], [5, 6], [NaN, NaN], [3, 4]], {count: 6, writeIndex: 2});
  const s = read(d, {start: 3, windowSamples: 2});
  assert.equal(s.wrapped, true); assert.equal(s.retained, 4); assert.equal(s.visible, 2);
  assert.equal(scopeViewportWarning(s), '');
  const gap = read(d, {start: 2, windowSamples: 2});
  assert.equal(gap.visible, 1); assert.equal(gap.gaps, 1);
});

test('empty and nonfinite captures are gaps, never measured zero', () => {
  const s = read(record([[NaN, NaN], [0, 0]], {count: 0}));
  assert.equal(s.visible, 0); assert.equal(s.gaps, 2); assert.equal(s.retained, 0);
  const invalid = read(record([[Infinity, Infinity], [3, 2]]));
  assert.equal(invalid.visible, 0); assert.equal(scopeViewportWarning(invalid), '');
});

test('invalid clock, ring and window metadata cannot invent an acquisition', () => {
  assert.equal(scopeDisplayStatus(null).ok, false);
  for (const extra of [{sampleIntervalNs: 0n}, {sampleIntervalNs: 1.5}, {count: -1}, {writeIndex: 3}]) {
    assert.equal(read(record([[1, 2], [2, 3]], extra)).ok, false);
  }
  assert.equal(read(record([[1, 2]]), {windowSamples: 2}).ok, false);
  assert.equal(read(record([[1, 2]]), {range: {vLo: 5, vHi: 0}}).viewport, null);
});

test('Nyquist belongs only to actual point samples, never envelopes or unknown modes', () => {
  const envelope = read(record([[1, 2]]));
  assert.equal(envelope.nyquistHz, null); assert.doesNotMatch(scopeDisplayLabel(envelope), /Nyquist/);
  const sample = read(record([[1, 1]], {capture: 'sample'}));
  assert.equal(sample.nyquistHz, 500000); assert.match(scopeDisplayLabel(sample), /Nyquist 500 kHz/);
  const unknown = read(record([[1, 2]], {capture: 'aperture'}));
  assert.equal(unknown.nyquistHz, null); assert.match(scopeDisplayLabel(unknown), /Unknown capture mode \(aperture\)/);
});

test('display status is an independent scalar snapshot and leaves raw bytes untouched', () => {
  const d = record([[-1, 2], [2, 6]], {startTNs: 18080000n});
  const bytes = Buffer.from(d.samples.buffer).toString('hex');
  const s = read(d); assert.equal(Buffer.from(d.samples.buffer).toString('hex'), bytes);
  assert.equal(s.startTimeNs, '18080000'); assert.match(scopeDisplayLabel(s), /record start 18.08 ms/);
  d.samples.fill(0); d.startTNs = 68080000n;
  assert.equal(s.above, true); assert.equal(s.below, true); assert.equal(s.startTimeNs, '18080000');
  assert.equal(Object.hasOwn(s, 'samples'), false);
  assert.match(scopeDisplayLabel(s, 'de'), /gespeichert/); assert.match(scopeViewportWarning(s, 'de'), /Unter und über/);
});
