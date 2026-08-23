/**
 * Declaration generator — converts circuit parts into project.stc declarations.
 *
 * Three constraints that cannot come from the part kind alone:
 * 1. POLARITY comes from the WIRING (LED to VCC → active-low, LED to GND → active-high)
 * 2. TONE is singular (one Timer 1 per program)
 * 3. ANALOG is P1.x only, PWM is P1.3/P1.4 only
 *
 * Wire endpoints are read ONLY through wire-endpoints.js. This module is
 * exported from src/index.js, so a host may hand it wires straight out of a
 * circuit.json — where the flat dialect is common — as well as the nested
 * ones Circuit.fromJSON produces. Reading `w.from.part` raw silently sees
 * `undefined` on a flat wire, and a polarity derived from no wires at all
 * comes back "active-high" for an active-low LED.
 */
import { wireEndpoint } from './wire-endpoints.js';

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
      const wf = wireEndpoint(w, 'from');
      const wt = wireEndpoint(w, 'to');
      let next = null;
      if (wf && wf.part === fromPart && wf.terminal === fromTerminal) {
        next = wt;
      } else if (wt && wt.part === fromPart && wt.terminal === fromTerminal) {
        next = wf;
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
      const wf = wireEndpoint(w, 'from');
      const wt = wireEndpoint(w, 'to');
      let next = null;
      if (wf && wf.part === fromPart && wf.terminal === fromTerminal) next = wt;
      else if (wt && wt.part === fromPart && wt.terminal === fromTerminal) next = wf;
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
  const { parts, wires, nets, toneAlreadyClaimed } = context || {};
  // Polarity questions go to the net graph when we have one (seated
  // benches have no part-to-part wires for the wire walkers to follow).
  const reaches = (partId, terminal, target) =>
    nets ? reachesViaNets(partId, terminal, target, nets) : null;

  switch (part.kind) {
    case 'led': {
      // Polarity from wiring, not a default
      let activeLow;
      const viaVcc = reaches(part.id, 'anode', 'vcc');
      const viaGnd = reaches(part.id, 'cathode', 'gnd');
      if (viaVcc) activeLow = true;
      else if (viaGnd) activeLow = false;
      else activeLow = (parts && wires)
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
      let activeLow;
      const toGnd = reaches(part.id, 'a', 'gnd') || reaches(part.id, 'b', 'gnd');
      const toVcc = reaches(part.id, 'a', 'vcc') || reaches(part.id, 'b', 'vcc');
      if (toGnd) activeLow = true;
      else if (toVcc) activeLow = false;
      else activeLow = (parts && wires)
        ? deriveButtonActiveLow(part.id, parts, wires)
        : true;
      return { ...base, direction: 'input', activeLow };
    }

    case 'potentiometer': {
      // ANALOG capability is per-device: P1.x on the STC parts, the An
      // header on Arduinos, GP26-28 on the Pico (the only ADC-capable GPs).
      if (where) {
        const analog = /^A\d+$/.test(where) || /^GP2[678]$/.test(where);
        return { ...base, direction: analog ? 'analog' : 'input', activeLow: false };
      }
      if (port !== 1) return { ...base, direction: 'input', activeLow: false };
      return { ...base, direction: 'analog', activeLow: false };
    }

    default:
      return null;
  }
}

// ── Net-aware derivation ─────────────────────────────────────────────
//
// Explicit part-to-part wires are only ONE way a circuit connects: a
// SEATED bench connects through breadboard rows and hole jumpers, which
// the wire walkers above cannot see. Every seated Arduino bench therefore
// derived ZERO pins, and the host's declaration merge wiped the program's
// pins with that empty list ("Debugger inactive — no program pins",
// owner report 2026-08-17). These helpers walk the circuit's RESOLVED
// nets (Circuit#resolvedNets — rows, jumpers and wires already unioned)
// and are used as the fallback whenever the wire walk comes up empty.

/** GPIO terminals only: P1.0-style (STC), Dn/An (Arduino), GPn (Pico).
 *  Power, reset, crystal and debug terminals must never become a PIN —
 *  a button leg sharing the ground rail with the MCU's gnd2 terminal is
 *  a supply connection, not a declaration. */
const GPIO_TERMINAL = /^(p\d+\.\d+|d\d+|a\d+|gp\d+)$/i;

