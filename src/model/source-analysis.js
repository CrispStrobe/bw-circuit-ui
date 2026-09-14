import { Circuit } from './circuit.js';
import { blockersFromImport } from './operating-point-view.js';
import { parseSpiceValue } from './si.js';

const CARD = Object.freeze({
  resistor: { kind: 'R', terminals: ['a', 'b'] },
  capacitor: { kind: 'C', terminals: ['a', 'b'] },
  inductor: { kind: 'L', terminals: ['a', 'b'] },
  vsource: { kind: 'V', terminals: ['pos', 'neg'], sourceTerminal: 'pos' },
  isource: { kind: 'I', terminals: ['neg', 'pos'] },
  diode: { kind: 'D', terminals: ['anode', 'cathode'] },
  zener: { kind: 'D', terminals: ['anode', 'cathode'] },
  npn: { kind: 'Q', terminals: ['collector', 'base', 'emitter'] },
  pnp: { kind: 'Q', terminals: ['collector', 'base', 'emitter'] },
  nmos: { kind: 'M', terminals: ['drain', 'gate', 'source', 'body'] },
  pmos: { kind: 'M', terminals: ['drain', 'gate', 'source', 'body'] },
  vcvs: { kind: 'E', terminals: ['outp', 'outn', 'inp', 'inn'], sourceTerminal: 'outp' },
  // SPICE G current flows from its first output node to its second; the native
  // positive gm convention is reversed, so import maps that order to outn/outp.
  vccs: { kind: 'G', terminals: ['outn', 'outp', 'inp', 'inn'] },
});

const SOURCE_KINDS = new Set(['V', 'I', 'E', 'G', 'F', 'H']);
export const SOURCE_OBSERVATION_PROFILE = 'source-declared-v1';
export const BOUNDED_RESEARCH_OBSERVATION_PROFILE = 'bounded-research-v1';
const normalize = value => String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
const finite = value => typeof value === 'number' && Number.isFinite(value);
const nanoseconds = seconds => {
  const raw = seconds * 1e9;
  const rounded = Math.round(raw);
  return finite(seconds) && Number.isSafeInteger(rounded) && Math.abs(raw - rounded) <= 1e-5
    ? rounded : null;
};

/** Enumerate source analysis cards without deduplicating cards of one kind. */
export function sourceAnalysisDescriptors(cards = []) {
  return cards.map((card, ordinal) => {
    const source = String(card || '').trim();
    const normalized = normalize(card);
    const kind = /^\.(op|ac|tran|dc|noise)\b/.exec(normalized)?.[1] || 'unknown';
    return { id: `${ordinal}:${kind}`, ordinal, kind, source, normalized };
  });
}

function terminalKey(part, terminal) { return `${part}\0${terminal}`; }

/**
 * Map imported SPICE topology to anonymous source-order identities. Raw node
 * names and part references remain internal; callers receive only n0/s0 ids.
 */
function canonicalCircuit(imported, circuit) {
  const engineNet = new Map();
  for (const net of circuit.resolvedNets || []) {
    for (const terminal of net.terminals || []) {
      engineNet.set(terminalKey(terminal.part, terminal.terminal), net.id);
    }
  }
  const groundParts = new Set((circuit.parts || []).filter(part => part.kind === 'gnd').map(part => part.id));
  const groundNets = new Set((circuit.resolvedNets || []).filter(net =>
    (net.terminals || []).some(terminal => groundParts.has(terminal.part))).map(net => net.id));
  const foldedNames = new Map();
  const canonicalByTerminal = new Map();
  const nodeNets = new Map();
  let nextNode = 0;
  for (const sourceNet of imported.netNames || []) {
    const folded = String(sourceNet.name || '').toLowerCase();
    const resolvedNets = new Set((sourceNet.terminals || []).map(terminal =>
      engineNet.get(terminalKey(terminal.partId, terminal.terminal))).filter(value => value != null));
    // Describe the topology the native engine actually received. If an
    // importer aliases a named node onto its ground part, the native hash says
    // `gnd`; an independent SPICE parser that retained it as nN will disagree.
    let id = folded === '0' || [...resolvedNets].some(net => groundNets.has(net))
      ? 'gnd' : foldedNames.get(folded);
    if (!id) { id = `n${nextNode++}`; foldedNames.set(folded, id); }
    for (const terminal of sourceNet.terminals || []) {
      const key = terminalKey(terminal.partId, terminal.terminal);
      canonicalByTerminal.set(key, id);
      const resolved = engineNet.get(key);
      if (resolved == null) throw new Error(`canonical topology cannot resolve imported terminal ${terminal.partId}.${terminal.terminal}`);
      const prior = nodeNets.get(id);
      if (prior != null && prior !== resolved) throw new Error(`case-folded source node ${id} resolves to more than one native net`);
      nodeNets.set(id, resolved);
    }
  }

  const cards = [];
  const sources = [];
  for (const part of imported.parts || []) {
    if (part.kind === 'gnd') continue;
    const spec = CARD[part.kind];
    if (!spec) throw new Error(`canonical topology has no source-card mapping for native kind ${part.kind}`);
    const nodes = spec.terminals.map(terminal => {
      const id = canonicalByTerminal.get(terminalKey(part.id, terminal));
      if (!id) throw new Error(`canonical topology is missing ${part.id}.${terminal}`);
      return id;
    });
    const card = { kind: spec.kind, nodes };
    if (SOURCE_KINDS.has(spec.kind)) {
      card.sourceId = `s${sources.length}`;
      sources.push({ id: card.sourceId, partId: part.id, kind: spec.kind,
        currentTerminal: spec.sourceTerminal || null });
    }
    cards.push(card);
  }
  const nodes = [...nodeNets].filter(([id]) => id !== 'gnd').map(([id, netId]) => ({ id, netId }));
  return { cards, nodes, sources };
}

