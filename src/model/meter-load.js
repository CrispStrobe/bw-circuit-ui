/**
 * Meter loading — what a placed multimeter does to the circuit it measures.
 *
 * D21. Until 2026-08-29 `circuit.js` filtered `p.kind !== 'meter'` out of the
 * netlist and left the meter's probe terminals sitting in the nets. That did
 * two things, and only the first was on the ledger:
 *
 * 1. The probe drew exactly zero current, so a meter could never load anything.
 *    A real bench DMM has ~10 MΩ across its V terminals, which is invisible on
 *    a 1 kΩ divider and decisive on a 1 MΩ one — the lesson the instrument was
 *    built to teach and the one measurement it could not make.
 *
 * 2. Worse, and unrecorded: bw-board's validator has refused a net that
 *    references a part it was not given since `4bd9bb2` (2026-08-08). Filtering
 *    the meter out of `parts` while leaving `{part: meter_6, terminal: probe_a}`
 *    in `nets` therefore rejected the WHOLE netlist. Measured on a
 *    VCC→1k→LED→pin bench: 5 engine parts before the probes were wired, **0
 *    after**, and the meter then read a fabricated "0 V" off the empty board.
 *    Wiring the instrument destroyed the circuit it was pointed at.
 *
 * Both are the same missing step: the meter has to be IN the netlist, as the
 * thing it physically is — a resistor between the probes.
 *
 * What loads and what does not, each because of a reason and not a default:
 *
 * - **Voltage mode loads.** `inputOhms` (default 10 MΩ) is stamped between the
 *   two probe nets. The value is a part parameter, so the inspector edits it
 *   and a lesson can dial in the 1 MΩ meter that makes the error obvious.
 * - **Resistance mode does not.** The ohmmeter measures with the power off and
 *   `board.resistance()` already switches the sources out; stamping the meter's
 *   own input across the pair would corrupt the very reading being taken.
 * - **Current mode does not.** This meter reads a branch current without
 *   inserting itself, and `meter-reading.js` says so on the face ("real ammeter
 *   drops ~0.2 V"). Stamping a shunt would need the probe to CUT the branch,
 *   which is a wiring change and not a stamp; inventing one here would make the
 *   disclosed simplification into an undisclosed lie.
 * - **A probe hanging in the air does not.** Both probes must be on a net.
 *   Stamping a resistor with one terminal on no net would silently reference
 *   ground and load a circuit through a lead that touches nothing.
 */

/** A bench DMM's DC input impedance. 10 MΩ is the figure the datasheets quote. */
export const METER_INPUT_OHMS = 10e6;

/**
 * A meter's input impedance in ohms, from its params, with the default.
 * A non-finite or non-positive value is refused rather than stamped —
 * a zero-ohm "voltmeter" is a short, and this is where that arrives.
 *
 * @param {{params?: {inputOhms?: number|string}}} meter
 * @returns {number}
 */
export function meterInputOhms(meter) {
  const raw = Number(meter?.params?.inputOhms);
  return Number.isFinite(raw) && raw > 0 ? raw : METER_INPUT_OHMS;
}

/** Does this meter load the circuit at all? @param {{params?: object}} meter */
export function meterLoads(meter) {
  return (meter?.params?.mode || 'voltage') === 'voltage';
}

/**
 * Fold placed meters into an engine netlist.
 *
 * A loading meter becomes a `resistor` carrying the SAME part id, so anything
 * that looks the part up by id (branch current, the canvas, a lesson gate) is
 * talking about the same object. Its probe terminals are renamed to the
 * resistor's `a`/`b` in the nets, because `mna.js` finds a resistor's ends by
 * those literal names.
 *
 * A meter that does not load is stripped from the nets instead — see the
 * validator note in this file's header. So is any other terminal naming a part
 * the engine was not given: a net may never reference a part that does not
 * exist, and the shape of that bug is a whole board silently going empty.
 *
 * @param {Array<{id: string, kind: string, params?: object}>} uiParts — the designer's parts
 * @param {Array<{id: string, kind: string, params?: object, terminals?: string[]}>} engineParts
 *        — parts already destined for the engine (meters excluded)
 * @param {Array<{id: string, terminals: Array<{part: string, terminal: string}>}>} nets
 * @returns {{parts: Array<object>, nets: Array<object>, loaded: string[]}}
 *          `loaded` is the ids of the meters that were stamped — the readable
 *          answer to "is this meter loading anything?".
 */
export function applyMeterLoads(uiParts, engineParts, nets) {
  const meters = (uiParts || []).filter(p => p.kind === 'meter');
  const parts = [...engineParts];
  const loaded = [];

  // Which probes are actually wired: a terminal must appear in some net.
  const onNet = new Map(); // meterId -> Set(terminal)
  for (const n of nets) {
    for (const t of n.terminals || []) {
      if (!onNet.has(t.part)) onNet.set(t.part, new Set());
      onNet.get(t.part).add(t.terminal);
    }
  }

  /** meterId -> {probe_a: 'a', probe_b: 'b'} for the stamped ones */
  const rename = new Map();
  for (const m of meters) {
    const wired = onNet.get(m.id);
    const bothWired = !!wired && wired.has('probe_a') && wired.has('probe_b');
    if (!bothWired || !meterLoads(m)) continue;
    parts.push({
      id: m.id,
      kind: 'resistor',
      params: { ...(m.params || {}), ohms: meterInputOhms(m) },
      terminals: ['a', 'b'],
    });
    rename.set(m.id, { probe_a: 'a', probe_b: 'b' });
    loaded.push(m.id);
  }

  const known = new Set(parts.map(p => p.id));
  const meterIds = new Set(meters.map(m => m.id));
  const dropped = new Set();
  const outNets = [];
  for (const n of nets) {
    const terminals = [];
    for (const t of n.terminals || []) {
      const map = rename.get(t.part);
      if (map) { terminals.push({ ...t, terminal: map[t.terminal] ?? t.terminal }); continue; }
      if (!known.has(t.part)) {
        // Never hand the engine a dangling reference. A non-loading meter is
        // EXPECTED here and says nothing; anything else is a bug upstream, and
        // this used to be loud (the validator rejected the netlist and the
        // board went empty), so it stays loud — just without taking the board
        // down with it.
        if (!meterIds.has(t.part)) dropped.add(t.part);
        continue;
      }
      terminals.push(t);
    }
    if (terminals.length) outNets.push({ ...n, terminals });
  }

  return { parts, nets: outNets, loaded, dropped: [...dropped] };
}
