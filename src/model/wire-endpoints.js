/**
 * Shared endpoint-shape helpers for circuit rendering and migration —
 * THE canonical reader for the two wire-endpoint dialects:
 *
 *   nested (current):  { from: {part, terminal} | {board, hole}, to: … }
 *   flat   (legacy):   { from: 'partId', fromTerminal: 't', … }
 *
 * Both dialects appear MIXED WITHIN ONE FILE in the wild. Every consumer
 * that hand-rolled this split has produced at least one real defect:
 * bw-board's examples-gate union-found on "[object Object] undefined"
 * and failed 26 healthy examples; a corpus rail-short scan reported 802
 * phantom shorts in 2,040 files; and this repo carried four separate
 * shape-adapters (circuit.js, drc.js, machine-extract.js, plus the
 * importer docs). Import these instead of writing a fifth.
 */

export function isBoardEndpoint(endpoint) {
  return !!(endpoint && (endpoint.board || endpoint.boardId ||
    (endpoint.hole && !endpoint.part)));
}

/**
 * Normalized endpoint of `wire` on `side` ('from' | 'to'):
 * `{part, terminal}` for a part pin, `{board/boardId, hole, …}` for a
 * breadboard hole, or `null` for anything malformed — a wire the model
 * cannot resolve renders as a visible gap, never as a phantom net.
 * Semantics lifted verbatim from Circuit.fromJSON's proven migrator.
 *
 * @param {object} wire
 * @param {'from' | 'to'} side
 * @returns {{part: string, terminal: string} | object | null}
 */
export function wireEndpoint(wire, side) {
  const v = wire?.[side];
  if (v && typeof v === 'object') {
    const copy = { ...v };
    if (isBoardEndpoint(copy)) {
      return typeof copy.hole === 'string' ? copy : null;
    }
    return (typeof copy.part === 'string' && typeof copy.terminal === 'string')
      ? copy : null;
  }
  if (typeof v === 'string') {
    const t = wire[`${side}Terminal`];
    if (typeof t === 'string') return { part: v, terminal: t };
  }
  return null;
}

/**
 * The flat `{from, fromTerminal, to, toTerminal}` shape the machine
 * extractors expect, from either dialect. Part endpoints flatten to
 * id + terminal strings; hole endpoints pass through as objects in the
 * `from`/`to` slot (the extractors treat non-string froms as
 * not-their-pin, which is correct — a hole is not a chip pin).
 *
 * @param {object} wire
 * @returns {{from: *, fromTerminal: string | undefined, to: *, toTerminal: string | undefined}}
 */
export function flatWire(wire) {
  const f = wireEndpoint(wire, 'from');
  const t = wireEndpoint(wire, 'to');
  return {
    from: f && !isBoardEndpoint(f) ? f.part : (f ?? wire?.from),
    fromTerminal: f && !isBoardEndpoint(f) ? f.terminal : undefined,
    to: t && !isBoardEndpoint(t) ? t.part : (t ?? wire?.to),
    toTerminal: t && !isBoardEndpoint(t) ? t.terminal : undefined,
  };
}

/**
 * Is `wire` written in the LEGACY FLAT dialect on either side?
 *
 * Not an endpoint reader — a dialect classifier, for the one caller that
 * legitimately needs to know which dialect a file arrived in rather than
 * what it says. CircuitDesigner uses it to decide whether an example file
 * predates the breadboard world (and so should defer to the project's
 * declared pins) or is a modern save to load verbatim. Sniffing it inline
 * with `typeof w.from === 'string'` was a sixth private copy of the
 * dialect rule; classification and reading now move together.
 *
 * Checks BOTH sides, which the inline sniff did not. Measured over the
 * 2,096 shipped circuit files with wires: 1,057 are flat on `from` and
 * the same 1,057 are flat on `to` — not one file is nested on one side
 * and flat on the other, so the widened check reclassifies nothing that
 * ships. It closes the case only for a file yet to be written.
 *
 * @param {object} wire
 * @returns {boolean}
 */
export function isLegacyFlatWire(wire) {
  return typeof wire?.from === 'string' || typeof wire?.to === 'string';
}
