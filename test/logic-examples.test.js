/**
 * The seated logic examples still compute what the wire-level ones did.
 *
 * gen-logic-examples.mjs takes gallery/l0..l7 — whose truth tables are
 * asserted in logic-ladder.test.js — and seats their parts in breadboard
 * holes for sb3-creator's `examples/`. Seating is supposed to be a purely
 * visual act: the `wires` are carried across untouched.
 *
 * It is not automatically harmless. A breadboard strip joins five holes,
 * so two leads of different nets sharing one column are shorted BY THE
 * BOARD, and the wire list looks perfect while the circuit stops working.
 * That failure is invisible to a loader test and to anything that only
 * checks the file parses.
 *
 * So this file re-runs the arithmetic on the seated circuits. If a seat
 * ever lands two nets on one strip, an adder starts returning the wrong
 * number here.
 *
 * Skips cleanly when the sb3-creator checkout is not beside this one.
 */

import './_setup.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { Circuit } from '../src/model/circuit.js';

const CANDIDATES = [
  process.env.LOGIC_EXAMPLES_DIR,
  join(homedir(), 'code', 'sb3-creator-logic', 'examples'),
  join(import.meta.dirname, '..', '..', 'sb3-creator', 'examples'),
].filter(Boolean);
const EXAMPLES = CANDIDATES.find((d) => existsSync(join(d, 'pc90-74hc08-and-gate', 'circuit.json')));

const SETTLE_NS = 25_000_000n;

function bench(id) {
  const circuit = Circuit.fromJSON(JSON.parse(readFileSync(join(EXAMPLES, id, 'circuit.json'), 'utf8')));
  const { board } = circuit;
  let now = 0n;
  return {
    circuit,
    set(p, mask) { board.setPartParam(p, 'switches', mask); },
    settle() { now += SETTLE_NS; board.advanceTo(now); now += SETTLE_NS; board.advanceTo(now); },
    lit(id2) { return board.ledBrightness(id2) > 0.05; },
    segments(id2) {
      const b = board.sevenSegmentBrightness(id2);
      if (!b) return '';
      return ['a', 'b', 'c', 'd', 'e', 'f', 'g']
        .filter((s) => (typeof b === 'object' ? (Array.isArray(b) ? b['abcdefg'.indexOf(s)] : b[s]) : 0) > 0.05)
        .join('');
    },
  };
}

