/**
 * A kind alias must not outrank a registered engine model.
 *
 * THE DEFECT
 * ----------
 * `KIND_ALIASES` mapped `74hc595` to `shift_register`. That was correct when
 * it was written: the engine had one shift register, board.js's built-in, and
 * a saved file naming the chip by its part number had to reach it somehow.
 *
 * bw-board later registered a REAL 74HC595 (src/devices/tier3-parts.js). The
 * two are not interchangeable, and that file's own header says why:
 *
 *   - the built-in `shift_register` speaks an ABSTRACT twelve-terminal
 *     namespace (data / clock / latch / oe / q0..q7);
 *   - the registered `74hc595` speaks the DIP-16 package namespace as well
 *     (ser / srclk / rclk / srclr / qa..qh / qh_s) AND both q-spellings;
 *   - and the decisive one: **the built-in has no vcc and no gnd at all.**
 *
 * The alias fired first, so every 74hc595 in the corpus was rewritten to the
 * power-less kind at `fromJSON`. Nine seated variants of 08-led-chaser-595
 * put the chip's vcc and gnd in real breadboard holes — eighteen power
 * connections to terminals the collapsed part does not declare.
 * `TERMINAL_ALIASES` cannot rescue them either: there is nothing on the target
 * to map them TO.
 *
 * WHAT THE HARM IS, measured rather than assumed — because the obvious story
 * is wrong. The wires are NOT dropped: they survive in `wires`, and their
 * endpoints even reach nets, because the netlist keys an endpoint by the name
 * the wire carries rather than by the part's declaration. Solved net counts
 * and LED brightness across all 42 corpus files that name either kind are
 * IDENTICAL either side of this change. What is lost is the PART's
 * declaration, and with it every consumer that walks `part.terminals` — the
 * pin chooser, the schematic's pin stubs, the BOM — and, the one that bites
 * electrically, the device model's own `read('vcc')`. board.js takes the
 * built-in's VIH/VIL from `this.vcc`, the BOARD's global rail, so a 595
 * powered from anything other than that rail was answering with a threshold
 * belonging to a different circuit.
 *
 * THE FIX, and its shape
 * ----------------------
 * `resolveKind` now asks the engine first, for kinds in `ENGINE_MODEL_WINS` —
 * the same discrimination `engineKindFor` already makes for passthrough kinds,
 * for the same reason. The alias is NOT removed: a file loaded against an
 * engine that still lacks the model must keep collapsing exactly as before,
 * which is what an alias map is for. That backwards case is asserted below,
 * and it doubles as the mutation proof — it is the defect, reproduced on
 * demand, so the fix cannot be quietly reverted without this file going red.
 */
import './_setup.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { setEngine, getEngine } from '../src/engine.js';
import { Circuit } from '../src/model/circuit.js';
import {
  KIND_ALIASES, ENGINE_MODEL_WINS, resolveKind,
} from '../src/model/terminal-aliases.js';

const prev = getEngine();
/** The engine as an older host injected it: the three required keys only. */
const withoutModels = () => setEngine({
  BoardImpl: prev.BoardImpl, inferNetlist: prev.inferNetlist, checkWiring: prev.checkWiring,
});

/** A minimal saved bench: a 74hc595 with its power pins wired to the rails. */
const savedBench = () => ({
  vcc: 5.0,
  parts: [
    { id: 'v1', kind: 'vsource', params: { volts: 5 }, x: 0, y: 0 },
    { id: 'sr1', kind: '74hc595', params: {}, x: 100, y: 0 },
    { id: 'led1', kind: 'led', params: {}, x: 200, y: 0 },
  ],
  wires: [
    { id: 'w1', from: { part: 'v1', terminal: 'pos' }, to: { part: 'sr1', terminal: 'vcc' } },
    { id: 'w2', from: { part: 'sr1', terminal: 'gnd' }, to: { part: 'v1', terminal: 'neg' } },
    { id: 'w3', from: { part: 'sr1', terminal: 'qa' }, to: { part: 'led1', terminal: 'anode' } },
  ],
});

const terminalsOf = (circuit, id) => circuit.parts.find((p) => p.id === id).terminals;
const wireIds = (circuit) => circuit.wires.map((w) => w.id).sort();

describe('resolveKind asks the engine before applying an alias', () => {
  test('the alias itself is still on file — it is consulted, not deleted', () => {
    assert.equal(KIND_ALIASES['74hc595'], 'shift_register',
      'removing the alias would strand every file loaded against an engine ' +
      'that has no 74hc595 model. The fix is to ask first, not to forget.');
    assert.ok(ENGINE_MODEL_WINS.has('74hc595'));
  });

  test('with no predicate, resolveKind behaves exactly as it always did', () => {
    // Every existing caller passes one argument. None of them changes.
    assert.equal(resolveKind('74hc595'), 'shift_register');
    assert.equal(resolveKind('battery'), 'vsource');
    assert.equal(resolveKind('resistor'), 'resistor');
  });

  test('the predicate only speaks for kinds in ENGINE_MODEL_WINS', () => {
    const always = () => true;
    assert.equal(resolveKind('74hc595', always), '74hc595');
    // `battery` is not in the set, so a yes-saying engine does not unalias it.
    assert.equal(resolveKind('battery', always), 'vsource');
    assert.equal(resolveKind('74hc595', () => false), 'shift_register');
  });

  test('a predicate that throws falls through to the alias', () => {
    assert.equal(resolveKind('74hc595', () => { throw new Error('no engine'); }),
      'shift_register');
  });
});

