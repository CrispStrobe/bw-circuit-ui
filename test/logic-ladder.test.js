/**
 * The logic ladder is PROVEN, not drawn.
 *
 * gallery/l0..l7 teach 74-series logic with no CPU and no MCU. An example
 * that merely loads is worth very little: a mis-numbered gate input or a
 * pin name the engine spells differently produces a circuit that renders
 * beautifully and computes nothing. So every rung here is simulated
 * through the REAL loader (`Circuit.fromJSON`, which resolves wires into
 * nets exactly as the app does) and its full truth table is asserted
 * against hand-computed values.
 *
 * The inputs are DIP switches, whose state is `params.switches` — a 4-bit
 * mask, bit i closing position i+1. `setPartParam` walks that mask through
 * every combination, so these tests exercise the same knob a learner
 * touches.
 *
 * Two invariants beyond the truth tables, both of which have bitten this
 * codebase before and are cheap to keep:
 *   - no CPU/MCU may appear in this ladder (that is its whole point), and
 *   - no logic input may float — a floating CMOS input reads 0 V in the
 *     engine and LOW on a good day on the bench, which turns a lesson
 *     into a different lesson without saying so.
 */

import './_setup.js';
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Circuit } from '../src/model/circuit.js';

const GALLERY = join(import.meta.dirname, '..', 'gallery');
const load = (name) => JSON.parse(readFileSync(join(GALLERY, `${name}.json`), 'utf8'));

/** Settle time: long enough for the bounded device fixpoint to ripple. */
const SETTLE_NS = 25_000_000n;

/**
 * Build the circuit once, then sweep switch states on it.
 * @returns {{lit: (id: string) => boolean, set: (part: string, mask: number) => void,
 *            digit: () => string, circuit: Circuit}}
 */
function bench(name) {
  const circuit = Circuit.fromJSON(load(name));
  const { board } = circuit;
  // advanceTo takes an ABSOLUTE time. Re-passing the same instant is a
  // silent no-op, which reads exactly like a circuit that computes the
  // right answer for its initial switch setting and ignores every input
  // after it — so the clock has to keep moving.
  let now = 0n;
  return {
    circuit,
    set(partId, mask) { board.setPartParam(partId, 'switches', mask); },
    // ledBrightness integrates current over a trailing 20 ms persistence
    // window, so one hop lands the new current at the very END of the
    // window where it carries no weight — the reading then lags a full
    // step behind the switches and looks exactly like inverted logic.
    // Two hops: the first registers the change, the second fills the
    // window with the settled value.
    settle() {
      now += SETTLE_NS; board.advanceTo(now);
      now += SETTLE_NS; board.advanceTo(now);
    },
    lit(id) { return board.ledBrightness(id) > 0.05; },
    /** Which segments of the display are lit, as a sorted string. */
    segments(id) {
      const b = board.sevenSegmentBrightness(id);
      if (!b) return '';
      const on = [];
      for (const seg of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) {
        const v = typeof b === 'object' ? (Array.isArray(b) ? b['abcdefg'.indexOf(seg)] : b[seg]) : 0;
        if (v > 0.05) on.push(seg);
      }
      return on.join('');
    },
  };
}

/** Sweep a two-input truth table: mask bit0 = A, bit1 = B. */
function sweep2(b, sw, read) {
  const out = {};
  for (let m = 0; m < 4; m++) {
    b.set(sw, m);
    b.settle();
    out[`${(m >> 1) & 1}${m & 1}`] = read();   // key is "BA"
  }
  return out;
}

describe('the logic ladder — no CPU, nothing to program', () => {
  const files = readdirSync(GALLERY).filter((f) => /^l\d+-.*\.json$/.test(f));

  it('is present: eight rungs, l0 through l7', () => {
    assert.equal(files.length, 8, `expected 8 logic examples, found ${files.join(', ')}`);
  });

  it('contains no CPU and no MCU — that is the point of it', () => {
    const FORBIDDEN = new Set(['mcu', 'w65c02', 'z80', 'eater6502', 'r6507', 'attiny88',
      'attiny85', 'attiny13', 'attiny2313', 'pi_pico', 'arduino_uno', 'arduino_nano',
      'arduino_mega', 'stc_mcu', 'stc15_mcu', 'microbit', '28c256', '62256']);
    for (const f of files) {
      const kinds = JSON.parse(readFileSync(join(GALLERY, f), 'utf8')).parts.map((p) => p.kind);
      const bad = kinds.filter((k) => FORBIDDEN.has(k));
      assert.deepEqual(bad, [], `${f} smuggles a processor: ${bad.join(', ')}`);
    }
  });

  it('leaves no logic input floating — every gate input is wired', () => {
    // A gate input that appears in no wire reads 0 V and quietly behaves
    // as LOW. On a breadboard it does whatever the room does.
    const GATE_INPUTS = /^[1-6][ab]$/;
    for (const f of files) {
      const data = JSON.parse(readFileSync(join(GALLERY, f), 'utf8'));
      const wired = new Set();
      for (const w of data.wires) {
        wired.add(`${w.from}.${w.fromTerminal}`);
        wired.add(`${w.to}.${w.toTerminal}`);
      }
      const circuit = Circuit.fromJSON(data);
      for (const p of circuit.parts) {
        if (!/^74hc(00|02|04|08|32|86)$/.test(p.kind)) continue;
        for (const t of p.terminals) {
          if (!GATE_INPUTS.test(t)) continue;
          // '04 is an inverter: only the 'a' pins are inputs.
          if (p.kind === '74hc04' && !t.endsWith('a')) continue;
          assert.ok(wired.has(`${p.id}.${t}`), `${f}: ${p.id}.${t} floats`);
        }
      }
    }
  });
});

