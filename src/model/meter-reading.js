/**
 * Read a placeable meter's value from the circuit.
 *
 * The meter is a UI-only part with two probe terminals. Its reading
 * depends on where the probes are wired and the meter's mode (V/A/Ω).
 */
import { wireEndpoint } from './wire-endpoints.js';
import { meterInputOhms } from './meter-load.js';

/** Human label for an ohms value: 10 MΩ, 470 kΩ, 100 Ω. */
export function ohmsLabel(ohms) {
  if (!Number.isFinite(ohms)) return '—';
  if (ohms >= 1e6) return `${trimZeros(ohms / 1e6)} MΩ`;
  if (ohms >= 1e3) return `${trimZeros(ohms / 1e3)} kΩ`;
  return `${trimZeros(ohms)} Ω`;
}
function trimZeros(n) {
  return String(Number(n.toFixed(3)));
}

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
      // The input impedance is part of the reading, not a footnote: on a 1 kΩ
      // divider 10 MΩ is invisible and on a 1 MΩ one it moves the answer by
      // 4.76 %. A learner cannot tell those apart from the number alone, so the
      // face states the figure that decides it (D21).
      const spec = ohmsLabel(meterInputOhms(meter));
      if (!probeANet || !probeBNet) return { value: '---', unit: 'V', note: 'Wire both probes', spec };
      try {
        const vA = circuit.nodeVoltage(probeANet);
        const vB = circuit.nodeVoltage(probeBNet);
        const diff = vA - vB;
        // Three decimals on volts, one on millivolts. One decimal — what this
        // showed until 2026-08-29 — renders the loaded and unloaded readings of
        // a 100 kΩ divider as the same string, which is the one comparison the
        // impedance above exists to make.
        if (Math.abs(diff) < 0.001) return { value: '0', unit: 'V', note: null, spec };
        if (Math.abs(diff) < 1) return { value: (diff * 1000).toFixed(1), unit: 'mV', note: null, spec };
        return { value: diff.toFixed(3), unit: 'V', note: null, spec };
      } catch {
        return { value: '---', unit: 'V', note: null, spec };
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
  // Follow the wire to the OTHER end's part+terminal, then find what engine
  // net THAT terminal is on. Since D21 a loading meter is IN the netlist (as a
  // resistor, probe_a/probe_b renamed to a/b), so its own wire's net exists too
  // — but a non-loading meter's does not, and this path serves both.
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
