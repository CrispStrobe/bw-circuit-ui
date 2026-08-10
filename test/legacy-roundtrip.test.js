/**
 * Legacy circuit file round-trip — load, serialize, re-load, compare.
 *
 * Legacy files lack wire.id, wire.netId, part.terminals, part.rotation.
 * Loading derives these. The question: does a round-trip preserve the
 * circuit, and is the derivation stable (load twice = same result)?
 *
 * This is the case the 52-file gallery corpus cannot represent: those
 * files were all written by this project in the current format.
 */

import './_setup.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Circuit, resetIds } from '../src/model/circuit.js';

const LEGACY_CIRCUIT = {
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

// A legacy file with no terminals, no wire ids, no rotation — the shape
// the owner was fixing crashes for.
const LEGACY_BARE = {
  vcc: 5.0,
  parts: [
    { id: 'v', kind: 'vcc', params: {}, x: 0, y: 0 },
    { id: 'g', kind: 'gnd', params: {}, x: 0, y: 200 },
    { id: 'r', kind: 'resistor', params: { ohms: 470 }, x: 100, y: 100 },
  ],
  wires: [
    { from: 'v', fromTerminal: 'vcc', to: 'r', toTerminal: 'a' },
    { from: 'r', fromTerminal: 'b', to: 'g', toTerminal: 'gnd' },
  ],
};

describe('legacy circuit round-trip', () => {
  it('load → save → load produces the same circuit', () => {
    resetIds();
    const c1 = Circuit.fromJSON(LEGACY_CIRCUIT);
    const json1 = c1.toJSON();

    resetIds();
    const c2 = Circuit.fromJSON(json1);
    const json2 = c2.toJSON();

    // Part count and kinds match
    assert.equal(json2.parts.length, json1.parts.length);
    for (let i = 0; i < json1.parts.length; i++) {
      assert.equal(json2.parts[i].kind, json1.parts[i].kind);
      assert.equal(json2.parts[i].x, json1.parts[i].x);
      assert.equal(json2.parts[i].y, json1.parts[i].y);
      assert.deepEqual(json2.parts[i].params, json1.parts[i].params);
    }

    // Wire count matches
    assert.equal(json2.wires.length, json1.wires.length);
    for (let i = 0; i < json1.wires.length; i++) {
      assert.deepEqual(json2.wires[i].from, json1.wires[i].from);
      assert.deepEqual(json2.wires[i].to, json1.wires[i].to);
    }
  });

  it('derivation is stable: two loads of the same legacy file agree', () => {
    resetIds();
    const c1 = Circuit.fromJSON(LEGACY_BARE);
    resetIds();
    const c2 = Circuit.fromJSON(LEGACY_BARE);

    // Same parts with same derived terminals
    assert.equal(c1.parts.length, c2.parts.length);
    for (let i = 0; i < c1.parts.length; i++) {
      assert.deepEqual(c1.parts[i].terminals, c2.parts[i].terminals,
        `${c1.parts[i].kind} terminals must be stable across loads`);
    }

    // Same wire count with same endpoints
    assert.equal(c1.wires.length, c2.wires.length);
    for (let i = 0; i < c1.wires.length; i++) {
      assert.deepEqual(c1.wires[i].from, c2.wires[i].from);
      assert.deepEqual(c1.wires[i].to, c2.wires[i].to);
    }
  });

  it('legacy file is silently upgraded: saved form has ids and terminals', () => {
    resetIds();
    const c = Circuit.fromJSON(LEGACY_BARE);
    const saved = c.toJSON();

    // Every part has terminals (derived on load, persisted on save)
    for (const p of saved.parts) {
      assert.ok(Array.isArray(p.terminals), `${p.kind} must have terminals after round-trip`);
      assert.ok(p.terminals.length > 0, `${p.kind} must have >0 terminals`);
    }

    // Every wire has id and netId (assigned on load, persisted on save)
    for (const w of saved.wires) {
      assert.ok(w.id, 'wire must have id after round-trip');
      assert.ok(w.netId, 'wire must have netId after round-trip');
      assert.equal(typeof w.from, 'object', 'from must be an object');
      assert.ok(w.from.part, 'from.part must exist');
      assert.ok(w.from.terminal, 'from.terminal must exist');
    }
  });

  it('battery→vsource alias: the file is silently upgraded on save', () => {
    // af726c0: legacy kind 'battery' aliases to vsource on load.
    // Question: does serialising write back 'vsource' (silent upgrade)
    // or 'battery' (stable legacy)?
    resetIds();
    const legacy = {
      vcc: 9.0,
      parts: [
        { id: 'bat1', kind: 'battery', params: { volts: 9 }, x: 100, y: 100 },
        { id: 'r1', kind: 'resistor', params: { ohms: 1000 }, x: 200, y: 100 },
      ],
      wires: [
        { from: 'bat1', fromTerminal: 'pos', to: 'r1', toTerminal: 'a' },
      ],
    };

    const c = Circuit.fromJSON(legacy);
    const saved = c.toJSON();

    // The kind is 'vsource' after load — the alias resolved
    const bat = saved.parts.find(p => p.params?.volts === 9);
    assert.ok(bat, 'battery part must survive');
    assert.equal(bat.kind, 'vsource',
      'battery is silently upgraded to vsource — stated behaviour, not a loss');

    // Round-trip is stable: vsource stays vsource
    resetIds();
    const c2 = Circuit.fromJSON(saved);
    const saved2 = c2.toJSON();
    const bat2 = saved2.parts.find(p => p.params?.volts === 9);
    assert.equal(bat2.kind, 'vsource', 'vsource stays vsource on second load');
  });

  it('negative control: mutated legacy file is detected by the comparator', () => {
    resetIds();
    const c = Circuit.fromJSON(LEGACY_BARE);
    const saved = c.toJSON();

    // Tamper: change the resistor value
    const tampered = JSON.parse(JSON.stringify(saved));
    tampered.parts.find(p => p.kind === 'resistor').params.ohms = 2200;

    resetIds();
    const c2 = Circuit.fromJSON(tampered);
    const saved2 = c2.toJSON();

    const r1 = saved.parts.find(p => p.kind === 'resistor');
    const r2 = saved2.parts.find(p => p.kind === 'resistor');
    assert.notEqual(r1.params.ohms, r2.params.ohms,
      'comparator must detect changed param in legacy-derived file');
  });
});
