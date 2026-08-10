/**
 * Loading the example gallery's LEGACY circuit files must never crash.
 *
 * The gallery's 53 circuit.json files were written against the original
 * flat wire format ({from: 'id', fromTerminal: 't'}); the model moved to
 * endpoint objects ({from: {part, terminal}}). Loading a legacy file used
 * to build wires whose endpoints were the bare strings, so _syncNetlist
 * dereferenced `terminal.part` of undefined and threw MID-RENDER — which
 * unmounted the entire GUI to the crash page. That was the "loading
 * examples crashes the browser window" report (2026-08-10), reproduced on
 * production with the confirm dialog accepted.
 *
 * The fixture below is the shape of examples/01-blink/circuit.json as
 * deployed, not a synthetic reduction.
 */

import './_setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { Circuit } from '../src/model/circuit.js';

const LEGACY_BLINK = {
  vcc: 5.0,
  parts: [
    { id: 'vcc1', kind: 'vcc', params: {}, x: 200, y: 50 },
    { id: 'gnd1', kind: 'gnd', params: {}, x: 200, y: 350 },
    { id: 'r1', kind: 'resistor', params: { ohms: 1000 }, x: 200, y: 120 },
    { id: 'led1', kind: 'led', params: { vf: 2.0, color: 'red' }, x: 200, y: 220 },
    { id: 'mcu1', kind: 'mcu', params: { pins: ['P1.0'] }, x: 400, y: 200 },
  ],
  wires: [
    { from: 'vcc1', fromTerminal: 'vcc', to: 'r1', toTerminal: 'a' },
    { from: 'r1', fromTerminal: 'b', to: 'led1', toTerminal: 'anode' },
    { from: 'led1', fromTerminal: 'cathode', to: 'mcu1', toTerminal: 'P1.0' },
  ],
};

test('legacy flat-format wires load without throwing', () => {
  const c = Circuit.fromJSON(LEGACY_BLINK);
  assert.equal(c.parts.length, 5);
  assert.equal(c.wires.length, 3);
});

test('legacy parts get their terminal lists derived — renderers map over them', () => {
  // The gallery files carry no `terminals` field; every renderer does
  // part.terminals.map(...), which was the pure-circuit crash (21-resistor-led).
  const c = Circuit.fromJSON(LEGACY_BLINK);
  for (const p of c.parts) {
    assert.ok(Array.isArray(p.terminals), `${p.kind} has no terminals array`);
    assert.equal(typeof p.rotation, 'number', `${p.kind} has no rotation`);
  }
  const led = c.parts.find(p => p.kind === 'led');
  assert.deepEqual(led.terminals, ['anode', 'cathode']);
});

test('legacy wires are normalized to endpoint objects', () => {
  const c = Circuit.fromJSON(LEGACY_BLINK);
  for (const w of c.wires) {
    assert.equal(typeof w.id, 'string', 'canvas hashes wire.id — must exist');
    assert.equal(typeof w.netId, 'string', 'netlist groups by netId — must exist');
    assert.equal(typeof w.from, 'object');
    assert.equal(typeof w.from.part, 'string');
    assert.equal(typeof w.from.terminal, 'string');
    assert.equal(typeof w.to.part, 'string');
    assert.equal(typeof w.to.terminal, 'string');
  }
  assert.deepEqual(c.wires[0].from, { part: 'vcc1', terminal: 'vcc' });
  assert.deepEqual(c.wires[2].to, { part: 'mcu1', terminal: 'P1.0' });
});

test('nets from a legacy load carry no undefined parts', () => {
  const c = Circuit.fromJSON(LEGACY_BLINK);
  const nets = c.board.getNets();
  for (const net of nets) {
    for (const t of net.terminals) {
      assert.equal(typeof t.part, 'string', `net ${net.id} has a partless terminal`);
    }
  }
  // The vcc→r→led→mcu chain must actually connect: 3 wires, distinct nets.
  assert.ok(nets.length >= 3, `expected ≥3 nets, got ${nets.length}`);
});

test('legacy wires sharing a terminal union into one net; others stay apart', () => {
  // No legacy wire carries a netId, and _syncNetlist groups by netId — before
  // the union-find they ALL collapsed into one net: a silent full-circuit short.
  const c = Circuit.fromJSON({
    vcc: 5,
    parts: [
      { id: 'v1', kind: 'vcc', params: {}, x: 0, y: 0 },
      { id: 'r1', kind: 'resistor', params: { ohms: 100 }, x: 0, y: 0 },
      { id: 'r2', kind: 'resistor', params: { ohms: 100 }, x: 0, y: 0 },
      { id: 'g1', kind: 'gnd', params: {}, x: 0, y: 0 },
    ],
    wires: [
      { from: 'v1', fromTerminal: 'vcc', to: 'r1', toTerminal: 'a' },
      { from: 'r1', fromTerminal: 'a', to: 'r2', toTerminal: 'a' }, // shares r1.a
      { from: 'r2', fromTerminal: 'b', to: 'g1', toTerminal: 'gnd' }, // disjoint
    ],
  });
  const ids = c.wires.map(w => w.netId);
  assert.equal(ids[0], ids[1], 'wires sharing r1.a must be one net');
  assert.notEqual(ids[0], ids[2], 'disjoint wires must stay separate nets');
  assert.equal(c.board.getNets().length, 2);
});

test('malformed wires are dropped, not fatal', () => {
  const c = Circuit.fromJSON({
    vcc: 5,
    parts: [{ id: 'r1', kind: 'resistor', params: { ohms: 100 }, x: 0, y: 0 }],
    wires: [
      { from: 'r1' },                       // no terminal on either side
      { from: { part: 'r1' }, to: { part: 'r1', terminal: 'b' } }, // missing terminal
      { to: 'r1', toTerminal: 'b' },        // no from at all
      { from: 'r1', fromTerminal: 'a', to: 'r1', toTerminal: 'b' }, // valid
    ],
  });
  assert.equal(c.wires.length, 1);
});

test('modern endpoint-object format is untouched', () => {
  const modern = {
    vcc: 5,
    parts: [
      { id: 'v1', kind: 'vsource', params: { volts: 5 }, x: 0, y: 0 },
      { id: 'r1', kind: 'resistor', params: { ohms: 1000 }, x: 100, y: 0 },
    ],
    wires: [
      { from: { part: 'v1', terminal: 'pos' }, to: { part: 'r1', terminal: 'a' }, color: '#e74c3c' },
      { from: { part: 'r1', terminal: 'b' }, to: { part: 'v1', terminal: 'neg' } },
    ],
  };
  const c = Circuit.fromJSON(modern);
  assert.equal(c.wires.length, 2);
  assert.equal(c.wires[0].color, '#e74c3c');
  assert.deepEqual(c.wires[0].from, { part: 'v1', terminal: 'pos' });
});
