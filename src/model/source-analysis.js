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
  nmos: { kind: 'M', terminals: ['drain', 'gate', 'source', 'bulk'] },
  pmos: { kind: 'M', terminals: ['drain', 'gate', 'source', 'bulk'] },
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
      // A grounded-bulk NMOS retains its authored fourth node as a proven
      // fact rather than a physical terminal. Exact PMOS instead carries a
      // real `bulk` terminal. No other bulk potential is inferred here.
      if (terminal === 'bulk' && part.params?.bulkAtGround === true) return 'gnd';
      if (terminal === 'bulk' && part.params?.bulkOnSource === true) {
        const source = canonicalByTerminal.get(terminalKey(part.id, 'source'));
        if (!source) throw new Error(`canonical topology is missing ${part.id}.source`);
        return source;
      }
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
  const sweep = fields[1];
  if (fields.length !== 5 || !['dec', 'oct', 'lin'].includes(sweep)) return integrationGap(descriptor,
    'ac-form-not-implemented', 'supported forms are .ac DEC|OCT|LIN N FSTART FSTOP');
  const density = Number(fields[2]);
  const startHz = parseSpiceValue(fields[3]);
  const stopHz = parseSpiceValue(fields[4]);
  if (!Number.isSafeInteger(density) || density <= 0
      || !finite(startHz) || !finite(stopHz) || !(startHz > 0) || !(stopHz > startHz)) {
    return sourceRefusal(descriptor, 'invalid-ac-card',
      'AC point count must be a positive integer and frequency bounds must satisfy 0 < FSTART < FSTOP');
  }
  let frequencies;
  let points;
  const logStart = Math.log(startHz);
  const logStop = Math.log(stopHz);
  if (sweep === 'lin') {
    if (density === 2) return integrationGap(descriptor, 'ac-grid-not-representable',
      'ngspice 42 emits only FSTART for LIN 2; the ambiguous missing endpoint is not manufactured');
    points = density;
  } else if (sweep === 'oct') {
    // SPICE OCT advances by the authored points-per-octave ratio and stops
    // before the first point above FSTOP; a non-grid-aligned endpoint is not
    // manufactured as an observation.
    points = Math.floor((logStop - logStart) / Math.LN2 * density + 1e-12) + 1;
  } else {
    // ngspice's DEC sweep chooses floor(N*decades)+1 observations and fits
    // the logarithmic axis to both authored endpoints.  This differs from
    // OCT's fixed 2^(1/N) progression when the interval is non-integral.
    points = Math.floor((logStop - logStart) / Math.LN10 * density + 1e-12) + 1;
    if (points < 2) return integrationGap(descriptor, 'ac-grid-not-representable',
      'DEC bounds and density produce fewer than two points; no endpoint is manufactured');
  }
  if (!Number.isSafeInteger(points) || points < 1 || points > limits.maxPoints) return integrationGap(descriptor,
    'analysis-budget-exceeded', `AC requests ${points} points; adapter limit is ${limits.maxPoints}`);
  if (sweep === 'lin') {
    frequencies = Array.from({ length: points }, (_, index) =>
      startHz + (stopHz - startHz) * index / Math.max(1, points - 1));
    if (points > 1) frequencies[points - 1] = stopHz;
  } else if (sweep === 'oct') {
    frequencies = Array.from({ length: points }, (_, index) =>
      Math.exp(logStart + index * Math.LN2 / density));
    if (Math.abs(frequencies.at(-1) - stopHz) <= stopHz * 1e-12) {
      frequencies[frequencies.length - 1] = stopHz;
    }
  } else {
    frequencies = Array.from({ length: points }, (_, index) =>
      Math.exp(logStart + (logStop - logStart) * index / (points - 1)));
    frequencies[0] = startHz;
    frequencies[points - 1] = stopHz;
  }
  if (frequencies.some((value, index) => !finite(value) || !(value > 0)
      || (index > 0 && !(value > frequencies[index - 1])))) {
    return integrationGap(descriptor, 'ac-grid-not-representable',
      'the authored AC grid cannot be represented as finite strictly increasing frequencies');
  }
  return {
    sourceArguments: { source: descriptor.source, normalized: descriptor.normalized },
    sweep, density, startHz, stopHz, points, frequencies,
    ...(sweep === 'dec' ? { pointsPerDecade: density } : {}),
    ...(sweep === 'oct' ? { pointsPerOctave: density } : {}),
    ...(sweep === 'lin' ? { pointCount: density } : {}),
    endpointPolicy: sweep === 'oct' ? 'last-authored-ratio-point-at-or-below-fstop'
      : 'include-fstart-and-fstop',
  };
}

