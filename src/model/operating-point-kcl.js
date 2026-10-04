// Static conservation diagnostic, not a solver or independent oracle.
export const KCL_ABSOLUTE_AMPS = 1e-9;
export const KCL_RELATIVE_ALLOWANCE = 1e-6;
const CONVENTION = 'positive-into-part-terminal';
const finite = value => typeof value === 'number' && Number.isFinite(value);
const key = (part, terminal) => JSON.stringify([part, terminal]);

export function auditOperatingPointKcl(circuit, point) {
  const unavailable = [];
  const terminalObservations = [];
  let unavailableCount = 0;
  const refuse = (code, detail) => {
    unavailableCount++;
    if (unavailable.length < 20) unavailable.push({code, detail});
  };
  const report = (nets = [], parts = []) => {
    const rows = [...nets, ...parts];
    const failed = rows.filter(row => row.status === 'fail').length;
    return {
      schemaVersion: 1,
      status: unavailableCount ? 'refused' : failed ? 'fail' : rows.length ? 'pass' : 'refused',
      currentConvention: CONVENTION,
      tolerance: {absoluteAmps: KCL_ABSOLUTE_AMPS, relative: KCL_RELATIVE_ALLOWANCE},
      counts: {nets: nets.length, parts: parts.length,
        terminals: nets.reduce((sum, row) => sum + row.terminals, 0),
        checked: rows.length, passed: rows.length - failed, failed, unavailable: unavailableCount},
      worstResidualAmps: rows.length ? rows.reduce((worst, row) => Math.max(worst, Math.abs(row.residualAmps)), 0) : null,
      nets, parts, observations: rows.length ? terminalObservations : [], unavailable,
      claims: {independentOracle: false, physicalDeviceCertification: false, transientConservation: false},
    };
  };
  if (point?.converged !== true || point?.analysis?.currentConvention !== CONVENTION ||
      !(point?.branchCurrents instanceof Map) || !(point?.nodeVoltages instanceof Map) ||
      !(point?.indeterminateBranchCurrents instanceof Set)) {
    refuse('invalid-operating-point-authority', 'requires a converged strict OP and explicit signed current maps');
    return report();
  }
  for (const field of ['conflicts', 'railConflicts']) {
    if (point[field] !== undefined && (!Array.isArray(point[field]) || point[field].length)) {
      refuse('conflicting-operating-point', field);
    }
  }
  if (point.indeterminateBranchCurrents.size) {
    refuse('indeterminate-current', 'individual branch currents are unavailable; no sharing is inferred');
  }
  if (!Array.isArray(circuit?.parts) || !circuit.parts.length ||
      !Array.isArray(circuit?.resolvedNets) || !circuit.resolvedNets.length) {
    refuse('missing-resolved-topology', 'requires actual parts and nonempty resolved nets');
    return report();
  }
  const physical = new Map();
  for (const part of circuit.parts) {
    if (typeof part?.id !== 'string' || !part.id || typeof part.kind !== 'string' || physical.has(part.id)) {
      refuse('duplicate-or-invalid-part', String(part?.id));
    } else physical.set(part.id, part);
  }
  const seenTerminals = new Set(), seenNets = new Set(), netInputs = [];
  for (const net of circuit.resolvedNets) {
    if (typeof net?.id !== 'string' || !net.id || seenNets.has(net.id) || !Array.isArray(net.terminals)) {
      refuse('duplicate-or-invalid-net', String(net?.id));
      continue;
    }
    seenNets.add(net.id);
    if (!finite(point.nodeVoltages.get(net.id))) refuse('missing-net-voltage', net.id);
    const values = [];
    for (const terminal of net.terminals) {
      const part = physical.get(terminal?.part);
      if (!part || typeof terminal?.terminal !== 'string' || !terminal.terminal) {
        refuse('unknown-terminal', net.id);
        continue;
      }
      const identity = key(terminal.part, terminal.terminal);
      if (seenTerminals.has(identity)) refuse('duplicate-terminal', identity);
      seenTerminals.add(identity);
      // Ground is a reference label, not an invented current injection.
      if (part.kind === 'gnd') {
        const currents = point.branchCurrents.get(part.id);
        if (point.branchCurrents.has(part.id) && (!(currents instanceof Map) || currents.size)) {
          refuse('unexpected-ground-current-map', part.id);
        }
        continue;
      }
      const currents = point.branchCurrents.get(part.id);
      const current = currents instanceof Map ? currents.get(terminal.terminal) : undefined;
      if (!finite(current)) refuse('missing-or-nonfinite-terminal-current', identity);
      else {
        values.push(current);
        terminalObservations.push({part: part.id, terminal: terminal.terminal, net: net.id, currentAmps: current});
      }
    }
    if (values.length) netInputs.push({id: net.id, values});
    else refuse('empty-net-current-coverage', net.id);
  }
  const partInputs = [];
  for (const [id, part] of physical) {
    if (part.kind === 'gnd') continue;
    const currents = point.branchCurrents.get(id);
    if (!(currents instanceof Map) || !currents.size) {
      refuse('missing-part-current-map', id);
      continue;
    }
    for (const [terminal, current] of currents) {
      if (typeof terminal !== 'string' || !seenTerminals.has(key(id, terminal))) {
        refuse('unmapped-terminal-current', key(id, terminal));
      }
      if (!finite(current)) refuse('nonfinite-part-current', id);
    }
    partInputs.push({id, values: [...currents.values()]});
  }
  for (const id of point.branchCurrents.keys()) {
    if (!physical.has(id)) refuse('unknown-part-current', String(id));
  }
  if (!netInputs.length || !partInputs.length) refuse('empty-current-coverage', 'no compared-zero pass');
  if (unavailableCount) return report();
  const residual = ({id, values}) => {
    const sum = values.reduce((total, value) => total + value, 0);
    const scale = values.reduce((total, value) => total + Math.abs(value), 0);
    const allowed = KCL_ABSOLUTE_AMPS + KCL_RELATIVE_ALLOWANCE * scale;
    if (!finite(sum) || !finite(scale) || !finite(allowed)) refuse('current-accumulation-overflow', id);
    return {id, terminals: values.length, residualAmps: sum, absoluteCurrentAmps: scale,
      allowedAmps: allowed, status: Math.abs(sum) <= allowed ? 'pass' : 'fail'};
  };
  const nets = netInputs.map(residual), parts = partInputs.map(residual);
  // Do not serialize Infinity as null or retain partial pass counts on refusal.
  return unavailableCount ? report() : report(nets, parts);
}
