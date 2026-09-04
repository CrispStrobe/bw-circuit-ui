import { flatWire } from './wire-endpoints.js';

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

  // Shape-adapt wires to the flat form the extractors expect — through
  // the ONE canonical dialect reader (wire-endpoints.js), not another
  // hand-rolled adapter.
  const wires = (circuit.wires || []).map(flatWire);
  const flatCircuit = { parts, wires };

  // Detect which CPU family is on the board
  const has6502 = parts.some(p => p.kind === 'w65c02');
  const hasZ80 = parts.some(p => p.kind === 'z80');
  const has8086 = parts.some(p => p.kind === 'i8086' || p.kind === '8086'
    || p.kind === 'i8088' || p.kind === '8088');

  if (has6502 && extractors.extract6502Machine) {
    const result = extractors.extract6502Machine(flatCircuit);
    return { ...result, kind: 'eater6502' };
  }

  if (hasZ80 && extractors.extractZ80Machine) {
    const result = extractors.extractZ80Machine(flatCircuit);
    return { ...result, kind: 'z80' };
  }

  if (has8086 && extractors.extract8086Machine) {
    const result = extractors.extract8086Machine(flatCircuit);
    return { ...result, kind: 'i8086' };
  }

  // A CPU IS on the board but the host never injected its extractor: that
  // is a wiring failure in the app, not the student's circuit. Blaming the
  // circuit here sent a live debugging session hunting a missing W65C02
  // that was seated in plain sight (2026-08-16).
  if (has6502 || hasZ80) {
    return {
      ok: false,
      notes: [],
      reasons: [`the ${has6502 ? 'W65C02' : 'Z80'} is on the board, but this build has no machine extractor wired — the host must inject extract${has6502 ? '6502' : 'Z80'}Machine via setEngine`],
    };
  }

  return {
    ok: false,
    notes: [],
    reasons: ['no retro CPU found — place a W65C02 or Z80 with address-decoded memory and I/O chips'],
  };
}