function circuitFor(imported) {
  return Circuit.fromJSON({
    parts: imported.parts || [], wires: imported.wires || [], analysisBlockers: [],
  });
}

function integrationGap(descriptor, code, detail, conditions = null) {
  return {
    analysisId: descriptor.id, ordinal: descriptor.ordinal, kind: descriptor.kind,
    status: 'not-run', classification: 'integration-gap', code, detail,
    ...(conditions ? { conditions } : {}),
  };
}

function mappingGap(descriptor, error, conditions = null) {
  return integrationGap(descriptor, 'canonical-topology-unavailable',
    String(error?.message || error), conditions);
}

function sourceRefusal(descriptor, code, detail, conditions = null) {
  return {
    analysisId: descriptor.id, ordinal: descriptor.ordinal, kind: descriptor.kind,
    status: 'refused', classification: 'source-condition', code, detail,
    ...(conditions ? { conditions } : {}),
  };
}

function solverRefusal(descriptor, error, conditions = null) {
  return {
    analysisId: descriptor.id, ordinal: descriptor.ordinal, kind: descriptor.kind,
    status: 'refused', classification: 'solver-refusal', code: 'native-analysis-refused',
    detail: String(error?.message || error), ...(conditions ? { conditions } : {}),
  };
}

function runOp(imported, descriptor) {
  if (descriptor.normalized !== '.op') return sourceRefusal(descriptor, 'invalid-op-card', '.op takes no arguments');
  let circuit;
  try { circuit = circuitFor(imported); }
  catch (error) { return mappingGap(descriptor, error); }
  if (circuit.netlistError != null) return mappingGap(descriptor, circuit.netlistError);
  let point;
  try {
    point = circuit.operatingPoint({ waveformBias: 'dc-value' });
    if (!point?.converged) return solverRefusal(descriptor, 'DC operating point did not converge');
    const conflicts = [...(point.conflicts || []), ...(point.railConflicts || [])];
    if (conflicts.length) return solverRefusal(descriptor,
      `DC operating point reported ${conflicts.length} conflicting fixed-voltage constraint(s)`);
  } catch (error) { return solverRefusal(descriptor, error); }
  try {
    const canonical = canonicalCircuit(imported, circuit);
    const nodes = canonical.nodes.map(({ id, netId }) => ({ id, voltage: point.nodeVoltages.get(netId) }));
    if (nodes.some(node => !finite(node.voltage))) return solverRefusal(descriptor, 'DC operating point returned a non-finite node voltage');
    const sourceCurrents = [];
    const unavailableSourceCurrents = [];
    for (const source of canonical.sources) {
      if (!source.currentTerminal) { unavailableSourceCurrents.push(source.id); continue; }
      const current = point.branchCurrents.get(source.partId)?.get(source.currentTerminal);
      if (!finite(current)) unavailableSourceCurrents.push(source.id);
      else sourceCurrents.push({ id: source.id, current });
    }
    return {
      analysisId: descriptor.id, ordinal: descriptor.ordinal, kind: 'op', status: 'pass',
      classification: 'native-original', conditions: { sourceDeclared: true, axis: null },
      topology: canonical.cards,
      observables: { axis: null, nodes, sourceCurrents, unavailableSourceCurrents },
      convergence: { converged: true, conflicts: [] },
      evidence: 'original-direct', adapted: [],
      thermal: 'native-fixed-26.8267934421C; no oracle comparison performed',
      metadata: point.analysis || null,
    };
  } catch (error) { return mappingGap(descriptor, error); }
}

