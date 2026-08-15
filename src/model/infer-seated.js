/**
 * Seated inference — the code prefills a REAL breadboard build.
 *
 * Boundary C gave us abstract parts from declared pins; this module goes the
 * rest of the way: the derived circuit arrives as a bench would be built.
 * The MCU chip sits above a breadboard, each declared pin's part is SEATED
 * in its own column pair, tap wires run from the chip's pins into the
 * strips, and the rails carry power. Open a project with
 * `PIN led1 IS P1.0 OUTPUT ACTIVE LOW` and you see the wiring a lab manual
 * would show — then the reverse warnings teach what the code and the board
 * disagree about.
 *
 * Per declared pin (columns advance left to right, 6 columns per part):
 *   OUTPUT ACTIVE LOW: rail + → resistor → LED → column ← tap from MCU pin
 *     (the sink wiring this chip's 20 mA / 230 µA asymmetry forces)
 *   OUTPUT (active high): tap from pin → resistor → LED → rail −
 *   ANALOG: potentiometer seated across three columns, wiper column tapped
 *     to the pin, outer legs jumpered to the rails
 *   INPUT: button straddling the gutter, top to the pin's column,
 *     bottom jumpered to rail − (the chip's quasi pull-up holds it high)
 *
 * Pure builder over the Circuit API — every connection lands through the
 * same seat/tap/jumper paths a hand-built board uses, so what inference
 * produces is exactly what a user could have built.
 *
 * @module
 */

import { FOOTPRINTS, computeLeadMap } from './footprints.js';

/**
 * Build the seated circuit for a project's declarations into `circuit`.
 *
 * @param {import('./circuit.js').Circuit} circuit - an EMPTY circuit
 * @param {{device?: string, pins?: Array<object>}} stc
 * @returns {{notes: string[]}}
 */
