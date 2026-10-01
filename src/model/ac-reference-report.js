/** Full-grid ground-referenced complex-voltage comparison; never runs an oracle. */
export const AC_REFERENCE_MAX_BYTES = 4 * 1024 * 1024;
const finite = value => typeof value === 'number' && Number.isFinite(value);
const identifier = value => typeof value === 'string' && value.length > 0 && value.length <= 128;

export function parseExpectedAc(text) {
  if (new TextEncoder().encode(text).byteLength > AC_REFERENCE_MAX_BYTES) {
    throw new Error('AC reference exceeds 4 MiB');
  }
  const value = JSON.parse(text);
  if (value?.schemaVersion !== 1 || !Array.isArray(value.analyses)
      || value.analyses.length < 1 || value.analyses.length > 8) {
    throw new Error('AC reference requires schemaVersion 1 and 1 to 8 analyses');
  }
  const ids = new Set();
  let observations = 0;
  const analyses = value.analyses.map(analysis => {
    if (!identifier(analysis?.analysisId) || ids.has(analysis.analysisId)) {
      throw new Error('AC reference requires unique analysisId values');
    }
    ids.add(analysis.analysisId);
    const frequenciesHz = analysis.frequenciesHz;
    if (!Array.isArray(frequenciesHz) || frequenciesHz.length < 1 || frequenciesHz.length > 4096
        || frequenciesHz.some((hz, index) => !finite(hz) || hz <= 0
          || (index > 0 && hz <= frequenciesHz[index - 1]))) {
      throw new Error('AC reference requires 1 to 4096 finite strictly increasing positive frequenciesHz');
    }
    const frequencyToleranceHz = analysis.frequencyToleranceHz ?? 1e-9;
    if (!finite(frequencyToleranceHz) || frequencyToleranceHz < 0) {
      throw new Error('AC reference frequencyToleranceHz must be finite and nonnegative');
    }
    if (!Array.isArray(analysis.nodes) || analysis.nodes.length < 1 || analysis.nodes.length > 128) {
      throw new Error('AC reference requires 1 to 128 nodes per analysis');
    }
    const nodeIds = new Set();
    const nodes = analysis.nodes.map(node => {
      if (!identifier(node?.id) || nodeIds.has(node.id) || node.unit !== 'V') {
        throw new Error('AC reference requires unique node ids and explicit voltage unit V');
      }
      nodeIds.add(node.id);
      const relativeTolerance = node.relativeTolerance ?? 0;
      if (!finite(node.absoluteTolerance) || node.absoluteTolerance < 0
          || !finite(relativeTolerance) || relativeTolerance < 0) {
        throw new Error('AC reference requires finite nonnegative absolute/relative tolerances');
      }
      for (const key of ['real', 'imaginary']) {
        if (!Array.isArray(node[key]) || node[key].length !== frequenciesHz.length
            || node[key].some(number => !finite(number))) {
          throw new Error('AC reference needs finite real/imaginary voltage at every frequency');
        }
      }
      observations += frequenciesHz.length;
      if (observations > 200000) throw new Error('AC reference exceeds 200000 complex observations');
      return { id: node.id, unit: 'V', absoluteTolerance: node.absoluteTolerance,
        relativeTolerance, real: node.real, imaginary: node.imaginary };
    });
    return { analysisId: analysis.analysisId, frequenciesHz, frequencyToleranceHz, nodes };
  });
  return { analyses, provenance: value.provenance ?? null };
}

export function compareExpectedAc(results, expected) {
  const actual = results.filter(result => result.kind === 'ac');
  let structuralFailures = 0, compared = 0, passed = 0, failed = 0;
  const mismatches = [];
  const mismatch = (code, details = {}, structural = false) => {
    if (structural) structuralFailures++;
    if (mismatches.length < 20) mismatches.push({ code, ...details });
  };
  if (actual.length !== expected.analyses.length) mismatch('analysis-count', {}, true);
  for (let index = 0; index < expected.analyses.length; index++) {
    const wanted = expected.analyses[index], got = actual[index];
    const detail = { analysisId: wanted.analysisId };
    if (!got || got.analysisId !== wanted.analysisId) mismatch('analysis-identity', detail, true);
    if (!got || got.status !== 'pass') {
      mismatch('analysis-not-successful', detail, true);
      continue;
    }
    const axis = got.observables?.axis;
    const frequencies = axis?.values;
    if (axis?.quantity !== 'frequency' || axis?.unit !== 'Hz'
        || !Array.isArray(frequencies) || frequencies.length !== wanted.frequenciesHz.length) {
      mismatch('frequency-axis', detail, true);
    }
    const nodes = got.observables?.nodes;
    if (!Array.isArray(nodes) || nodes.length !== wanted.nodes.length) mismatch('node-count', detail, true);
    for (let point = 0; point < wanted.frequenciesHz.length; point++) {
      const hz = frequencies?.[point];
      if (!finite(hz) || hz <= 0 || (point > 0 && hz <= frequencies[point - 1])
          || Math.abs(hz - wanted.frequenciesHz[point]) > wanted.frequencyToleranceHz) {
        mismatch('frequency', { ...detail, point, expectedHz: wanted.frequenciesHz[point] }, true);
      }
    }
    for (let channel = 0; channel < wanted.nodes.length; channel++) {
      const reference = wanted.nodes[channel], node = nodes?.[channel];
      if (node?.id !== reference.id) mismatch('node-identity', { ...detail, node: reference.id }, true);
      if (!Array.isArray(node?.magnitude) || !Array.isArray(node?.phaseDeg)
          || node.magnitude.length !== wanted.frequenciesHz.length
          || node.phaseDeg.length !== wanted.frequenciesHz.length) {
        mismatch('node-grid', { ...detail, node: reference.id }, true);
      }
      for (let point = 0; point < wanted.frequenciesHz.length; point++) {
        compared++;
        const magnitude = node?.magnitude?.[point], phase = node?.phaseDeg?.[point];
        const angle = phase * Math.PI / 180;
        const real = magnitude * Math.cos(angle), imaginary = magnitude * Math.sin(angle);
        const error = Math.hypot(real - reference.real[point], imaginary - reference.imaginary[point]);
        const allowance = reference.absoluteTolerance + reference.relativeTolerance
          * Math.hypot(reference.real[point], reference.imaginary[point]);
        if (!finite(magnitude) || magnitude < 0 || !finite(phase) || !finite(error)
            || !finite(allowance) || error > allowance) {
          failed++;
          mismatch('complex-voltage', { ...detail, node: reference.id, point, error, allowance });
        } else passed++;
      }
    }
  }
  return { status: structuralFailures === 0 && failed === 0 && compared > 0 ? 'pass' : 'fail',
    compared, passed, failed, structuralFailures, mismatches,
    claims: { fullAcGrid: true, independentOracle: false, terminalCurrents: false } };
}