function parseAc(descriptor, limits) {
  const fields = descriptor.normalized.split(' ');
  if (fields.length !== 5 || fields[1] !== 'dec') return integrationGap(descriptor,
    'ac-form-not-implemented', 'only .ac dec N FSTART FSTOP is currently wired');
  const pointsPerDecade = Number(fields[2]);
  const startHz = parseSpiceValue(fields[3]);
  const stopHz = parseSpiceValue(fields[4]);
  if (!Number.isSafeInteger(pointsPerDecade) || pointsPerDecade <= 0
      || !finite(startHz) || !finite(stopHz) || !(startHz > 0) || !(stopHz > startHz)) {
    return sourceRefusal(descriptor, 'invalid-ac-card', 'AC DEC count and frequency bounds must be finite and positive');
  }
  const intervals = Math.log10(stopHz / startHz) * pointsPerDecade;
  const rounded = Math.round(intervals);
  if (Math.abs(intervals - rounded) > 1e-10) return integrationGap(descriptor,
    'ac-grid-not-implemented', 'the native grid is used only when the authored DEC interval count is integral');
  const points = rounded + 1;
  if (points < 2 || points > limits.maxPoints) return integrationGap(descriptor,
    'analysis-budget-exceeded', `AC requests ${points} points; adapter limit is ${limits.maxPoints}`);
  return { pointsPerDecade, startHz, stopHz, points };
}

function runAc(imported, descriptor, limits) {
  const parsed = parseAc(descriptor, limits);
  if (parsed.status) return parsed;
  const excitations = (imported.parts || []).filter(part =>
    (part.kind === 'vsource' || part.kind === 'isource')
    && Object.prototype.hasOwnProperty.call(part.params || {}, 'acMagnitude'));
  if (excitations.length !== 1 || excitations[0].kind !== 'vsource') {
    const kinds = excitations.map(part => part.kind).join(', ') || 'none';
    return integrationGap(descriptor, 'ac-source-set-not-implemented',
      `exactly one explicit AC voltage source and no other AC excitation is required; found ${kinds}`, parsed);
  }
  const source = excitations[0];
  const amplitude = source.params.acMagnitude;
  const phaseDeg = source.params.acPhase ?? 0;
  if (!finite(amplitude) || amplitude < 0 || !finite(phaseDeg)) return sourceRefusal(descriptor,
    'invalid-ac-source', 'AC magnitude must be finite and non-negative and phase must be finite');
  let circuit;
  try { circuit = circuitFor(imported); }
  catch (error) { return mappingGap(descriptor, error, parsed); }
  if (circuit.netlistError != null) return mappingGap(descriptor, circuit.netlistError, parsed);
  if (typeof circuit.board?.runAc !== 'function') return integrationGap(descriptor,
    'native-ac-api-unavailable', 'the injected board does not expose runAc', parsed);
  let canonical;
  try { canonical = canonicalCircuit(imported, circuit); }
  catch (error) { return mappingGap(descriptor, error, parsed); }
  try {
    if (canonical.nodes.length * parsed.points > limits.maxObservations) return integrationGap(descriptor,
      'analysis-budget-exceeded', 'AC node-point product exceeds the adapter observation limit', parsed);
    const probes = canonical.nodes.map(node => node.netId);
    const rows = circuit.board.runAc({ sourceId: source.id, from: parsed.startHz,
      to: parsed.stopHz, pointsPerDecade: parsed.pointsPerDecade, probes });
    if (rows.length !== parsed.points) return integrationGap(descriptor, 'native-ac-grid-mismatch',
      `native returned ${rows.length} points for an authored ${parsed.points}-point DEC grid`, parsed);
    if (rows.some(row => row.outOfLinear?.length)) return solverRefusal(descriptor,
      'small-signal linearization is outside a proven device region', parsed);
    const sourceId = canonical.sources.find(entry => entry.partId === source.id)?.id;
    if (!sourceId) return mappingGap(descriptor, 'canonical AC source mapping is missing', parsed);
    const nodes = canonical.nodes.map(node => ({
      id: node.id,
      magnitude: rows.map(row => row.results.get(node.netId)?.mag * amplitude),
      phaseDeg: rows.map(row => (row.results.get(node.netId)?.phaseDeg ?? NaN) + phaseDeg),
    }));
    if (nodes.some(node => [...node.magnitude, ...node.phaseDeg].some(value => !finite(value)))) {
      return solverRefusal(descriptor, 'native AC returned a missing or non-finite observation', parsed);
    }
    return {
      analysisId: descriptor.id, ordinal: descriptor.ordinal, kind: 'ac', status: 'pass',
      classification: 'native-original',
      conditions: { ...parsed, sweep: 'dec', sourceId, amplitude, phaseDeg },
      topology: canonical.cards,
      observables: { axis: { quantity: 'frequency', unit: 'Hz', values: rows.map(row => row.hz) }, nodes },
      evidence: 'original-direct', adapted: [],
      thermal: 'native-fixed-26.8267934421C; no oracle comparison performed',
    };
  } catch (error) { return solverRefusal(descriptor, error, parsed); }
}

