/**
 * Machine extraction — turns a hand-wired designer circuit into a
 * bootable machine config by evaluating the bus decode network.
 *
 * Delegates to bw-board's extractors (m6502-extract, z80-extract) which
 * evaluate the NAND network at all 65536 addresses, refusing bus
 * contention and open vectors WITH ADDRESSES NAMED.
 *
 * The refusal messages ARE the teaching: they explain WHY the decode
 * is wrong, in hardware terms the student can reason about.
 */

/**
 * Extract a machine config from a circuit.
 *
 * @param {{ parts: Array, wires: Array }} circuit — the designer's circuit
 * @param {{ extract6502Machine?: Function, extractZ80Machine?: Function }} extractors
 * @returns {{ ok: boolean, kind?: string, config?: object, lines?: string[], notes: string[], reasons: string[] }}
 */
export function extractMachine(circuit, extractors = {}) {
  const parts = circuit.parts || [];

  // Detect which CPU family is on the board
  const has6502 = parts.some(p => p.kind === 'w65c02');
  const hasZ80 = parts.some(p => p.kind === 'z80');

  if (has6502 && extractors.extract6502Machine) {
    const result = extractors.extract6502Machine(circuit);
    return { ...result, kind: 'eater6502' };
  }

  if (hasZ80 && extractors.extractZ80Machine) {
    const result = extractors.extractZ80Machine(circuit);
    return { ...result, kind: 'z80' };
  }

  return {
    ok: false,
    notes: [],
    reasons: ['no retro CPU found — place a W65C02 or Z80 with address-decoded memory and I/O chips'],
  };
}
