/** Electrical contracts for the oscilloscope leads.
 *
 * `ideal` is the historical debugger tap: it does not load the circuit and an
 * omitted reference keeps bw-board's implicit ground behaviour.  The passive
 * presets are deliberately ordinary bench-probe approximations, not claims
 * about a particular manufacturer's compensated probe or scope front end.
 */
export const SCOPE_PROBE_PRESETS = Object.freeze({
  ideal: Object.freeze({ id: 'ideal', label: 'ideal / debug', inputOhms: null, inputFarads: null }),
  '10x': Object.freeze({ id: '10x', label: '10× · 10 MΩ ∥ 15 pF', inputOhms: 10e6, inputFarads: 15e-12 }),
  '1x': Object.freeze({ id: '1x', label: '1× · 1 MΩ ∥ 100 pF', inputOhms: 1e6, inputFarads: 100e-12 }),
});

export function scopeProbeOptions(presetId = 'ideal', referenceNetId = '', { load = true } = {}) {
  const preset = SCOPE_PROBE_PRESETS[presetId];
  if (!preset) throw new Error(`Unknown scope probe preset: ${presetId}`);
  const reference = String(referenceNetId || '').trim();
  if (presetId !== 'ideal' && !reference) {
    throw new Error(`${preset.label} requires an explicit reference net`);
  }
  const options = reference ? { referenceNetId: reference } : {};
  if (load && preset.inputOhms != null) options.inputOhms = preset.inputOhms;
  if (load && preset.inputFarads != null) options.inputFarads = preset.inputFarads;
  return options;
}

export function scopeProbeLabel(presetId = 'ideal', referenceNetId = '') {
  const preset = SCOPE_PROBE_PRESETS[presetId];
  if (!preset) return presetId;
  return `${preset.label} · ref ${String(referenceNetId || '').trim() || 'engine ground'}`;
}