describe('L0 — AND: the gate you can press', () => {
  it('lights only when both switches are closed', () => {
    const b = bench('l0-and-gate');
    assert.deepEqual(sweep2(b, 'sw1', () => b.lit('led1')),
      { '00': false, '01': false, '10': false, '11': true });
  });
});

describe('L1 — NOT: the gate that disagrees', () => {
  it('inverts: open switch lights the LED, closed switch darkens it', () => {
    const b = bench('l1-not-gate');
    b.set('sw1', 0b0000); b.settle();
    assert.equal(b.lit('led1'), true, 'input LOW → output HIGH');
    b.set('sw1', 0b0001); b.settle();
    assert.equal(b.lit('led1'), false, 'input HIGH → output LOW');
  });
});

describe('L2 — AND, OR, XOR side by side', () => {
  it('three gates, three different truth tables, one pair of switches', () => {
    const b = bench('l2-and-or-xor');
    assert.deepEqual(sweep2(b, 'sw1', () => b.lit('led_and')),
      { '00': false, '01': false, '10': false, '11': true }, 'AND');
    assert.deepEqual(sweep2(b, 'sw1', () => b.lit('led_or')),
      { '00': false, '01': true, '10': true, '11': true }, 'OR');
    assert.deepEqual(sweep2(b, 'sw1', () => b.lit('led_xor')),
      { '00': false, '01': true, '10': true, '11': false }, 'XOR');
  });
});

describe('L3 — NAND is universal', () => {
  it('NOT, AND and OR, all out of one gate type', () => {
    const b = bench('l3-nand-is-universal');
    assert.deepEqual(sweep2(b, 'sw1', () => b.lit('led_not')),
      { '00': true, '01': false, '10': true, '11': false }, 'NOT A');
    assert.deepEqual(sweep2(b, 'sw1', () => b.lit('led_and')),
      { '00': false, '01': false, '10': false, '11': true }, 'A AND B');
    assert.deepEqual(sweep2(b, 'sw1', () => b.lit('led_or')),
      { '00': false, '01': true, '10': true, '11': true }, 'A OR B (De Morgan)');
  });
});

describe('L4 — the half adder', () => {
  it('SUM is XOR, CARRY is AND: 1+1 reads as binary 10', () => {
    const b = bench('l4-half-adder');
    assert.deepEqual(sweep2(b, 'sw1', () => b.lit('led_sum')),
      { '00': false, '01': true, '10': true, '11': false }, 'SUM');
    assert.deepEqual(sweep2(b, 'sw1', () => b.lit('led_carry')),
      { '00': false, '01': false, '10': false, '11': true }, 'CARRY');
  });
});

describe('L5 — the full adder', () => {
  it('all eight rows of A + B + Cin', () => {
    const b = bench('l5-full-adder');
    for (let m = 0; m < 8; m++) {
      const [a, bb, cin] = [m & 1, (m >> 1) & 1, (m >> 2) & 1];
      b.set('sw1', m);
      b.settle();
      const total = a + bb + cin;
      assert.equal(b.lit('led_sum'), !!(total & 1), `A=${a} B=${bb} Cin=${cin}: SUM`);
      assert.equal(b.lit('led_carry'), total >= 2, `A=${a} B=${bb} Cin=${cin}: CARRY`);
    }
  });
});

describe('L6 — four bits at once (74HC283)', () => {
  it('adds every pair in 0..15 and carries correctly', () => {
    const b = bench('l6-four-bit-adder');
    for (let a = 0; a < 16; a++) {
      for (let bb = 0; bb < 16; bb++) {
        b.set('swa', a);
        b.set('swb', bb);
        b.settle();
        const bits = [0, 1, 2, 3].map((i) => (b.lit(`led${i}`) ? 1 : 0));
        const got = bits[0] + 2 * bits[1] + 4 * bits[2] + 8 * bits[3] + (b.lit('led4') ? 16 : 0);
        assert.equal(got, a + bb, `${a} + ${bb}`);
      }
    }
  });
});

describe('L7 — a calculator with no computer in it', () => {
  /** The standard seven-segment font, as the CD4511 drives it. */
  const FONT = ['abcdef', 'bc', 'abdeg', 'abcdg', 'bcfg', 'acdfg', 'acdefg', 'abc', 'abcdefg', 'abcdfg'];
  let b;
  before(() => { b = bench('l7-calculator'); });

  it('shows the decimal sum as a digit, for every sum 0..9', () => {
    for (let a = 0; a <= 9; a++) {
      for (let bb = 0; a + bb <= 9 && bb <= 9; bb++) {
        b.set('swa', a); b.set('swb', bb); b.settle();
        assert.equal(b.segments('disp'), FONT[a + bb], `${a} + ${bb} should show ${a + bb}`);
      }
    }
  });

  it('blanks above 9 — a BCD decoder only knows ten digits, and says so', () => {
    for (const [a, bb] of [[9, 1], [8, 4], [15, 0], [7, 8]]) {
      b.set('swa', a); b.set('swb', bb); b.settle();
      assert.equal(b.segments('disp'), '', `${a} + ${bb} = ${a + bb} must blank, not lie`);
    }
  });

  it('the carry LED still tells the truth when the digit cannot', () => {
    b.set('swa', 15); b.set('swb', 15); b.settle();
    assert.equal(b.lit('led_carry'), true, '15 + 15 = 30 sets the carry');
  });
});
