/**
 * Design-Rule Check — evaluate a circuit against real hardware limits.
 *
 * Every threshold comes from bw-board's pin-model.js or the part's datasheet
 * values, NEVER invented here. The checker explains and offers fixes; it never
 * blocks the user from building the wrong thing (that is how benches teach).
 *
 * Rules:
 *   1. Source-current violation (quasi-bidir pin can't source enough)
 *   2. Missing series resistor (LED direct to pin/supply)
 *   3. Missing flyback diode (inductive load without protection)
 *   4. Floating input (input pin with nothing driving it)
 *   5. Supply short (VCC→GND through negligible impedance)
 *   6. Polarity (polarised component wired backward)
 *   7. I2C pull-up (pcf8574/char_lcd_i2c/eeprom need pull-ups)
 *   8. Aggregate current (total chip current exceeds ~120 mA)
 *
 * @module
 */

import { getEngine } from '../engine.js';

/**
 * Read current-rating data from the injected engine if available.
 * Falls back to conservative defaults if the host did not inject them.
 */
function getCurrentRatings() {
  try {
    const engine = getEngine();
    if (engine.getMaxCurrent && engine.PORT_LIMITS) {
      return { getMaxCurrent: engine.getMaxCurrent, PORT_LIMITS: engine.PORT_LIMITS };
    }
  } catch { /* engine not injected yet */ }
  // Fallback — conservative defaults from STC12 datasheet §4.1
  return {
    getMaxCurrent: () => null, // unknown = cannot sum
    PORT_LIMITS: {
      perPin: { sink: 0.020, source: 0.000230 },
      perPort: { sink: 0.080 },
      perChip: { sink: 0.120 },
    },
  };
}

/**
 * @typedef {object} DrcWarning
 * @property {'info' | 'warning' | 'danger'} severity
 * @property {string} rule — which rule triggered (source-current, missing-resistor, etc.)
 * @property {string} partId — the part the warning is about
 * @property {string} [pinId] — specific pin if applicable
 * @property {string} explanation — what is wrong and why, for a learner
 * @property {string} [fix] — suggested fix (e.g. "Add a transistor to switch it")
 * @property {string} [fixPart] — part kind that would fix it (for one-click add)
 */

// Thresholds are read at call time from the engine, not at import time,
// so the engine can be injected after this module loads.

// Retro-bench bus extractors — optional. In lite these resolve against
// the sibling bw-board vendor tree; in standalone bw-circuit-ui they are
// absent and the extractor DRC rules simply do not run. Injected via
// setExtractors() rather than a static import so the same source works
// in both environments.
let _extract6502 = null;
let _extractZ80 = null;
export function setExtractors({ extract6502Machine, extractZ80Machine } = {}) {
    if (extract6502Machine) _extract6502 = extract6502Machine;
    if (extractZ80Machine) _extractZ80 = extractZ80Machine;
}

/**
 * Run all design-rule checks against a circuit.
 *
 * @param {object} circuit — the Circuit instance
 * @param {object} board — the Board instance (from circuit.board)
 * @returns {DrcWarning[]}
 */
