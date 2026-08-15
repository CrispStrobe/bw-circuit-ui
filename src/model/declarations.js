/**
 * Declaration generator — converts circuit parts into project.stc declarations.
 *
 * Three constraints that cannot come from the part kind alone:
 * 1. POLARITY comes from the WIRING (LED to VCC → active-low, LED to GND → active-high)
 * 2. TONE is singular (one Timer 1 per program)
 * 3. ANALOG is P1.x only, PWM is P1.3/P1.4 only
 */

/**
 * Generate a unique name for a part.
 */
export function generatePartName(kind, existingNames) {
  const prefix = {
    led: 'led', resistor: 'r', buzzer: 'buzzer', button: 'btn',
    potentiometer: 'pot', capacitor: 'cap', vcc: 'vcc', gnd: 'gnd', mcu: 'mcu',
  }[kind] || kind;

  for (let i = 1; i < 100; i++) {
    const name = `${prefix}${i}`;
    if (!existingNames.includes(name)) return name;
  }
  return `${prefix}_${Date.now()}`;
}

/**
 * Derive LED polarity from the wiring.
 *
 * Active-low: the LED's anode-side path reaches VCC (current sinks into the pin).
 * Active-high: the LED's cathode-side path reaches GND (current sources from the pin).
 *
 * @param {string} partId — the LED's part ID
 * @param {Array} parts — all parts
 * @param {Array} wires — all wires
 * @returns {boolean} — true if active-low
 */
function deriveActiveLow(partId, parts, wires) {
  // Walk from the LED's anode through wires to see if we reach VCC or GND
  const visited = new Set();

  function reachable(fromPart, fromTerminal, target) {
    const key = `${fromPart}:${fromTerminal}`;
    if (visited.has(key)) return false;
    visited.add(key);

    // Check if this terminal is on the target part
    const p = parts.find(pp => pp.id === fromPart);
    if (p && p.kind === target) return true;

    // Follow wires from this terminal
    for (const w of wires) {
      let next = null;
      if (w.from.part === fromPart && w.from.terminal === fromTerminal) {
        next = w.to;
      } else if (w.to.part === fromPart && w.to.terminal === fromTerminal) {
        next = w.from;
      }
      if (!next) continue;

      const nextPart = parts.find(pp => pp.id === next.part);
      if (!nextPart) continue;
      if (nextPart.kind === target) return true;

      // Walk through resistors (they're transparent for polarity)
      if (nextPart.kind === 'resistor') {
        const otherTerm = next.terminal === 'a' ? 'b' : 'a';
        if (reachable(next.part, otherTerm, target)) return true;
      }
    }
    return false;
  }

  // Active-low: anode side reaches VCC (VCC → R → LED.anode ... LED.cathode → pin)
  visited.clear();
  const anodeReachesVcc = reachable(partId, 'anode', 'vcc');

  visited.clear();
  const cathodeReachesGnd = reachable(partId, 'cathode', 'gnd');

  // If anode reaches VCC, current flows VCC → LED → pin → sink = active-low
  if (anodeReachesVcc) return true;
  // If cathode reaches GND, current flows pin → LED → GND → source = active-high
  if (cathodeReachesGnd) return false;
  // Default: active-low (the correct wiring for quasi-bidir)
  return true;
}

/**
 * Derive button polarity from wiring.
 * Button to GND with pull-up → active-low (pressed = 0).
 * Button to VCC → active-high (pressed = 1).
 */
function deriveButtonActiveLow(partId, parts, wires) {
  const visited = new Set();

  function reaches(fromPart, fromTerminal, target) {
    const key = `${fromPart}:${fromTerminal}`;
    if (visited.has(key)) return false;
    visited.add(key);
    const p = parts.find(pp => pp.id === fromPart);
    if (p && p.kind === target) return true;
    for (const w of wires) {
      let next = null;
      if (w.from.part === fromPart && w.from.terminal === fromTerminal) next = w.to;
      else if (w.to.part === fromPart && w.to.terminal === fromTerminal) next = w.from;
      if (!next) continue;
      const np = parts.find(pp => pp.id === next.part);
      if (np && np.kind === target) return true;
    }
    return false;
  }

  // If either terminal reaches GND → active-low (pull-down button)
  visited.clear();
  if (reaches(partId, 'a', 'gnd') || reaches(partId, 'b', 'gnd')) return true;
  visited.clear();
  if (reaches(partId, 'a', 'vcc') || reaches(partId, 'b', 'vcc')) return false;
  return true; // default: active-low (standard button wiring)
}

