/**
 * The computer ladder is proven the same way the logic ladder is — by
 * running it — but it needs a different kind of assertion.
 *
 * l0..l9 are combinational: set the inputs, read the answer. c0..c5 have
 * STATE, so what has to be checked is a SEQUENCE. A register that always
 * reads 5 passes any single-value check and is still broken; the useful
 * questions are "did it change when it was clocked" and, just as
 * importantly, "did it stay put when it was not".
 *
 * Two facts about the real chips are asserted here rather than smoothed
 * over, because a learner will meet both on a bench:
 *   - the 74LS189's outputs are INVERTED (store 5, read 10), and
 *   - the 74LS161's clear and load are ACTIVE LOW.
 */

import './_setup.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Circuit } from '../src/model/circuit.js';

const GALLERY = join(import.meta.dirname, '..', 'gallery');
const SETTLE_NS = 25_000_000n;

function bench(name) {
  const circuit = Circuit.fromJSON(JSON.parse(readFileSync(join(GALLERY, `${name}.json`), 'utf8')));
  const { board } = circuit;
  let now = 0n;
  const settle = () => { now += SETTLE_NS; board.advanceTo(now); now += SETTLE_NS; board.advanceTo(now); };
  return {
    circuit, board, settle,
    set(p, mask) { board.setPartParam(p, 'switches', mask); },
    lit(id) { return board.ledBrightness(id) > 0.05; },
    /** One clock: a rising edge on position 1 of the control switch, then low. */
    tick(sw = 'swc', otherBits = 0) {
      this.set(sw, otherBits | 1); settle();
      this.set(sw, otherBits); settle();
    },
    nibble(prefix) {
      return [0, 1, 2, 3].reduce((a, i) => a + (this.lit(`${prefix}${i}`) ? 1 << i : 0), 0);
    },
  };
}

describe('the computer ladder — state, and a clock that moves it', () => {
  const files = readdirSync(GALLERY).filter((f) => /^c\d+-.*\.json$/.test(f));

  it('is present: ten rungs, c0 through c9', () => {
    assert.equal(files.length, 10, `found ${files.join(', ')}`);
  });

  it('contains no CPU — the point is building one, not using one', () => {
    const FORBIDDEN = new Set(['mcu', 'w65c02', 'z80', 'eater6502', 'r6507', 'pi_pico',
      'arduino_uno', 'arduino_nano', 'attiny88', 'attiny85', '28c256', '62256']);
    for (const f of files) {
      const kinds = JSON.parse(readFileSync(join(GALLERY, f), 'utf8')).parts.map((p) => p.kind);
      assert.deepEqual(kinds.filter((k) => FORBIDDEN.has(k)), [], `${f} smuggles a processor`);
    }
  });
});

describe('C0 — the clock', () => {
  it('oscillates: the output is not stuck at one level', () => {
    const b = bench('c0-clock');
    const seen = new Set();
    // A ~1 Hz astable: sample across a couple of seconds of simulated
    // time and both levels must appear. A 555 that never toggles is the
    // classic mis-wire (trigger not tied to threshold), and it would
    // look perfectly healthy in a single reading.
    let t = 0n;
    for (let i = 0; i < 40; i++) {
      t += 50_000_000n;                 // 50 ms steps, 2 s total
      b.board.advanceTo(t);
      seen.add(b.board.nodeVoltage(b.circuit.parts.length ? 'net_vcc' : 'x') > 0 ? 'ok' : 'ok');
      seen.add(b.lit('led_clk'));
    }
    assert.ok(seen.has(true) && seen.has(false),
      'the clock LED must be seen both lit and dark across two seconds');
  });
});

describe('C1 — the program counter', () => {
  it('counts up one address per clock, and wraps at sixteen', () => {
    const b = bench('c1-program-counter');
    b.settle();
    assert.equal(b.nibble('led'), 0, 'starts at zero');
    for (let expected = 1; expected <= 16; expected++) {
      b.tick();
      assert.equal(b.nibble('led'), expected % 16, `after ${expected} clocks`);
    }
  });

  it('the ripple carry lights at fifteen — that is how counters chain', () => {
    const b = bench('c1-program-counter');
    b.settle();
    for (let i = 0; i < 15; i++) b.tick();
    assert.equal(b.nibble('led'), 15);
    assert.equal(b.lit('led_rco'), true, 'RCO is high on the terminal count');
    b.tick();
    assert.equal(b.lit('led_rco'), false, 'and low again once it wraps');
  });
});

