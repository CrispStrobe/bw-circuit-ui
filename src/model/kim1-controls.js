// SPDX-License-Identifier: MIT
// The circuit Board owns execution and memory; the front panel only sends commands.
export const KIM1_KIND = 'kim-1';
export const KIM1_KEY_ROWS = Object.freeze([
  ['AD', 'DA', 'PC', '+'],
  ['C', 'D', 'E', 'F'],
  ['8', '9', 'A', 'B'],
  ['4', '5', '6', '7'],
  ['0', '1', '2', '3'],
].map(Object.freeze));

export function kim1Control({board, part, verb, value, onProgramChange}) {
  if (part?.kind !== KIM1_KIND || typeof board?.setDeviceControl !== 'function') {
    throw new Error('The KIM-1 circuit engine is unavailable.');
  }
  if (!board.setDeviceControl(part.id, verb, value)) {
    const warning = board.getRenderState?.().warnings?.find(w =>
      w.type === 'device-control-refused' && w.partId === part.id && w.message?.startsWith(`"${verb}"`));
    throw new Error(warning?.message || `KIM-1 could not accept ${verb}. Use a four-digit hex address followed by two-digit bytes.`);
  }
  const state = board.getDeviceState(part.id);
  if (!state) throw new Error('The KIM-1 has no live circuit state.');
  if (typeof state.programSource === 'string' && state.programSource !== part.params?.program) {
    onProgramChange?.(part.id, state.programSource);
  }
  return state;
}

/** Persist an accepted image without rebuilding the electrical network. */
export function saveKim1Program(circuit, partId, source) {
  const part = circuit.getPart(partId);
  if (part?.kind !== KIM1_KIND || typeof source !== 'string' || part.params?.program === source) return false;
  circuit.setPartParam(partId, 'program', source);
  part.params = {...part.params, program: source};
  circuit._saveHistory();
  return true;
}

/** Only the focused panel handles keys. Editors and native buttons retain theirs. */
export function kim1KeyboardKey(event, running) {
  if (event.repeat || event.ctrlKey || event.altKey || event.metaKey) return null;
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(event.target?.tagName || '') || event.target?.isContentEditable) return null;
  if (/^[0-9a-f]$/i.test(event.key)) return event.key.toUpperCase();
  if (event.key === 'Escape') return 'ST';
  if (event.key === '+' || (event.key === 'Enter' && event.target?.tagName !== 'BUTTON')) return '+';
  if (event.key === ' ' && event.target?.tagName !== 'BUTTON') return running ? 'ST' : 'GO';
  return null;
}
