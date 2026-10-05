/**
 * Simulation driver — connects the UI to a real BoardImpl from bw-board.
 *
 * Every value returned by this module comes from the engine.
 * Nothing is fabricated.
 */

import { wireEndpoint } from './wire-endpoints.js';
import { getEngine } from '../engine.js';

/**
 * Create a board, load a netlist, and return the board instance.
 *
 * @param {Array} parts
 * @param {Array} nets
 * @param {number} [vcc=5.0]
 * @returns {BoardImpl}
 */
export function createBoard(parts, nets, vcc = 5.0) {
  const { BoardImpl } = getEngine();
  const board = new BoardImpl(vcc);
  board.setNetlist(parts, nets);
  return board;
}

/**
 * Snapshot the board's instrument readings for the current time.
 * Every value comes from the engine — nothing is invented.
 *
 * @param {BoardImpl} board
 * @param {string} label — description of the current state
 * @param {number} tMs — timestamp in milliseconds
 * @returns {{ label, tMs, readings }}
 */
export function snapshot(board, label, tMs) {
  const readings = {};

  // LED brightness for each LED part
  for (const part of board.parts) {
    if (part.kind === 'led') {
      readings[`brightness(${part.id})`] = board.ledBrightness(part.id);
    }
    if (part.kind === 'buzzer') {
      readings[`buzzerTone(${part.id})`] = board.buzzerTone(part.id);
    }
  }

  // Node voltages for all nets
  for (const net of board.nets) {
    readings[`V(${net.id})`] = board.nodeVoltage(net.id);
  }

  return { label, tMs, readings };
}

/**
 * Run the active-low LED demo trace.
 *
 * Same scenario as bw-board's led-active-low test:
 * quasi-bidir pin driving low → LED bright, driving high → LED dark.
 *
 * @param {BoardImpl} board
 * @returns {Array<{label: string, tMs: number, readings: object}>}
 */
export function runDemoTrace(board) {
  const MS = 1_000_000n;
  const snapshots = [];

  // State 1: pin high (quasi) → LED off (both sides at VCC)
  board.setPin('P1.0', 'quasi', true);
  board.advanceTo(25n * MS);
  snapshots.push(snapshot(board, 'P1.0 quasi HIGH → LED off', 25));

  // State 2: pin low (quasi) → LED on (strong sink, ~2.9 mA)
  board.setPin('P1.0', 'quasi', false);
  board.advanceTo(50n * MS);
  snapshots.push(snapshot(board, 'P1.0 quasi LOW → LED on (~0.14)', 50));

  // State 3: pin high again → LED off
  board.setPin('P1.0', 'quasi', true);
  board.advanceTo(75n * MS);
  snapshots.push(snapshot(board, 'P1.0 quasi HIGH → LED off', 75));

  // State 4: push-pull low → LED on (same as quasi sink)
  board.setPin('P1.0', 'pushpull', false);
  board.advanceTo(100n * MS);
  snapshots.push(snapshot(board, 'P1.0 push-pull LOW → LED on', 100));

  return snapshots;
}

/**
 * Does the built-in demo pin script apply to this project?
 *
 * The designer plays a placeholder animation while a circuit has no program
 * driving it: it blinks every pin it classified as an output, all of them from
 * ONE shared on/off value. For a bench with no program that is a friendly sign
 * of life. For a project that HAS a program it is fiction — and fiction that
 * looks convincing, because on a single-LED circuit it is indistinguishable
 * from the program working.
 *
 * Consumed by brickwright, where it was caught: a two-LED example whose program
 * alternates the pins rendered with both LEDs lighting TOGETHER. The program was
 * running and its pin writes were correct; they simply were not arriving at this
 * board, so the placeholder kept playing over the top of a real program. The
 * placeholder standing down is half the fix, and it is the half that belongs
 * here — a project that declares pins has an author for them, and it is not this
 * module.
 *
 * A predicate rather than an inline condition so it can be tested: the decision
 * otherwise lives inside a React effect, where the only way to reach it is to
 * render the whole designer.
 *
 * @param {object} opts
 * @param {boolean} opts.hasMcu — the demo script only ever drove MCU pins
 * @param {object} [opts.stc] — the project's declarations, if it has any
 * @returns {boolean} true when the placeholder should play
 */
export function demoPinScriptApplies({ hasMcu, stc }) {
  if (!hasMcu) return false;
  const declared = stc && Array.isArray(stc.pins) ? stc.pins.length : 0;
  return declared === 0;
}

/** The MCU-surface part kinds whose pins the designer arms at the start of a run. */
export const RUN_MCU_KINDS = ['mcu', 'arduino_uno', 'arduino_nano', 'arduino_mega', 'pi_pico', 'pybadge'];

/**
 * Begin a run on the designer's OWN board (no external, emulator-driven one):
 * clear its stale state (capacitor voltages, LED history) and arm every pin of
 * the circuit's MCU part so no net floats before the program's first write —
 * outputs and inputs quasi-high (the 8051 idle level), analog inputs high-Z.
 *
 * A function, not effect code, because WHEN it runs is the whole contract: it
 * is the CLEAR of a seed-then-clear pair, and the program's writes are the
 * seed. It used to run in the designer's [mode] effect after the green flag's
 * `bw-green-flag` arrived on a setTimeout(0) — unordered with the Scratch VM's
 * first step, so a program's first write was wiped whenever the VM stepped
 * first (measured in a real browser on production, brickwright-lite task B7:
 * `turn on led` at 68.7 ms, the reset at 174 ms, the LED dark for the whole
 * of the program's 2 s wait). The designer now calls it synchronously from
 * the green-flag event, which the host dispatches BEFORE it starts the VM.
 *
 * @param {object} opts
 * @param {{reset?: Function}} opts.board — the designer's board
 * @param {Array} opts.parts
 * @param {Array} opts.wires
 * @param {(pin: string, mode: string, high: boolean) => void} opts.setPin
 * @returns {{mcu: object|null, outputPins: string[], inputPins: string[], analogPins: string[]}}
 */
export function armBoardForRun({ board, parts, wires, setPin }) {
  if (board && typeof board.reset === 'function') board.reset();
  const mcu = (parts || []).find(p => RUN_MCU_KINDS.includes(p.kind)) || null;
  const outputPins = [];
  const inputPins = [];
  const analogPins = [];
  if (mcu) {
    for (const pin of mcu.terminals || []) {
      const connectedKinds = new Set();
      for (const w of wires || []) {
        const f = wireEndpoint(w, 'from');
        const t = wireEndpoint(w, 'to');
        if (!f || !t) continue;
        let otherPart = null;
        if (f.part === mcu.id && f.terminal === pin) otherPart = t.part;
        else if (t.part === mcu.id && t.terminal === pin) otherPart = f.part;
        if (otherPart) {
          const p = parts.find(pp => pp.id === otherPart);
          if (p) connectedKinds.add(p.kind);
        }
      }
      if (connectedKinds.has('led') || connectedKinds.has('buzzer') || connectedKinds.has('resistor')) {
        outputPins.push(pin);
      } else if (connectedKinds.has('button')) {
        inputPins.push(pin);
      } else if (connectedKinds.has('potentiometer')) {
        analogPins.push(pin);
      } else {
        outputPins.push(pin); // default: treat as output
      }
    }
    for (const pin of outputPins) setPin(pin, 'quasi', true);
    for (const pin of inputPins) setPin(pin, 'quasi', true);
    for (const pin of analogPins) setPin(pin, 'input', false);
  }
  return { mcu, outputPins, inputPins, analogPins };
}