describe('C2 — memory', () => {
  it('stores a nibble and gives it back INVERTED, as a real 74LS189 does', () => {
    const b = bench('c2-memory');
    b.settle();
    // Write 5 at address 0: data switches to 5, then pull WE low.
    b.set('swd', 5);
    b.set('swc', 0b0010); b.settle();      // closing the switch pulls /WE LOW — active low
    b.set('swc', 0); b.settle();
    const read = b.nibble('led_data');
    assert.equal(read, (~5) & 0xF,
      `the 189 inverts its outputs: storing 5 must read back ${(~5) & 0xF}, got ${read}`);
  });

  it('the address LEDs follow the counter, so each clock looks somewhere new', () => {
    const b = bench('c2-memory');
    b.settle();
    assert.equal(b.nibble('led_addr'), 0);
    b.tick('swc');
    assert.equal(b.nibble('led_addr'), 1, 'one clock moves the machine to the next address');
    b.tick('swc');
    assert.equal(b.nibble('led_addr'), 2);
  });
});

describe('C3 — the accumulator', () => {
  it('adds its switch value to itself on every clock', () => {
    const b = bench('c3-accumulator');
    // Clear first (MR is position 2 on the control switch).
    b.set('swc', 0b0010); b.settle();
    b.set('swc', 0); b.settle();
    b.set('swv', 3);
    let total = 0;
    for (let i = 0; i < 5; i++) {
      b.tick('swc');
      total = (total + 3) & 0xF;
      assert.equal(b.nibble('led'), total, `after ${i + 1} clocks of +3`);
    }
  });

  it('HOLDS between clocks — changing the addend does not move the total', () => {
    // The check that separates a register from a wire: state must persist
    // when nothing clocks it.
    const b = bench('c3-accumulator');
    b.set('swc', 0b0010); b.settle();
    b.set('swc', 0); b.settle();
    b.set('swv', 1);
    b.tick('swc');
    const held = b.nibble('led');
    b.set('swv', 7); b.settle();
    assert.equal(b.nibble('led'), held, 'no clock, no change');
    b.set('swv', 0); b.settle();
    assert.equal(b.nibble('led'), held, 'still no change');
  });
});

describe('C4 — the ring counter', () => {
  it('is one-hot and wraps after six: T1..T6, then T1 again', () => {
    const b = bench('c4-ring-counter');
    b.settle();
    const state = () => [1, 2, 3, 4, 5, 6].map((n) => (b.lit(`led_t${n}`) ? 1 : 0));
    const oneHot = (s) => s.reduce((a, x) => a + x, 0) === 1;
    let s = state();
    assert.ok(oneHot(s), `reset must leave exactly one state active, got ${s.join('')}`);
    assert.equal(s[0], 1, 'and it must be T1');
    // Two full laps: a ring that wraps once by luck fails on the second.
    for (let lap = 0; lap < 2; lap++) {
      for (let step = 1; step <= 6; step++) {
        b.tick();
        s = state();
        assert.ok(oneHot(s), `lap ${lap} step ${step}: one-hot, got ${s.join('')}`);
        assert.equal(s[step % 6], 1, `lap ${lap}: after ${step} clocks T${(step % 6) + 1} is active`);
      }
    }
  });
});

describe('C5 — the instruction decoder', () => {
  const OPCODES = [
    [0b0000, 'lda'], [0b0001, 'add'], [0b0010, 'sub'],
    [0b1110, 'out'], [0b1111, 'hlt'],
  ];
  it('lights exactly the named instruction, and nothing else', () => {
    const b = bench('c5-instruction-decoder');
    const names = ['lda', 'add', 'sub', 'out', 'hlt'];
    for (const [code, want] of OPCODES) {
      b.set('swi', code); b.settle();
      for (const n of names) {
        assert.equal(b.lit(`led_${n}`), n === want,
          `opcode ${code.toString(2).padStart(4, '0')}: ${n} should be ${n === want ? 'lit' : 'dark'}`);
      }
    }
  });

  it('an unused opcode decodes to nothing rather than to something wrong', () => {
    // 0111 is not a SAP-1 instruction. A decoder that quietly picks the
    // nearest match would be worse than one that stays dark.
    const b = bench('c5-instruction-decoder');
    b.set('swi', 0b0111); b.settle();
    for (const n of ['lda', 'add', 'sub', 'out', 'hlt']) {
      assert.equal(b.lit(`led_${n}`), false, `0111 must not decode as ${n}`);
    }
  });
});

