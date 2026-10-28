/**
 * Opt-in scope AC input coupling: an ideal first-order RC high-pass applied to
 * an actual captured voltage point ring, producing a separately labelled view.
 *
 * Model choice, not a measured instrument: a series coupling capacitor C into
 * an input resistance R, tau = R*C, corner fc = 1/(2*pi*tau). Real scopes put
 * fc roughly in the 1..10 Hz range; no default corner exists here, the caller
 * must state one (cornerHz) or tau (tauSeconds) explicitly.
 *
 * Continuous model: y' = x' - y/tau (y = x - v_C, tau*v_C' = x - v_C).
 * Discretisation: the input is taken as piecewise linear between samples
 * (slope s = (x1-x0)/h on each interval). For that input the recurrence
 *     y1 = a*y0 + (x1 - x0) * (tau/h) * (1 - a),   a = exp(-h/tau)
 * is the exact solution, not an approximation; constant and ramp inputs are
 * therefore reproduced to rounding. Bilinear (Tustin) was not chosen because
 * it warps frequency and is not exact for any non-trivial input class.
 *
 * Initial condition at the first retained sample x0:
 *   'uncharged' (default): v_C = 0, so y0 = x0 (a step applied at capture start)
 *   'settled':  v_C = x0, so y0 = 0 (input had been at x0 for a long time)
 */
const models = new WeakSet();
const fail = (code, message) => { const error = new Error(message); error.code = code; throw error; };
const OPTION_KEYS = ['cornerHz', 'tauSeconds', 'initial'];

export function createScopeCoupling(options = {}) {
  const unknown = Object.keys(options).find(key => !OPTION_KEYS.includes(key));
  if (unknown) fail('COUPLING_OPTION', `unknown AC coupling option "${unknown}"`);
  const hasCorner = options.cornerHz !== undefined, hasTau = options.tauSeconds !== undefined;
  if (!hasCorner && !hasTau) fail('COUPLING_TAU', 'AC coupling needs an explicit cornerHz or tauSeconds');
  if (hasCorner && hasTau) fail('COUPLING_TAU', 'AC coupling takes exactly one of cornerHz or tauSeconds');
  const positive = (name, value) => {
    if (typeof value !== 'number' || !Number.isFinite(value) || !(value > 0)) {
      fail('COUPLING_TAU', `AC coupling ${name} must be a finite positive number`);
    }
    return value;
  };
  const tauSeconds = hasTau ? positive('tauSeconds', options.tauSeconds)
    : 1 / (2 * Math.PI * positive('cornerHz', options.cornerHz));
  const cornerHz = hasCorner ? options.cornerHz : 1 / (2 * Math.PI * tauSeconds);
  if (!(tauSeconds > 0) || !Number.isFinite(tauSeconds) || !(cornerHz > 0) || !Number.isFinite(cornerHz)) {
    fail('COUPLING_TAU', 'AC coupling tauSeconds/cornerHz is not representable');
  }
  const initial = options.initial ?? 'uncharged';
  if (!['uncharged', 'settled'].includes(initial)) fail('COUPLING_INITIAL', 'AC coupling initial must be "uncharged" or "settled"');
  const descriptor = Object.freeze({ schemaVersion: 1, kind: 'first-order-rc-highpass',
    tauSeconds, cornerHz, specified: hasTau ? 'tauSeconds' : 'cornerHz', initial,
    discretization: 'exact-for-piecewise-linear-input', modelChoice: true, physicalHardwareModel: false });
  const model = Object.freeze({ descriptor });
  models.add(model);
  return model;
}

/** Copy a fully finite point ring and return a separately labelled coupled view. */
export function coupleScopeCapture(actualSampleData, model) {
  const data = actualSampleData;
  if (!models.has(model)) fail('COUPLING_MODEL', 'AC coupling model must come from createScopeCoupling');
  if (!data || data.capture !== 'sample' || data.channelType !== 'voltage'
    || Object.hasOwn(data, 'adc') || Object.hasOwn(data, 'coupling')) {
    fail('COUPLING_CAPTURE', 'AC coupling requires an unmodeled voltage sample capture');
  }
  const samples = data.samples;
  if ((!Array.isArray(samples) && !(samples instanceof Float64Array) && !(samples instanceof Float32Array)) ||
    samples.length < 2 || samples.length % 2) fail('COUPLING_CAPTURE', 'AC coupling requires interleaved voltage pairs');
  const depth = samples.length / 2, { count, writeIndex, startTNs, sampleIntervalNs } = data;
  if (!Number.isSafeInteger(count) || count < 0 || !Number.isSafeInteger(writeIndex) || writeIndex < 0 ||
    writeIndex >= depth || writeIndex !== count % depth || (data.depth !== undefined && data.depth !== depth) ||
    typeof startTNs !== 'bigint' || typeof sampleIntervalNs !== 'bigint' || sampleIntervalNs <= 0n) {
    fail('COUPLING_CAPTURE_METADATA', 'AC coupling requires consistent ring metadata and BigInt sample clocks');
  }
  const rawSamples = Object.freeze(Array.from(samples));
  const modeled = Array(samples.length).fill(NaN), retained = Math.min(count, depth);
  const oldest = (writeIndex - retained + depth) % depth;
  const { tauSeconds: tau, initial } = model.descriptor;
  const h = Number(sampleIntervalNs) / 1e9, a = Math.exp(-h / tau), gain = (tau / h) * -Math.expm1(-h / tau);
  let previousX = 0, y = 0;
  for (let offset = 0; offset < retained; offset++) {
    const index = (oldest + offset) % depth, x = rawSamples[2 * index], b = rawSamples[2 * index + 1];
    if (typeof x !== 'number' || !Number.isFinite(x) || x !== b) {
      fail('COUPLING_GAP', 'AC coupling refuses a gap or unequal point pair in the retained capture');
    }
    y = offset === 0 ? (initial === 'uncharged' ? x : 0) : a * y + (x - previousX) * gain;
    previousX = x;
    modeled[2 * index] = modeled[2 * index + 1] = y;
  }
  const base = { capture: 'sample', channelType: 'voltage', startTNs, sampleIntervalNs, count, writeIndex };
  if (data.depth !== undefined) base.depth = data.depth;
  const coupling = Object.freeze({ descriptor: model.descriptor, rawSamples });
  return Object.freeze({ ...base, samples: Object.freeze(modeled), coupling });
}
