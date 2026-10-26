import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {scopeDisplayStatus, scopeDisplayLabel, scopeViewportWarning} from '../src/model/scope-display-status.js';

const verifierSourceText = readFileSync(new URL('../scripts/verify-interaction.mjs', import.meta.url), 'utf8');
const verifierMarkers = [...verifierSourceText.matchAll(
  /\/\/ BEGIN scopeReadoutMatchesActualRecord\n([\s\S]*?)\/\/ END scopeReadoutMatchesActualRecord/g)];
assert.equal(verifierMarkers.length, 1, 'one exact browser-verifier predicate source');
const verifierFunctionSource = verifierMarkers[0][1].trim();
assert.match(verifierFunctionSource, /^function scopeReadoutMatchesActualRecord\(/);

const liveHandle = 'scope-live-0';
const liveData = () => ({samples: new Float64Array(8192 * 2), count: 10000,
  startTNs: 18080000n, sampleIntervalNs: 10000n, capture: 'envelope'});
const liveAttributes = () => ({
  'data-start-time-ns': '18080000', 'data-interval-ns': '10000', 'data-depth': '8192',
  'data-retained': '8192', 'data-capture': 'envelope', 'data-wrapped': 'true'
});
const verifierContext = ({data = liveData(), attributes = liveAttributes(), channels = [liveHandle],
  selectorIdentity = 'bw-scope-acquisition-0', refusal = null} = {}) => ({
  window: {__board: {
    getScopeChannels: () => channels,
    getScopeData: handle => {
      if (refusal) throw refusal;
      assert.equal(handle, liveHandle, 'predicate requests the admitted live handle');
      return data;
    }
  }},
  document: {querySelector: selector => selector === `[data-testid="${selectorIdentity}"]`
    ? {getAttribute: name => Object.hasOwn(attributes, name) ? attributes[name] : null}
    : null}
});
const runVerifier = (context, input = {handle: liveHandle, channelIndex: 0, count: 10000}) =>
  vm.runInNewContext(`(${verifierFunctionSource})`, context)(input);
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

test('Nyquist belongs to declared uniform series, never envelopes or unknown modes', () => {
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

test('explicit voltage means retain their aperture identity and series Nyquist in both languages',()=>{
 const d=record([[1,1],[2,2]],{capture:'average',channelType:'voltage',apertureNs:1000n});
 const before=d.samples.slice(),status=read(d);
 assert.equal(status.ok,true);assert.equal(status.apertureNs,1000);assert.equal(status.nyquistHz,500000);
 assert.match(scopeDisplayLabel(status),/Interval means · aperture 1 µs/);
 assert.match(scopeDisplayLabel(status,'de'),/Intervallmittelwerte · Zeitfenster 1 µs/);
 assert.doesNotMatch(scopeDisplayLabel(status),/Point samples|Unknown/);assert.deepEqual(d.samples,before);
 for(const extra of [{apertureNs:undefined},{apertureNs:2000n},{channelType:'current'}])assert.equal(read({...d,...extra}).ok,false);
 const nonscalar=record([[1,2],[3,4]],{capture:'average',channelType:'voltage',apertureNs:1000n});
 assert.equal(read(nonscalar).visible,0);
});

test('browser ring readout predicate joins the current live Board record to its exact DOM metadata', () => {
  assert.equal(runVerifier(verifierContext()), true);
});

test('browser ring readout predicate rejects a held wrapped readout with a stale record origin', () => {
  const data = liveData(); data.count = 15000; data.startTNs = 68080000n;
  assert.equal(runVerifier(verifierContext({data}), {handle: liveHandle, channelIndex: 0, count: 15000}), false);
});

test('browser ring readout predicate rejects wrong identity and every missing or wrong metadata field', () => {
  assert.equal(runVerifier(verifierContext({channels: ['other-handle']})), false, 'wrong live channel identity');
  assert.equal(runVerifier(verifierContext({selectorIdentity: 'other-readout'})), false, 'wrong DOM readout identity');
  assert.equal(runVerifier(verifierContext(), {handle: liveHandle, channelIndex: 0, count: 9999}), false,
    'wrong exact live count');
  for (const [name, missing, wrong] of [
    ['count', undefined, 9999],
    ['startTNs', undefined, 18080001n],
    ['sampleIntervalNs', undefined, 20000n],
    ['samples', undefined, new Float64Array(4096 * 2)],
    ['capture', undefined, 'sample']
  ]) {
    assert.equal(runVerifier(verifierContext({data: {...liveData(), [name]: missing}})), false,
      `live ${name} missing`);
    assert.equal(runVerifier(verifierContext({data: {...liveData(), [name]: wrong}})), false,
      `live ${name} wrong`);
  }
  for (const name of Object.keys(liveAttributes())) {
    const missing = liveAttributes(); delete missing[name];
    assert.equal(runVerifier(verifierContext({attributes: missing})), false, `${name} missing`);
    assert.equal(runVerifier(verifierContext({attributes: {...liveAttributes(), [name]: 'wrong'}})), false,
      `${name} wrong`);
  }
});

test('browser ring readout predicate propagates Board record refusal', () => {
  const refusal = new Error('controlled getScopeData refusal');
  assert.throws(() => runVerifier(verifierContext({refusal})), error => error === refusal);
});
