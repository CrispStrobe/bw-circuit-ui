/** Read-only metadata for the capture selected for display; never alters acquisition. */
export function scopeDisplayStatus(data, {start = 0, windowSamples, range = null} = {}) {
  const depth = Number(data?.samples?.length) / 2;
  const intervalNs = Number(data?.sampleIntervalNs);
  const count = Number(data?.count);
  const writeIndex = Number(data?.writeIndex);
  const window = windowSamples ?? depth;
  if (!Number.isSafeInteger(depth) || depth < 1 || !Number.isSafeInteger(intervalNs) || intervalNs < 1
      || !Number.isSafeInteger(count) || count < 0 || !Number.isInteger(writeIndex)
      || writeIndex < 0 || writeIndex >= depth || !Number.isInteger(start)
      || !Number.isInteger(window) || window < 1 || window > depth) {
    return {ok: false, reason: 'Capture metadata unavailable'};
  }
  const retained = Math.min(count, depth);
  const oldest = (writeIndex - retained + depth) % depth;
  let visible = 0, below = false, above = false;
  const viewport = range && Number.isFinite(range.vLo) && Number.isFinite(range.vHi)
    && range.vLo < range.vHi ? {vLo: range.vLo, vHi: range.vHi} : null;
  for (let offset = 0; offset < window; offset++) {
    const index = ((start + offset) % depth + depth) % depth;
    // Unwritten slots are not evidence, even if their backing memory is finite.
    if ((index - oldest + depth) % depth >= retained) continue;
    const lo = data.samples[index * 2], hi = data.samples[index * 2 + 1];
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo > hi) continue;
    visible++;
    if (viewport) {
      below ||= lo < viewport.vLo;
      above ||= hi > viewport.vHi;
    }
  }
  const capture = typeof data.capture === 'string' ? data.capture : 'unknown';
  const startTimeNs = retained > 0 && typeof data.startTNs === 'bigint' && data.startTNs >= 0n ? String(data.startTNs) : null;
  return {ok: true, capture, intervalNs, depth, retained, visible, window,
    gaps: window - visible, wrapped: count > depth, startTimeNs, viewport,
    below, above, nyquistHz: capture === 'sample' ? 1e9 / intervalNs / 2 : null};
}

const concise = value => String(Number(value.toPrecision(6)));
const timeLabel = ns => ns >= 1e9 ? `${concise(ns / 1e9)} s` : ns >= 1e6
  ? `${concise(ns / 1e6)} ms` : ns >= 1e3 ? `${concise(ns / 1e3)} µs` : `${concise(ns)} ns`;
const frequencyLabel = hz => hz >= 1e6 ? `${concise(hz / 1e6)} MHz`
  : hz >= 1e3 ? `${concise(hz / 1e3)} kHz` : `${concise(hz)} Hz`;

export function scopeDisplayLabel(status, lang = 'en') {
  const de = lang === 'de';
  if (!status?.ok) return de ? 'Noch keine Anzeige-Metadaten' : 'No displayed capture metadata yet';
  const mode = status.capture === 'envelope' ? de ? 'Min/Max-Hüllkurve' : 'Min/max envelope'
    : status.capture === 'sample' ? de ? 'Punktabtastung' : 'Point samples'
      : `${de ? 'Unbekannter Aufnahmemodus' : 'Unknown capture mode'} (${status.capture})`;
  const filled = `${status.retained}/${status.depth} ${de ? 'gespeichert' : 'stored'}`;
  const shown = `${status.visible}/${status.window} ${de ? 'ausgewählt' : 'selected'}`;
  const state = status.wrapped ? de ? 'Ring umlaufen' : 'ring wrapped' : de ? 'Anfangsaufnahme' : 'record prefix';
  const start = status.startTimeNs === null ? '' : ` · ${de ? 'Aufnahmestart' : 'record start'} ${
    Number.isSafeInteger(Number(status.startTimeNs)) ? timeLabel(Number(status.startTimeNs)) : `${status.startTimeNs} ns`}`;
  return `${mode} · Δt ${timeLabel(status.intervalNs)} · ${filled} · ${shown} · ${state}${start}${
    status.nyquistHz === null ? '' : ` · Nyquist ${frequencyLabel(status.nyquistHz)}`}`;
}

export function scopeViewportWarning(status, lang = 'en') {
  if (!status?.ok || !status.viewport || (!status.below && !status.above)) return '';
  if (lang === 'de') return status.below && status.above ? 'Unter und über dem Anzeigebereich'
    : status.below ? 'Unter dem Anzeigebereich' : 'Über dem Anzeigebereich';
  return status.below && status.above ? 'Below and above viewport'
    : status.below ? 'Below viewport' : 'Above viewport';
}