export function runDrc(circuit, board) {
  const warnings = [];
  if (!board || !board.powered) return warnings;

  const { getMaxCurrent, PORT_LIMITS } = getCurrentRatings();
  const QUASI_SOURCE_CURRENT_A = PORT_LIMITS.perPin.source;
  const CHIP_CURRENT_LIMIT_A = PORT_LIMITS.perChip.sink;

  const parts = circuit.parts;
  const wires = circuit.wires;

  // Build net membership for quick lookup
  const terminalToNet = new Map();
  for (const w of wires) {
    terminalToNet.set(`${w.from.part}:${w.from.terminal}`, w.netId);
    terminalToNet.set(`${w.to.part}:${w.to.terminal}`, w.netId);
  }
  // Also from breadboard nets if available
  for (const bb of circuit.breadboards?.values() || []) {
    try {
      const { nets } = bb.deriveNets();
      for (const net of nets) {
        for (const t of net.terminals) {
          terminalToNet.set(`${t.part}:${t.terminal}`, net.id);
        }
      }
    } catch { /* incomplete board */ }
  }

  const netMembers = new Map();
  for (const [key, netId] of terminalToNet) {
    if (!netMembers.has(netId)) netMembers.set(netId, []);
    const [part, terminal] = key.split(':');
    netMembers.get(netId).push({ part, terminal });
  }

  // Helper: find all parts on a net
  const partsOnNet = (netId) => netMembers.get(netId) || [];
  const partById = (id) => parts.find(p => p.id === id);
  const netOf = (partId, terminal) => terminalToNet.get(`${partId}:${terminal}`);

  // ── Rule 0: Pico GPIO voltage domain ──────────────────────────────
  // RP2040 GPIO is 3.3 V only. VBUS is deliberately excluded: it is the
  // board's 5 V USB input, not a GPIO signal.
  for (const pico of parts.filter(p => p.kind === 'pi_pico')) {
    for (const pin of pico.terminals || []) {
      if (!/^gp\d+$/i.test(pin)) continue;
      const netId = netOf(pico.id, pin);
      if (!netId) continue;
      const members = partsOnNet(netId);
      const fiveVoltSource = members.some(member => {
        const source = partById(member.part);
        if (!source) return false;
        if (source.kind === 'vcc' || /^(5v|vin)$/i.test(member.terminal)) return true;
        return source.kind === 'vsource' && Number(source.params?.volts) > 3.6;
      });
      if (fiveVoltSource) {
        warnings.push({
          severity: 'danger',
          rule: 'pico-voltage',
          partId: pico.id,
          pinId: pin,
          explanation: `${pin.toUpperCase()} is an RP2040 GPIO at 3.3 V. ` +
            'This connection reaches a 5 V-or-higher source and can damage the Pico.',
          fix: 'Use the Pico 3V3 rail or a proper logic-level shifter; reserve VBUS for board power.',
        });
      }
    }
  }

  // ── Rule 1: Source-current violation ──────────────────────────────
  for (const part of parts) {
    if (part.kind !== 'mcu') continue;
    for (const pin of part.terminals) {
      const state = board.pinStates?.get(pin);
      if (!state) continue;

      // Quasi-bidir driving high → weak source (~230 µA)
      if (state.mode === 'quasi' && state.driveHigh) {
        const net = netOf(part.id, pin);
        if (!net) continue;
        const members = partsOnNet(net);

        // Find loads on this net
        for (const m of members) {
          if (m.part === part.id) continue;
          const loadPart = partById(m.part);
          if (!loadPart) continue;

          const isHighCurrentLoad = ['relay', 'dc_motor', 'gearmotor', 'servo', 'buzzer'].includes(loadPart.kind);
          const isLed = loadPart.kind === 'led' || loadPart.kind === 'rgb_led';

          if (isHighCurrentLoad) {
            warnings.push({
              severity: 'danger',
              rule: 'source-current',
              partId: part.id,
              pinId: pin,
              explanation: `${pin} is in quasi-bidirectional mode and can only source ~230 µA. ` +
                `A ${loadPart.kind} typically needs 50–200 mA. ` +
                `The pin cannot drive this load directly — the ${loadPart.kind} will not work.`,
              fix: 'Add a transistor (NPN or TIP120) to switch the load. ' +
                'The pin drives the transistor base; the transistor switches the load current from VCC.',
              fixPart: 'npn',
            });
          }

          // LED sourced from quasi: will be very dim (I ≈ V/R_quasi ≈ 230 µA)
          if (isLed && m.terminal === 'anode') {
            // Check if there's a resistor in the path (active-high: pin → LED → GND)
            const cathodeNet = netOf(loadPart.id, 'cathode');
            if (!cathodeNet) continue;
            const cathodeMembers = partsOnNet(cathodeNet);
            const hasGnd = cathodeMembers.some(mm => partById(mm.part)?.kind === 'gnd');
            if (hasGnd) {
              warnings.push({
                severity: 'warning',
                rule: 'source-current',
                partId: loadPart.id,
                pinId: pin,
                explanation: `${pin} sources only ~230 µA in quasi-bidirectional mode. ` +
                  `This LED will be barely visible. Wire it active-low instead: ` +
                  `pin → resistor → LED cathode, LED anode → VCC. ` +
                  `The pin sinks 20 mA, which is plenty.`,
                fix: 'Rewire active-low: LED anode to VCC, cathode through resistor to pin.',
              });
            }
          }
        }
      }
    }
  }

  // ── Rule 2: Missing series resistor ───────────────────────────────
  for (const part of parts) {
    if (part.kind !== 'led' && part.kind !== 'rgb_led') continue;
    const terminals = part.kind === 'rgb_led'
      ? ['r_anode', 'g_anode', 'b_anode']
      : ['anode'];

    for (const anodeTerm of terminals) {
      const anodeNet = netOf(part.id, anodeTerm);
      if (!anodeNet) continue;
      const cathodeTerm = part.kind === 'rgb_led' ? 'cathode' : 'cathode';
      const cathodeNet = netOf(part.id, cathodeTerm);
      if (!cathodeNet) continue;

      // Check if there's a resistor between the LED and either supply
      const anodeMembers = partsOnNet(anodeNet);
      const cathodeMembers = partsOnNet(cathodeNet);

      const hasResistorOnAnode = anodeMembers.some(m => partById(m.part)?.kind === 'resistor');
      const hasResistorOnCathode = cathodeMembers.some(m => partById(m.part)?.kind === 'resistor');

      if (!hasResistorOnAnode && !hasResistorOnCathode) {
        // Direct connection: check if it's VCC→LED→GND or pin→LED→GND
        const directToSupply = anodeMembers.some(m => {
          const p = partById(m.part);
          return p && (p.kind === 'vcc' || p.kind === 'mcu');
        }) && cathodeMembers.some(m => {
          const p = partById(m.part);
          return p && (p.kind === 'gnd' || p.kind === 'mcu');
        });

        if (directToSupply) {
          warnings.push({
            severity: 'danger',
            rule: 'missing-resistor',
            partId: part.id,
            explanation: `This LED has no series resistor. Without one, the current is limited only by ` +
              `the LED's forward resistance (~10 Ω), which means ${part.kind === 'led' ? '~300' : '~150'} mA — ` +
              `far above the 20 mA maximum. The LED will burn out.`,
            fix: 'Add a resistor (220 Ω–1 kΩ) in series. For 5V and a red LED: R = (5 − 2) / 0.015 = 200 Ω.',
            fixPart: 'resistor',
          });
        }
      }
    }
  }

  // ── Rule 3: Missing flyback diode ─────────────────────────────────
  // Note: l293d has built-in flyback diodes (the D suffix), so it's excluded
  const INDUCTIVE_KINDS = new Set(['relay', 'relay_dpdt', 'dc_motor', 'gearmotor', 'vibration_motor', 'inductor']);
  for (const part of parts) {
    if (!INDUCTIVE_KINDS.has(part.kind)) continue;

    // Check if there's a diode across the inductive load's terminals
    const termA = part.terminals[0];
    const termB = part.terminals[1] || part.terminals[0];
    const netA = netOf(part.id, termA);
    const netB = netOf(part.id, termB);
    if (!netA || !netB) continue;

    const membersA = partsOnNet(netA);
    const membersB = partsOnNet(netB);

    // Look for a diode with cathode on one net and anode on the other
    const hasFlyback = membersA.some(ma => {
      const p = partById(ma.part);
      if (!p || p.kind !== 'diode') return false;
      // Diode anode on netA, cathode should be on netB (or vice versa)
      const otherTerm = ma.terminal === 'anode' ? 'cathode' : 'anode';
      return membersB.some(mb => mb.part === p.id && mb.terminal === otherTerm);
    });

    if (!hasFlyback) {
      // Check if there's a transistor driving it (the transistor is what gets killed)
      const hasDriver = membersA.some(m => ['npn', 'pnp', 'nmos', 'pmos'].includes(partById(m.part)?.kind)) ||
                        membersB.some(m => ['npn', 'pnp', 'nmos', 'pmos'].includes(partById(m.part)?.kind));

      warnings.push({
        severity: hasDriver ? 'danger' : 'warning',
        rule: 'missing-flyback',
        partId: part.id,
        explanation: `This ${part.kind} is an inductive load. When it switches off, the collapsing ` +
          `magnetic field produces a voltage spike (back-EMF) that can destroy ` +
          `${hasDriver ? 'the driving transistor' : 'the driving circuit'}. ` +
          `A flyback diode across the coil clamps this spike safely.`,
        fix: 'Add a diode across the load, cathode toward VCC (reverse-biased during normal operation).',
        fixPart: 'diode',
      });
    }
  }

  // ── Rule 4: Floating input ────────────────────────────────────────
  for (const part of parts) {
    if (part.kind !== 'mcu') continue;
    for (const pin of part.terminals) {
      const state = board.pinStates?.get(pin);
      if (!state || state.mode !== 'input') continue;

      const net = netOf(part.id, pin);
      if (!net) {
        warnings.push({
          severity: 'warning',
          rule: 'floating-input',
          partId: part.id,
          pinId: pin,
          explanation: `${pin} is configured as an input but has nothing connected to it. ` +
            `A floating input reads random noise and can cause unpredictable behavior.`,
          fix: 'Connect a pull-up or pull-down resistor, or use input-pullup mode, ' +
            'or wire it to a signal source (button, sensor, etc.).',
        });
        continue;
      }

      const members = partsOnNet(net);
      const externalParts = members.filter(m => m.part !== part.id);
      if (externalParts.length === 0) {
        warnings.push({
          severity: 'warning',
          rule: 'floating-input',
          partId: part.id,
          pinId: pin,
          explanation: `${pin} is configured as an input but nothing else is on its net. ` +
            `The pin is electrically floating and will read noise.`,
          fix: 'Wire a signal source (button, sensor) or add a pull-up/pull-down resistor.',
        });
      }
    }
  }

  // ── Rule 5: Supply short ──────────────────────────────────────────
  for (const [netId, members] of netMembers) {
    const hasVcc = members.some(m => partById(m.part)?.kind === 'vcc');
    const hasGnd = members.some(m => partById(m.part)?.kind === 'gnd');
    if (!hasVcc || !hasGnd) continue;

    // VCC and GND on the same net: check if there's meaningful impedance
    const hasResistor = members.some(m => {
      const p = partById(m.part);
      return p && (p.kind === 'resistor' || p.kind === 'potentiometer' || p.kind === 'ldr' || p.kind === 'ntc');
    });
    const hasLed = members.some(m => partById(m.part)?.kind === 'led');
    const hasSemiconductor = members.some(m => {
      const p = partById(m.part);
      return p && ['npn', 'pnp', 'nmos', 'pmos', 'opamp'].includes(p.kind);
    });

    if (!hasResistor && !hasLed && !hasSemiconductor) {
      warnings.push({
        severity: 'danger',
        rule: 'supply-short',
        partId: members.find(m => partById(m.part)?.kind === 'vcc')?.part,
        explanation: 'VCC and GND are connected through no meaningful impedance. ' +
          'This is a short circuit — maximum current will flow, ' +
          'potentially damaging components or the power supply.',
        fix: 'Check the wiring. Every path from VCC to GND should go through a load (resistor, LED, motor, etc.).',
      });
    }
  }

  // ── Rule 6: Polarity ──────────────────────────────────────────────
  // LED backward polarity is checked by bw-board's getWarnings()
  // Here we check polarised capacitors (electrolytic)
  for (const part of parts) {
    if (part.kind !== 'capacitor') continue;
    if (!part.params?.polarized) continue;

    const posNet = netOf(part.id, 'a'); // 'a' is positive terminal
    const negNet = netOf(part.id, 'b');
    if (!posNet || !negNet) continue;

    try {
      const posV = board.nodeVoltage(posNet);
      const negV = board.nodeVoltage(negNet);
      if (typeof posV === 'number' && typeof negV === 'number' && negV > posV + 0.5) {
        warnings.push({
          severity: 'danger',
          rule: 'polarity',
          partId: part.id,
          explanation: `This polarized capacitor is wired backward (negative terminal at ` +
            `${posV.toFixed(1)}V, positive at ${negV.toFixed(1)}V). ` +
            `An electrolytic capacitor can rupture or explode when reverse-biased.`,
          fix: 'Swap the capacitor terminals so the + side is at higher voltage.',
        });
      }
    } catch { /* voltage not available yet */ }
  }

  // ── Rule 7: I2C pull-up resistors ──────────────────────────────
  const I2C_KINDS = new Set(['pcf8574', 'char_lcd_i2c', 'eeprom']);
  for (const part of parts) {
    if (!I2C_KINDS.has(part.kind)) continue;
    for (const line of ['sda', 'scl']) {
      const net = netOf(part.id, line);
      if (!net) continue;
      const members = partsOnNet(net);
      const hasPullup = members.some(m => {
        const p = partById(m.part);
        return p && (p.kind === 'resistor' || p.kind === 'potentiometer');
      });
      if (!hasPullup) {
        warnings.push({
          severity: 'warning',
          rule: 'missing-pullup',
          partId: part.id,
          explanation: `${part.kind}'s ${line.toUpperCase()} line has no pull-up resistor. ` +
            `I²C is an open-drain bus — without pull-ups (typically 4.7 kΩ to VCC), ` +
            `the signal cannot go high and communication will fail.`,
          fix: `Add a 4.7 kΩ resistor from ${line.toUpperCase()} to VCC.`,
          fixPart: 'resistor',
        });
      }
    }
  }

  // ── Rule 8: Aggregate chip current ─────────────────────────────
  // MCU power pins: the simulator powers the chip implicitly, a real bench
  // does not. When the full pin map is present (VCC/GND terminals exist) and
  // nothing is wired to them, say so - as teaching, not as an error.
  {
    const mcu = parts.find(p => p.kind === 'mcu');
    if (mcu && mcu.terminals.includes('VCC')) {
      const touched = (term) => wires.some(w =>
        (w.from.part === mcu.id && w.from.terminal === term) ||
        (w.to.part === mcu.id && w.to.terminal === term));
      const missing = ['VCC', 'GND'].filter(t => !touched(t));
      if (missing.length > 0) {
        warnings.push({
          severity: 'info',
          rule: 'mcu-power-pins',
          partId: mcu.id,
          explanation: `The chip's ${missing.join(' and ')} pin${missing.length > 1 ? 's are' : ' is'} not wired. ` +
            'The simulator powers the MCU implicitly so everything still runs - ' +
            'on a real bench, an unpowered chip does nothing.',
          fix: 'Wire VCC (pin 40) to the +5 V rail and GND (pin 20) to ground, the way the real board needs.',
        });
      }
    }
  }

  // Sum the max current of every part on the circuit. If it exceeds
  // the chip's total rating (~120 mA for STC12), warn. If any part
  // has a null rating (current depends on the circuit, not the kind),
  // the sum is a lower bound — say so honestly.
  {
    let totalA = 0;
    let hasUnrated = false;
    const unratedKinds = [];
    const contributors = [];

    for (const part of parts) {
      if (part.kind === 'mcu' || part.kind === 'breadboard') continue;
      // Circuit-dependent parts are summed from the ENGINE'S MEASURED
      // current when the board can report one - an LED through 220 ohm
      // draws ~12 mA, not the folklore 20; the DRC must not invent loads
      // the solver already computed. Only parts that are BOTH kind-unrated
      // and unmeasured remain honest unknowns.
      const measured = board && board.ledCurrents ? board.ledCurrents.get(part.id) : undefined;
      if (measured !== undefined && measured > 0) {
        totalA += measured;
        if (measured > 0.005) {
          contributors.push({ id: part.id, kind: part.kind, mA: (measured * 1000).toFixed(0) });
        }
        continue;
      }
      const rating = getMaxCurrent(part.kind);
      if (rating === null) {
        hasUnrated = true;
        if (!unratedKinds.includes(part.kind)) unratedKinds.push(part.kind);
      } else {
        totalA += rating;
        if (rating > 0.005) { // only list significant contributors
          contributors.push({ id: part.id, kind: part.kind, mA: (rating * 1000).toFixed(0) });
        }
      }
    }

    if (totalA > CHIP_CURRENT_LIMIT_A) {
      const totalMa = (totalA * 1000).toFixed(0);
      const limitMa = (CHIP_CURRENT_LIMIT_A * 1000).toFixed(0);
      const top = contributors.sort((a, b) => b.mA - a.mA).slice(0, 3);
      const topStr = top.map(c => `${c.kind} (${c.mA} mA)`).join(', ');
      warnings.push({
        severity: 'danger',
        rule: 'aggregate-current',
        partId: parts.find(p => p.kind === 'mcu')?.id || parts[0]?.id,
        explanation: `Total circuit current is ${hasUnrated ? 'at least ' : ''}${totalMa} mA, ` +
          `exceeding the chip's ~${limitMa} mA limit. ` +
          `Largest consumers: ${topStr}.` +
          (hasUnrated ? ` Some parts (${unratedKinds.join(', ')}) cannot be rated — the real total may be higher.` : ''),
        fix: 'Reduce the number of simultaneously active loads, or use external drivers ' +
          '(transistors, shift registers) to power them from VCC rather than from MCU pins.',
      });
    } else if (hasUnrated && totalA > CHIP_CURRENT_LIMIT_A * 0.7) {
      // Close to the limit with unrated parts — warn conservatively
      const totalMa = (totalA * 1000).toFixed(0);
      const limitMa = (CHIP_CURRENT_LIMIT_A * 1000).toFixed(0);
      warnings.push({
        severity: 'warning',
        rule: 'aggregate-current',
        partId: parts.find(p => p.kind === 'mcu')?.id || parts[0]?.id,
        explanation: `Rated parts draw ${totalMa} mA (limit ~${limitMa} mA), ` +
          `but ${unratedKinds.join(', ')} cannot be rated — ` +
          `the total is a lower bound, not a sum. The actual current may exceed the limit.`,
        fix: 'Check the current through unrated parts with the multimeter.',
      });
    }
  }

  // ── Retro-bench extractors ────────────────────────────────────────
  // If the circuit contains a W65C02 or Z80 CPU, run the bus extractor
  // to check for contention, open vectors, and wiring errors. Refusals
  // surface as DRC warnings so the user sees them in the Warnings panel.
  const hasW65c02 = parts.some(p => p.kind === 'w65c02');
  const hasZ80 = parts.some(p => p.kind === 'z80');
  if (hasW65c02 || hasZ80) {
    try {
      // Shape-adapt wires: the designer's wire objects are {from: {part, terminal}, to: ...}
      // but the extractors expect the flat {from, fromTerminal, to, toTerminal} format.
      const flatWires = wires.map(w => ({
        from: w.from?.part || w.from,
        fromTerminal: w.from?.terminal || w.fromTerminal,
        to: w.to?.part || w.to,
        toTerminal: w.to?.terminal || w.toTerminal,
      }));
      const circuitData = { parts, wires: flatWires };
      if (hasW65c02 && _extract6502) {
        const result = _extract6502(circuitData);
        for (const reason of result.reasons || []) {
          warnings.push({
            severity: 'danger', rule: 'bus-extract-6502',
            partId: parts.find(p => p.kind === 'w65c02')?.id,
            explanation: reason,
            fix: 'Check the address decode wiring on the breadboard.',
          });
        }
        for (const note of result.notes || []) {
          warnings.push({
            severity: 'info', rule: 'bus-extract-6502-note',
            partId: parts.find(p => p.kind === 'w65c02')?.id,
            explanation: note,
          });
        }
      }
      if (hasZ80 && _extractZ80) {
        const result = _extractZ80(circuitData);
        for (const reason of result.reasons || []) {
          warnings.push({
            severity: 'danger', rule: 'bus-extract-z80',
            partId: parts.find(p => p.kind === 'z80')?.id,
            explanation: reason,
            fix: 'Check the address decode wiring on the breadboard.',
          });
        }
        for (const note of result.notes || []) {
          warnings.push({
            severity: 'info', rule: 'bus-extract-z80-note',
            partId: parts.find(p => p.kind === 'z80')?.id,
            explanation: note,
          });
        }
      }
    } catch (e) {
      warnings.push({
        severity: 'warning', rule: 'bus-extract-error',
        explanation: `Bus extractor failed: ${e.message}`,
      });
    }
  }

  return warnings;
}
