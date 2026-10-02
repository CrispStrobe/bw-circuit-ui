/**
 * Multimeter model — voltage, current, and resistance measurement.
 *
 * The honesty rule: resistance() returns 'requires-power-off' when the
 * board is powered. This is a FEATURE — a real DMM measures resistance
 * with the power off. The UI should prompt the user to switch off,
 * not show an error.
 *
 * Every reading comes from the engine. Nothing is fabricated.
 */

/**
 * @typedef {'voltage' | 'current' | 'resistance'} MeterMode
 */

/**
 * @typedef {object} Probe
 * @property {string|null} netId — the net being probed (for V and Ω)
 * @property {string|null} partId — the part being probed (for A)
 * @property {string|null} terminal — the terminal being probed (for A)
 */

/**
 * @typedef {object} MeterState
 * @property {MeterMode} mode
 * @property {Probe} probeA
 * @property {Probe} probeB
 */

/**
 * The averaged reading when the circuit offers one (Circuit.meterVoltage /
 * meterCurrent, over bw-board's 100 ms meter window), else the instantaneous
 * one — a caller handing in a bare {nodeVoltage, branchCurrent} still works.
 */
export function meterDifference(circuit, netA, netB) {
  if (typeof circuit.meterVoltage === 'function') return circuit.meterVoltage(netA, netB);
  const a = circuit.nodeVoltage(netA);
  const b = circuit.nodeVoltage(netB);
  if (!Number.isFinite(a)) throw new Error('Invalid instantaneous voltage operand A');
  if (!Number.isFinite(b)) throw new Error('Invalid instantaneous voltage operand B');
  return a - b;
}

/** @see meterDifference */
export function meterCurrentOf(circuit, partId, terminal) {
  if (typeof circuit.meterCurrent === 'function') return circuit.meterCurrent(partId, terminal);
  return circuit.branchCurrent(partId, terminal);
}

/**
 * Create a fresh meter state.
 * @returns {MeterState}
 */
export function createMeterState() {
  return {
    mode: 'voltage',
    probeA: { netId: null, partId: null, terminal: null },
    probeB: { netId: null, partId: null, terminal: null },
  };
}

/**
 * Take a meter reading. Returns a display object.
 *
 * @param {MeterState} meter
 * @param {import('./circuit.js').Circuit} circuit
 * Successful readings preserve their numeric SI value alongside the formatted
 * display value.  Callers doing calculations must use siValue rather than
 * parsing the human-readable value/unit pair.
 *
 * @returns {{ value: string, unit: string, note: string|null, siValue: number|null, siUnit: string }}
 */
export function readMeter(meter, circuit) {
  // No board → "needs the simulator", not 0 (which would be a fabricated reading)
  if (!circuit || !circuit.board) {
    return { value: '---', unit: '', note: 'Needs the simulator', siValue: null, siUnit: '' };
  }

  const { mode, probeA, probeB } = meter;

  switch (mode) {
    case 'voltage': {
      if (!probeA.netId || !probeB.netId) {
        return { value: '---', unit: 'V', note: 'Place both probes on nets', siValue: null, siUnit: 'V' };
      }
      try {
        // A DMM averages (100 ms, the engine's meter window): on a PWM net it
        // shows the mean, not whichever level the last instant solved to.
        const diff = meterDifference(circuit, probeA.netId, probeB.netId);
        if (!Number.isFinite(diff)) throw new Error('Nonfinite voltage reading');
        return { value: diff.toFixed(3), unit: 'V', note: null, siValue: diff, siUnit: 'V' };
      } catch {
        return { value: '---', unit: 'V', note: 'Cannot read voltage', siValue: null, siUnit: 'V' };
      }
    }

    case 'current': {
      if (!probeA.partId || !probeA.terminal) {
        return { value: '---', unit: 'A', note: 'Place probe A on a part terminal', siValue: null, siUnit: 'A' };
      }
      try {
        // Raw/public current is signed positive OUT of the probed part. Keep
        // the sign: reversing the selected terminal must reverse the reading.
        const i = meterCurrentOf(circuit, probeA.partId, probeA.terminal);
        if (!Number.isFinite(i)) throw new Error('Nonfinite current reading');
        const magnitude = Math.abs(i);
        let scale = 1e3;
        let unit = 'mA';
        let digits = 3;
        if (magnitude >= 1) {
          scale = 1;
          unit = 'A';
        } else if (magnitude > 0 && magnitude < 1e-12) {
          scale = 1;
          unit = 'A';
          digits = null;
        } else if (magnitude > 0 && magnitude < 1e-9) {
          scale = 1e12;
          unit = 'pA';
        } else if (magnitude > 0 && magnitude < 1e-6) {
          scale = 1e9;
          unit = 'nA';
        } else if (magnitude > 0 && magnitude < 1e-3) {
          scale = 1e6;
          unit = 'µA';
        }
        const value = digits == null ? i.toExponential(3) : (i * scale).toFixed(digits);
        return { value, unit, note: null, siValue: i, siUnit: 'A' };
      } catch {
        return { value: '---', unit: 'mA', note: 'Cannot read current', siValue: null, siUnit: 'A' };
      }
    }

    case 'resistance': {
      if (!probeA.netId || !probeB.netId) {
        return { value: '---', unit: 'Ω', note: 'Place both probes on nets', siValue: null, siUnit: 'Ω' };
      }
      try {
        const r = circuit.resistance(probeA.netId, probeB.netId);
        if (r === 'requires-power-off') {
          // This is the meter behaving correctly, not an error.
          return {
            value: '---',
            unit: 'Ω',
            note: 'Turn power OFF to measure resistance (this is how a real DMM works)',
            siValue: null,
            siUnit: 'Ω',
          };
        }
        if (!Number.isFinite(r)) throw new Error('Nonfinite resistance reading');
        if (r > 1e6) {
          return { value: (r / 1e6).toFixed(2), unit: 'MΩ', note: null, siValue: r, siUnit: 'Ω' };
        }
        if (r > 1e3) {
          return { value: (r / 1e3).toFixed(2), unit: 'kΩ', note: null, siValue: r, siUnit: 'Ω' };
        }
        return { value: r.toFixed(1), unit: 'Ω', note: null, siValue: r, siUnit: 'Ω' };
      } catch {
        return { value: '---', unit: 'Ω', note: 'Cannot read resistance', siValue: null, siUnit: 'Ω' };
      }
    }

    default:
      return { value: '---', unit: '', note: 'Unknown mode', siValue: null, siUnit: '' };
  }
}