function indexNets(nets, parts) {
  const byTerm = new Map();   // "part:terminal" → net
  const byPart = new Map();   // partId → [net, ...]
  for (const n of nets || []) {
    for (const t of n.terminals) {
      byTerm.set(`${t.part}:${t.terminal}`, n);
      if (!byPart.has(t.part)) byPart.set(t.part, []);
      if (!byPart.get(t.part).includes(n)) byPart.get(t.part).push(n);
    }
  }
  const partById = new Map((parts || []).map(p => [p.id, p]));
  return { byTerm, byPart, partById };
}

/** The MCU GPIO terminal this part reaches — directly on a shared net,
 *  or across exactly one resistor (the series-R idiom). */
function mcuPinViaNets(part, mcu, idx) {
  const gpioOn = net => {
    const t = net.terminals.find(t => t.part === mcu.id && GPIO_TERMINAL.test(t.terminal));
    return t && t.terminal;
  };
  const nets = idx.byPart.get(part.id) || [];
  for (const net of nets) {
    const direct = gpioOn(net);
    if (direct) return direct;
  }
  for (const net of nets) {
    for (const t of net.terminals) {
      const p = idx.partById.get(t.part);
      if (!p || p.kind !== 'resistor') continue;
      const other = t.terminal === 'a' ? 'b' : 'a';
      const net2 = idx.byTerm.get(`${p.id}:${other}`);
      const viaR = net2 && gpioOn(net2);
      if (viaR) return viaR;
    }
  }
  return null;
}

/** Net-graph reachability, resistors transparent — the polarity question
 *  ("does the anode side reach VCC?") asked of rows instead of wires. */
function reachesViaNets(partId, terminal, targetKind, idx) {
  const seen = new Set();
  const queue = [[partId, terminal]];
  while (queue.length) {
    const [pid, term] = queue.shift();
    const key = `${pid}:${term}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const net = idx.byTerm.get(key);
    if (!net) continue;
    for (const t of net.terminals) {
      const p = idx.partById.get(t.part);
      if (!p) continue;
      if (p.kind === targetKind) return true;
      if (p.kind === 'resistor') {
        queue.push([p.id, t.terminal === 'a' ? 'b' : 'a']);
      }
    }
  }
  return false;
}

/**
 * Build project.stc declarations from the circuit.
 */
const BOARD_TO_DEVICE = {
  arduino_uno: 'arduino-uno', arduino_nano: 'arduino-nano',
  arduino_mega: 'arduino-mega', pi_pico: 'pico',
};
const MCU_KINDS = new Set(['mcu', ...Object.keys(BOARD_TO_DEVICE)]);

export function circuitToDeclarations(parts, wires, nets = null) {
  const pins = [];
  const mcu = parts.find(p => MCU_KINDS.has(p.kind));
  if (!mcu) return { pins, ports: [], parts: [] };
  const device = BOARD_TO_DEVICE[mcu.kind] || undefined;
  const isBoard = !!device;

  const idx = nets ? indexNets(nets, parts) : null;
  let toneAlreadyClaimed = false;
  const context = { parts, wires, nets: idx, toneAlreadyClaimed: false };

  for (const part of parts) {
    if (!part.declName) continue;

    // Find the MCU pin this part connects to (directly or through a resistor)
    let mcuPin = null;
    for (const wire of wires) {
      const f = wireEndpoint(wire, 'from');
      const t = wireEndpoint(wire, 'to');
      if (!f || !t) continue;
      // Direct connection
      if (f.part === mcu.id && t.part === part.id) mcuPin = f.terminal;
      else if (t.part === mcu.id && f.part === part.id) mcuPin = t.terminal;
      if (mcuPin) break;

      // Through a resistor
      const mid = f.part === part.id ? t.part
        : t.part === part.id ? f.part : null;
      if (!mid) continue;
      for (const w2 of wires) {
        if (w2 === wire) continue;
        const f2 = wireEndpoint(w2, 'from');
        const t2 = wireEndpoint(w2, 'to');
        if (!f2 || !t2) continue;
        if (f2.part === mid && t2.part === mcu.id) { mcuPin = t2.terminal; break; }
        if (t2.part === mid && f2.part === mcu.id) { mcuPin = f2.terminal; break; }
      }
      if (mcuPin) break;
    }

    // Seated benches connect through rows, not wires — fall back to nets.
    if (!mcuPin && idx) mcuPin = mcuPinViaNets(part, mcu, idx);

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
