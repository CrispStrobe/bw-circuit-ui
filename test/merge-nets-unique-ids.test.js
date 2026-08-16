// mergeNets runs once per breadboard; its uniquifier must never mint an id
// that ANY earlier pass already produced. It did — 'n-col-b5-m1' twice
// across a four-breadboard bench — and two nets sharing an id makes the
// engine's MNA matrix singular: every net on the eater6502 full build read
// 0 V with power on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeNets } from '../src/model/merge-nets.js';

test('sequential merges never repeat an id', () => {
  // Pass 1: two distinct column nets that collide on the id 'n-col-b5'
  // (same column name, different breadboards).
  const pass1 = mergeNets(
    [{ id: 'n-col-b5', terminals: [{ part: 'a1', terminal: 'x' }] }],
    [{ id: 'n-col-b5', terminals: [{ part: 'a2', terminal: 'x' }] }]);
  assert.equal(new Set(pass1.map(n => n.id)).size, pass1.length, 'pass1 unique');
  // Pass 2: a third board contributes ANOTHER 'n-col-b5'. The old counter
  // restarted here and minted a second 'n-col-b5-m1'.
  const pass2 = mergeNets(pass1,
    [{ id: 'n-col-b5', terminals: [{ part: 'a3', terminal: 'x' }] }]);
  const ids = pass2.map(n => n.id);
  assert.equal(new Set(ids).size, ids.length, `all unique, got ${ids}`);
  assert.equal(pass2.length, 3, 'three distinct nets survive');
});

test('a pre-suffixed source id does not collide with a fresh suffix', () => {
  const out = mergeNets(
    [{ id: 'n-x', terminals: [{ part: 'p1', terminal: 't' }] },
      { id: 'n-x-m1', terminals: [{ part: 'p2', terminal: 't' }] }],
    [{ id: 'n-x', terminals: [{ part: 'p3', terminal: 't' }] }]);
  const ids = out.map(n => n.id);
  assert.equal(new Set(ids).size, ids.length, `all unique, got ${ids}`);
});
