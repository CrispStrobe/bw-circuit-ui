import test from 'node:test';
import assert from 'node:assert/strict';
import {createScopeDigitizer, digitizeScopeCapture} from '../src/model/scope-digitizer.js';

// Independent exact binary-string decoder: no production DataView/rounder imports.
function rationalUnits(value) {
  if (value === 0) return 0n;
  const negative = value < 0, [whole, fraction = ''] = Math.abs(value).toString(2).split('.');
  const integer = BigInt('0b' + whole + fraction);
  return (negative ? -integer : integer) << BigInt(1074 - fraction.length);
}
const absolute = n => n < 0n ? -n : n;
function expectedCode(bits, low, high, value) {
  const n = BigInt(2 ** bits - 1), lo = rationalUnits(low), hi = rationalUnits(high), x = rationalUnits(value);
  let code = 0;
  for (let k = 0n; k < n; k++) if (2n * n * x >= (2n * n - 2n * k - 1n) * lo + (2n * k + 1n) * hi) code++;
  return code;
}
// Adjacent-number oracle uses exact binary strings, not a shared bit decoder.
function nextUp(value) {
  if (value === Number.MAX_VALUE) return Infinity;
  if (value === 0) return Number.MIN_VALUE;
  let step = Math.abs(value) * Number.EPSILON;
  if (step === 0) step = Number.MIN_VALUE;
  let next = value + step;
  while (next === value || !Number.isFinite(next)) { step /= 2; next = value + step; }
  for (;;) { const half = step / 2; if (!half || value + half === value) return next;
    step = half; next = value + step; }
}
const nextDown = value => -nextUp(-value);
function verify(model, x) {
  const d = model.descriptor, result = model.quantize(x), n = BigInt(d.intervals);
  assert.equal(result.code, expectedCode(d.bits, d.lowVolts, d.highVolts, x));
  const lo = rationalUnits(d.lowVolts), hi = rationalUnits(d.highVolts), code = BigInt(result.code);
  const target = (n - code) * lo + code * hi, actual = rationalUnits(result.volts);
  const error = absolute(actual * n - target);
  for (const adjacent of [nextDown(result.volts), nextUp(result.volts)]) {
    if (Number.isFinite(adjacent)) assert(error <= absolute(rationalUnits(adjacent) * n - target));
  }
  assert(absolute(actual - rationalUnits(x)) <= rationalUnits(d.maxReconstructionErrorVolts));
}

test('endpoint grid, half ties upward, clipping and finite code zero', () => {
  const m = createScopeDigitizer({bits: 2, lowVolts: -1, highVolts: 2});
  for (const [x, code] of [[-1, 0], [-.5, 1], [.5, 2], [1.5, 3], [2, 3]]) assert.equal(m.quantize(x).code, code);
  assert.equal(m.quantize(-1).clipping, 'none');
  assert.deepEqual(m.quantize(-2), {inputVolts: -2, code: 0, volts: -1, clipping: 'below'});
  assert.equal(m.quantize(3).clipping, 'above');
  for (const value of [NaN, Infinity, -Infinity, undefined, null]) {
    assert.deepEqual(m.quantize(value), {inputVolts: null, code: null, volts: null, clipping: 'gap'});
  }
  assert(Object.isFrozen(m)); assert(Object.isFrozen(m.descriptor)); assert(Object.isFrozen(m.quantize(0)));
  assert.equal(m.descriptor.physicalHardwareModel, false);
});

test('quotient cancellation counterexamples and signed zero never erase threshold side', () => {
  const offset = createScopeDigitizer({bits: 8, lowVolts: -128, highVolts: 127});
  for (const [x, code] of [[nextDown(-.5), 127], [-.5, 128], [nextUp(-.5), 128]]) assert.equal(offset.quantize(x).code, code);
  const symmetric = createScopeDigitizer({bits: 8, lowVolts: -1, highVolts: 1});
  assert.equal(symmetric.quantize(-Number.MIN_VALUE).code, 127);
  for (const x of [-0, 0, Number.MIN_VALUE]) assert.equal(symmetric.quantize(x).code, 128);
  assert(Object.is(symmetric.quantize(-0).inputVolts, -0));
});