function runAc(imported, descriptor, limits) {
  const parsed = parseAc(descriptor, limits);
  if (parsed.status) return parsed;
  const unqualifiedLinearizations = (imported.parts || []).filter(part =>
    ['pnp', 'pmos'].includes(part.kind)
      || (part.kind === 'npn' && (part.params?.model !== 'shockley'
        || part._acModelProfile !== 'exact-static-ebers-moll-v1'))
      || (part.kind === 'nmos' && (part.params?.model !== 'level1'
        || (Number.isFinite(part.params?.gamma) && Number.isFinite(part.params?.phi)))));
  if (unqualifiedLinearizations.length) return integrationGap(descriptor,
    'ac-linearization-model-unqualified',
    `native AC model fidelity is not qualified for ${unqualifiedLinearizations.map(part =>
      `${part.id}:${part.kind}`).join(', ')}`, parsed);
  const excitations = (imported.parts || []).filter(part =>
    (part.kind === 'vsource' || part.kind === 'isource')
    && Object.prototype.hasOwnProperty.call(part.params || {}, 'acMagnitude'));
  if (excitations.length === 0) {
    return sourceRefusal(descriptor, 'missing-ac-source',
      'at least one explicit independent AC voltage or current source is required', parsed);
  }
  const invalidSource = excitations.find(source => {
    const amplitude = source.params.acMagnitude;
    const phaseDeg = source.params.acPhase ?? 0;
    return !finite(amplitude) || amplitude < 0 || !finite(phaseDeg);
  });
  if (invalidSource) return sourceRefusal(descriptor, 'invalid-ac-source',
    `AC source ${invalidSource.id} must have a finite non-negative magnitude and finite phase`, parsed);
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
    const sourceConditions = excitations.map(source => {
      const canonicalSource = canonical.sources.find(entry => entry.partId === source.id);
      if (!canonicalSource) throw new Error(`canonical AC source mapping is missing for ${source.id}`);
      return { id: canonicalSource.id, partId: source.id,
        kind: source.kind === 'vsource' ? 'voltage' : 'current',
        amplitude: source.params.acMagnitude, phaseDeg: source.params.acPhase ?? 0 };
    });
    const sums = canonical.nodes.map(() => parsed.frequencies.map(() =>
      ({ real: 0, imaginary: 0, absoluteContributions: 0 })));
    for (let sourceIndex = 0; sourceIndex < excitations.length; sourceIndex++) {
      const source = excitations[sourceIndex];
      const condition = sourceConditions[sourceIndex];
      const rows = circuit.board.runAc({ sourceId: source.id, frequencies: parsed.frequencies,
        probes, analysisProfile: 'source-analysis-v1', nodeRegularizationSiemens: 0 });
      if (rows.length !== parsed.points) return integrationGap(descriptor, 'native-ac-grid-mismatch',
        `native returned ${rows.length} points for an authored ${parsed.points}-point ${parsed.sweep.toUpperCase()} grid`, parsed);
      if (rows.some((row, index) => row.hz !== parsed.frequencies[index])) {
        return integrationGap(descriptor, 'native-ac-grid-mismatch',
          'native did not preserve the authored AC frequency vector exactly', parsed);
      }
      if (rows.some(row => row.profile?.id !== 'source-analysis-v1'
          || row.profile?.nodeRegularizationSiemens !== 0
          || row.profile?.sourceBiasPolicy !== 'authored-dc-value-no-interactive-source-controls')) {
        return integrationGap(descriptor, 'native-ac-profile-mismatch',
          'native did not report the requested strict AC source-analysis profile', parsed);
      }
      if (rows.some(row => row.outOfLinear?.length)) return solverRefusal(descriptor,
        'small-signal linearization is outside a proven device region', parsed);
      const sourceAngle = condition.phaseDeg * Math.PI / 180;
      const sourceReal = condition.amplitude * Math.cos(sourceAngle);
      const sourceImaginary = condition.amplitude * Math.sin(sourceAngle);
      for (let nodeIndex = 0; nodeIndex < canonical.nodes.length; nodeIndex++) {
        const netId = canonical.nodes[nodeIndex].netId;
        for (let pointIndex = 0; pointIndex < rows.length; pointIndex++) {
          const response = rows[pointIndex].results.get(netId);
          if (!finite(response?.mag) || !finite(response?.phaseDeg)) {
            return solverRefusal(descriptor, 'native AC returned a missing or non-finite observation', parsed);
          }
          const responseAngle = response.phaseDeg * Math.PI / 180;
          const responseReal = response.mag * Math.cos(responseAngle);
          const responseImaginary = response.mag * Math.sin(responseAngle);
          const sum = sums[nodeIndex][pointIndex];
          sum.real += responseReal * sourceReal - responseImaginary * sourceImaginary;
          sum.imaginary += responseReal * sourceImaginary + responseImaginary * sourceReal;
          sum.absoluteContributions += response.mag * condition.amplitude;
        }
      }
    }
    const nodes = canonical.nodes.map((node, nodeIndex) => ({
      id: node.id,
      magnitude: sums[nodeIndex].map(value => {
        const magnitude = Math.hypot(value.real, value.imaginary);
        return magnitude <= value.absoluteContributions * Number.EPSILON * 32 ? 0 : magnitude;
      }),
      phaseDeg: sums[nodeIndex].map(value => {
        const magnitude = Math.hypot(value.real, value.imaginary);
        return magnitude <= value.absoluteContributions * Number.EPSILON * 32
          ? 0 : Math.atan2(value.imaginary, value.real) * 180 / Math.PI;
      }),
    }));
    if (nodes.some(node => [...node.magnitude, ...node.phaseDeg].some(value => !finite(value)))) {
      return solverRefusal(descriptor, 'native AC returned a missing or non-finite observation', parsed);
    }
    const { frequencies, ...conditions } = parsed;
    return {
      analysisId: descriptor.id, ordinal: descriptor.ordinal, kind: 'ac', status: 'pass',
      classification: 'native-original',
      conditions: { ...conditions, sources: sourceConditions.map(({ partId, ...source }) => source),
        solverProfile: { id: 'source-analysis-v1', nodeRegularizationSiemens: 0,
          sourceBiasPolicy: 'authored-dc-value-no-interactive-source-controls' } },
      topology: canonical.cards,
      observables: { axis: { quantity: 'frequency', unit: 'Hz', values: parsed.frequencies }, nodes },
      evidence: 'original-direct', adapted: [],
      thermal: 'native-fixed-26.8267934421C; no oracle comparison performed',
    };
  } catch (error) { return solverRefusal(descriptor, error, parsed); }
}

