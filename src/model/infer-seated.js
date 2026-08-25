/**
 * Seated inference — the code prefills a REAL breadboard build.
 *
 * The MCU chip SEATS on the breadboard straddling the gutter (rows e/f),
 * each declared pin's part is seated in the same column strip so they
 * connect through the breadboard's internal conductors — no tap wires
 * from a floating chip. This is the Ben-Eater-photo look.
 *
 * Per declared pin (parts advance right of the MCU):
 *   OUTPUT ACTIVE LOW: rail + → resistor → LED → pin's column
 *     (the sink wiring this chip's 20 mA / 230 µA asymmetry forces)
 *   OUTPUT (active high): pin column → resistor → LED → rail −
 *   ANALOG: potentiometer seated, wiper column jumpered to pin column
 *   INPUT: button straddling the gutter, one side to the pin's column
 *
 * Pure builder over the Circuit API — every connection lands through the
 * same seat/tap/jumper paths a hand-built board uses.
 *
 * @module
 */

import { FOOTPRINTS, computeLeadMap, straddleRefRow } from './footprints.js';

/**
 * Build the seated circuit for a project's declarations into `circuit`.
 *
 * @param {import('./circuit.js').Circuit} circuit - an EMPTY circuit
 * @param {{device?: string, pins?: Array<object>}} stc
 * @returns {{notes: string[]}}
 */