test('independent rational nearest grid and bound controls across signed/offset/subnormal domains', () => {
  for (const [bits, lowVolts, highVolts] of [[1,-1,1],[2,0,1],[4,-3,7],[8,-128,127],
    [8,-1,1],[4,1e10,1e10+1],[4,-1e10-1,-1e10],[2,Number.MIN_VALUE*4,Number.MIN_VALUE*40]]) {
    const m = createScopeDigitizer({bits, lowVolts, highVolts});
    for (let i = 0; i <= 32; i++) {
      const x = lowVolts * (1 - i / 32) + highVolts * (i / 32);
      if (x >= lowVolts && x <= highVolts) verify(m, x);
    }
  }
});

test('all exact thresholds and adjacent floats on integer-step grids', () => {
  for (const [bits, lowVolts] of [[1,-1],[2,-3],[4,-8],[8,-128]]) {
    const highVolts = lowVolts + 2 ** bits - 1, m = createScopeDigitizer({bits, lowVolts, highVolts});
    for (let i = 0; i < 2 ** bits - 1; i++) {
      const tie = lowVolts + i + .5;
      for (const x of [nextDown(tie), tie, nextUp(tie)]) verify(m, x);
    }
  }
});

test('16-bit maximum grid keeps endpoint and middle adjacent decisions', () => {
  const m = createScopeDigitizer({bits:16,lowVolts:-32768,highVolts:32767});
  for (const x of [-32768,nextUp(-32768),nextDown(-.5),-.5,nextUp(-.5),nextDown(32767),32767]) verify(m,x);
});

test('reconstruction is nearest-even at exact binary64 midpoints, with valid distinct levels', () => {
  const epsilon=Number.EPSILON;
  const down=createScopeDigitizer({bits:2,lowVolts:1-epsilon/2,highVolts:1+4*epsilon});
  assert.equal(down.quantize(1+2*epsilon).code,2);
  assert.equal(down.quantize(1+2*epsilon).volts,1+2*epsilon);
  const up=createScopeDigitizer({bits:2,lowVolts:1-3*epsilon/2,highVolts:1+3*epsilon});
  assert.equal(up.quantize(1+2*epsilon).code,2);
  assert.equal(up.quantize(1+2*epsilon).volts,1+2*epsilon);
});

test('published bound is the least binary64 outward bound on exact half-step plus maximum rounding', () => {
  for(const [bits,lowVolts,highVolts] of [[2,0,1],[4,-3,7],[3,0,.1],[4,1,2],[8,-1,3],
    [8,0,10],[3,100,100.1],[1,0,Number.MAX_VALUE],
    [2,Number.MIN_VALUE*4,Number.MIN_VALUE*40]]) {
    const m=createScopeDigitizer({bits,lowVolts,highVolts}),n=BigInt(m.descriptor.intervals);
    const lo=rationalUnits(lowVolts),hi=rationalUnits(highVolts);
    let max=0n;
    for(let k=0;k<=Number(n);k++) {
      const input=lowVolts*(1-k/Number(n))+highVolts*(k/Number(n));
      const result=m.quantize(input); assert.equal(result.code,k);
      const rho=absolute(rationalUnits(result.volts)*n-((n-BigInt(k))*lo+BigInt(k)*hi));
      if(rho>max)max=rho;
    }
    const required=hi-lo+2n*max,bound=m.descriptor.maxReconstructionErrorVolts;
    assert(rationalUnits(bound)*2n*n>=required);
    assert(rationalUnits(nextDown(bound))*2n*n<required);
  }
});

