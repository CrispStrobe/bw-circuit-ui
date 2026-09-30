/** Pure parsing, endpoint resolution and scope summaries for `bwc measure`. */

const UNIT_SCALE = Object.freeze({
  ns: 1e-9, us: 1e-6, ms: 1e-3, s: 1,
  hz: 1, khz: 1e3, mhz: 1e6,
});

export const MEASUREMENT_MAX_SAMPLES = 200_000;

// A single batch advance in this domain has no device deadlines or driven PWM
// subdivisions. The engine's fixed per-integrator cap is therefore a capture
// cap, unlike an arbitrary sequence of --watch advances on a timed-device graph.
const PRECISION_PARTS = new Set(['resistor','capacitor','cap','inductor','gnd',
  'vsource','isource','vcvs','vccs']);
const PRECISION_WAVES = new Set(['dc','sine','square','triangle','pulse',
  'spice-sine','spice-pulse','spice-exp']);

export function validatePrecisionCaptureInput(parts, scopeCount, meterModes) {
  if (!Array.isArray(parts) || parts.length>32) {
    throw new Error('precision batch limits the circuit to 32 parts');
  }
  if (!(scopeCount>=1 && scopeCount<=4)) {
    throw new Error('precision batch requires 1 to 4 scope channels');
  }
  if (meterModes.length>8 || meterModes.some(mode => !['voltage','current'].includes(mode))) {
    throw new Error('precision batch allows at most 8 voltage/current meters; resistance requires a second advance');
  }
  for (const part of parts) {
    if (part.analysisBlockers?.length) {
      throw new Error(`precision batch refuses retained analysis blockers on ${part.id}`);
    }
    if (['ic','initial','initialVoltage','initialCurrent'].some(key =>
      Object.hasOwn(part.params ?? {},key))) {
      throw new Error(`precision batch refuses explicit initial conditions on ${part.id}`);
    }
    if (!PRECISION_PARTS.has(part.kind)) {
      throw new Error(`precision batch refuses part ${part.id} (${part.kind}); timed/non-passive models need a whole-run budget`);
    }
    if (['vsource','isource'].includes(part.kind)
        && !PRECISION_WAVES.has(part.params?.wave ?? 'dc')) {
      throw new Error(`precision batch refuses source ${part.id} waveform ${part.params.wave}`);
    }
  }
}

/** Conservative voltage-constraint admission, not another waveform parser. */
export function validatePrecisionVoltageTopology(parts, nets) {
  const ground = Symbol('all native ground terminals');
  const groundParts = new Set(parts.filter(part => part.kind==='gnd').map(part => part.id));
  const groundNets = new Set(nets.filter(net => net.terminals.some(terminal =>
    groundParts.has(terminal.part))).map(net => net.id));
  const parent = new Map();
  const root = node => {
    if (!parent.has(node)) parent.set(node,node);
    while (node!==parent.get(node)) node = parent.get(node);
    return node;
  };
  const nodeAt = (part,terminal) => {
    const matches = nets.filter(net => net.terminals.some(t => t.part===part.id && t.terminal===terminal));
    if (matches.length!==1) throw new Error(`precision batch requires one net for ${part.id}.${terminal}`);
    return groundNets.has(matches[0].id) ? ground : matches[0].id;
  };
  for (const part of parts) {
    if (!['vsource','vcvs'].includes(part.kind)) continue;
    const positive = nodeAt(part,part.kind==='vsource'?'pos':'outp');
    const negative = nodeAt(part,part.kind==='vsource'?'neg':'outn');
    // A declared DC zero is a valid redundant short. Other redundant rows,
    // including initially-zero waveforms, need a stronger time-domain source
    // consistency proof; legacy convergence alone does not provide it.
    if (positive===negative && part.kind==='vsource'
        && (part.params?.wave ?? 'dc')==='dc' && part.params?.volts===0) continue;
    const a = root(positive), b = root(negative);
    if (a===b) throw new Error(`precision batch refuses ideal voltage constraint cycle at ${part.id}`);
    parent.set(a,b);
  }
}

