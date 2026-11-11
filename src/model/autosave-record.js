/**
 * The ONE `bw-circuit-autosave` record for a circuit. Both writers — the
 * synchronous write in handleLoad and the debounced autosave — build it here,
 * so an unchanged circuit always produces the same bytes.
 *
 * Engine-format nets are carried only for a file that brought its own nets
 * (imports that describe connectivity with nets instead of wires). Before,
 * handleLoad wrote a wire-based file without nets while the debounced
 * autosave added `resolvedNets` to every file-owned circuit, so a remount
 * after a load rewrote the same circuit into a second, larger record. A host
 * that opens a project and refuses its sidecar saw its known circuit
 * "change" (Lite task I5).
 *
 * @param {object} json - circuit.toJSON()
 * @param {{fileNets?: boolean, nets?: Array}} options
 * @returns {string}
 */
export function autosaveRecord(json, { fileNets = false, nets } = {}) {
  const saved = { ...json };
  if (fileNets && Array.isArray(nets)) saved.nets = nets;
  return JSON.stringify(saved);
}

/** Whether a loaded document carried its own engine-format nets. */
export function carriesFileNets(data) {
  return !!data && Array.isArray(data.nets) && data.nets.length > 0;
}
