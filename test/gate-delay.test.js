/**
 * Why carry look-ahead exists — measured, not asserted.
 *
 * This is NOT a gallery rung, and the reason is the interesting part. The
 * ladders are built from chips you can buy, and in this engine a real
 * 74HC08 is ZERO-DELAY: chip-composer.js models logic levels, not
 * propagation time. Only the abstract gate_* kinds honour params.tpdNs. So
 * an adder built from 74-series parts settles instantly however deep its
 * carry chain is, and a "look-ahead is faster" example built from buyable
 * parts would assert its own conclusion while demonstrating nothing.
 *
 * Built from abstract gates the delay is real and countable, and the result
 * is not the textbook one: look-ahead assembled from 2-input packages buys
 * 1.33x the speed for 2.1x the gates, which is a bad trade. It only becomes
 * the textbook 2x when the gates are WIDE — which is why carry look-ahead
 * ships as dedicated silicon (the 74182 uses 5-input gates) instead of
 * being something you assemble from a bag of quad-gate chips.
 *
 * Widening a gate needs params.inputs, which bw-board honoured everywhere
 * except netlist validation until f727c02 — so this file requires a
 * bw-board at or after that commit.
 */

import './_setup.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getEngine } from '../src/engine.js';

const { BoardImpl } = getEngine();
const TPD = 10; // ns per gate — the unit every depth below is counted in

function mk() {
  const P = [];
  const N = new Map();
  let n = 0;
  const net = (id) => {
    if (!N.has(id)) N.set(id, { id, terminals: [] });
    return N.get(id);
  };
  const join = (id, part, terminal) => net(id).terminals.push({ part, terminal });
  const add = (id, kind, params, terminals) => P.push({ id, kind, params, terminals });

  add('VCC', 'vcc', {}, ['vcc']);
  add('GND', 'gnd', {}, ['gnd']);
  join('net_vcc', 'VCC', 'vcc');
  join('net_gnd', 'GND', 'gnd');

  const gate = (kind, x, y) => {
    const id = `g${n++}`;
    const out = `n_${id}`;
    add(id, kind, { tpdNs: TPD }, ['in0', 'in1', 'out']);
    join(x, id, 'in0');
    join(y, id, 'in1');
    join(out, id, 'out');
    return out;
  };

  // One gate of n inputs, one gate delay — what a 74182 does and a bag of
  // 74HC08s cannot.
  const wide = (kind, list) => {
    if (list.length === 1) return list[0];
    const id = `g${n++}`;
    const out = `n_${id}`;
    const ins = list.map((_, i) => `in${i}`);
    add(id, kind, { tpdNs: TPD, inputs: list.length }, [...ins, 'out']);
    list.forEach((nm, i) => join(nm, id, `in${i}`));
    join(out, id, 'out');
    return out;
  };

  const AND = (x, y) => gate('gate_and', x, y);
  const OR = (x, y) => gate('gate_or', x, y);
  const XOR = (x, y) => gate('gate_xor', x, y);

  // A balanced tree of 2-input gates: depth ceil(log2 k), not 1.
  const tree = (fn, list) => {
    let cur = list.slice();
    while (cur.length > 1) {
      const next = [];
      for (let i = 0; i < cur.length; i += 2) {
        next.push(i + 1 < cur.length ? fn(cur[i], cur[i + 1]) : cur[i]);
      }
      cur = next;
    }
    return cur[0];
  };

  const bank = (id, netNames) => {
    add(id, 'dip_switch_spst', { switches: 0 },
      ['1a', '2a', '3a', '4a', '1b', '2b', '3b', '4b']);
    netNames.forEach((nm, i) => {
      join('net_vcc', id, `${i + 1}a`);
      join(nm, id, `${i + 1}b`);
      const r = `r_${id}_${i}`;
      add(r, 'resistor', { ohms: 10000 }, ['a', 'b']);
      join(nm, r, 'a');
      join('net_gnd', r, 'b');
    });
  };

  return { P, AND, OR, XOR, tree, wide, bank, nets: () => [...N.values()], count: () => n };
}

function ripple(m, A, B, cin) {
  let c = cin;
  const S = [];
  for (let i = 0; i < 4; i++) {
    const p = m.XOR(A[i], B[i]);
    S.push(m.XOR(p, c));
    c = m.OR(m.AND(A[i], B[i]), m.AND(p, c)); // two more gate delays per bit
  }
  return { S, cout: c };
}

