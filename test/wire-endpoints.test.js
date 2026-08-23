/**
 * The canonical wire-endpoint dialect reader.
 *
 * Two dialects appear MIXED WITHIN ONE FILE in the wild; every consumer
 * that hand-rolled the split produced at least one real defect (the
 * examples-gate "[object Object] undefined" nets, the 802-phantom-short
 * scan). These tests pin the one reader everything now imports.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wireEndpoint, flatWire, isBoardEndpoint } from '../src/model/wire-endpoints.js';

test('nested part endpoints normalize to copies', () => {
  const w = { from: { part: 'r1', terminal: 'a' }, to: { part: 'led1', terminal: 'anode' } };
  const f = wireEndpoint(w, 'from');
  assert.deepEqual(f, { part: 'r1', terminal: 'a' });
  assert.notEqual(f, w.from, 'a copy, not the caller\'s object');
  assert.deepEqual(wireEndpoint(w, 'to'), { part: 'led1', terminal: 'anode' });
});

test('legacy flat endpoints normalize to the same shape', () => {
  const w = { from: 'r1', fromTerminal: 'a', to: 'led1', toTerminal: 'anode' };
  assert.deepEqual(wireEndpoint(w, 'from'), { part: 'r1', terminal: 'a' });
  assert.deepEqual(wireEndpoint(w, 'to'), { part: 'led1', terminal: 'anode' });
});

test('MIXED dialects within one wire read correctly', () => {
  // This exact mix broke the corpus rail-short scan: 802 phantom shorts.
  const w = { from: 'sw1', fromTerminal: 'b', to: { board: 'bb1', hole: 'j30' } };
  assert.deepEqual(wireEndpoint(w, 'from'), { part: 'sw1', terminal: 'b' });
  const hole = wireEndpoint(w, 'to');
  assert.ok(isBoardEndpoint(hole));
  assert.equal(hole.hole, 'j30');
});

test('malformed endpoints are null, never phantom nets', () => {
  assert.equal(wireEndpoint({ from: 'r1' }, 'from'), null, 'flat without terminal');
  assert.equal(wireEndpoint({ from: { part: 'r1' } }, 'from'), null, 'nested without terminal');
  assert.equal(wireEndpoint({ from: { terminal: 'a' } }, 'from'), null, 'nested without part');
  assert.equal(wireEndpoint({}, 'from'), null, 'missing side');
  assert.equal(wireEndpoint({ from: { board: 'bb1' } }, 'from'), null, 'hole without hole id');
  assert.equal(wireEndpoint(null, 'from'), null, 'no wire at all');
});

test('flatWire produces the extractor shape from either dialect', () => {
  const nested = { from: { part: 'cpu', terminal: 'resb' }, to: { part: 'r1', terminal: 'a' } };
  assert.deepEqual(flatWire(nested),
    { from: 'cpu', fromTerminal: 'resb', to: 'r1', toTerminal: 'a' });
  const flat = { from: 'cpu', fromTerminal: 'resb', to: 'r1', toTerminal: 'a' };
  assert.deepEqual(flatWire(flat), flat);
});

test('flatWire passes hole endpoints through as non-strings', () => {
  // Extractors treat a non-string `from` as not-their-pin — correct,
  // a breadboard hole is not a chip pin.
  const w = { from: { board: 'bb1', hole: 'a5' }, to: { part: 'r1', terminal: 'a' } };
  const f = flatWire(w);
  assert.notEqual(typeof f.from, 'string');
  assert.equal(f.to, 'r1');
  assert.equal(f.toTerminal, 'a');
});
