/** Instantaneous terminal measurements. Public engine current is positive OUT;
 * this table converts it to positive INTO the first terminal for absorbed V*I.
 */
export function normalizeComponentLimits(limits = {}) {
  if (limits === null) limits = {};
  if (typeof limits !== 'object' || Array.isArray(limits)) throw new Error('Invalid component limits');
  const result = {};
  for (const key of ['powerWatts', 'currentAmps']) {
    const value = limits[key];
    if (value === undefined || value === null || value === '') continue;
    if (!Number.isFinite(value) || value <= 0) throw new Error(`Invalid component limit: ${key}`);
    result[key] = value;
  }
  return result;
}

const display = (value, scale = 1) => Number.isFinite(value) ?
  (Math.abs(value * scale) < 1e-12 ? '0' : Number((value * scale).toPrecision(3)).toString()) : '—';

/** Existing canvas annotation format; no change to part geometry or connectivity. */
export function componentMeasurementAnnotations(rows, parts) {
  const byId = new Map(parts.map(p => [p.id, p]));
  return rows.flatMap(row => {
    const part = byId.get(row.id);
    if (!part || !Number.isFinite(part.x) || !Number.isFinite(part.y)) return [];
    const color = row.warnings.length ? '#b45309' : row.status === 'measured' ? '#334155' : '#64748b';
    return [
      {x: part.x, y: part.y + 34, color, text: `${row.label}: ${display(row.volts)} V`},
      {x: part.x, y: part.y + 47, color, text: `${display(row.currentAmps, 1000)} mA · ${display(row.powerWatts, 1000)} mW`},
    ];
  });
}

export function componentMeasurements(board, parts) {
  // Unknown/UI-only parts must not inherit branchCurrent's legacy zero default.
  const supported = new Set(['resistor', 'led', 'diode', 'zener', 'capacitor', 'inductor',
    'button', 'switch', 'buzzer', 'vsource', 'isource', 'voltage_source', 'current_source']);
  const eligible = parts.filter(p => supported.has(p.kind) && p.terminals?.length === 2);
  let nets, knownParts, failure;
  try {
    if (!board) throw new Error('Needs the simulator');
    const status = board.transientAnalysisStatus?.();
    if (status?.failure || status?.accuracyMet === false) throw new Error(status.failure || 'Unqualified transient solve');
    nets = board.getNets();
    if (board.getParts) knownParts = new Set(board.getParts().map(p => p.id));
  } catch (error) { failure = String(error.message || error); }
  const nodes = new Map();
  for (const net of nets || []) for (const terminal of net.terminals || []) {
    nodes.set(`${terminal.part}\0${terminal.terminal}`, net.id);
  }
  return eligible.map(part => {
    const terminals = part.terminals.map(t => typeof t === 'string' ? t : t.name);
    const row = {id: part.id, label: part.label || part.id, terminals, status: 'unavailable',
      volts: null, currentAmps: null, powerWatts: null, warnings: [], limits: part.limits || {}};
    if (failure) return {...row, reason: failure};
    if (knownParts && !knownParts.has(part.id)) return {...row, reason: 'Part is absent from the active board'};
    try {
      const current = -board.branchCurrent(part.id, terminals[0]);
      if (!Number.isFinite(current)) throw new Error('No finite terminal current');
      row.currentAmps = current;
      const [a, b] = terminals.map(t => nodes.get(`${part.id}\0${t}`));
      if (a === undefined || b === undefined) return {...row, status: 'open', reason: 'Open terminal'};
      const va = board.nodeVoltage(a), vb = board.nodeVoltage(b);
      if (!Number.isFinite(va) || !Number.isFinite(vb)) throw new Error('No finite terminal voltage');
      row.volts = va - vb;
      row.powerWatts = row.volts * current;
      if (!Number.isFinite(row.volts) || !Number.isFinite(row.powerWatts)) throw new Error('Nonfinite component result');
      row.status = 'measured';
      const limits = normalizeComponentLimits(part.limits);
      if (limits.powerWatts !== undefined && row.powerWatts > limits.powerWatts) row.warnings.push('power');
      if (limits.currentAmps !== undefined && Math.abs(current) > limits.currentAmps) row.warnings.push('current');
      return row;
    } catch (error) {
      return {...row, status: 'unavailable', volts: null, currentAmps: null, powerWatts: null,
        reason: String(error.message || error)};
    }
  });
}