describe('seated logic examples (skips without the sb3-creator checkout)', { skip: !EXAMPLES }, () => {
  it('every part sits at a real coordinate, and params stay in params', () => {
    // A previous example shipped with `params` leaked into `y`: every
    // coordinate was an object, three sb3-creator gates went red, and
    // the circuit still "loaded" fine. Cheap to check, so check it.
    for (const id of ['pc90-74hc08-and-gate', 'pc94-half-adder', 'pc97-logic-calculator']) {
      const data = JSON.parse(readFileSync(join(EXAMPLES, id, 'circuit.json'), 'utf8'));
      for (const p of data.parts) {
        assert.ok(Number.isFinite(p.x), `${id}/${p.id}: x is not a number`);
        assert.ok(Number.isFinite(p.y), `${id}/${p.id}: y is not a number`);
        assert.equal(typeof p.params, 'object', `${id}/${p.id}: params must be an object`);
        assert.ok(!Array.isArray(p.params), `${id}/${p.id}: params must not be an array`);
      }
    }
  });

  it('seats do not short: no two parts share a breadboard hole', () => {
    for (const id of ['pc90-74hc08-and-gate', 'pc92-and-or-xor-compared', 'pc96-four-bit-adder-74hc283',
      'pc97-logic-calculator']) {
      const data = JSON.parse(readFileSync(join(EXAMPLES, id, 'circuit.json'), 'utf8'));
      const taken = new Map();
      for (const p of data.parts) {
        if (!p.seat) continue;
        for (const [term, hole] of Object.entries(p.seat.leadMap)) {
          const key = `${p.seat.boardId}/${hole}`;
          assert.ok(!taken.has(key), `${id}: ${p.id}.${term} and ${taken.get(key)} both in ${key}`);
          taken.set(key, `${p.id}.${term}`);
        }
      }
    }
  });

  it('AND still ANDs once it is sitting in holes', () => {
    const b = bench('pc90-74hc08-and-gate');
    const seen = {};
    for (let m = 0; m < 4; m++) { b.set('sw1', m); b.settle(); seen[`${(m >> 1) & 1}${m & 1}`] = b.lit('led1'); }
    assert.deepEqual(seen, { '00': false, '01': false, '10': false, '11': true });
  });

  it('the half adder still adds', () => {
    const b = bench('pc94-half-adder');
    const sum = {}; const carry = {};
    for (let m = 0; m < 4; m++) {
      b.set('sw1', m); b.settle();
      const k = `${(m >> 1) & 1}${m & 1}`;
      sum[k] = b.lit('led_sum'); carry[k] = b.lit('led_carry');
    }
    assert.deepEqual(sum, { '00': false, '01': true, '10': true, '11': false });
    assert.deepEqual(carry, { '00': false, '01': false, '10': false, '11': true });
  });

  it('the 4-bit adder still adds all 256 pairs across two boards', () => {
    const b = bench('pc96-four-bit-adder-74hc283');
    for (let a = 0; a < 16; a++) {
      for (let bb = 0; bb < 16; bb++) {
        b.set('swa', a); b.set('swb', bb); b.settle();
        const bits = [0, 1, 2, 3].map((i) => (b.lit(`led${i}`) ? 1 : 0));
        const got = bits[0] + 2 * bits[1] + 4 * bits[2] + 8 * bits[3] + (b.lit('led4') ? 16 : 0);
        assert.equal(got, a + bb, `seated: ${a} + ${bb}`);
      }
    }
  });

  it('the calculator still shows the right digit, on three boards', () => {
    const FONT = ['abcdef', 'bc', 'abdeg', 'abcdg', 'bcfg', 'acdfg', 'acdefg', 'abc', 'abcdefg', 'abcdfg'];
    const b = bench('pc97-logic-calculator');
    for (const [a, bb] of [[0, 0], [5, 3], [4, 5], [2, 7], [9, 0]]) {
      b.set('swa', a); b.set('swb', bb); b.settle();
      assert.equal(b.segments('disp'), FONT[a + bb], `seated: ${a} + ${bb}`);
    }
    b.set('swa', 9); b.set('swb', 1); b.settle();
    assert.equal(b.segments('disp'), '', 'ten still blanks rather than lying');
  });
});

describe('seated pc98/pc99 (skips without the sb3-creator checkout)', { skip: !EXAMPLES || !existsSync(join(EXAMPLES, 'pc98-adder-subtractor', 'circuit.json')) }, () => {
  it('pc98 still subtracts once seated', () => {
    const b = bench('pc98-adder-subtractor');
    const val = () => [0, 1, 2, 3].reduce((a, i) => a + (b.lit(`led${i}`) ? 1 << i : 0), 0);
    for (const [a, bb] of [[7, 2], [2, 7], [9, 4], [15, 1], [0, 1]]) {
      b.set('swa', a); b.set('swb', bb);
      b.set('swm', 0); b.settle();
      assert.equal(val(), (a + bb) & 0xF, `seated ${a}+${bb}`);
      b.set('swm', 1); b.settle();
      assert.equal(val(), (a - bb) & 0xF, `seated ${a}-${bb}`);
      assert.equal(b.lit('led4'), a >= bb, `seated ${a}-${bb}: no-borrow flag`);
    }
  });

  it('pc99 still shows two decimal digits once seated', () => {
    const FONT = ['abcdef', 'bc', 'abdeg', 'abcdg', 'bcfg', 'acdfg', 'acdefg', 'abc', 'abcdefg', 'abcdfg'];
    const b = bench('pc99-bcd-two-digit-calculator');
    for (const [a, bb] of [[3, 4], [9, 0], [9, 1], [7, 6], [9, 9]]) {
      b.set('swa', a); b.set('swb', bb); b.settle();
      const t = a + bb;
      assert.equal(b.segments('disp_ones'), FONT[t % 10], `seated ${a}+${bb} ones`);
      assert.equal(b.segments('disp_tens'), FONT[Math.floor(t / 10)], `seated ${a}+${bb} tens`);
    }
  });
});
