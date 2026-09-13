/** UI adapter for bw-board's operatingPoint result. This module never solves. */

export function blockersFromImport(result, format, sourceName) {
  const context = { format: format || null, sourceName: sourceName || null };
  const unmapped = (result?.unmapped || []).map((item) => ({
    ...context,
    type: 'unmapped-component',
    ref: item.ref || null,
    reason: item.libsource || item.value || 'component was not imported',
  }));
  const losses = (result?.losses || []).map((item) => ({
    ...context,
    type: 'semantic-import-loss',
    ref: item.ref || null,
    reason: item.reason || 'authored semantics were not represented',
    source: item.source || null,
    fallback: item.fallback || null,
  }));
  return [...unmapped, ...losses];
}

export function runOperatingPointAnalysis(board, blockers = []) {
  if (blockers.length) {
    const first = blockers[0];
    const detail = [first.ref, first.reason].filter(Boolean).join(': ');
    return {
      ok: false,
      reason: `DC operating point blocked by ${blockers.length} import finding(s)`
        + (detail ? ` — ${detail}` : ''),
    };
  }
  if (!board || typeof board.operatingPoint !== 'function') {
    return { ok: false, reason: 'The injected bw-board engine does not provide DC operating-point analysis.' };
  }
  let result;
  try {
    result = board.operatingPoint();
  } catch (error) {
    return { ok: false, reason: (error && error.message) || String(error) };
  }
  if (!result || result.converged !== true) {
    const conflicts = result?.railConflicts || [];
    return { ok: false, reason: conflicts.length
      ? `DC operating point did not converge — ${conflicts.join('; ')}`
      : 'DC operating point did not converge.' };
  }
  if (result.railConflicts?.length) {
    return { ok: false, reason: `DC operating point has rail conflicts — ${result.railConflicts.join('; ')}` };
  }
  return { ok: true, result };
}

export function operatingPointRows(result) {
  const nodes = [...(result?.nodeVoltages || new Map())]
    .map(([id, value]) => ({ id, value }))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const currents = [];
  for (const [part, terminals] of result?.branchCurrents || new Map()) {
    for (const [terminal, value] of terminals) currents.push({ id: `${part}.${terminal}`, value });
  }
  currents.sort((a, b) => a.id.localeCompare(b.id));
  return { nodes, currents };
}