export function buildSeatedFromDeclarations(circuit, stc, opts = {}) {
  const notes = [];
  const realism = opts.realism ?? 'bench';
  const pins = (stc.pins || []).slice(0, 8);
  if ((stc.pins || []).length > 8) {
    notes.push(`Showing the first 8 of ${stc.pins.length} declared pins — the board is full.`);
  }

  // Device-specific board support
  const device = String(stc.device || '').toLowerCase();
  const controllerKind = device === 'arduino-uno' ? 'arduino_uno'
    : device === 'arduino-nano' ? 'arduino_nano'
      : device === 'pico' ? 'pi_pico'
        : device === 'stm32f030' ? 'stm32f030' : 'mcu';
  const isBoard = controllerKind !== 'mcu';
  // A bare chip with fixed terminals (stm32f030) names pins like a board
  // (lowercase `where`) but powers like a chip (vcc/gnd pads, no rail).
  const isBareChip = controllerKind === 'stm32f030';
  const controllerPin = pin => isBoard
    ? String(pin.where || pin.pin || pin.name || '').toLowerCase()
    : `P${pin.port}.${pin.bit}`;
  const powerPin = controllerKind === 'pi_pico' ? 'vbus' : isBareChip ? 'vcc' : isBoard ? '5v' : 'VCC';
  const groundPin = isBareChip ? 'gnd' : isBoard ? 'gnd' : 'GND';

  // ── Place and seat the breadboard + controller ───────────────────
  const bb = circuit.addPart('breadboard', {}, 470, 330);
  const fp = FOOTPRINTS[controllerKind];
  const canSeat = fp && fp.straddlesGutter;

  const mcu = circuit.addPart(controllerKind,
    isBoard ? {} : { pins: pins.map(p => controllerPin(p)), device: stc.device || '' },
    canSeat ? 470 : 470, canSeat ? 330 : 40);

  // Seat the MCU on the breadboard if it has a straddling footprint —
  // at the row its physical span demands (DIP e, Nano b, Pico a).
  if (canSeat) {
    try {
      circuit.seatPart(mcu.id, bb.id, computeLeadMap(fp, `${straddleRefRow(fp)}1`));
    } catch {
      // Seating failed — fall back to floating position
      mcu.x = 470; mcu.y = 40;
    }
  }

  const seated = !!(mcu.seat);

  // ── Power: battery → rails → MCU ────────────────────────────────
  // The F030 is a 3.3 V part — a 5 V bench rail would exceed abs-max.
  const benchVolts = controllerKind === 'stm32f030' ? 3.3 : 5;
  const bat = circuit.addPart('vsource', { variant: '9v', volts: benchVolts }, 120, 150);
  circuit.addTapWire(bat.id, 'pos', bb.id, 't+2', '#e74c3c');
  circuit.addTapWire(bat.id, 'neg', bb.id, 't-2', '#2c3e50');

  if (seated) {
    // MCU power pins are in the breadboard strips — jumper from their
    // columns to the power rails.
    const leadMap = mcu.seat.leadMap;
    const vccHole = leadMap[powerPin];
    const gndHole = leadMap[groundPin];
    if (vccHole) {
      const vccCol = parseInt(vccHole.slice(1));
      const vccRow = vccHole[0];
      const freeRow = vccRow <= 'e' ? 'a' : 'g';
      const railPrefix = vccRow <= 'e' ? 't' : 'b';
      circuit.addHoleWire(bb.id, `${freeRow}${vccCol}`, `${railPrefix}+${vccCol}`, '#e74c3c');
    }
    if (gndHole) {
      const gndCol = parseInt(gndHole.slice(1));
      const gndRow = gndHole[0];
      const freeRow = gndRow <= 'e' ? 'a' : 'g';
      const railPrefix = gndRow <= 'e' ? 't' : 'b';
      circuit.addHoleWire(bb.id, `${freeRow}${gndCol}`, `${railPrefix}-${gndCol}`, '#2c3e50');
    }
    // Cross-rail jumpers so both halves have power.
    // Use columns away from the VCC/GND jumpers to avoid occupancy conflicts.
    try { circuit.addHoleWire(bb.id, 't+3', 'b+3', '#e74c3c'); } catch { /* occupied */ }
    try { circuit.addHoleWire(bb.id, 't-3', 'b-3', '#2c3e50'); } catch { /* occupied */ }
  } else {
    // Floating chip — tap wires from the chip to the rails
    circuit.addTapWire(mcu.id, powerPin, bb.id, 't+1', '#e74c3c');
    circuit.addTapWire(mcu.id, groundPin, bb.id, 't-1', '#2c3e50');
  }

  notes.push(seated
    ? `${stc.device || 'MCU'}: seated on the breadboard. Power from the rails through column jumpers.`
    : (isBoard
      ? `${stc.device}: ${powerPin.toUpperCase()} and GND feed the controller from the rails.`
      : 'VCC (pin 40) and GND (pin 20) feed the chip from the rails.'));

  // Decoupling caps: the bench realism every real build needs. Skipped
  // when the MCU is seated — the 40-column net expansion triggers the
  // cap-companion solver bug (documented in spec-updates/cap-companion-setpin.md).
  // The caps are a teaching aid, not electrically required.
  if (realism === 'bench' && !seated) {
    const c100n = circuit.addPart('capacitor', { farads: 100e-9 }, 250, 90);
    circuit.addTapWire(c100n.id, 'a', bb.id, 't+4', '#e74c3c');
    circuit.addTapWire(c100n.id, 'b', bb.id, 't-4', '#2c3e50');
    const c10u = circuit.addPart('capacitor', { farads: 10e-6 }, 120, 250);
    circuit.addTapWire(c10u.id, 'a', bb.id, 't+3', '#e74c3c');
    circuit.addTapWire(c10u.id, 'b', bb.id, 't-3', '#2c3e50');
    notes.push('100 nF beside the chip + 10 µF at the battery decouple the rails.');
  }

  // ── Per-pin wiring ───────────────────────────────────────────────
  // Parts go to the RIGHT of the MCU (col 22+), outside the DIP body.
  let col = seated ? 22 : 5;
  for (const pin of pins) {
    const pinName = controllerPin(pin);
    const dir = String(pin.direction || 'output').toLowerCase();
    const activeLow = !!pin.activeLow;

    // For a seated MCU, find which hole the pin occupies and run a
    // jumper from its column strip to the part's column.
    const pinHole = seated ? mcu.seat.leadMap[pinName] : null;
    const pinCol = pinHole ? parseInt(pinHole.slice(1)) : null;
    const pinRow = pinHole ? pinHole[0] : null;
    // Free row in the same strip block as the pin
    const pinFreeRow = pinRow && pinRow <= 'e' ? 'a' : 'g';

    if (dir === 'analog') {
      const pot = circuit.addPart('potentiometer', { ohms: 10000 }, 0, 0, pin.name);
      circuit.seatPart(pot.id, bb.id, computeLeadMap(FOOTPRINTS.potentiometer, `a${col}`));
      circuit.addHoleWire(bb.id, `b${col}`, `t+${col}`, '#e74c3c');
      circuit.addHoleWire(bb.id, `b${col + 4}`, `t-${col + 4}`, '#2c3e50');
      if (seated && pinHole) {
        // Jumper from pin's column to pot wiper column (use b-row, not a-row which has the pot lead)
        circuit.addHoleWire(bb.id, `${pinFreeRow}${pinCol}`, `b${col + 2}`, '#f1c40f');
      } else {
        circuit.addTapWire(mcu.id, pinName, bb.id, `b${col + 2}`, '#f1c40f');
      }
    } else if (dir === 'input') {
      const btn = circuit.addPart('button', {}, 0, 0, pin.name);
      circuit.seatPart(btn.id, bb.id, computeLeadMap(FOOTPRINTS.button, `e${col}`));
      if (seated && pinHole) {
        circuit.addHoleWire(bb.id, `${pinFreeRow}${pinCol}`, `d${col}`, '#f1c40f');
      } else {
        circuit.addTapWire(mcu.id, pinName, bb.id, `d${col}`, '#f1c40f');
      }
      circuit.addHoleWire(bb.id, `g${col}`, `b-${col}`, '#2c3e50');
      notes.push(`${pin.name}: the chip's internal pull-up holds the pin HIGH; pressing pulls it LOW.`);
    } else if (activeLow) {
      const r = circuit.addPart('resistor', { ohms: 1000 }, 0, 0);
      const led = circuit.addPart('led', { color: 'red' }, 0, 0, pin.name);
      circuit.seatPart(r.id, bb.id, computeLeadMap(FOOTPRINTS.resistor, `b${col}`));
      circuit.seatPart(led.id, bb.id, computeLeadMap(FOOTPRINTS.led, `c${col + 4}`));
      circuit.addHoleWire(bb.id, `a${col}`, `t+${col}`, '#e74c3c');
      if (seated && pinHole) {
        circuit.addHoleWire(bb.id, `${pinFreeRow}${pinCol}`, `a${col + 5}`, '#f1c40f');
      } else {
        circuit.addTapWire(mcu.id, pinName, bb.id, `a${col + 5}`, '#f1c40f');
      }
      notes.push(`${pin.name}: wired active-low — the pin SINKS current (20 mA) far better than it sources (~230 µA); writing 0 lights it.`);
    } else {
      const r = circuit.addPart('resistor', { ohms: 1000 }, 0, 0);
      const led = circuit.addPart('led', { color: 'red' }, 0, 0, pin.name);
      circuit.seatPart(r.id, bb.id, computeLeadMap(FOOTPRINTS.resistor, `b${col}`));
      circuit.seatPart(led.id, bb.id, computeLeadMap(FOOTPRINTS.led, `c${col + 4}`));
      if (seated && pinHole) {
        circuit.addHoleWire(bb.id, `${pinFreeRow}${pinCol}`, `a${col}`, '#f1c40f');
      } else {
        circuit.addTapWire(mcu.id, pinName, bb.id, `a${col}`, '#f1c40f');
      }
      circuit.addHoleWire(bb.id, `a${col + 5}`, `t-${col + 5}`, '#2c3e50');
      notes.push(`${pin.name}: wired active-high — a quasi pin sources only ~230 µA, so this LED will be DIM unless the pin is push-pull. That is the lesson.`);
    }
    col += 7;
  }

  return { notes };
}
