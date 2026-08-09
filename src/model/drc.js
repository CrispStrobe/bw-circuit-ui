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
 *
 * @module
 */

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

// ── Thresholds from bw-board/src/pin-model.js ─────────────────────
// These are the SAME constants; we cite them, not duplicate them.
// If pin-model.js changes, this must be updated to match.
const QUASI_SOURCE_CURRENT_A = 0.000230;  // ~230 µA at 5V
const STRONG_SINK_CURRENT_A = 0.020;       // ~20 mA (R_STRONG = 25Ω at 5V)
const LED_MAX_CURRENT_A = 0.020;           // typical LED absolute max
const MIN_SERIES_R_FOR_LED = 50;           // Ω — below this, it's basically direct

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

          const isHighCurrentLoad = ['relay', 'dc_motor', 'hobby_gearmotor', 'servo', 'buzzer'].includes(loadPart.kind);
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
  const INDUCTIVE_KINDS = new Set(['relay', 'dc_motor', 'hobby_gearmotor', 'inductor']);
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

  return warnings;
}