describe('74hc595 keeps its identity, and therefore its power pins', () => {
  test('the engine really does have the model this rests on', () => {
    const eng = getEngine();
    assert.equal(typeof eng.getDevice, 'function');
    const model = eng.getDevice('74hc595');
    assert.ok(model, 'bw-board has no registered 74hc595 — the premise is gone');
    assert.ok(model.terminals.includes('vcc'), '74hc595 model must declare vcc');
    assert.ok(model.terminals.includes('gnd'), '74hc595 model must declare gnd');
    // And the kind it was aliased to genuinely lacks them, which is the point.
    const builtin = eng.getDevice('shift_register');
    assert.ok(!builtin || !(builtin.terminals || []).includes('vcc'),
      'shift_register has grown a vcc — re-read this file, the reasoning has moved');
  });

  test('a saved 74hc595 loads as a 74hc595', () => {
    const c = Circuit.fromJSON(savedBench());
    assert.equal(c.parts.find((p) => p.id === 'sr1').kind, '74hc595');
  });

  test('its resolved terminals include vcc and gnd', () => {
    const c = Circuit.fromJSON(savedBench());
    const terms = terminalsOf(c, 'sr1');
    assert.ok(terms.includes('vcc'), `vcc missing from ${JSON.stringify(terms)}`);
    assert.ok(terms.includes('gnd'), `gnd missing from ${JSON.stringify(terms)}`);
    // The package namespace the datasheet and the sidecar use.
    assert.ok(terms.includes('ser'));
    assert.ok(terms.includes('srclk'));
  });

  test('every wire survives the load, and the power ones reach real nets', () => {
    const c = Circuit.fromJSON(savedBench());
    assert.deepEqual(wireIds(c), ['w1', 'w2', 'w3']);
    const nets = c.board.getNets ? c.board.getNets() : c.board.nets;
    const on = new Set();
    for (const n of nets) for (const t of n.terminals || []) on.add(`${t.part}.${t.terminal}`);
    assert.ok(on.has('sr1.vcc'), 'sr1.vcc is on no net');
    assert.ok(on.has('sr1.gnd'), 'sr1.gnd is on no net');
  });

  test('WHAT THE FIX BUYS: the chip can read its own supply', () => {
    // This is the substantive difference, and it is a property of the two
    // MODELS rather than of this circuit. The registered 74hc595 derives its
    // logic thresholds from `read('vcc')` — the voltage on its own supply pin.
    // The built-in `shift_register` has no vcc terminal to read, so board.js
    // takes VIH/VIL from `this.vcc`, the BOARD's global rail. On a bench where
    // the chip's supply is not the board rail — a dropping diode, a sagging
    // node, a 3V3 domain beside a 5V one — the collapsed part answers with a
    // threshold belonging to a different circuit.
    const eng = getEngine();
    const real = eng.getDevice('74hc595');
    assert.ok(real.terminals.includes('vcc'),
      'the registered model must declare vcc, or it cannot read its own supply');
    const builtin = eng.getDevice('shift_register');
    assert.ok(!builtin || !(builtin.terminals || []).includes('vcc'),
      'the built-in has grown a vcc — this whole comparison needs re-reading');
    // And the corpus spellings both resolve on the real model, which is why
    // de-aliasing does not strand the abstract benches: 20-shift-register-binary
    // wires data/clock/latch/q0..q7, 08-led-chaser-595 wires ser/srclk/rclk and
    // the UPPERCASE Q0..Q7. The model accepts all three namespaces.
    for (const t of ['data', 'clock', 'latch', 'ser', 'srclk', 'rclk',
      'q0', 'q7', 'Q0', 'Q7', 'qa', 'qh', 'srclr', 'qh_s', 'oe']) {
      assert.ok(real.terminals.includes(t), `74hc595 model lacks ${t}`);
    }
  });
});

describe('MUTATION: the old engine still gets the old behaviour', () => {
  test('without getDevice, 74hc595 collapses to shift_register as before', () => {
    withoutModels();
    try {
      const c = Circuit.fromJSON(savedBench());
      assert.equal(c.parts.find((p) => p.id === 'sr1').kind, 'shift_register',
        'an engine with no model must still get the alias — otherwise a file ' +
        'loaded against an older build reaches a kind that build cannot solve');
    } finally { setEngine(prev); }
  });

  test('and THAT is where the power pins are lost — the defect, on demand', () => {
    withoutModels();
    try {
      const c = Circuit.fromJSON(savedBench());
      const terms = terminalsOf(c, 'sr1');
      assert.ok(!terms.includes('vcc'),
        'the collapsed kind has grown a vcc; this mutation no longer reproduces ' +
        'the defect and the test above is no longer proving anything');
      assert.ok(!terms.includes('gnd'));
      assert.equal(terms.length, 12, 'the abstract twelve-terminal namespace');
      // MEASURED, so the claim in this file stays honest: the WIRE is not
      // dropped — it survives in `wires` and its endpoint even reaches a net,
      // because the netlist keys endpoints by the name the wire carries. What
      // is lost is the PART's declaration, and with it every consumer that
      // walks `part.terminals`: the pin chooser, the schematic's pin stubs,
      // the BOM, and the device model's own `read('vcc')`.
      assert.deepEqual(wireIds(c), ['w1', 'w2', 'w3'],
        'if the collapse now drops wires outright, the harm is larger than ' +
        'this file describes and the prose above must be corrected');
    } finally { setEngine(prev); }
  });

  test('the engine is restored for every other test file', () => {
    assert.equal(typeof getEngine().getDevice, 'function');
  });
});
