/**
 * A structural fingerprint of a circuit: what a host needs in order to know
 * that the CIRCUIT changed, as against its derived pin declarations.
 *
 * The designer's only "something changed" signal used to be
 * `onDeclarationChange`, which fires when `circuitToDeclarations` produces a
 * different result. On a bench with no microcontroller it never does — the
 * declarations are `{pins: [], ports: [], parts: []}` before and after every
 * edit — so hosts were told nothing at all on those benches. Changing a
 * resistor value, breaking a wire and deleting a part were all silent.
 *
 * What belongs in the signature, and what deliberately does not:
 *
 *   IN   part id, kind and params — a 1 kΩ resistor becoming 470 Ω is the
 *        commonest edit a lesson asks for and the one most likely to be
 *        mistaken for "nothing happened".
 *   IN   wire endpoints — made and broken connections are the topology.
 *   OUT  part POSITION. Dragging a part across the canvas changes the
 *        drawing, not the circuit; a host that treated it as an edit would
 *        fire continuously while the pointer moved.
 *   OUT  wire routing waypoints, for the same reason.
 *
 * @param {Array<{id: string, kind: string, params?: object}>} parts
 * @param {Array<{from?: {part?: string, terminal?: string}, to?: {part?: string, terminal?: string}}>} wires
 * @returns {string}
 */
export function circuitSignature(parts, wires) {
  return JSON.stringify({
    parts: (parts || []).map(p => [p.id, p.kind, p.params ?? null]),
    wires: (wires || []).map(w => [
      w.from?.part, w.from?.terminal, w.to?.part, w.to?.terminal,
    ]),
  });
}