describe('C6 — the control matrix', () => {
  // The SAP-1 control table, straight from the architecture: for each
  // instruction, which lines are asserted in each of the six states.
  // Anything not listed must be DARK — a control unit that fires a spare
  // signal is not a smaller bug than one that misses a needed one.
  const TABLE = {
    LDA: [['ep', 'lm'], ['cp'], ['ce', 'li'], ['ei', 'lm'], ['ce', 'la'], []],
    ADD: [['ep', 'lm'], ['cp'], ['ce', 'li'], ['ei', 'lm'], ['ce', 'lb'], ['eu', 'la']],
    SUB: [['ep', 'lm'], ['cp'], ['ce', 'li'], ['ei', 'lm'], ['ce', 'lb'], ['eu', 'la', 'su']],
    OUT: [['ep', 'lm'], ['cp'], ['ce', 'li'], ['ea', 'lo'], [], []],
  };
  const OPCODE = { LDA: 0b0000, ADD: 0b0001, SUB: 0b0010, OUT: 0b1110 };
  const ALL = ['ep', 'lm', 'cp', 'ce', 'li', 'ei', 'la', 'lb', 'eu', 'su', 'ea', 'lo'];

  for (const [instr, states] of Object.entries(TABLE)) {
    it(`${instr}: the right lines fire in the right state, and only those`, () => {
      const b = bench('c6-control-matrix');
      b.set('swi', OPCODE[instr]);
      b.settle();
      for (let t = 0; t < 6; t++) {
        if (t > 0) b.tick('swc');
        b.settle();
        assert.equal(b.lit(`led_t${t + 1}`), true, `${instr}: T${t + 1} must be the active state`);
        const want = new Set(states[t]);
        for (const line of ALL) {
          assert.equal(b.lit(`led_${line}`), want.has(line),
            `${instr} T${t + 1}: ${line} should be ${want.has(line) ? 'ASSERTED' : 'dark'}`);
        }
      }
    });
  }

  it('the fetch phase is identical whatever the instruction', () => {
    // T1-T3 are architecture, not opcode: if they ever differ by
    // instruction, the machine has stopped being a SAP-1.
    const seen = [];
    for (const instr of Object.keys(TABLE)) {
      const b = bench('c6-control-matrix');
      b.set('swi', OPCODE[instr]);
      b.settle();
      const phase = [];
      for (let t = 0; t < 3; t++) {
        if (t > 0) b.tick('swc');
        b.settle();
        phase.push(ALL.filter((l) => b.lit(`led_${l}`)).join('+'));
      }
      seen.push(phase.join(' | '));
    }
    assert.equal(new Set(seen).size, 1, `fetch differs by instruction: ${seen.join(' /// ')}`);
  });
});

describe('C7 — the bus', () => {
  /** Read the bus as levels, keeping "neither" distinct from 0 and 1. */
  function busLevels(b) {
    const nets = b.board.getNets();
    return [0, 1, 2, 3].map((i) => {
      const net = nets.find((n) => n.terminals?.some((t) => t.part === `rbus${i}` && t.terminal === 'a'));
      const v = net ? b.board.nodeVoltage(net.id) : NaN;
      return v > 3.5 ? 1 : v < 1.0 ? 0 : '?';
    });
  }

  it('whoever is enabled owns the bus, and nobody enabled means zero', () => {
    const b = bench('c7-the-bus');
    b.set('swa', 0b0101); b.set('swb', 0b1010);
    b.set('swe', 0b0000); b.settle();
    assert.deepEqual(busLevels(b), [0, 0, 0, 0], 'pull-downs hold the bus low when nobody drives');
    b.set('swe', 0b0001); b.settle();
    assert.deepEqual(busLevels(b), [1, 0, 1, 0], 'A drives 0101, LSB first');
    b.set('swe', 0b0010); b.settle();
    assert.deepEqual(busLevels(b), [0, 1, 0, 1], 'B drives 1010');
  });

  it('two drivers at once is CONTENTION, and the bus says so', () => {
    // The important assertion in this file: with both enabled the bus
    // must be neither a valid 1 nor a valid 0 on the contested lines.
    // A simulator that quietly picked a winner would teach the opposite
    // of the lesson — that contention is survivable.
    const b = bench('c7-the-bus');
    b.set('swa', 0b0101); b.set('swb', 0b1010);
    b.set('swe', 0b0011); b.settle();
    const levels = busLevels(b);
    assert.ok(levels.every((l) => l === '?'),
      `every line is contested (A and B disagree on all four), so none may read as a clean level: got ${levels.join('')}`);
  });

  it('sources that AGREE do not contend — it is disagreement that hurts', () => {
    const b = bench('c7-the-bus');
    b.set('swa', 0b0110); b.set('swb', 0b0110);
    b.set('swe', 0b0011); b.settle();
    assert.deepEqual(busLevels(b), [0, 1, 1, 0],
      'both driving the same value is electrically fine, if still bad practice');
  });
});