export function precisionCaptureBudget(clock, profile, netCount) {
  if (!(Number.isSafeInteger(netCount) && netCount>=0 && netCount<=32)) {
    throw new Error('precision batch limits the resolved circuit to 32 nets');
  }
  if (profile?.id!=='precision-v1' || !Number.isSafeInteger(profile.maxAttempts)
      || profile.maxAttempts<1 || profile.maxAttempts>20000
      || !(Number.isFinite(profile.maxStepSec) && profile.maxStepSec>0)) {
    throw new Error('precision batch requires the fixed bounded precision-v1 engine contract');
  }
  const minimumAdaptiveAttempts = Math.max(clock.captureSamples,
    Math.ceil(Number(clock.durationNs)/1e9/profile.maxStepSec));
  if (minimumAdaptiveAttempts>profile.maxAttempts) {
    throw new Error(`precision batch preflight needs ${minimumAdaptiveAttempts} adaptive attempts; limit is ${profile.maxAttempts}`);
  }
  return {maxAttempts:profile.maxAttempts,maxSolves:3*profile.maxAttempts+1,
    maxAdvances:1,minimumAdaptiveAttempts,basis:'single-advance-passive-source-domain',
    initialization:'zero-state-no-dc-operating-point',
    admission:'native-time-zero-constraint-check-and-acyclic-voltage-graph; bias-not-adopted'};
}

export function validatePrecisionCaptureWork(status, budget) {
  if (status?.profile?.id!=='precision-v1') {
    throw new Error('precision batch engine profile changed during capture');
  }
  const work = status?.work;
  if (!work || !['attempts','solves','advances'].every(key =>
    Number.isSafeInteger(work[key]) && work[key]>=0)) {
    throw new Error('precision batch returned invalid work counters');
  }
  if (work.attempts>budget.maxAttempts || work.solves>budget.maxSolves
      || work.advances>budget.maxAdvances) {
    throw new Error('precision batch exceeded its whole-capture work budget');
  }
  if (status.failure || status.accuracyMet===false
      || (work.advances>0 && status.accuracyMet!==true)) {
    throw new Error(`precision batch did not qualify: ${status.failure?.code || 'local accuracy unmet or unassessed'}`);
  }
}

/** Match the engine's integer-nanosecond clock before allocating a capture. */
export function measurementSampleClock(durationSeconds, rateHz) {
  if (![durationSeconds, rateHz].every(value => Number.isFinite(value) && value > 0)) {
    throw new Error('measurement duration and rate must be positive and finite');
  }
  const durationNs = BigInt(Math.round(durationSeconds * 1e9));
  const intervalNs = BigInt(Math.round(1e9 / rateHz));
  if (durationNs <= 0n) throw new Error('measure duration rounds to zero on the nanosecond simulation clock');
  if (intervalNs <= 0n) throw new Error('measure rate has no positive nanosecond sample interval');
  const captureSamples = Number(durationNs / intervalNs);
  if (captureSamples > MEASUREMENT_MAX_SAMPLES) {
    throw new Error(`measure rounded sample clock produces ${captureSamples} samples; limit is ${MEASUREMENT_MAX_SAMPLES}`);
  }
  return { durationNs, intervalNs, captureSamples, effectiveRateHz: 1e9 / Number(intervalNs) };
}

export function parseScaledNumber(value, kind) {
  const match = String(value ?? '').trim().match(/^([+]?(?:\d+(?:\.\d*)?|\.\d+))(ns|us|ms|s|hz|khz|mhz)?$/i);
  if (!match) throw new Error(`invalid ${kind}: ${value}`);
  const unit = (match[2] || (kind === 'duration' ? 's' : 'hz')).toLowerCase();
  if (kind === 'duration' && !['ns', 'us', 'ms', 's'].includes(unit)) throw new Error(`invalid duration unit: ${unit}`);
  if (kind === 'rate' && !['hz', 'khz', 'mhz'].includes(unit)) throw new Error(`invalid rate unit: ${unit}`);
  return Number(match[1]) * UNIT_SCALE[unit];
}

export function resolveEndpointNet(resolvedNets, selector) {
  const wanted = String(selector || '').trim();
  if (!wanted) throw new Error('empty probe endpoint');
  const nets = Array.isArray(resolvedNets) ? resolvedNets : [];
  const explicit = wanted.startsWith('net:') ? wanted.slice(4) : wanted;
  const byId = nets.filter(net => net.id === explicit);
  if (byId.length === 1) return byId[0].id;
  const dot = wanted.lastIndexOf('.');
  if (dot <= 0 || dot === wanted.length - 1) {
    throw new Error(`unknown net or endpoint "${wanted}"; use net:<id> or <part>.<terminal>`);
  }
  const part = wanted.slice(0, dot);
  const terminal = wanted.slice(dot + 1);
  const matches = nets.filter(net => (net.terminals || []).some(item => item.part === part && item.terminal === terminal));
  if (matches.length !== 1) throw new Error(`endpoint "${wanted}" resolves to ${matches.length} nets`);
  return matches[0].id;
}