function boundedObservationTimes(startNs, stopNs, limits, targetIntervals = 100) {
  const span = stopNs - startNs;
  const intervals = Math.min(targetIntervals, limits.maxPoints - 1, Math.max(1, span));
  if (!Number.isSafeInteger(intervals) || intervals < 1) return null;
  return [...new Set(Array.from({ length: intervals + 1 }, (_, index) =>
    startNs + Math.round(index * span / intervals)))];
}

function parseTran(descriptor, limits) {
  const fields = descriptor.normalized.split(' ');
  const modifiers = [];
  while (['uic', 'startup'].includes(fields.at(-1))) modifiers.unshift(fields.pop());
  const uic = modifiers.includes('uic');
  const startup = modifiers.includes('startup');
  if (uic && startup) return sourceRefusal(descriptor, 'invalid-tran-card',
    '.tran UIC and startup request different initialization semantics and cannot be combined',
    { sourceArguments: { source: descriptor.source, normalized: descriptor.normalized, uic, startup } });
  if (startup) return integrationGap(descriptor, 'tran-startup-not-implemented',
    'LTspice startup ramps independent sources from zero and is not equivalent to ordinary non-UIC initialization',
    { sourceArguments: { source: descriptor.source, normalized: descriptor.normalized, uic, startup } });
  const values = fields.slice(1);
  if (values.length < 1 || values.length > 4) return integrationGap(descriptor,
    'tran-form-not-implemented',
    'supported forms are .tran TSTOP or .tran TSTEP TSTOP [TSTART [TMAX]], optionally followed by UIC');
  const authored = values.map(parseSpiceValue);
  if (!authored.every(finite)) return sourceRefusal(descriptor, 'invalid-tran-card',
    'transient time fields must be complete finite SPICE scalars');
  const oneArgument = values.length === 1;
  const stepSec = oneArgument ? null : authored[0];
  const stopSec = oneArgument ? authored[0] : authored[1];
  const startSec = authored[2] ?? 0;
  const maxStepSec = authored[3] ?? null;
  const stopNs = nanoseconds(stopSec);
  const startNs = nanoseconds(startSec);
  if (!(stopSec > 0) || stopNs == null) {
    return sourceRefusal(descriptor, 'invalid-tran-card', 'transient stop must map to a finite positive integer nanosecond');
  }
  if (startNs == null || startSec < 0 || startNs >= stopNs) return sourceRefusal(descriptor,
    'invalid-tran-card', 'transient TSTART must be a non-negative integer nanosecond before TSTOP');
  if (stepSec != null && stepSec < 0) return sourceRefusal(descriptor,
    'invalid-tran-card', 'transient TSTEP must be non-negative');
  if (maxStepSec != null && !(maxStepSec > 0)) return sourceRefusal(descriptor,
    'invalid-tran-card', 'transient TMAX must be positive when present');

  let stepNs = stepSec == null ? null : nanoseconds(stepSec);
  let sampleTimesNs; let samplingProfile;
  if (stepSec == null || stepSec === 0) {
    // No positive plot cadence was authored. Sampling is an explicit output
    // profile; the engine still integrates adaptively and honors source edges.
    sampleTimesNs = boundedObservationTimes(startNs, stopNs, limits);
    if (!sampleTimesNs) return integrationGap(descriptor,
      'analysis-budget-exceeded', 'the bounded observation profile has no available transient samples');
    samplingProfile = { id: 'bounded-uniform-observation-v1', sourceDeclared: false,
      adapted: true, targetIntervals: 100,
      reason: stepSec === 0 ? 'source TSTEP is zero' : 'source declares no TSTEP' };
  } else {
    const exactGrid = stepNs != null && stepNs > 0;
    const requestedPoints = exactGrid ? Math.floor((stopNs - startNs) / stepNs) + 1
      + (((stopNs - startNs) % stepNs) === 0 ? 0 : 1) : Infinity;
    if (!exactGrid || requestedPoints > limits.maxPoints) {
      if (limits.observationProfile !== BOUNDED_RESEARCH_OBSERVATION_PROFILE) {
        return integrationGap(descriptor, !exactGrid
          ? 'tran-grid-not-representable' : 'analysis-budget-exceeded',
        !exactGrid
          ? 'positive TSTEP does not map to an exact integer-nanosecond observation cadence; select bounded-research-v1 to adapt observations only'
          : `transient requests ${requestedPoints} observations; adapter limit is ${limits.maxPoints}; select bounded-research-v1 to adapt observations only`);
      }
      sampleTimesNs = boundedObservationTimes(startNs, stopNs, limits);
      if (!sampleTimesNs) return integrationGap(descriptor,
        'analysis-budget-exceeded', 'the bounded research observation profile has no available transient samples');
      samplingProfile = { id: BOUNDED_RESEARCH_OBSERVATION_PROFILE, sourceDeclared: false,
        adapted: true, targetIntervals: 100, requestedTstepSec: stepSec,
        requestedPoints: Number.isFinite(requestedPoints) ? requestedPoints : null };
    } else {
      sampleTimesNs = [];
      for (let time = startNs; time <= stopNs; time += stepNs) sampleTimesNs.push(time);
      if (sampleTimesNs.at(-1) !== stopNs) sampleTimesNs.push(stopNs);
      samplingProfile = { id: 'source-tstep-v1', sourceDeclared: true, adapted: false,
        endpointPolicy: 'include-tstop' };
    }
  }
  const points = sampleTimesNs.length;
  if (points > limits.maxPoints) return integrationGap(descriptor, 'analysis-budget-exceeded',
    `transient requests ${points} points; adapter limit is ${limits.maxPoints}`);
  return { sourceArguments: { source: descriptor.source, normalized: descriptor.normalized, tstepSec: stepSec,
    tstopSec: stopSec, tstartSec: startSec, tmaxSec: maxStepSec, uic, startup: false },
  stepSec, stopSec, startSec, maxStepSec, stepNs, stopNs, startNs, points, uic,
  sampleTimesNs, samplingProfile, observationProfileRequested: limits.observationProfile,
  integrationWindow: { startSec: 0, stopSec }, outputWindow: { startSec, stopSec },
    initialization: uic ? 'uic-zero-state' : 'source-declared-dc-operating-point' };
}

