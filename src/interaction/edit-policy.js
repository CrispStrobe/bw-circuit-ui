/** Build-mode property editing is never an interaction available in SIM. */
export function partEditingAllowed(simulate) {
  return !simulate;
}
