/** Ideal reconstruction of actual voltage point samples; never an electrical model. */
const models = new WeakSet();
const buffer = new ArrayBuffer(8), view = new DataView(buffer);
const fail = (code, message) => { throw Object.assign(new Error(message), {code}); };
const abs = n => n < 0n ? -n : n;

// Exact signed integer units of the least positive binary64 value, 2^-1074.
function units(value) {
  view.setFloat64(0, value);
  const bits = view.getBigUint64(0), exponent = Number((bits >> 52n) & 2047n);
  const fraction = bits & ((1n << 52n) - 1n);
  const magnitude = exponent ? ((1n << 52n) | fraction) << BigInt(exponent - 1) : fraction;
  return bits >> 63n ? -magnitude : magnitude;
}

// Correct rounding of A/D least-subnormal units, without floating normalization.
function roundedRational(a, d, upward = false) {
  if (a === 0n) return {value: 0, units: 0n};
  const negative = a < 0n, magnitude = abs(a);
  let exponent = magnitude.toString(2).length - d.toString(2).length;
  if (exponent >= 0 ? magnitude < (d << BigInt(exponent)) :
    (magnitude << BigInt(-exponent)) < d) exponent--;
  const shift = Math.max(exponent - 52, 0), divisor = d << BigInt(shift);
  let q = magnitude / divisor;
  const remainder = magnitude % divisor;
  if (upward ? !negative && remainder !== 0n :
    2n * remainder > divisor || (2n * remainder === divisor && q % 2n !== 0n)) q++;
  const signed = negative ? -q : q;
  return {value: Number(signed) * 2 ** (shift - 1074), units: signed << BigInt(shift)};
}

/** Endpoint grid with exact half ties toward the larger code/voltage. */
export function createScopeDigitizer({bits, lowVolts, highVolts} = {}) {
  if (!Number.isInteger(bits) || bits < 1 || bits > 16 ||
    !Number.isFinite(lowVolts) || !Number.isFinite(highVolts) || !(lowVolts < highVolts)) {
    fail('ADC_CONFIGURATION', 'ADC requires 1–16 bits and finite increasing full-scale endpoints');
  }
  const intervals = 2 ** bits - 1, width = highVolts - lowVolts, stepVolts = width / intervals;
  if (!Number.isFinite(width) || !(stepVolts > 0) || !Number.isFinite(stepVolts) || !(stepVolts / 2 > 0)) {
    fail('ADC_REPRESENTABILITY', 'ADC width, step and half-step must be finite and positive');
  }
  const lo = units(lowVolts), hi = units(highVolts), n = BigInt(intervals);
  const levels = [], cuts = [];
  let maxRhoNum = 0n;
  for (let k = 0; k <= intervals; k++) {
    const index = BigInt(k), numerator = (n - index) * lo + index * hi;
    const rounded = roundedRational(numerator, n);
    if (!Number.isFinite(rounded.value) || (k && !(rounded.value > levels[k - 1]))) {
      fail('ADC_REPRESENTABILITY', 'ADC reconstruction levels collapse at binary64 precision');
    }
    levels.push(rounded.value);
    const rho = abs(rounded.units * n - numerator);
    if (rho > maxRhoNum) maxRhoNum = rho;
    if (k < intervals) {
      const numeratorCut = (2n * n - 2n * index - 1n) * lo + (2n * index + 1n) * hi;
      const cut = roundedRational(numeratorCut, 2n * n, true).value;
      if (!Number.isFinite(cut) || !(cut > lowVolts) || !(cut <= highVolts) ||
        (k && !(cut > cuts[k - 1]))) {
        fail('ADC_REPRESENTABILITY', 'ADC decision cuts collapse at binary64 precision');
      }
      cuts.push(cut);
    }
  }
  const maxReconstructionErrorVolts = roundedRational(hi - lo + 2n * maxRhoNum, 2n * n, true).value;
  if (!(maxReconstructionErrorVolts > 0) || !Number.isFinite(maxReconstructionErrorVolts)) {
    fail('ADC_REPRESENTABILITY', 'ADC reconstruction error bound is not representable');
  }
  const descriptor = Object.freeze({schemaVersion: 1, kind: 'ideal-uniform-adc', bits,
    lowVolts, highVolts, levels: intervals + 1, intervals, stepVolts,
    maxReconstructionErrorVolts, decision: 'nearest-half-up', reconstruction: 'binary64-nearest-even',
    physicalHardwareModel: false});
  const model = Object.freeze({descriptor, quantize(value) {
    if (!Number.isFinite(value)) return Object.freeze({inputVolts: null, code: null, volts: null, clipping: 'gap'});
    let code;
    const clipping = value < lowVolts ? 'below' : value > highVolts ? 'above' : 'none';
    if (clipping === 'below') code = 0;
    else if (clipping === 'above') code = intervals;
    else {
      let lower = 0, upper = cuts.length;
      while (lower < upper) {
        const middle = Math.floor((lower + upper) / 2);
        if (value >= cuts[middle]) lower = middle + 1;
        else upper = middle;
      }
      code = lower;
    }
    return Object.freeze({inputVolts: value, code, volts: levels[code], clipping});
  }});
  models.add(model);
  return model;
}