function transientSourceBreakpoints(parts, stopSec, maxPoints) {
  const values = new Set();
  let truncated = false;
  const addSeconds = seconds => {
    if (!finite(seconds) || seconds < 0) throw new Error('source breakpoint must be finite and non-negative');
    if (seconds <= stopSec && values.size < maxPoints) values.add(seconds);
    else if (seconds <= stopSec) truncated = true;
  };
  for (const part of parts || []) {
    const p = part.params || {};
    if (p.wave === 'spice-pwl') {
      for (const point of p.points || []) addSeconds(point[0]);
    } else if (p.wave === 'spice-exp') {
      addSeconds(p.td1); addSeconds(p.td2);
    } else if (p.wave === 'spice-sine') {
      addSeconds(p.td);
    } else if (p.wave === 'spice-pulse') {
      if (!(p.per > 0)) throw new Error('PULSE period must be positive');
      const offsets = [...new Set([0, p.tr, p.tr + p.pw, p.tr + p.pw + p.tf])];
      for (let base = p.td; base <= stopSec; base += p.per) {
        for (const offset of offsets) addSeconds(base + offset);
        if (truncated) break;
      }
    }
  }
  return { seconds: [...values].sort((a, b) => a - b), truncated };
}

function workOf(status) {
  const work = status?.work || {};
  const counts = { attempts: Number(work.attempts), solves: Number(work.solves),
    advances: Number(work.advances) };
  return Object.values(counts).every(value => Number.isSafeInteger(value) && value >= 0)
    ? counts : null;
}

function executionProfile(profile, status, limits) {
  return {
    requested: profile,
    configured: status?.profile || null,
    integrationMode: status?.integrationMode || null,
    qualification: {
      accuracyMet: status?.accuracyMet ?? null,
      scope: 'native local transient-step acceptance and solve convergence',
      globalOutputAccuracy: false,
      oracleComparison: 'not-performed',
    },
    work: workOf(status),
    totalWorkLimits: {
      attempts: limits.maxTotalAttempts,
      solves: limits.maxTotalSolves,
      advances: limits.maxTotalAdvances,
    },
    ...(status?.failure ? { failure: status.failure } : {}),
  };
}

function profileGap(descriptor, code, detail, parsed, profile, status, limits) {
  return integrationGap(descriptor, code, detail, {
    ...parsed, executionProfile: executionProfile(profile, status, limits),
  });
}

function precisionRefusal(descriptor, detail, parsed, profile, status, limits) {
  return {
    analysisId: descriptor.id, ordinal: descriptor.ordinal, kind: descriptor.kind,
    status: 'refused', classification: 'solver-refusal', code: 'transient-accuracy-unmet',
    detail, conditions: { ...parsed, executionProfile: executionProfile(profile, status, limits) },
  };
}

