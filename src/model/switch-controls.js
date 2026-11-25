/** Ordinary two-terminal switch controls share the solver's live latch. */
export function switchClosed(part, board) {
  const live = typeof board?.getControl === 'function' ? board.getControl(part.id) : undefined;
  if (live !== undefined) return live === 1;
  const authored = part.params?.closed ?? part.params?.pressed;
  return authored === 1 || authored === true;
}

/** Read again at activation so two clicks before a render still toggle twice. */
export function toggleSwitch(part, board, onControlChange) {
  if (part?.kind !== 'switch' || typeof onControlChange !== 'function') return undefined;
  const next = switchClosed(part, board) ? 0 : 1;
  onControlChange(part.id, next);
  return next;
}