export function parseScopeSpec(value) {
  const pieces = String(value || '').split(',').map(piece => piece.trim());
  if (pieces.length < 1 || pieces.length > 2 || !pieces[0]) {
    throw new Error(`invalid scope spec "${value}"; use <tip>[,<reference>]`);
  }
  return { tip: pieces[0], reference: pieces[1] || '' };
}

export function parseMeterSpec(value) {
  const colon = String(value || '').indexOf(':');
  if (colon < 1) throw new Error(`invalid meter spec "${value}"`);
  const mode = value.slice(0, colon).trim().toLowerCase();
  const probes = value.slice(colon + 1).split(',').map(piece => piece.trim()).filter(Boolean);
  if (!['voltage', 'current', 'resistance'].includes(mode)) throw new Error(`unknown meter mode "${mode}"`);
  const expected = mode === 'current' ? 1 : 2;
  if (probes.length !== expected) {
    throw new Error(`${mode} meter needs ${expected} endpoint${expected === 1 ? '' : 's'}`);
  }
  return { mode, probes };
}

function scopePointVoltage(data, index, chronologicalIndex) {
  const low = data.samples[index * 2];
  const high = data.samples[index * 2 + 1];
  if (!Number.isFinite(low) || !Number.isFinite(high)) {
    throw new Error(`scope trace has a nonfinite sample at chronological index ${chronologicalIndex}`);
  }
  const sum = low + high;
  return Number.isFinite(sum) ? sum / 2 : low / 2 + high / 2;
}

export function scopeSeries(data) {
  if (!data?.samples) return [];
  const depth = Math.floor(data.samples.length / 2);
  const count = Math.min(Number(data.count || 0), depth);
  const oldest = ((Number(data.writeIndex || 0) - count) % depth + depth) % depth;
  const values = [];
  for (let offset = 0; offset < count; offset++) {
    const index = (oldest + offset) % depth;
    // Do not drop a point: its index is the authority for its simulation timestamp.
    values.push(scopePointVoltage(data, index, offset));
  }
  return values;
}

/** Newest retained point only: two buffer reads, independent of capture length.
 * Earlier points are still validated by the final full-trace summary/comparison.
 */
export function latestTimedScopeSample(data) {
  if (!data?.samples) return null;
  const depth = Math.floor(data.samples.length / 2);
  const count = Math.min(Number(data.count || 0), depth);
  if (!count) return null;
  const index = ((Number(data.writeIndex || 0) - 1) % depth + depth) % depth;
  const volts = scopePointVoltage(data, index, count - 1);
  const startNs = BigInt(data.startTNs ?? 0n);
  const intervalNs = BigInt(Math.round(Number(data.sampleIntervalNs || 0)));
  if (intervalNs <= 0n) throw new Error('scope trace has no positive sample interval');
  const elapsedNs = BigInt(count - 1) * intervalNs;
  return { index: count - 1, timeSeconds: Number(startNs + elapsedNs) / 1e9,
    elapsedSeconds: Number(elapsedNs) / 1e9, volts };
}

/** Chronological true samples with their absolute simulation timestamps. */
export function timedScopeSeries(data) {
  const values = scopeSeries(data);
  if (!values.length) return [];
  const startNs = BigInt(data?.startTNs ?? 0n);
  const intervalNs = BigInt(Math.round(Number(data?.sampleIntervalNs || 0)));
  if (intervalNs <= 0n) throw new Error('scope trace has no positive sample interval');
  return values.map((volts, index) => ({
    index,
    timeSeconds: Number(startNs + BigInt(index) * intervalNs) / 1e9,
    elapsedSeconds: Number(BigInt(index) * intervalNs) / 1e9,
    volts,
  }));
}

export function parseExpectedWaveforms(text) {
  let value;
  try { value = JSON.parse(String(text)); } catch (error) {
    throw new Error(`expected waveform is not JSON: ${error.message}`);
  }
  if (value?.schemaVersion !== 1 || !Array.isArray(value.traces) || !value.traces.length) {
    throw new Error('expected waveform needs schemaVersion 1 and a non-empty traces array');
  }
  const traces = value.traces.map((trace, traceIndex) => {
    if (!Array.isArray(trace.samples) || !trace.samples.length) {
      throw new Error(`expected trace ${traceIndex} has no samples`);
    }
    const samples = trace.samples.map((sample, sampleIndex) => {
      if (!Number.isFinite(sample?.timeSeconds) || !Number.isFinite(sample?.volts)) {
        throw new Error(`expected trace ${traceIndex} sample ${sampleIndex} needs finite timeSeconds and volts`);
      }
      if (sampleIndex && !(sample.timeSeconds > trace.samples[sampleIndex - 1].timeSeconds)) {
        throw new Error(`expected trace ${traceIndex} timestamps are not strictly increasing`);
      }
      return { timeSeconds: sample.timeSeconds, volts: sample.volts };
    });
    return { tip: String(trace.tip || ''), reference: String(trace.reference || ''), samples };
  });
  return { schemaVersion: 1, provenance: value.provenance || null, traces };
}