function dcValues(from, to, step) {
  if (!finite(from) || !finite(to) || !finite(step) || step === 0) return null;
  if (from === to) return [from];
  if (Math.sign(to - from) !== Math.sign(step)) return null;
  const intervals = (to - from) / step;
  if (!finite(intervals) || intervals < 0) return null;
  const count = Math.floor(intervals + 1e-12) + 1;
  if (!Number.isSafeInteger(count) || count < 1) return null;
  return Array.from({ length: count }, (_, index) => {
    const value = from + step * index;
    return Math.abs(value - to) <= Math.max(1, Math.abs(to)) * 1e-12 ? to : value;
  });
}

function parseDc(imported, descriptor, limits) {
  const fields = descriptor.normalized.split(' ');
  if (fields.length !== 5 && fields.length !== 9) return integrationGap(descriptor,
    'dc-form-not-implemented',
    'supported forms are .dc VSOURCE START STOP INCREMENT with one optional nested voltage-source sweep');
  const sweeps = [];
  for (let offset = 1; offset < fields.length; offset += 4) {
    const requestedRef = fields[offset];
    const matches = (imported.parts || []).filter(part =>
      String(part.id || '').toLowerCase() === requestedRef);
    if (matches.length !== 1) return sourceRefusal(descriptor, 'invalid-dc-source',
      `.dc source ${requestedRef} must identify exactly one imported part`);
    const part = matches[0];
    if (part.kind !== 'vsource') return integrationGap(descriptor,
      'dc-source-kind-not-implemented',
      `.dc source ${part.id} maps to ${part.kind}; only independent voltage-source sweeps are wired`);
    const from = parseSpiceValue(fields[offset + 1]);
    const to = parseSpiceValue(fields[offset + 2]);
    const step = parseSpiceValue(fields[offset + 3]);
    const values = dcValues(from, to, step);
    if (!values) return sourceRefusal(descriptor, 'invalid-dc-card',
      `.dc source ${part.id} requires finite bounds and a non-zero increment directed toward its stop`);
    sweeps.push({ requestedRef: fields[offset], partId: part.id, from, to, step, values });
  }
  const points = sweeps.reduce((count, sweep) => count * sweep.values.length, 1);
  if (!Number.isSafeInteger(points) || points > limits.maxPoints) return integrationGap(descriptor,
    'analysis-budget-exceeded', `.dc requests ${points} points; adapter limit is ${limits.maxPoints}`,
    { sourceArguments: { source: descriptor.source, normalized: descriptor.normalized },
      sweeps: sweeps.map(({ values, ...sweep }) => ({ ...sweep, points: values.length })), points });
  return { sourceArguments: { source: descriptor.source, normalized: descriptor.normalized },
    sweeps, points, order: sweeps.length === 1 ? 'single-source'
      : 'last-source-outer-first-source-fastest' };
}

