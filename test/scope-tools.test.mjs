import assert from 'node:assert/strict';
import test from 'node:test';

import {
  availableSampleCount,
  scopeEnvelopeColumns,
  cursorDeltaSeconds,
  findTriggerIndex,
  latestWindowStart,
  readScopeCapture,
  triggeredWindowStart,
} from '../src/model/scope-tools.js';

const waveform = values => ({
  samples: Float64Array.from(values.flatMap(value => [value, value])),
  writeIndex: 0,
  count: values.length,
  sampleIntervalNs: 1_000_000n,
});

test('scope validity reads actual data without advancing and preserves named refusals', () => {
  const data = waveform([0, 1]);
  const board = {getScopeData: handle => { assert.equal(handle, 7); return data; }};
  assert.deepEqual(readScopeCapture(board, 7), {data, reason: null});
  board.getScopeData = () => { throw new Error('scope capture refused: circuit solve failed: VBAD'); };
  assert.deepEqual(readScopeCapture(board, 7), {
    data: null, reason: 'scope capture refused: circuit solve failed: VBAD',
  });
  assert.equal(readScopeCapture(null, 7).data, null);
  assert.ok(readScopeCapture(null, 7).reason);
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


test('scope pixel aggregation preserves narrow pulses between formerly selected bins',()=>{
 const data=waveform(Array(4096).fill(0));
 for(let i=13;i<4096;i+=391){data.samples[i*2]=-2;data.samples[i*2+1]=8;}
 const columns=scopeEnvelopeColumns(data,0,4096,320);
 assert.equal(columns.filter(c=>c.max===8).length,11);
 assert.equal(Math.min(...columns.map(c=>c.min)),-2);
 assert.equal(columns.length,320);
});

test('scope pixel aggregation preserves ring wrap and excludes bins outside zoom',()=>{
 const data=waveform([1,2,3,4,5,6,7,8]);
 assert.deepEqual(scopeEnvelopeColumns(data,6,4,2),[
  {min:7,max:8,gap:false},{min:1,max:2,gap:false}]);
 assert.deepEqual(scopeEnvelopeColumns(data,0,2,4).map(c=>c.max),[1,1,2,2]);
});

test('uncaptured scope pixels stay empty and mixed capture gaps break connecting traces',()=>{
 const data=waveform([NaN,NaN,3,NaN,NaN,NaN]);
 assert.deepEqual(scopeEnvelopeColumns(data,0,6,3),[null,{min:3,max:3,gap:true},null]);
});

test('scope aggregation rejects invalid windows rather than reading invented samples',()=>{
 for(const [start,win,width] of [[0,9,2],[0,0,2],[.5,2,2],[0,2,0]])
  assert.throws(()=>scopeEnvelopeColumns(waveform([1,2,3]),start,win,width),/invalid scope/);
});
