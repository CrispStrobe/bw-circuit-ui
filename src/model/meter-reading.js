/**
 * Read a placeable meter's value from the circuit.
 *
 * The meter is a UI-only part with two probe terminals. Its reading
 * depends on where the probes are wired and the meter's mode (V/A/Ω).
 */

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
        if (r > 1e6) return { value: (r / 1e6).toFixed(1), unit: 'MΩ', note: null };
        if (r > 1e3) return { value: (r / 1e3).toFixed(1), unit: 'kΩ', note: null };
        return { value: r.toFixed(0), unit: 'Ω', note: null };
      } catch {
        return { value: '---', unit: 'Ω', note: null };
      }
    }

    case 'current': {
      // Current mode needs a part + terminal, not two nets
      // Find a part connected to probe A
      const conn = findProbePartTerminal(meter.id, 'probe_a', wires);
      if (!conn) return { value: '---', unit: 'mA', note: 'Wire probe A to a part' };
      try {
        const i = circuit.branchCurrent(conn.part, conn.terminal);
        const mA = i * 1000;
        return { value: Math.abs(mA).toFixed(1), unit: 'mA', note: null };
      } catch {
        return { value: '---', unit: 'mA', note: null };
      }
    }

    default:
      return { value: '---', unit: '', note: null };
  }
}

function findProbeNet(meterId, probeTerminal, wires) {
  for (const w of wires) {
    if (w.from.part === meterId && w.from.terminal === probeTerminal) return w.netId;
    if (w.to.part === meterId && w.to.terminal === probeTerminal) return w.netId;
  }
  return null;
}

function findProbePartTerminal(meterId, probeTerminal, wires) {
  for (const w of wires) {
    if (w.from.part === meterId && w.from.terminal === probeTerminal) {
      return { part: w.to.part, terminal: w.to.terminal };
    }
    if (w.to.part === meterId && w.to.terminal === probeTerminal) {
      return { part: w.from.part, terminal: w.from.terminal };
    }
  }
  return null;
}