function runTran(imported, descriptor, limits) {
  const parsed = parseTran(descriptor, limits);
  if (parsed.status) return parsed;
  try {
    const breakpointRecord = transientSourceBreakpoints(imported.parts, parsed.stopSec, limits.maxPoints);
    const breakpointsSec = breakpointRecord.seconds;
    const integerBreakpointsNs = breakpointsSec.map(nanoseconds);
    const publiclyRepresentableNs = integerBreakpointsNs.filter(value => value != null
      && value >= parsed.startNs && value <= parsed.stopNs);
    if (breakpointsSec.length || breakpointRecord.truncated) {
      parsed.samplingProfile = { ...parsed.samplingProfile,
        sourceBreakpointsIncluded: false,
        sourceBreakpointsAreIntegrationBarriers: true };
      parsed.sourceBreakpoints = {
        exactSeconds: breakpointsSec,
        enumerationTruncated: breakpointRecord.truncated,
        integration: 'native-engine-source-edge-barriers',
        addedToObservationGrid: false,
        publiclyRepresentableNanoseconds: publiclyRepresentableNs,
        beforeOutputWindow: integerBreakpointsNs.filter(value => value != null && value < parsed.startNs).length,
        fractionalNotRounded: integerBreakpointsNs.filter(value => value == null).length,
      };
      if (!parsed.uic) {
        parsed.initialization = 'source-declared-waveform-time-zero-operating-point';
      }
    }
  } catch (error) {
    return integrationGap(descriptor, 'tran-grid-not-representable', error.message, parsed);
  }
  let circuit;
  try { circuit = circuitFor(imported); }
  catch (error) { return mappingGap(descriptor, error, parsed); }
  if (circuit.netlistError != null) return mappingGap(descriptor, circuit.netlistError, parsed);
  let canonical;
  try { canonical = canonicalCircuit(imported, circuit); }
  catch (error) { return mappingGap(descriptor, error, parsed); }
  let profileStatus = null;
  if (limits.transientProfile) {
    try {
      circuit.configureTransientAnalysis(limits.transientProfile);
      profileStatus = circuit.transientAnalysisStatus();
    } catch (error) {
      return profileGap(descriptor, 'transient-profile-unavailable', String(error?.message || error),
        parsed, limits.transientProfile, profileStatus, limits);
    }
    const maxStepSec = Number(profileStatus?.profile?.maxStepSec);
    if (!(maxStepSec > 0)) return profileGap(descriptor, 'transient-profile-invalid',
      'configured transient profile has no finite positive maxStepSec', parsed,
      limits.transientProfile, profileStatus, limits);
    const algebraic = profileStatus?.integrationMode === 'algebraic-direct';
    if (parsed.maxStepSec != null && !algebraic
        && maxStepSec > parsed.maxStepSec * (1 + 1e-12)) {
      return profileGap(descriptor, 'tran-tmax-not-honored',
        `source TMAX is ${parsed.maxStepSec}s but ${limits.transientProfile} permits steps up to ${maxStepSec}s`,
        parsed, limits.transientProfile, profileStatus, limits);
    }
    parsed.tmaxHandling = parsed.maxStepSec == null ? 'not-declared'
      : algebraic ? 'not-applicable-algebraic-direct'
        : 'enforced-by-equal-or-stricter-execution-profile';
    const minimumSolves = algebraic
      ? parsed.sampleTimesNs.filter(timeNs => timeNs > 0).length
      : Math.ceil(parsed.stopSec / maxStepSec);
    parsed.preflight = { minimumSolves, basis: algebraic
      ? 'algebraic-direct-nonzero-observation-count' : 'ceil(stop/maxStepSec)',
    integrationMode: profileStatus?.integrationMode || 'adaptive' };
    if (limits.ledger.solves + minimumSolves > limits.maxTotalSolves
        || limits.ledger.attempts + minimumSolves > limits.maxTotalAttempts
        || limits.ledger.advances + parsed.sampleTimesNs.length > limits.maxTotalAdvances) {
      return profileGap(descriptor, 'analysis-work-budget-exceeded',
        `precision preflight needs at least ${minimumSolves} solves and ${parsed.sampleTimesNs.length} advances; remaining total limits are ${limits.maxTotalSolves - limits.ledger.solves} solves, ${limits.maxTotalAttempts - limits.ledger.attempts} attempts, ${limits.maxTotalAdvances - limits.ledger.advances} advances`,
        parsed, limits.transientProfile, profileStatus, limits);
    }
  }
  try {
    if (canonical.nodes.length * parsed.points > limits.maxObservations) return integrationGap(descriptor,
      'analysis-budget-exceeded', 'transient node-point product exceeds the adapter observation limit', parsed);
    const axis = [];
    const values = new Map(canonical.nodes.map(node => [node.id, []]));
    let convergenceVerified = typeof circuit.board?.deviceCompanions === 'function'
      && (circuit.parts || []).length > 0;
    let converged = true;
    let initialization = null;
    if (!parsed.uic) initialization = circuit.initializeTransientFromOperatingPoint();
    let accounted = { attempts: 0, solves: 0, advances: 0 };
    const accountStatus = () => {
      if (!limits.transientProfile) return null;
      const status = circuit.transientAnalysisStatus();
      const work = workOf(status);
      if (!work || Object.keys(work).some(key => work[key] < accounted[key])) {
        throw new Error('transient profile returned invalid or non-monotonic work counters');
      }
      for (const key of Object.keys(work)) {
        limits.ledger[key] += work[key] - accounted[key];
        accounted[key] = work[key];
      }
      profileStatus = status;
      if (limits.ledger.attempts > limits.maxTotalAttempts
          || limits.ledger.solves > limits.maxTotalSolves
          || limits.ledger.advances > limits.maxTotalAdvances) {
        return profileGap(descriptor, 'analysis-work-budget-exceeded',
          'cumulative transient work exceeded the source-analysis total limit', parsed,
          limits.transientProfile, profileStatus, limits);
      }
      if (status.failure || status.accuracyMet === false) {
        return precisionRefusal(descriptor,
          status.failure?.detail || status.failure?.code || 'precision profile did not meet its local step qualification',
          parsed, limits.transientProfile, profileStatus, limits);
      }
      return null;
    };
    let workOutcome = accountStatus();
    if (workOutcome) return workOutcome;
    for (const timeNs of parsed.sampleTimesNs) {
      circuit.advanceTo(BigInt(timeNs));
      workOutcome = accountStatus();
      if (workOutcome) return workOutcome;
      if (convergenceVerified) {
        const sample = circuit.board.deviceCompanions(circuit.parts[0].id);
        if (sample?.converged !== true) converged = false;
      }
      axis.push(timeNs / 1e9);
      for (const node of canonical.nodes) values.get(node.id).push(circuit.nodeVoltage(node.netId));
    }
    const nodes = canonical.nodes.map(node => ({ id: node.id, voltage: values.get(node.id) }));
    if (nodes.some(node => node.voltage.some(value => !finite(value)))) return solverRefusal(descriptor,
      'native transient returned a non-finite node voltage', parsed);
    if (convergenceVerified && !converged) return solverRefusal(descriptor,
      'native transient failed to converge at one or more authored sample times', parsed);
    if (limits.transientProfile && profileStatus?.accuracyMet !== true) {
      return precisionRefusal(descriptor,
        'precision profile completed without a positive local step qualification',
        parsed, limits.transientProfile, profileStatus, limits);
    }
    const adapted = [];
    if (parsed.samplingProfile.id === BOUNDED_RESEARCH_OBSERVATION_PROFILE) {
      adapted.push(`replaced the requested ${parsed.samplingProfile.requestedPoints ?? 'non-integer-nanosecond'}-point TSTEP output grid with ${parsed.points} bounded observations from ${parsed.startSec}s through ${parsed.stopSec}s; circuit integration and source timing were unchanged`);
    } else if (parsed.samplingProfile.adapted) {
      adapted.push(`generated ${parsed.points} bounded observations from ${parsed.startSec}s through ${parsed.stopSec}s because ${parsed.samplingProfile.reason}; circuit integration and source timing were unchanged`);
    }
    return {
      analysisId: descriptor.id, ordinal: descriptor.ordinal, kind: 'tran',
      status: convergenceVerified ? 'pass' : 'partial',
      classification: convergenceVerified
        ? (adapted.length ? 'native-original-adapted-observation-grid' : 'native-original')
        : 'diagnostic-native',
      ...(!convergenceVerified ? { code: 'transient-convergence-unverified' } : {}),
      conditions: parsed, topology: canonical.cards,
      evidence: adapted.length ? 'original-adapted' : 'original-direct', adapted,
      thermal: 'native-fixed-26.8267934421C; no oracle comparison performed',
      ...(limits.transientProfile ? { executionProfile: executionProfile(
        limits.transientProfile, profileStatus, limits) } : {}),
      observables: { axis: { quantity: 'time', unit: 's', values: axis }, nodes },
      convergence: { verified: convergenceVerified, converged: convergenceVerified ? true : null,
        api: convergenceVerified ? 'deviceCompanions' : null },
      ...(initialization ? { initialization: initialization.analysis } : {}),
    };
  } catch (error) {
    if (limits.transientProfile) {
      try { profileStatus = circuit.transientAnalysisStatus(); } catch { /* original error remains primary */ }
      if (profileStatus?.failure || profileStatus?.accuracyMet === false) {
        return precisionRefusal(descriptor,
          profileStatus.failure?.detail || profileStatus.failure?.code || String(error?.message || error),
          parsed, limits.transientProfile, profileStatus, limits);
      }
      return profileGap(descriptor, 'native-transient-execution-failed', String(error?.message || error),
        parsed, limits.transientProfile, profileStatus, limits);
    }
    return solverRefusal(descriptor, error, parsed);
  }
}