/**
 * Convert a placed part to a project.stc declaration.
 *
 * @param {object} part — { kind, params, declName }
 * @param {string} pin — MCU pin (e.g. "P1.0")
 * @param {object} context — { parts, wires, toneAlreadyClaimed }
 * @returns {object|null}
 */
export function partToDeclaration(part, pin, context) {
  if (!pin || !part.declName) return null;
  const match = pin.match(/P(\d+)\.(\d+)/);
  // Board terminal names: d13 → D13, gp0 → GP0
  const boardMatch = !match && /^([a-zA-Z]+)(\d+)$/i.test(pin);
  if (!match && !boardMatch) return null;

  const port = match ? parseInt(match[1]) : undefined;
  const bit = match ? parseInt(match[2]) : undefined;
  const where = boardMatch ? pin.toUpperCase() : undefined;
  const base = match
    ? { name: part.declName, port, bit, pin }
    : { name: part.declName, where, pin: where };
  const { parts, wires, toneAlreadyClaimed } = context || {};

  switch (part.kind) {
    case 'led': {
      // Polarity from wiring, not a default
      const activeLow = (parts && wires)
        ? deriveActiveLow(part.id, parts, wires)
        : (part.params.activeLow ?? true);
      return { ...base, direction: 'output', activeLow };
    }

    case 'buzzer': {
      // TONE is singular — one Timer 1 per program
      if (toneAlreadyClaimed) {
        // Second buzzer becomes a plain output (can switch on/off, no pitch)
        return { ...base, direction: 'output', activeLow: false };
      }
      return { ...base, direction: 'tone', activeLow: false };
    }

    case 'button': {
      const activeLow = (parts && wires)
        ? deriveButtonActiveLow(part.id, parts, wires)
        : true;
      return { ...base, direction: 'input', activeLow };
    }

    case 'potentiometer': {
      // ANALOG is P1.x only
      if (port !== 1) return { ...base, direction: 'input', activeLow: false };
      return { ...base, direction: 'analog', activeLow: false };
    }

    default:
      return null;
  }
}

/**
 * Build project.stc declarations from the circuit.
 */
const BOARD_TO_DEVICE = {
  arduino_uno: 'arduino-uno', arduino_nano: 'arduino-nano',
  arduino_mega: 'arduino-mega', pi_pico: 'pico',
};
const MCU_KINDS = new Set(['mcu', ...Object.keys(BOARD_TO_DEVICE)]);

export function circuitToDeclarations(parts, wires) {
  const pins = [];
  const mcu = parts.find(p => MCU_KINDS.has(p.kind));
  if (!mcu) return { pins, ports: [], parts: [] };
  const device = BOARD_TO_DEVICE[mcu.kind] || undefined;
  const isBoard = !!device;

  let toneAlreadyClaimed = false;
  const context = { parts, wires, toneAlreadyClaimed: false };

  for (const part of parts) {
    if (!part.declName) continue;

    // Find the MCU pin this part connects to (directly or through a resistor)
    let mcuPin = null;
    for (const wire of wires) {
      // Direct connection
      if (wire.from.part === mcu.id && wire.to.part === part.id) mcuPin = wire.from.terminal;
      else if (wire.to.part === mcu.id && wire.from.part === part.id) mcuPin = wire.to.terminal;
      if (mcuPin) break;

      // Through a resistor
      const mid = wire.from.part === part.id ? wire.to.part
        : wire.to.part === part.id ? wire.from.part : null;
      if (!mid) continue;
      for (const w2 of wires) {
        if (w2 === wire) continue;
        if (w2.from.part === mid && w2.to.part === mcu.id) { mcuPin = w2.to.terminal; break; }
        if (w2.to.part === mid && w2.from.part === mcu.id) { mcuPin = w2.from.terminal; break; }
      }
      if (mcuPin) break;
    }

    if (mcuPin) {
      const decl = partToDeclaration(part, mcuPin, context);
      if (decl) {
        if (decl.direction === 'tone') context.toneAlreadyClaimed = true;
        pins.push(decl);
      }
    }
  }

  return { device, pins, ports: [], parts: [] };
}
