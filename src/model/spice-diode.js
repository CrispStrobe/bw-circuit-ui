export const SHOCKLEY_THERMAL_VOLTAGE = 0.02585;
export const SHOCKLEY_FIXED_TEMP_C = 26.826793442075882;

const own = (o, k) => Object.prototype.hasOwnProperty.call(o || {}, k);

export function validateExplicitShockley(params, raw = null) {
  if (raw != null) {
    let rest = String(raw).trim();
    if (rest.startsWith('(') && rest.endsWith(')')) rest = rest.slice(1, -1);
    const names = [];
    while (rest.trim()) {
      const match = rest.match(/^\s*,?\s*([A-Za-z_]\w*)\s*=\s*([^\s,()]+)([\s\S]*)$/);
      if (!match) return { ok: false, reason: 'diode model contains unparsed or malformed syntax' };
      names.push(match[1].toLowerCase());
      rest = match[3];
    }
    if (new Set(names).size !== names.length || names.sort().join(',') !== 'is,n,rs') {
      return { ok: false, reason: 'exact diode model requires one each of IS, N and RS and no other model fields' };
    }
  }
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
    if (/^\.temp\b/i.test(line)) {
      const temp = line.match(/^\.temp\s+([^\s]+)\s*$/i);
      temps.push(temp ? Number(temp[1]) : NaN); source.push(line);
    }
    const option = line.match(/^\.options?\b(.*)$/i);
    if (option) {
      if (/\btemp\b/i.test(option[1])) {
        const values = [...option[1].matchAll(/\btemp\s*=\s*([^\s]+)/ig)];
        if (!values.length) temps.push(NaN);
        else for (const match of values) temps.push(Number(match[1]));
        source.push(line);
      }
      if (/\btnom\b/i.test(option[1])) {
        const values = [...option[1].matchAll(/\btnom\s*=\s*([^\s]+)/ig)];
        if (!values.length) tnoms.push(NaN);
        else for (const match of values) tnoms.push(Number(match[1]));
        source.push(line);
      }
    }
  }
  if (!temps.length && !tnoms.length) return { ok: true, explicit: false, source: [] };
  const close = value => Number.isFinite(value) && Math.abs(value - SHOCKLEY_FIXED_TEMP_C) <= 1e-6;
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
