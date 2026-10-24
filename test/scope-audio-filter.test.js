import test from 'node:test';
import assert from 'node:assert/strict';
import {createScopeAudioLowPass, apertureAudioFilter} from '../src/audio/scope-audio-filter.js';

function gain(hz) {
  const rate = 100000, filter = createScopeAudioLowPass(rate, 8000);
  let input = 0, output = 0;
  for (let i = 0; i < 50000; i++) {
    const value = Math.sin(2 * Math.PI * hz * i / rate), y = filter(value);
    if (i > 1000) { input += value * value; output += y * y; }
  }
  return Math.sqrt(output / input);
}

test('low-pass retains voltage gain and its stated cutoff, while attenuating high frequencies', () => {
  const filter = createScopeAudioLowPass(100000, 8000);
  let value; for (let i = 0; i < 2000; i++) value = filter(2.5);
  assert.ok(Math.abs(value - 2.5) < 1e-12);
  assert.ok(Math.abs(gain(1000) - 1) < .001);
  assert.ok(Math.abs(gain(8000) - Math.SQRT1_2) < .001);
  assert.ok(gain(30000) < .04);
});

test('filter state follows samples across arbitrary transport chunk boundaries', () => {
  const input = Array.from({length: 1001}, (_, i) => i % 13 === 0 ? 1 : -.02);
  const first = createScopeAudioLowPass(100000, 8000), second = createScopeAudioLowPass(100000, 8000);
  const expected = input.map(first), actual = [];
  for (const [start, end] of [[0, 7], [7, 64], [64, 999], [999, 1001]]) {
    actual.push(...input.slice(start, end).map(second));
  }
  assert.deepEqual(actual, expected);
});

test('invalid bandwidth and nonfinite values refuse, and point audio stays unfiltered', () => {
  for (const [rate, hz] of [[0, 100], [1000, 100], [200000, 8000], [10000, 0],
    [10000, NaN], [10000, Infinity], [10000, 5000]]) {
    assert.throws(() => createScopeAudioLowPass(rate, hz));
  }
  assert.equal(apertureAudioFilter('sample', 10000), null);
  assert.equal(apertureAudioFilter('average', 10000, 0), null);
  assert.throws(() => apertureAudioFilter('sample', 10000, 4000), /interval-mean/);
  assert.throws(() => createScopeAudioLowPass(10000, 4000)(NaN), /Nonfinite/);
});
