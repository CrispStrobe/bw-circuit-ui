/**
 * Read a placeable meter's value from the circuit.
 *
 * The meter is a UI-only part with two probe terminals. Its reading
 * depends on where the probes are wired and the meter's mode (V/A/Ω).
 */
import { wireEndpoint } from './wire-endpoints.js';

/**
 * Get the reading for a meter part.
 *
 * @param {object} meter — the meter part { id, params: { mode } }
 * @param {Array} wires — all wires
 * @param {object} circuit — the Circuit instance
 * @returns {{ value: string, unit: string, note: string|null }}
 */
export function getMeterReading(meter, wires, circuit) {
  const mode = meter.params?.mode || 'voltage';

  // Find what each probe is connected to
  const probeANet = findProbeNet(meter.id, 'probe_a', wires);
  const probeBNet = findProbeNet(meter.id, 'probe_b', wires);

  if (!circuit || !circuit.board) {
    return { value: '---', unit: '', note: 'Needs the simulator' };
  }

  switch (mode) {
    case 'voltage': {
      if (!probeANet || !probeBNet) return { value: '---', unit: 'V', note: 'Wire both probes' };
      try {
        const vA = circuit.nodeVoltage(probeANet);
        const vB = circuit.nodeVoltage(probeBNet);
        const diff = vA - vB;
        if (Math.abs(diff) < 0.01) return { value: '0', unit: 'V', note: null };
        if (Math.abs(diff) < 1) return { value: (diff * 1000).toFixed(0), unit: 'mV', note: null };
        return { value: diff.toFixed(1), unit: 'V', note: null };
      } catch {
        return { value: '---', unit: 'V', note: null };
      }
    }

    case 'resistance': {
      if (!probeANet || !probeBNet) return { value: '---', unit: 'Ω', note: 'Wire both probes' };
      try {
        const r = circuit.resistance(probeANet, probeBNet);
        if (r === 'requires-power-off') {
          return { value: '---', unit: 'Ω', note: 'Turn power OFF' };
        }
        if (r >= 1e6) return { value: (r / 1e6).toFixed(1), unit: 'MΩ', note: null };
        if (r >= 1e3) return { value: (r / 1e3).toFixed(1), unit: 'kΩ', note: null };
        return { value: r.toFixed(0), unit: 'Ω', note: null };
      } catch {
        return { value: '---', unit: 'Ω', note: null };
      }
    }

    case 'current': {
      // Current mode needs a part + terminal, not two nets.
      // A real ammeter is wired IN SERIES and drops a burden voltage
      // (~0.2V for a typical DMM shunt). The simulated meter reads
      // the current without inserting itself — which is a simplification
      // a learner should know about.
      const conn = findProbePartTerminal(meter.id, 'probe_a', wires);
      if (!conn) return { value: '---', unit: 'mA', note: 'Wire probe A in series with a part' };
      try {
        const i = circuit.branchCurrent(conn.part, conn.terminal);
        const mA = i * 1000;
        return {
          value: Math.abs(mA).toFixed(1),
          unit: 'mA',
          // Teaching note: a real meter changes the circuit it measures
          note: Math.abs(mA) > 0.1 ? 'Real ammeter drops ~0.2V (burden voltage)' : null,
        };
      } catch {
        return { value: '---', unit: 'mA', note: null };
      }
    }

    default:
      return { value: '---', unit: '', note: null };
  }
}

function findProbeNet(meterId, probeTerminal, wires) {
  // The meter is filtered from the engine netlist, so its wire's netId
  // may not exist in the engine. Follow the wire to the OTHER end's
  // part+terminal, then find what engine net THAT terminal is on.
  for (const w of wires) {
    const f = wireEndpoint(w, 'from');
    const t = wireEndpoint(w, 'to');
    if (!f || !t) continue;
    let otherPart, otherTerm;
    if (f.part === meterId && f.terminal === probeTerminal) {
      otherPart = t.part; otherTerm = t.terminal;
    } else if (t.part === meterId && t.terminal === probeTerminal) {
      otherPart = f.part; otherTerm = f.terminal;
    }
    if (!otherPart) continue;

    // Find the engine net this other terminal is on
    for (const w2 of wires) {
      const f2 = wireEndpoint(w2, 'from');
      const t2 = wireEndpoint(w2, 'to');
      if (!f2 || !t2) continue;
      if (f2.part === meterId || t2.part === meterId) continue; // skip meter wires
      if ((f2.part === otherPart && f2.terminal === otherTerm) ||
          (t2.part === otherPart && t2.terminal === otherTerm)) {
        return w2.netId;
      }
    }
    // If the other part has no other wires, use the meter wire's net as fallback
    return w.netId;
  }
  return null;
}

function findProbePartTerminal(meterId, probeTerminal, wires) {
  for (const w of wires) {
    const f = wireEndpoint(w, 'from');
    const t = wireEndpoint(w, 'to');
    if (!f || !t) continue;
    if (f.part === meterId && f.terminal === probeTerminal) {
      return { part: t.part, terminal: t.terminal };
    }
    if (t.part === meterId && t.terminal === probeTerminal) {
      return { part: f.part, terminal: f.terminal };
    }
  }
  return null;
}
