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
const normalize = value => String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
const finite = value => typeof value === 'number' && Number.isFinite(value);

/** Enumerate source analysis cards without deduplicating cards of one kind. */
export function sourceAnalysisDescriptors(cards = []) {
  return cards.map((card, ordinal) => {
    const normalized = normalize(card);
    const kind = /^\.(op|ac|tran|dc|noise)\b/.exec(normalized)?.[1] || 'unknown';
    return { id: `${ordinal}:${kind}`, ordinal, kind, normalized };
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

function sourceRefusal(descriptor, code, detail) {
  return {
    analysisId: descriptor.id, ordinal: descriptor.ordinal, kind: descriptor.kind,
    status: 'refused', classification: 'source-condition', code, detail,
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
    };
  } catch (error) { return solverRefusal(descriptor, error, parsed); }
}

function parseTran(descriptor, limits) {
  const fields = descriptor.normalized.split(' ');
  const uic = fields.at(-1) === 'uic';
  const values = uic ? fields.slice(1, -1) : fields.slice(1);
  if (values.includes('startup')) return integrationGap(descriptor, 'tran-startup-not-implemented',
    'LTspice startup ramps independent sources from zero and is not equivalent to ordinary non-UIC initialization');
  if (values.length !== 1 && values.length !== 2) return integrationGap(descriptor,
    'tran-form-not-implemented', 'only .tran TSTOP or .tran TSTEP TSTOP, optionally followed by UIC, is currently wired');
  const stopSec = parseSpiceValue(values.at(-1));
  const stopNs = stopSec * 1e9;
  if (!finite(stopSec) || !(stopSec > 0) || !Number.isSafeInteger(stopNs)) {
    return sourceRefusal(descriptor, 'invalid-tran-card', 'transient stop must map to a finite positive integer nanosecond');
  }
  let stepSec; let stepNs; let points; let sampleTimesNs; let samplingProfile;
  if (values.length === 2) {
    stepSec = parseSpiceValue(values[0]); stepNs = stepSec * 1e9;
    if (!finite(stepSec) || !(stepSec > 0) || !Number.isSafeInteger(stepNs)
        || stepNs > stopNs || stopNs % stepNs !== 0) {
      return integrationGap(descriptor, 'tran-grid-not-representable',
        'the authored transient grid must map exactly to integer nanoseconds and divide the stop time');
    }
    points = stopNs / stepNs + 1;
    sampleTimesNs = Array.from({ length: points }, (_, index) => index * stepNs);
    samplingProfile = { id: 'source-tstep-v1', sourceDeclared: true, adapted: false };
  } else {
    // LTspice permits `.tran Tstop`: no plot/output step is authored. Sampling
    // is therefore an explicit observation profile, not a silently invented
    // simulator timestep. The engine keeps its own adaptive integration.
    const intervals = Math.min(100, limits.maxPoints - 1, stopNs);
    if (!Number.isSafeInteger(intervals) || intervals < 1) return integrationGap(descriptor,
      'analysis-budget-exceeded', 'the bounded observation profile has no available transient samples');
    sampleTimesNs = [...new Set(Array.from({ length: intervals + 1 }, (_, index) =>
      Math.round(index * stopNs / intervals)))];
    points = sampleTimesNs.length;
    stepSec = null; stepNs = null;
    samplingProfile = { id: 'bounded-uniform-observation-v1', sourceDeclared: false,
      adapted: true, targetIntervals: 100 };
  }
  if (points > limits.maxPoints) return integrationGap(descriptor, 'analysis-budget-exceeded',
    `transient requests ${points} points; adapter limit is ${limits.maxPoints}`);
  return { stepSec, stopSec, stepNs, stopNs, points, uic, sampleTimesNs, samplingProfile,
    initialization: uic ? 'uic-zero-state' : 'source-declared-dc-operating-point' };
}

function transientSourceBreakpoints(parts, stopNs, maxPoints) {
  const values = new Set();
  const addSeconds = seconds => {
    const ns = seconds * 1e9;
    if (!finite(seconds) || seconds < 0 || !Number.isSafeInteger(ns)) {
      throw new Error('source breakpoint does not map exactly to an integer nanosecond');
    }
    if (ns <= stopNs) values.add(ns);
    if (values.size > maxPoints) throw new Error('source breakpoint count exceeds the analysis point budget');
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
      const offsets = [...new Set([0, p.tr, p.tr + p.pw, p.tr + p.pw + p.tf])];
      for (let base = p.td; base <= stopNs / 1e9; base += p.per) {
        for (const offset of offsets) addSeconds(base + offset);
        if (!(p.per > 0)) throw new Error('PULSE period must be positive');
      }
    }
  }
  return [...values].sort((a, b) => a - b);
}

function runTran(imported, descriptor, limits) {
  const parsed = parseTran(descriptor, limits);
  if (parsed.status) return parsed;
  try {
    const sourceBreakpointsNs = transientSourceBreakpoints(imported.parts, parsed.stopNs, limits.maxPoints);
    parsed.sampleTimesNs = [...new Set([...parsed.sampleTimesNs, ...sourceBreakpointsNs])]
      .sort((a, b) => a - b);
    parsed.points = parsed.sampleTimesNs.length;
    if (sourceBreakpointsNs.length) {
      parsed.samplingProfile = { ...parsed.samplingProfile,
        sourceBreakpointsIncluded: true, breakpointCount: sourceBreakpointsNs.length };
      parsed.initialization = 'source-declared-waveform-time-zero-operating-point';
    }
    if (parsed.points > limits.maxPoints) return integrationGap(descriptor, 'analysis-budget-exceeded',
      'authored source breakpoints plus observation points exceed the adapter limit', parsed);
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
    for (const timeNs of parsed.sampleTimesNs) {
      circuit.advanceTo(BigInt(timeNs));
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
    return {
      analysisId: descriptor.id, ordinal: descriptor.ordinal, kind: 'tran',
      status: convergenceVerified ? 'pass' : 'partial',
      classification: convergenceVerified
        ? (parsed.samplingProfile.adapted ? 'native-original-adapted-observation-grid' : 'native-original')
        : 'diagnostic-native',
      ...(!convergenceVerified ? { code: 'transient-convergence-unverified' } : {}),
      conditions: parsed, topology: canonical.cards,
      observables: { axis: { quantity: 'time', unit: 's', values: axis }, nodes },
      convergence: { verified: convergenceVerified, converged: convergenceVerified ? true : null,
        api: convergenceVerified ? 'deviceCompanions' : null },
      ...(initialization ? { initialization: initialization.analysis } : {}),
    };
  } catch (error) { return solverRefusal(descriptor, error, parsed); }
}

/**
 * Run every source-declared analysis independently through existing public
 * Circuit/Board APIs. This adapter owns no solver semantics.
 */
export function runSourceAnalyses(imported, {
  format = null, sourceName = null, maxAnalyses = 16, maxPoints = 2048,
  maxObservations = 16384,
} = {}) {
  const descriptors = sourceAnalysisDescriptors(imported?.analyses || []);
  if (descriptors.length > maxAnalyses) {
    return descriptors.map(descriptor => integrationGap(descriptor, 'analysis-budget-exceeded',
      `source declares ${descriptors.length} analyses; adapter limit is ${maxAnalyses}`));
  }
  const blockers = blockersFromImport(imported, format, sourceName);
  if (blockers.length) {
    return descriptors.map(descriptor => ({
      analysisId: descriptor.id, ordinal: descriptor.ordinal, kind: descriptor.kind,
      status: 'refused', classification: 'import-fidelity', code: 'semantic-import-blocker',
      blockerCount: blockers.length,
    }));
  }
  const limits = { maxPoints, maxObservations };
  return descriptors.map(descriptor => {
    if (descriptor.kind === 'op') return runOp(imported, descriptor);
    if (descriptor.kind === 'ac') return runAc(imported, descriptor, limits);
    if (descriptor.kind === 'tran') return runTran(imported, descriptor, limits);
    if (descriptor.kind === 'dc') return integrationGap(descriptor, 'dc-sweep-not-implemented',
      'the reusable source-analysis adapter does not yet expose source-declared DC sweeps');
    return integrationGap(descriptor, 'analysis-kind-not-implemented',
      `source analysis ${descriptor.kind} has no reusable native adapter`);
  });
}
