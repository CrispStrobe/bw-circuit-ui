// SPDX-License-Identifier: MIT
// The circuit Board owns CARDIAC state and time. These helpers only route intent.
export const CARDIAC_KIND = 'cardiac';
export const CARDIAC_OPEN_EVENT = 'bw-cardiac-open';
export const CARDIAC_PROGRAM_EVENT = 'bw-cardiac-program-loaded';
export const CARDIAC_RUN_EVENT = 'bw-cardiac-run';
export const CARDIAC_PAUSE_EVENT = 'bw-cardiac-pause';

function notifyHost(type, partId, target = globalThis.window) {
  if (typeof target?.dispatchEvent !== 'function') return false;
  target.dispatchEvent(new CustomEvent(type, {detail: {partId}}));
  return true;
}

/** CARDIAC gallery programs keep their decimal target; MCU benches cannot run them. */
export const isCardiacExample = example => example?.target === CARDIAC_KIND ||
  typeof example?.files?.cardiac === 'string';

const imageKey = program => {
  if (!program || !Number.isInteger(program.entry) || !Array.isArray(program.words) ||
    !program.words.every(word => word && Number.isInteger(word.address) && Number.isInteger(word.value))) return null;
  const words = program.words.map(({address, value}) => ({address, value})).sort((a, b) => a.address - b.address);
  return JSON.stringify({entry: program.entry, words});
};

export function sameCardiacProgram(left, right) {
  const key = imageKey(left);
  return key !== null && key === imageKey(right);
}

/** Host notifications can save an accepted image, never inject an unaccepted one. */
export function acceptedCardiacProgram(board, part, notifiedProgram) {
  if (part?.kind !== CARDIAC_KIND) return null;
  const accepted = board?.getDeviceState?.(part.id)?.program;
  if (imageKey(accepted) === null || (notifiedProgram !== undefined && !sameCardiacProgram(accepted, notifiedProgram))) return null;
  return accepted;
}

export function cardiacControl({board, part, verb, value, onProgramChange, eventTarget = globalThis.window}) {
  if (part?.kind !== CARDIAC_KIND || typeof board?.setDeviceControl !== 'function') {
    throw new Error('The CARDIAC circuit engine is unavailable.');
  }
  if (['pause', 'step', 'reset', 'loadProgram', 'setPc'].includes(verb)) {
    notifyHost(CARDIAC_PAUSE_EVENT, part.id, eventTarget);
  }
  if (!board.setDeviceControl(part.id, verb, value)) {
    const warning = board.getRenderState?.().warnings?.find(item =>
      item.type === 'device-control-refused' && item.partId === part.id &&
      item.message?.startsWith(`"${verb}"`));
    throw new Error(warning?.message || `CARDIAC could not accept ${verb}.`);
  }
  const state = board.getDeviceState(part.id);
  if (!state) throw new Error('CARDIAC has no live circuit state.');
  if (verb === 'loadProgram' && state.program) onProgramChange?.(part.id, state.program);
  if (verb === 'run' && state.running) notifyHost(CARDIAC_RUN_EVENT, part.id, eventTarget);
  return state;
}

/** The loaded initial image is portable; live self-modifying writes are not edits. */
export function saveCardiacProgram(circuit, partId, program) {
  const part = circuit.getPart(partId);
  if (part?.kind !== CARDIAC_KIND || !program || !Array.isArray(program.words)) return false;
  const saved = {entry: program.entry, words: program.words.map(({address, value}) => ({address, value}))};
  if (sameCardiacProgram(part.params?.program, saved)) return false;
  circuit.setPartParam(partId, 'program', saved);
  part.params = {...part.params, program: saved};
  circuit._saveHistory();
  return true;
}

/** One explicit submission makes one bounded group of signed decimal cards. */
export function parseCardiacInputCards(text) {
  if (typeof text !== 'string' || text.length > 4096) throw new Error('Enter at most 100 signed three-digit cards.');
  const words = text.replace(/−/g, '-').trim().split(/[\s,]+/).filter(Boolean);
  if (!words.length || words.length > 100 || words.some(word => !/^[+-]?\d{1,3}$/.test(word))) {
    throw new Error('Use signed decimal cards from -999 to 999, separated by spaces or commas.');
  }
  return words.map(word => Number(word) || 0);
}

export function formatCardiacWord(value, digits = 3) {
  if (!Number.isInteger(value)) return '—';
  return `${value < 0 ? '−' : ''}${String(Math.abs(value)).padStart(digits, '0')}`;
}

/** Native controls/editors retain their keyboard behavior. */
export function cardiacKeyboardCommand(event, running) {
  if (event.repeat || event.ctrlKey || event.altKey || event.metaKey ||
      /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(event.target?.tagName || '') ||
      event.target?.isContentEditable) return null;
  if (event.key === 'Escape') return 'pause';
  if (event.key === ' ') return running ? 'pause' : 'run';
  if (event.key === 'ArrowRight') return 'step';
  return null;
}

export function openCardiacLab(partId, target = globalThis.window) {
  if (typeof partId !== 'string' || !partId || typeof target?.dispatchEvent !== 'function') return false;
  return notifyHost(CARDIAC_OPEN_EVENT, partId, target);
}
