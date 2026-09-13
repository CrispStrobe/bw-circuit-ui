export const SHOCKLEY_THERMAL_VOLTAGE = 0.02585;
export const SHOCKLEY_FIXED_TEMP_C = 26.826793442075882;

const own = (o, k) => Object.prototype.hasOwnProperty.call(o || {}, k);

export function validateExplicitShockley(params) {
  const keys = Object.keys(params || {}).sort();
  if (keys.join(',') !== 'is,n,rs') return { ok: false, reason: 'exact diode model requires explicit IS, N and RS and no other model fields' };
  const is = Number(params.is); const n = Number(params.n); const rs = Number(params.rs);
  if (!(Number.isFinite(is) && is > 0 && Number.isFinite(n) && n > 0 && Number.isFinite(rs) && rs >= 0)) {
    return { ok: false, reason: 'diode IS and N must be positive finite numbers and RS must be a non-negative finite number' };
  }
  return { ok: true, params: { model: 'shockley', is, n, rs } };
}

export function classifyShockleyThermal(lines) {
  const temps = []; const tnoms = [];
  const source = [];
  for (const line of lines || []) {
    const temp = line.match(/^\.temp\s+([^\s]+)\s*$/i);
    if (temp) { temps.push(Number(temp[1])); source.push(line); }
    const option = line.match(/^\.options?\b(.*)$/i);
    if (option) for (const match of option[1].matchAll(/\btnom\s*=\s*([^\s]+)/ig)) { tnoms.push(Number(match[1])); source.push(line); }
  }
  if (!temps.length && !tnoms.length) return { ok: true, explicit: false, source: [] };
  const close = value => Number.isFinite(value) && Math.abs(value - SHOCKLEY_FIXED_TEMP_C) <= 1e-9;
  if (temps.length === 1 && tnoms.length === 1 && close(temps[0]) && close(tnoms[0])) {
    return { ok: true, explicit: true, source };
  }
  return { ok: false, explicit: true,
    source, reason: `diode DC requires one TEMP and one TNOM both equal to the fixed ${SHOCKLEY_FIXED_TEMP_C} C profile` };
}

export function isExplicitShockleyPart(part) {
  const p = part?.params || {};
  return part?.kind === 'diode' && Object.keys(p).sort().join(',') === 'is,model,n,rs'
    && p.model === 'shockley' && own(p, 'is') && own(p, 'n') && own(p, 'rs')
    && validateExplicitShockley({ is: p.is, n: p.n, rs: p.rs }).ok;
}