export function buildSeatedFromDeclarations(circuit, stc, opts = {}) {
  const notes = [];
  // 'bench' realism (default): the rails carry the decoupling every real
  // build needs — 100 nF close to the chip, 10 µF bulk at the battery.
  // Cheap to show, real in the engine, and the habit worth teaching.
  // No crystal by default: the STC12 genuinely runs from its internal RC
  // (11–17 MHz at 5 V); fitting one is a choice, not a requirement.
  const realism = opts.realism ?? 'bench';
  const pins = (stc.pins || []).slice(0, 8); // a full board: cap honestly
  if ((stc.pins || []).length > 8) {
    notes.push(`Showing the first 8 of ${stc.pins.length} declared pins — the board is full.`);
  }

  // Device-specific board support: Arduino/Pico use their real board part
  // and header pin names; everything else gets a generic MCU DIP.
  const device = String(stc.device || '').toLowerCase();
  const controllerKind = device === 'arduino-uno' ? 'arduino_uno'
    : device === 'arduino-nano' ? 'arduino_nano'
      : device === 'pico' ? 'pi_pico' : 'mcu';
  const isBoard = controllerKind !== 'mcu';
  const controllerPin = pin => isBoard
    ? String(pin.where || pin.pin || pin.name || '').toLowerCase()
    : `P${pin.port}.${pin.bit}`;
  const powerPin = controllerKind === 'pi_pico' ? 'vbus' : isBoard ? '5v' : 'VCC';
  const groundPin = isBoard ? 'gnd' : 'GND';

  const bb = circuit.addPart('breadboard', {}, 470, 330);
  const mcu = circuit.addPart(controllerKind,
    isBoard ? {} : { pins: pins.map(p => controllerPin(p)) }, 470, 40);
  // A real battery feeding the rails — the bench has power OBJECTS, never
  // abstract supply symbols (those belong to the schematic projection).
  const bat = circuit.addPart('vsource', { variant: '9v', volts: 5 }, 120, 150);
  circuit.addTapWire(bat.id, 'pos', bb.id, 't+2', '#e74c3c');
  circuit.addTapWire(bat.id, 'neg', bb.id, 't-2', '#2c3e50');
  // The controller is powered from the rails.
  circuit.addTapWire(mcu.id, powerPin, bb.id, 't+1', '#e74c3c');
  circuit.addTapWire(mcu.id, groundPin, bb.id, 't-1', '#2c3e50');
  notes.push(isBoard
    ? `${stc.device}: ${powerPin.toUpperCase()} and GND feed the controller from the rails.`
    : 'VCC (pin 40) and GND (pin 20) feed the chip from the rails.');
  if (realism === 'bench') {
    const c100n = circuit.addPart('capacitor', { farads: 100e-9 }, 250, 90);
    circuit.addTapWire(c100n.id, 'a', bb.id, 't+4', '#e74c3c');
    circuit.addTapWire(c100n.id, 'b', bb.id, 't-4', '#2c3e50');
    const c10u = circuit.addPart('capacitor', { farads: 10e-6 }, 120, 250);
    circuit.addTapWire(c10u.id, 'a', bb.id, 't+3', '#e74c3c');
    circuit.addTapWire(c10u.id, 'b', bb.id, 't-3', '#2c3e50');
    notes.push('100 nF beside the chip + 10 µF at the battery decouple the rails — every real bench has them.');
  }

  let col = 5;
  for (const pin of pins) {
    const pinName = controllerPin(pin);
    const dir = String(pin.direction || 'output').toLowerCase();
    const activeLow = !!pin.activeLow;

    if (dir === 'analog') {
      // Pot across cols col..col+4 (a-row), wiper at col+2.
      const pot = circuit.addPart('potentiometer', { ohms: 10000 }, 0, 0, pin.name);
      circuit.seatPart(pot.id, bb.id, computeLeadMap(FOOTPRINTS.potentiometer, `a${col}`));
      circuit.addHoleWire(bb.id, `b${col}`, `t+${col}`, '#e74c3c');
      circuit.addHoleWire(bb.id, `b${col + 4}`, `t-${col + 4}`, '#2c3e50');
      circuit.addTapWire(mcu.id, pinName, bb.id, `b${col + 2}`, '#f1c40f');
    } else if (dir === 'input') {
      // Button straddles the gutter at col; top block to the pin, bottom to −.
      const btn = circuit.addPart('button', {}, 0, 0, pin.name);
      circuit.seatPart(btn.id, bb.id, computeLeadMap(FOOTPRINTS.button, `e${col}`));
      circuit.addTapWire(mcu.id, pinName, bb.id, `d${col}`, '#f1c40f');
      circuit.addHoleWire(bb.id, `g${col}`, `b-${col}`, '#2c3e50');
      circuit.addHoleWire(bb.id, `b-2`, `t-3`, '#2c3e50');
      notes.push(`${pin.name}: the chip's internal pull-up holds the pin HIGH; pressing pulls it LOW.`);
    } else if (activeLow) {
      // Sink wiring: + rail → R → LED anode…cathode(col+5) ← tap from pin.
      const r = circuit.addPart('resistor', { ohms: 1000 }, 0, 0);
      const led = circuit.addPart('led', { color: 'red' }, 0, 0, pin.name);
      circuit.seatPart(r.id, bb.id, computeLeadMap(FOOTPRINTS.resistor, `b${col}`));
      circuit.seatPart(led.id, bb.id, computeLeadMap(FOOTPRINTS.led, `c${col + 4}`));
      circuit.addHoleWire(bb.id, `a${col}`, `t+${col}`, '#e74c3c');
      circuit.addTapWire(mcu.id, pinName, bb.id, `a${col + 5}`, '#f1c40f');
      notes.push(`${pin.name}: wired active-low — the pin SINKS current (20 mA) far better than it sources (~230 µA); writing 0 lights it.`);
    } else {
      // Source wiring: tap from pin → R → LED → − rail.
      const r = circuit.addPart('resistor', { ohms: 1000 }, 0, 0);
      const led = circuit.addPart('led', { color: 'red' }, 0, 0, pin.name);
      circuit.seatPart(r.id, bb.id, computeLeadMap(FOOTPRINTS.resistor, `b${col}`));
      circuit.seatPart(led.id, bb.id, computeLeadMap(FOOTPRINTS.led, `c${col + 4}`));
      circuit.addTapWire(mcu.id, pinName, bb.id, `a${col}`, '#f1c40f');
      circuit.addHoleWire(bb.id, `a${col + 5}`, `t-${col + 5}`, '#2c3e50');
      notes.push(`${pin.name}: wired active-high — a quasi pin sources only ~230 µA, so this LED will be DIM unless the pin is push-pull. That is the lesson.`);
    }
    col += 7;
  }

  return { notes };
}
