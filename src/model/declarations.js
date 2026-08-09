/**
 * Declaration generator — converts circuit parts into project.stc declarations.
 *
 * When a user drops a part on the canvas, this module generates the
 * corresponding PIN/PORT/PART declaration for project.stc. The declaration
 * feeds the block palette (the name IS the block's label).
 *
 * project.stc is the single source of truth, and both sides write it.
 */

/**
 * Generate a unique name for a part based on its kind and existing names.
 * @param {string} kind — 'led', 'resistor', 'button', etc.
 * @param {string[]} existingNames — names already in use
 * @returns {string}
 */
export function generatePartName(kind, existingNames) {
  const prefix = {
    led: 'led',
    resistor: 'r',
    buzzer: 'buzzer',
    button: 'btn',
    potentiometer: 'pot',
    capacitor: 'cap',
    vcc: 'vcc',
    gnd: 'gnd',
    mcu: 'mcu',
  }[kind] || kind;

  for (let i = 1; i < 100; i++) {
    const name = `${prefix}${i}`;
    if (!existingNames.includes(name)) return name;
  }
  return `${prefix}_${Date.now()}`;
}

/**
 * Infer a PIN declaration from a placed part.
 * Not all parts produce declarations (resistors, VCC, GND don't).
 *
 * @param {object} part — the placed part { kind, params, declName }
 * @param {string} pin — the MCU pin this part is connected to (e.g. "P1.0")
 * @returns {object|null} — a pin declaration for project.stc.pins, or null
 */
export function partToDeclaration(part, pin) {
  if (!pin || !part.declName) return null;

  const match = pin.match(/P(\d+)\.(\d+)/);
  if (!match) return null;

  const base = {
    name: part.declName,
    port: parseInt(match[1]),
    bit: parseInt(match[2]),
    pin,
  };

  switch (part.kind) {
    case 'led':
      return {
        ...base,
        direction: 'output',
        activeLow: part.params.activeLow ?? true,
      };
    case 'buzzer':
      return {
        ...base,
        direction: 'tone',
        activeLow: false,
      };
    case 'button':
      return {
        ...base,
        direction: 'input',
        activeLow: true,
      };
    case 'potentiometer':
      return {
        ...base,
        direction: 'analog',
        activeLow: false,
      };
    default:
      return null; // resistors, caps, VCC, GND don't produce declarations
  }
}

/**
 * Build the full project.stc declarations from the current circuit.
 * Scans all parts and their wire connections to MCU pins.
 *
 * @param {Array} parts — all placed parts
 * @param {Array} wires — all wires
 * @returns {{ pins: Array, ports: Array, parts: Array }}
 */
export function circuitToDeclarations(parts, wires) {
  const pins = [];
  const mcu = parts.find(p => p.kind === 'mcu');
  if (!mcu) return { pins, ports: [], parts: [] };

  // Find which MCU pin each declarable part is connected to
  for (const part of parts) {
    if (!part.declName) continue;

    // Find a wire from this part to an MCU terminal
    for (const wire of wires) {
      let mcuPin = null;
      if (wire.from.part === mcu.id && (wire.to.part === part.id)) {
        mcuPin = wire.from.terminal;
      } else if (wire.to.part === mcu.id && (wire.from.part === part.id)) {
        mcuPin = wire.to.terminal;
      }
      // Also check indirect connection (through resistor to MCU)
      if (!mcuPin) {
        // Look for chain: part → resistor → MCU or part → wire → MCU
        for (const w2 of wires) {
          if (w2 === wire) continue;
          const mid = wire.to.part === part.id ? wire.from.part : wire.to.part;
          if ((w2.from.part === mid && w2.to.part === mcu.id) ||
              (w2.to.part === mid && w2.from.part === mcu.id)) {
            mcuPin = w2.from.part === mcu.id ? w2.from.terminal : w2.to.terminal;
            break;
          }
        }
      }

      if (mcuPin) {
        const decl = partToDeclaration(part, mcuPin);
        if (decl) {
          pins.push(decl);
          break; // one declaration per part
        }
      }
    }
  }

  return { pins, ports: [], parts: [] };
}