test('named refusal for configuration and unrepresentable grids', () => {
  for (const options of [{bits:0,lowVolts:0,highVolts:1},{bits:17,lowVolts:0,highVolts:1},
    {bits:1.5,lowVolts:0,highVolts:1},{bits:2,lowVolts:1,highVolts:1},
    {bits:2,lowVolts:Infinity,highVolts:2}]) assert.throws(()=>createScopeDigitizer(options),{code:'ADC_CONFIGURATION'});
  for (const options of [{bits:1,lowVolts:-Number.MAX_VALUE,highVolts:Number.MAX_VALUE},
    {bits:1,lowVolts:0,highVolts:Number.MIN_VALUE},
    {bits:16,lowVolts:1,highVolts:nextUp(1)}]) assert.throws(()=>createScopeDigitizer(options),{code:'ADC_REPRESENTABILITY'});
});

const capture = overrides => ({capture:'sample',channelType:'voltage',startTNs:10n,sampleIntervalNs:5n,
  count:3,writeIndex:0,samples:new Float64Array([-1,-1,0,0,2,2]),...overrides});
test('copied immutable capture preserves raw, signed zero, layout and explicit clipping', () => {
  const m=createScopeDigitizer({bits:2,lowVolts:0,highVolts:1}), original=capture();
  const result=digitizeScopeCapture(original,m);
  assert.deepEqual(result.data.adc.codes,[0,0,3]);
  assert.deepEqual(result.data.adc.clippingDirections,['below','none','above']);
  assert.deepEqual(result.data.adc.clippingCounts,{below:1,above:1,gaps:0,finite:3});
  assert.deepEqual(result.data.adc.source,{startTimeNs:'10',sampleIntervalNs:'5',count:3,writeIndex:0,depth:3});
  assert.equal(original.samples[0],-1); original.samples[0]=99;
  assert.equal(result.raw.samples[0],-1); assert.equal(result.data.adc.rawSamples[0],-1);
  for(const x of [result,result.raw,result.raw.samples,result.data,result.data.samples,result.data.adc,
    result.data.adc.source,result.data.adc.codes,result.data.adc.clippingCounts]) assert(Object.isFrozen(x));
  assert.throws(()=>{result.data.adc.codes[0]=9;},TypeError);
  const zero=digitizeScopeCapture(capture({count:1,writeIndex:1,samples:new Float64Array([-0,-0,8,8,9,9])}),m);
  assert(Object.is(zero.raw.samples[0],-0)); assert.deepEqual(zero.data.adc.codes,[0,null,null]);
  assert(Number.isNaN(zero.data.samples[2])); assert.equal(zero.data.adc.clippingCounts.gaps,0);
});

test('wrapped rings count only retained points and keep actual gap/code0 distinct', () => {
  const m=createScopeDigitizer({bits:2,lowVolts:0,highVolts:1});
  const result=digitizeScopeCapture(capture({count:8,writeIndex:2,samples:[0,0,NaN,NaN,.5,.5]}),m);
  assert.deepEqual(result.data.adc.codes,[0,null,2]);
  assert.deepEqual(result.data.adc.clippingCounts,{below:0,above:0,gaps:1,finite:2});
  assert.equal(result.data.count,8); assert.equal(result.data.writeIndex,2);
});

test('refuse relabeled capture, remodelling, pair mismatch, fake model and malformed clocks/layout', () => {
  const m=createScopeDigitizer({bits:2,lowVolts:0,highVolts:1});
  for(const change of [{capture:'envelope'},{capture:'average'},{channelType:'current'},
    {channelType:'digital'},{adc:null}]) assert.throws(()=>digitizeScopeCapture(capture(change),m),{code:'ADC_CAPTURE'});
  for(const change of [{count:NaN},{count:-1},{writeIndex:2},{writeIndex:3},{count:2**54},
    {sampleIntervalNs:0n},{sampleIntervalNs:5},{startTNs:-1n},{startTNs:10},{depth:4}]) {
    assert.throws(()=>digitizeScopeCapture(capture(change),m),{code:'ADC_CAPTURE_METADATA'});
  }
  for(const samples of [[0,1,0,0,0,0],[NaN,0,0,0,0,0]]) {
    assert.throws(()=>digitizeScopeCapture(capture({samples}),m),{code:'ADC_SAMPLE_PAIR'});
  }
  assert.throws(()=>digitizeScopeCapture(capture(),{descriptor:m.descriptor,quantize:m.quantize}),{code:'ADC_MODEL'});
});