/**
 * Run every source-declared analysis independently through existing public
 * Circuit/Board APIs. This adapter owns no solver semantics.
 */
export function runSourceAnalyses(imported, {
  format = null, sourceName = null, maxAnalyses = 16, maxPoints = 2048,
  maxObservations = 16384, transientProfile = 'interactive-v1',
  observationProfile = SOURCE_OBSERVATION_PROFILE,
  maxTotalAttempts = 1_000_000, maxTotalSolves = 100_000, maxTotalAdvances = 4096,
} = {}) {
  if (transientProfile == null) transientProfile = 'interactive-v1';
  const descriptors = sourceAnalysisDescriptors(imported?.analyses || []);
  const tag = result => ({ ...result, requestedObservationProfile: observationProfile });
  const budgets = [
    ['maxAnalyses', maxAnalyses, 64], ['maxPoints', maxPoints, 8192],
    ['maxObservations', maxObservations, 65536],
    ['maxTotalAttempts', maxTotalAttempts, 2_000_000],
    ['maxTotalSolves', maxTotalSolves, 200_000],
    ['maxTotalAdvances', maxTotalAdvances, 8192],
  ];
  const invalidBudget = budgets.find(([, value, ceiling]) =>
    !Number.isSafeInteger(value) || value < 1 || value > ceiling);
  if (invalidBudget) {
    const [name, value, ceiling] = invalidBudget;
    return descriptors.map(descriptor => tag(integrationGap(descriptor, 'invalid-analysis-budget',
      `${name} must be a positive safe integer no greater than ${ceiling}; received ${String(value)}`)));
  }
  if (transientProfile != null && !['interactive-v1', 'precision-v1'].includes(transientProfile)) {
    return descriptors.map(descriptor => tag(integrationGap(descriptor, 'transient-profile-not-allowed',
      `source analysis profile must be interactive-v1 or precision-v1; received ${String(transientProfile)}`)));
  }
  if (![SOURCE_OBSERVATION_PROFILE, BOUNDED_RESEARCH_OBSERVATION_PROFILE].includes(observationProfile)) {
    return descriptors.map(descriptor => tag(integrationGap(descriptor, 'observation-profile-not-allowed',
      `source observation profile must be ${SOURCE_OBSERVATION_PROFILE} or ${BOUNDED_RESEARCH_OBSERVATION_PROFILE}; received ${String(observationProfile)}`)));
  }
  if (descriptors.length > maxAnalyses) {
    return descriptors.map(descriptor => tag(integrationGap(descriptor, 'analysis-budget-exceeded',
      `source declares ${descriptors.length} analyses; adapter limit is ${maxAnalyses}`)));
  }
  const blockers = [
    ...blockersFromImport(imported, format, sourceName),
    ...(Array.isArray(imported?.analysisBlockers) ? imported.analysisBlockers : []),
  ];
  if (blockers.length) {
    return descriptors.map(descriptor => tag({
      analysisId: descriptor.id, ordinal: descriptor.ordinal, kind: descriptor.kind,
      status: 'refused', classification: 'import-fidelity', code: 'semantic-import-blocker',
      blockerCount: blockers.length,
      skipped: blockers.map(blocker => ({
        ref: blocker.ref || 'source',
        consequence: blocker.reason || blocker.type || 'semantic import finding blocks numerical analysis',
      })),
    }));
  }
  const limits = { maxPoints, maxObservations, transientProfile, observationProfile,
    maxTotalAttempts, maxTotalSolves, maxTotalAdvances,
    ledger: { attempts: 0, solves: 0, advances: 0 } };
  return descriptors.map(descriptor => {
    let result;
    if (descriptor.kind === 'op') result = runOp(imported, descriptor);
    else if (descriptor.kind === 'ac') result = runAc(imported, descriptor, limits);
    else if (descriptor.kind === 'tran') result = runTran(imported, descriptor, limits);
    else if (descriptor.kind === 'dc') result = integrationGap(descriptor, 'dc-sweep-not-implemented',
      'the reusable source-analysis adapter does not yet expose source-declared DC sweeps');
    else result = integrationGap(descriptor, 'analysis-kind-not-implemented',
      `source analysis ${descriptor.kind} has no reusable native adapter`);
    return tag(result);
  });
}

/** Run the source analysis metadata persisted with a live Circuit instance. */
export function runCircuitSourceAnalyses(circuit, options = {}) {
  const source = circuit?.sourceAnalysis;
  if (!source || !Array.isArray(source.analyses) || !source.analyses.length) return [];
  return runSourceAnalyses({
    parts: circuit.parts || [], wires: circuit.wires || [],
    analyses: source.analyses, netNames: source.netNames || [],
    analysisBlockers: circuit.analysisBlockers || [],
  }, {
    format: source.format || null, sourceName: source.sourceName || null,
    ...options,
  });
}