/** Compare exact sample grids and values; a missing point can never disappear into a tolerance. */
export function compareExpectedWaveforms(actual, expected, tolerances = {}) {
  const absoluteVolts = Number(tolerances.absoluteVolts ?? 1e-6);
  const relative = Number(tolerances.relative ?? 1e-6);
  const timeSeconds = Number(tolerances.timeSeconds ?? 1e-12);
  if (![absoluteVolts, relative, timeSeconds].every(value => Number.isFinite(value) && value >= 0)) {
    throw new Error('waveform tolerances must be finite and non-negative');
  }
  const mismatches = [];
  let compared = 0; let passed = 0; let structuralFailures = 0; let worstVolts = 0; let worstAt = null;
  if (actual.length !== expected.traces.length) {
    mismatches.push({ code: 'trace-count', actual: actual.length, expected: expected.traces.length });
    structuralFailures++;
  }
  const count = Math.max(actual.length, expected.traces.length);
  for (let traceIndex = 0; traceIndex < count; traceIndex++) {
    const a = actual[traceIndex]; const e = expected.traces[traceIndex];
    if (!a || !e) continue;
    if (a.tip !== e.tip || (a.reference || '') !== (e.reference || '')) {
      mismatches.push({ code: 'trace-identity', traceIndex,
        actual: { tip: a.tip, reference: a.reference || '' }, expected: { tip: e.tip, reference: e.reference || '' } });
      structuralFailures++;
    }
    if (a.samples.length !== e.samples.length) {
      mismatches.push({ code: 'sample-count', traceIndex, actual: a.samples.length, expected: e.samples.length });
      structuralFailures++;
    }
    const points = Math.min(a.samples.length, e.samples.length);
    for (let sampleIndex = 0; sampleIndex < points; sampleIndex++) {
      const av = a.samples[sampleIndex]; const ev = e.samples[sampleIndex];
      compared++;
      const timeError = Math.abs(av.timeSeconds - ev.timeSeconds);
      const voltageError = Math.abs(av.volts - ev.volts);
      const allowed = absoluteVolts + relative * Math.max(Math.abs(av.volts), Math.abs(ev.volts));
      const finite = [av.timeSeconds, ev.timeSeconds, av.volts, ev.volts].every(Number.isFinite);
      const ok = finite && timeError <= timeSeconds && voltageError <= allowed;
      if (ok) passed++;
      if (finite && voltageError > worstVolts) {
        worstVolts = voltageError;
        worstAt = { traceIndex, sampleIndex, timeSeconds: av.timeSeconds, actualVolts: av.volts, expectedVolts: ev.volts };
      }
      if (!ok && mismatches.length < 20) mismatches.push({ code: !finite ? 'sample-nonfinite'
        : timeError > timeSeconds ? 'sample-time' : 'sample-voltage',
        traceIndex, sampleIndex, actualTimeSeconds: av.timeSeconds, expectedTimeSeconds: ev.timeSeconds,
        actualVolts: av.volts, expectedVolts: ev.volts, voltageError, allowedVolts: allowed });
    }
  }
  if (!compared && !structuralFailures) {
    mismatches.push({ code: 'no-compared-samples' });
    structuralFailures++;
  }
  return { status: structuralFailures || passed !== compared ? 'fail' : 'pass',
    counts: { traces: actual.length, compared, passed, failed: compared - passed, structuralFailures },
    tolerances: { absoluteVolts, relative, timeSeconds }, worstVolts, worstAt, mismatches };
}

export function summarizeScope(data) {
  const values = scopeSeries(data);
  if (!values.length) return { samples: 0, minVolts: null, maxVolts: null, meanVolts: null, rmsVolts: null, lastVolts: null };
  let min = Infinity; let max = -Infinity; let sum = 0; let squares = 0;
  for (const value of values) {
    min = Math.min(min, value); max = Math.max(max, value); sum += value; squares += value * value;
  }
  return {
    samples: values.length,
    minVolts: min,
    maxVolts: max,
    meanVolts: sum / values.length,
    rmsVolts: Math.sqrt(squares / values.length),
    lastVolts: values.at(-1),
  };
}