function dcCoordinates(sweeps) {
  if (sweeps.length === 1) return sweeps[0].values.map(value => [value]);
  const [first, second] = sweeps;
  return second.values.flatMap(secondValue => first.values.map(firstValue => [firstValue, secondValue]));
}

function runDc(imported, descriptor, limits) {
  const parsed = parseDc(imported, descriptor, limits);
  if (parsed.status) return parsed;
  let template;
  try { template = circuitFor(imported); }
  catch (error) { return mappingGap(descriptor, error, parsed); }
  if (template.netlistError != null) return mappingGap(descriptor, template.netlistError, parsed);
  let canonical;
  try { canonical = canonicalCircuit(imported, template); }
  catch (error) { return mappingGap(descriptor, error, parsed); }
  if (canonical.nodes.length * parsed.points > limits.maxObservations) return integrationGap(descriptor,
    'analysis-budget-exceeded', 'DC node-point product exceeds the adapter observation limit', parsed);
  const canonicalSources = parsed.sweeps.map(sweep => canonical.sources.find(source =>
    source.partId === sweep.partId));
  if (canonicalSources.some(source => !source)) return mappingGap(descriptor,
    'canonical DC source mapping is missing', parsed);

  const coordinates = dcCoordinates(parsed.sweeps);
  const nodeValues = new Map(canonical.nodes.map(node => [node.id, []]));
  const currentValues = new Map(canonical.sources.filter(source => source.currentTerminal)
    .map(source => [source.id, []]));
  const unavailableSourceCurrents = canonical.sources.filter(source => !source.currentTerminal)
    .map(source => source.id);
  try {
    for (const coordinate of coordinates) {
      // Each point is a fresh circuit.  A source-declared DC sweep is a family
      // of static operating points, not the curve-tracer's transient settling
      // path and not a stateful continuation from the preceding point.
      const circuit = circuitFor(imported);
      for (let index = 0; index < parsed.sweeps.length; index++) {
        circuit.setControl(parsed.sweeps[index].partId, coordinate[index]);
      }
      const point = circuit.operatingPoint({ waveformBias: 'dc-value' });
      if (!point?.converged) return solverRefusal(descriptor,
        `DC operating point did not converge at source coordinates ${coordinate.join(', ')}`, parsed);
      const conflicts = [...(point.conflicts || []), ...(point.railConflicts || [])];
      if (conflicts.length) return solverRefusal(descriptor,
        `DC operating point reported ${conflicts.length} conflicting fixed-voltage constraint(s) at source coordinates ${coordinate.join(', ')}`,
        parsed);
      for (const node of canonical.nodes) {
        const voltage = point.nodeVoltages.get(node.netId);
        if (!finite(voltage)) return solverRefusal(descriptor,
          `DC operating point returned a non-finite voltage for ${node.id}`, parsed);
        nodeValues.get(node.id).push(voltage);
      }
      for (const source of canonical.sources) {
        if (!source.currentTerminal) continue;
        const current = point.branchCurrents.get(source.partId)?.get(source.currentTerminal);
        if (!finite(current)) return solverRefusal(descriptor,
          `DC operating point returned a non-finite current for ${source.id}`, parsed);
        currentValues.get(source.id).push(current);
      }
    }
  } catch (error) { return solverRefusal(descriptor, error, parsed); }

  const sweeps = parsed.sweeps.map((sweep, index) => ({
    sourceId: canonicalSources[index].id, partKind: 'V', from: sweep.from,
    to: sweep.to, step: sweep.step, values: sweep.values,
  }));
  return {
    analysisId: descriptor.id, ordinal: descriptor.ordinal, kind: 'dc', status: 'pass',
    classification: 'native-original',
    conditions: { sourceArguments: parsed.sourceArguments, sweeps, points: parsed.points,
      order: parsed.order, initialization: 'independent-static-operating-points' },
    topology: canonical.cards,
    observables: {
      axis: { quantity: 'dc-source', dimensions: sweeps.map(sweep => ({
        sourceId: sweep.sourceId, unit: 'V', values: sweep.values,
      })), order: parsed.order, coordinates },
      nodes: canonical.nodes.map(node => ({ id: node.id, voltage: nodeValues.get(node.id) })),
      sourceCurrents: canonical.sources.filter(source => source.currentTerminal)
        .map(source => ({ id: source.id, current: currentValues.get(source.id) })),
      unavailableSourceCurrents,
    },
    convergence: { converged: true, pointCount: parsed.points, conflicts: [] },
    evidence: 'original-direct', adapted: [],
    thermal: 'native-fixed-26.8267934421C; no oracle comparison performed',
  };
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
    const acceptedStepLowerBound = algebraic ? 0 : Math.ceil(parsed.stopSec / maxStepSec);
    const nonzeroObservationCount = parsed.sampleTimesNs.filter(timeNs => timeNs > 0).length;
    // The adaptive controller qualifies an accepted step with one full-step
    // solve plus two half-step solves.  The first backward-Euler seed uses one
    // solve; every later accepted step therefore has a deterministic minimum
    // of three.  Retries and method restarts only increase these counts.
    const minimumAttempts = algebraic ? nonzeroObservationCount : acceptedStepLowerBound;
    const minimumSolves = algebraic ? nonzeroObservationCount
      : acceptedStepLowerBound === 0 ? 0 : 1 + 3 * (acceptedStepLowerBound - 1);
    parsed.preflight = { minimumAttempts, minimumSolves,
      basis: algebraic ? 'algebraic-direct-nonzero-observation-count'
        : 'adaptive-be-seed-plus-three-solves-per-later-accepted-step',
      acceptedStepLowerBound,
      integrationMode: profileStatus?.integrationMode || 'adaptive' };
    if (limits.ledger.solves + minimumSolves > limits.maxTotalSolves
        || limits.ledger.attempts + minimumAttempts > limits.maxTotalAttempts
        || limits.ledger.advances + parsed.sampleTimesNs.length > limits.maxTotalAdvances) {
      return profileGap(descriptor, 'analysis-work-budget-exceeded',
        `precision preflight needs at least ${minimumAttempts} attempts, ${minimumSolves} solves, and ${parsed.sampleTimesNs.length} advances; remaining total limits are ${limits.maxTotalSolves - limits.ledger.solves} solves, ${limits.maxTotalAttempts - limits.ledger.attempts} attempts, ${limits.maxTotalAdvances - limits.ledger.advances} advances`,
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
    else if (descriptor.kind === 'dc') result = runDc(imported, descriptor, limits);
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
