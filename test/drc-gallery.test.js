/**
 * DRC against gallery circuits — the check that would have caught the
 * relay-from-pin bug that started this feature.
 *
 * Each gallery circuit is loaded from test/fixtures/ and run through DRC.
 * Correctly-designed circuits must be clean; the test documents what
 * "correctly designed" means for each one.
 */

import './_setup.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Circuit, resetIds } from '../src/model/circuit.js';
import { runDrc } from '../src/model/drc.js';

const MS = 1_000_000n;

/**
 * Load a circuit from a plain JSON object (the format bw-cfront uses).
 */
function loadCircuitFromJson(json) {
  resetIds();
  const c = new Circuit(json.vcc || 5.0);
  const idMap = new Map();

  for (const p of json.parts) {
    const part = c.addPart(p.kind, p.params || {}, p.x || 0, p.y || 0);
    idMap.set(p.id, part.id);
  }

  for (const w of json.wires) {
    const fromId = idMap.get(w.from) || w.from;
    const toId = idMap.get(w.to) || w.to;
    c.addWire(fromId, w.fromTerminal, toId, w.toTerminal);
  }

  return c;
}

describe('DRC gallery: correctly-designed circuits are clean', () => {
  it('09-relay-clicker: relay through darlington + flyback = no dangers', () => {
    const c = loadCircuitFromJson({
      vcc: 5.0,
      parts: [
        { id: 'vcc1', kind: 'vcc', params: {} },
        { id: 'gnd1', kind: 'gnd', params: {} },
        { id: 'relay1', kind: 'relay', params: {} },
        { id: 'd1', kind: 'diode', params: { vf: 0.7 } },
        { id: 'q1', kind: 'npn', params: { beta: 1000 } }, // tip120 is a darlington
        { id: 'rb1', kind: 'resistor', params: { ohms: 1000 } },
        { id: 'r1', kind: 'resistor', params: { ohms: 1000 } },
        { id: 'led1', kind: 'led', params: { vf: 2.0, color: 'green' } },
        { id: 'mcu1', kind: 'mcu', params: { pins: ['P1.0', 'P1.1'] } },
      ],
      wires: [
        { from: 'vcc1', fromTerminal: 'vcc', to: 'relay1', toTerminal: 'coil_a' },
        { from: 'relay1', fromTerminal: 'coil_b', to: 'q1', toTerminal: 'collector' },
        { from: 'q1', fromTerminal: 'emitter', to: 'gnd1', toTerminal: 'gnd' },
        { from: 'mcu1', fromTerminal: 'P1.0', to: 'rb1', toTerminal: 'a' },
        { from: 'rb1', fromTerminal: 'b', to: 'q1', toTerminal: 'base' },
        { from: 'd1', fromTerminal: 'cathode', to: 'vcc1', toTerminal: 'vcc' },
        { from: 'd1', fromTerminal: 'anode', to: 'relay1', toTerminal: 'coil_b' },
        { from: 'vcc1', fromTerminal: 'vcc', to: 'r1', toTerminal: 'a' },
        { from: 'r1', fromTerminal: 'b', to: 'led1', toTerminal: 'anode' },
        { from: 'led1', fromTerminal: 'cathode', to: 'mcu1', toTerminal: 'P1.1' },
      ],
    });

    c.setPin('P1.0', 'quasi', true);
    c.setPin('P1.1', 'quasi', false); // active-low LED
    c.advanceTo(25n * MS);

    const w = runDrc(c, c.board);
    const dangers = w.filter(x => x.severity === 'danger');
    assert.equal(dangers.length, 0,
      `gallery relay circuit should be clean, got: ${dangers.map(d => `${d.rule}: ${d.explanation.slice(0, 60)}`).join('; ')}`);
  });

  it('BAD: relay driven directly from quasi pin → source-current warning', () => {
    const c = loadCircuitFromJson({
      vcc: 5.0,
      parts: [
        { id: 'vcc1', kind: 'vcc', params: {} },
        { id: 'gnd1', kind: 'gnd', params: {} },
        { id: 'relay1', kind: 'relay', params: {} },
        { id: 'mcu1', kind: 'mcu', params: { pins: ['P1.0'] } },
      ],
      wires: [
        { from: 'mcu1', fromTerminal: 'P1.0', to: 'relay1', toTerminal: 'coil_a' },
        { from: 'relay1', fromTerminal: 'coil_b', to: 'gnd1', toTerminal: 'gnd' },
      ],
    });

    c.setPin('P1.0', 'quasi', true);
    c.advanceTo(25n * MS);

    const w = runDrc(c, c.board);
    const hits = w.filter(x => x.rule === 'source-current');
    assert.ok(hits.length > 0, 'direct relay from quasi pin MUST warn');
    assert.ok(hits[0].explanation.includes('230'), 'must cite the 230 µA limit');
  });

  it('BAD: LED without resistor → missing-resistor warning', () => {
    const c = loadCircuitFromJson({
      vcc: 5.0,
      parts: [
        { id: 'vcc1', kind: 'vcc', params: {} },
        { id: 'gnd1', kind: 'gnd', params: {} },
        { id: 'led1', kind: 'led', params: { vf: 2.0 } },
      ],
      wires: [
        { from: 'vcc1', fromTerminal: 'vcc', to: 'led1', toTerminal: 'anode' },
        { from: 'led1', fromTerminal: 'cathode', to: 'gnd1', toTerminal: 'gnd' },
      ],
    });

    c.advanceTo(25n * MS);

    const w = runDrc(c, c.board);
    const hits = w.filter(x => x.rule === 'missing-resistor');
    assert.ok(hits.length > 0, 'LED without resistor MUST warn');
  });
});