/** Copy a real ring before deriving a separately labeled, immutable ADC view. */
export function digitizeScopeCapture(actualSampleData, model) {
  const data = actualSampleData;
  if (!models.has(model)) fail('ADC_MODEL', 'ADC model must come from createScopeDigitizer');
  if (!data || data.capture !== 'sample' || data.channelType !== 'voltage' || Object.hasOwn(data, 'adc')) {
    fail('ADC_CAPTURE', 'ADC requires an unmodeled voltage point capture');
  }
  const samples = data.samples;
  if ((!Array.isArray(samples) && !(samples instanceof Float64Array) && !(samples instanceof Float32Array)) ||
    samples.length < 2 || samples.length % 2) fail('ADC_CAPTURE', 'ADC requires interleaved voltage pairs');
  const depth = samples.length / 2, {count, writeIndex, startTNs, sampleIntervalNs} = data;
  if (!Number.isSafeInteger(count) || count < 0 || !Number.isSafeInteger(writeIndex) || writeIndex < 0 ||
    writeIndex >= depth || writeIndex !== count % depth ||
    (data.depth !== undefined && data.depth !== depth) ||
    typeof startTNs !== 'bigint' || startTNs < 0n || typeof sampleIntervalNs !== 'bigint' || sampleIntervalNs <= 0n) {
    fail('ADC_CAPTURE_METADATA', 'ADC requires consistent finite ring metadata and BigInt sample clocks');
  }
  const rawSamples = Object.freeze(Array.from(samples));
  const modeled = Array(samples.length).fill(NaN), codes = Array(depth).fill(null);
  const directions = Array(depth).fill('gap'), retained = Math.min(count, depth);
  const oldest = (writeIndex - retained + depth) % depth;
  const clippingCounts = {below: 0, above: 0, gaps: 0, finite: 0};
  for (let offset = 0; offset < retained; offset++) {
    const index = (oldest + offset) % depth, a = rawSamples[2 * index], b = rawSamples[2 * index + 1];
    if (typeof a !== 'number' || typeof b !== 'number') fail('ADC_CAPTURE', 'ADC samples must be numeric');
    if (Number.isFinite(a) !== Number.isFinite(b) || (Number.isFinite(a) && a !== b)) {
      fail('ADC_SAMPLE_PAIR', 'ADC point pair must contain the same finite voltage or two nonfinite gaps');
    }
    const result = model.quantize(a);
    directions[index] = result.clipping;
    codes[index] = result.code;
    if (result.clipping === 'gap') clippingCounts.gaps++;
    else {
      clippingCounts.finite++;
      if (result.clipping !== 'none') clippingCounts[result.clipping]++;
      modeled[index * 2] = modeled[index * 2 + 1] = result.volts;
    }
  }
  const base = {capture: 'sample', channelType: 'voltage', startTNs, sampleIntervalNs, count, writeIndex};
  if (data.depth !== undefined) base.depth = data.depth;
  const source = Object.freeze({startTimeNs: String(startTNs), sampleIntervalNs: String(sampleIntervalNs),
    count, writeIndex, depth});
  const adc = Object.freeze({descriptor: model.descriptor, source, rawSamples,
    codes: Object.freeze(codes), clippingDirections: Object.freeze(directions),
    clippingCounts: Object.freeze(clippingCounts)});
  return Object.freeze({raw: Object.freeze({...base, samples: rawSamples}),
    data: Object.freeze({...base, samples: Object.freeze(modeled), adc})});
}