// c_{i+1} = g_i | p_i g_{i-1} | ... | (all p) cin — every carry from the
// inputs directly, so depth stops growing with bit position.
function lookaheadWith(combine) {
  return (m, A, B, cin) => {
    const g = [];
    const p = [];
    for (let i = 0; i < 4; i++) {
      g.push(m.AND(A[i], B[i]));
      p.push(m.XOR(A[i], B[i]));
    }
    const carry = [cin];
    for (let i = 0; i < 4; i++) {
      const terms = [g[i]];
      for (let j = i - 1; j >= 0; j--) {
        terms.push(combine(m, 'gate_and', [...p.slice(j + 1, i + 1), g[j]]));
      }
      terms.push(combine(m, 'gate_and', [...p.slice(0, i + 1), cin]));
      carry.push(combine(m, 'gate_or', terms));
    }
    const S = [];
    for (let i = 0; i < 4; i++) S.push(m.XOR(p[i], carry[i]));
    return { S, cout: carry[4] };
  };
}

const TREES = (m, kind, list) => m.tree(kind === 'gate_and' ? m.AND : m.OR, list);
const WIDE = (m, kind, list) => m.wide(kind, list);

/**
 * Settle at A=0,B=0, then switch to the worst case (15+1, where the carry
 * must cross every stage) and record the last nanosecond at which any
 * watched line moved.
 */
function measure(build) {
  const m = mk();
  const A = ['a0', 'a1', 'a2', 'a3'];
  const B = ['b0', 'b1', 'b2', 'b3'];
  m.bank('SA', A);
  m.bank('SB', B);
  const { S, cout } = build(m, A, B, 'net_gnd');

  const b = new BoardImpl(5.0);
  b.setNetlist(m.P, m.nets());

  let t = 0n;
  for (let i = 0; i < 3; i++) {
    t += 1_000_000n;
    b.advanceTo(t);
  }

  const watch = [...S, cout];
  const read = () => watch.map((nm) => (b.nodeVoltage(nm) > 2.5 ? 1 : 0)).join('');

  let prev = read();
  b.setPartParam('SA', 'switches', 0b1111);
  b.setPartParam('SB', 'switches', 0b0001);

  const t0 = t;
  let settledAt = 0;
  for (let ns = 1; ns <= 400; ns++) {
    b.advanceTo(t0 + BigInt(ns));
    const now = read();
    if (now !== prev) {
      settledAt = ns;
      prev = now;
    }
  }
  const bits = read().split('').map(Number);
  return {
    gates: m.count(),
    settledAt,
    delays: settledAt / TPD,
    sum: bits.slice(0, 4).reduce((a, x, i) => a + (x << i), 0),
    cout: bits[4],
  };
}

describe('propagation delay: why carry look-ahead exists', () => {
  const r = measure(ripple);
  const c2 = measure(lookaheadWith(TREES));
  const cw = measure(lookaheadWith(WIDE));

  it('all three adders compute the worst case correctly', () => {
    // 15 + 1 = 16: four zero sum bits and a carry out. If an adder got this
    // wrong its timing would be meaningless.
    for (const [name, a] of [['ripple', r], ['2-input CLA', c2], ['wide CLA', cw]]) {
      assert.equal(a.sum, 0, `${name}: 15+1 low nibble`);
      assert.equal(a.cout, 1, `${name}: 15+1 carry out`);
    }
  });

  it('ripple carry costs two gate delays per bit', () => {
    assert.equal(r.delays, 8, 'four stages, two gate delays of carry each');
    assert.equal(r.gates, 20);
  });

  it('look-ahead from 2-input gates is a BAD trade', () => {
    // The textbook says look-ahead is much faster. Built from quad 2-input
    // packages it is barely faster and much bigger, because the wide AND/OR
    // terms it needs become trees that are themselves several gates deep.
    assert.equal(c2.delays, 6);
    assert.ok(c2.delays < r.delays, 'faster than ripple');
    assert.ok(c2.gates > 2 * r.gates,
      `${c2.gates} gates vs ripple's ${r.gates} — more than double, for `
      + `${(r.delays / c2.delays).toFixed(2)}x the speed`);
  });

  it('look-ahead with WIDE gates is the trade the textbook describes', () => {
    assert.equal(cw.delays, 4, 'g/p, one product term, one sum term, one sum XOR');
    assert.equal(r.delays / cw.delays, 2, 'twice as fast as ripple');
    assert.ok(cw.gates < c2.gates,
      `wide gates also SHRINK it: ${cw.gates} vs ${c2.gates} — the tree that `
      + 'cost depth cost parts too');
  });

  it('the ordering is the lesson: wide < trees < ripple', () => {
    assert.ok(cw.delays < c2.delays && c2.delays < r.delays,
      `${cw.delays} < ${c2.delays} < ${r.delays} gate delays`);
  });
});
