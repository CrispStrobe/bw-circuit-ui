// SPDX-License-Identifier: MIT
// Controls read and write the engine-owned machine. No instruction execution lives here.
export const MICROTRONIC_KIND = 'busch-microtronic';
export const MICROTRONIC_HEX_KEYS = Object.freeze([
  'C', 'D', 'E', 'F', '8', '9', 'A', 'B', '4', '5', '6', '7', '0', '1', '2', '3',
]);
export const MICROTRONIC_FUNCTION_KEYS = Object.freeze(['HALT', 'NEXT', 'BKP', 'REG', 'C/CE', 'RUN', 'STEP', 'PGM']);
// The documented front panel has four rows of six keys.
export const MICROTRONIC_KEY_ROWS = Object.freeze([
  ['C', 'D', 'E', 'F', 'NEXT', 'REG'],
  ['8', '9', 'A', 'B', 'BKP', 'STEP'],
  ['4', '5', '6', '7', 'RUN', 'HALT'],
  ['0', '1', '2', '3', 'C/CE', 'PGM'],
].map(Object.freeze));

/** A successful edit persists exactly the program accepted by the active device. */
export function microtronicControl({board, part, verb, value, onProgramChange}) {
  if (part?.kind !== MICROTRONIC_KIND || typeof board?.setDeviceControl !== 'function') {
    throw new Error('The Microtronic circuit engine is unavailable.');
  }
  if (!board.setDeviceControl(part.id, verb, value)) {
    const warning = board.getRenderState?.().warnings?.find(w =>
      w.type === 'device-control-refused' && w.partId === part.id && w.message?.startsWith(`"${verb}"`));
    throw new Error(warning?.message || `The Microtronic could not accept ${verb}. Use three-digit hexadecimal words at addresses 00–FF.`);
  }
  const state = board.getDeviceState(part.id);
  if (!state) throw new Error('The Microtronic has no live circuit state.');
  if (typeof state.programSource === 'string' && state.programSource !== part.params?.program) {
    onProgramChange?.(part.id, state.programSource);
  }
  return state;
}

/** Persist without rebuilding the electrical network or resetting another computer. */
export function saveMicrotronicProgram(circuit, partId, source) {
  const part = circuit.getPart(partId);
  if (part?.kind !== MICROTRONIC_KIND || typeof source !== 'string') return false;
  if (part.params?.program === source) return false;
  // Program source comes back from a successful device command. The same-source
  // parameter update is intentionally idempotent in the engine.
  circuit.setPartParam(partId, 'program', source);
  part.params = {...part.params, program: source};
  circuit._saveHistory();
  return true;
}

/** Keyboard shortcuts apply only inside the focused front panel, never editors. */
export function microtronicKeyboardKey(event, running) {
  if (event.repeat || event.ctrlKey || event.altKey || event.metaKey) return null;
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(event.target?.tagName || '') || event.target?.isContentEditable) return null;
  if (/^[0-9a-f]$/i.test(event.key)) return event.key.toUpperCase();
  if (event.key === 'Escape') return 'HALT';
  if (event.key === 'Enter' && event.target?.tagName !== 'BUTTON') return 'NEXT';
  if (event.key === ' ' && event.target?.tagName !== 'BUTTON') return running ? 'HALT' : 'RUN';
  return null;
}