describe('C8 — the machine reads its own memory', () => {
  it('walks the addresses it wrote, and gives back what was stored', () => {
    // Hand-load four cells, wrap the counter round, then let it run:
    // nothing is touched but the clock, and the stored values must come
    // back in the order they went in.
    const b = bench('c8-memory-walker');
    b.settle();
    const PROGRAM = [3, 9, 5, 12];
    for (let addr = 0; addr < 4; addr++) {
      assert.equal(b.nibble('led_addr'), addr, `about to write cell ${addr}`);
      b.set('swd', PROGRAM[addr]);
      b.set('swc', 0b0010); b.settle();          // WRITE
      b.set('swc', 0); b.settle();
      b.tick('swc');                              // on to the next address
    }
    // The counter is 4-bit, so twelve more ticks bring it back to zero.
    for (let i = 0; i < 12; i++) b.tick('swc');
    assert.equal(b.nibble('led_addr'), 0, 'wrapped back to the start');
    for (let addr = 0; addr < 4; addr++) {
      assert.equal(b.nibble('led_addr'), addr, `now looking at cell ${addr}`);
      assert.equal(b.nibble('led_data'), PROGRAM[addr],
        `cell ${addr} must give back ${PROGRAM[addr]} — the inverter bank undoes the 189's inversion`);
      b.tick('swc');
    }
  });

  it('the address register FOLLOWS the bus rather than the counter directly', () => {
    // MAR latches what it sees on the bus. If someone rewired it straight
    // to the counter it would still count, and the bus would have stopped
    // mattering — so check the two agree, which is what makes the bus the
    // real path.
    const b = bench('c8-memory-walker');
    b.settle();
    for (let i = 0; i < 6; i++) {
      assert.equal(b.nibble('led_addr'), b.nibble('led_bus'),
        `tick ${i}: the address register holds what the bus is carrying`);
      b.tick('swc');
    }
  });
});

describe('C9 — the fetch cycle', () => {
  const decoded = (b) => ['lda', 'add', 'sub', 'out'].filter((n) => b.lit(`led_${n}`));
  const tState = (b) => [1, 2, 3].filter((n) => b.lit(`led_t${n}`));

  it('fetches a stored program and decodes each instruction in turn', () => {
    const b = bench('c9-fetch-cycle');
    b.settle();
    // 0111 = ADD 3, 1100 = OUT, 1011 = SUB 3
    const PROGRAM = [0b0111, 0b1100, 0b1011];
    const EXPECT = ['add', 'out', 'sub'];
    for (let addr = 0; addr < PROGRAM.length; addr++) {
      assert.deepEqual(tState(b), [1], `writing cell ${addr}: should be sitting in T1`);
      assert.equal(b.nibble('led_addr'), addr, `MAR points at cell ${addr}`);
      b.set('swd', PROGRAM[addr]);
      b.set('swc', 0b0010); b.settle();      // /WE low: store
      b.set('swc', 0); b.settle();
      b.tick('swc'); b.tick('swc'); b.tick('swc');
    }
    // The counter is four bits; run it round to zero again.
    for (let i = 0; i < 13 * 3; i++) b.tick('swc');
    assert.equal(b.nibble('led_addr'), 0, 'back at the first instruction');

    for (let i = 0; i < PROGRAM.length; i++) {
      assert.deepEqual(tState(b), [1], `instruction ${i}: T1`);
      assert.equal(b.nibble('led_bus'), i, 'T1: the counter is driving the bus');
      assert.equal(b.nibble('led_addr'), i, 'T1: MAR latched that address');
      b.tick('swc');
      assert.deepEqual(tState(b), [2], `instruction ${i}: T2`);
      assert.equal(b.nibble('led_bus'), 0,
        'T2: NOBODY drives the bus — the counter has let go and the RAM has not yet been enabled');
      b.tick('swc');
      assert.deepEqual(tState(b), [3], `instruction ${i}: T3`);
      assert.equal(b.nibble('led_bus'), PROGRAM[i], 'T3: the RAM is driving the bus');
      assert.equal(b.nibble('led_ir'), PROGRAM[i], 'T3: the instruction register latched it');
      assert.deepEqual(decoded(b), [EXPECT[i]],
        `instruction ${i} (${PROGRAM[i].toString(2).padStart(4, '0')}) decodes as ${EXPECT[i]} and nothing else`);
      b.tick('swc');
    }
  });

  it('the instruction register HOLDS across the next fetch until T3 replaces it', () => {
    // If the IR were transparent rather than latched, it would follow the
    // bus and show the ADDRESS during T1 — which would look like the
    // machine forgetting what it is doing.
    const b = bench('c9-fetch-cycle');
    b.settle();
    b.set('swd', 0b1100);                        // OUT at cell 0
    b.set('swc', 0b0010); b.settle();
    b.set('swc', 0); b.settle();
    b.tick('swc'); b.tick('swc');                 // through T2 into T3
    assert.equal(b.nibble('led_ir'), 0b1100, 'latched at T3');
    b.tick('swc');                                // T1 of the next fetch
    assert.equal(b.nibble('led_ir'), 0b1100,
      'still holding the instruction while the next address goes past on the bus');
  });
});
