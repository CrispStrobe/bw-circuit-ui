import test from 'node:test';
import assert from 'node:assert/strict';
import {apertureCaptureInfo, seriesFromApertureData} from '../src/model/scope-aperture-series.js';
import {seriesFromScopeData, spectrum} from '../src/model/fft.js';

function ring(count, depth = 128) {
  const samples = new Float64Array(depth * 2).fill(NaN);
  for (let i = 0; i < count; i++) samples[(i % depth) * 2] = samples[(i % depth) * 2 + 1] = i;
  return {capture: 'average', channelType: 'voltage', apertureNs: 100000n,
    sampleIntervalNs: 100000n, startTNs: BigInt(Math.max(1, count - depth + 1)) * 100000n,
    samples, count, writeIndex: count % depth};
}

test('aperture prefix and wrapped ring preserve newest actual values and metadata', () => {
  for (const count of [80, 200]) {
    const data = ring(count), before = data.samples.slice();
    const series = seriesFromApertureData(data), n = count < 128 ? 64 : 128;
    assert.equal(series.ok, true);
    assert.deepEqual([...series.values], Array.from({length: n}, (_, i) => count - n + i));
    assert.equal(series.capture, 'average'); assert.equal(series.apertureNs, 100000n);
    assert.equal(series.sampleRateHz, 10000); assert.deepEqual(data.samples, before);
    assert.equal(seriesFromScopeData(data).ok, false, 'the original point reader still refuses other acquisitions');
  }
});

test('aperture means never fill an absent prefix or transform an envelope', () => {
  for (const count of [0, 1, 63]) assert.equal(seriesFromApertureData(ring(count)).ok, false);
  for (const capture of ['sample', 'envelope', undefined]) {
    assert.equal(seriesFromApertureData({...ring(128), capture}).ok, false);
  }
});

test('invalid duration, epoch, channel identity and ring geometry refuse', () => {
  for (const change of [{apertureNs: undefined}, {apertureNs: 200000n}, {apertureNs: 100000},
    {sampleIntervalNs: 0n}, {sampleIntervalNs: 1.5}, {startTNs: undefined}, {startTNs: -1n},
    {channelType: 'current'}, {channelType: undefined}, {count: -1}, {count: NaN},
    {count: .5}, {writeIndex: -1}, {writeIndex: 128}, {samples: new Float64Array(3)}]) {
    assert.equal(apertureCaptureInfo({...ring(128), ...change}).ok, false, JSON.stringify(change, (_, v) => typeof v === 'bigint' ? String(v) : v));
  }
});

test('unwritten and nonscalar means cannot enter an FFT', () => {
  for (const pair of [[NaN, NaN], [Infinity, Infinity], [1, 2]]) {
    const data = ring(128); data.samples.set(pair, 10);
    assert.equal(seriesFromApertureData(data).ok, false);
  }
});

test('FFT retains the actual finite-aperture amplitude without inverse-filter correction', () => {
  const data = ring(128), rate = 10000, hz = 625;
  const x = Math.PI * hz / rate, amplitude = 2 * Math.sin(x) / x;
  for (let i = 0; i < 128; i++) {
    const mean = 2.5 + amplitude * Math.sin(2 * Math.PI * hz * (i + .5) / rate);
    data.samples[i * 2] = data.samples[i * 2 + 1] = mean;
  }
  const series = seriesFromApertureData(data);
  const spec = spectrum(series.values, series.sampleRateHz, {window: 'rect'});
  assert.equal(spec.ok, true); assert.ok(Math.abs(spec.magV[8] - amplitude) < 1e-12);
  assert.ok(spec.magV[8] < 2, 'finite-aperture attenuation remains visible');
});
