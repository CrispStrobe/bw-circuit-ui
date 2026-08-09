// Tests for the placeable multimeter reading logic.

import './_setup.js';
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Circuit, resetIds } from '../src/model/circuit.js';
import { getMeterReading } from '../src/model/meter-reading.js';

const MS = 1_000_000n;
beforeEach(() => resetIds());

function buildCircuitWithMeter() {
  const c = new Circuit(5.0);
  const vcc = c.addPart('vcc', {}, 0, 0);
  const gnd = c.addPart('gnd', {}, 0, 0);
  const r = c.addPart('resistor', { ohms: 1000 }, 0, 0);
  const led = c.addPart('led', { vf: 2.0 }, 0, 0);
  const mcu = c.addPart('mcu', { pins: ['P1.0'] }, 0, 0);
  const meter = c.addPart('meter', { mode: 'voltage' }, 0, 0);

  c.addWire(vcc.id, 'vcc', r.id, 'a');
  c.addWire(r.id, 'b', led.id, 'anode');
  c.addWire(led.id, 'cathode', mcu.id, 'P1.0');

  c.setPin('P1.0', 'quasi', false);
  c.advanceTo(25n * MS);

  return { c, vcc, gnd, r, led, mcu, meter };
}

describe('getMeterReading', () => {
  it('voltage: returns --- when probes not wired', () => {
    const { c, meter } = buildCircuitWithMeter();
    const r = getMeterReading(meter, c.wires, c);
    assert.equal(r.value, '---');
    assert.ok(r.note.includes('Wire'));
  });

  it('voltage: reads difference between two nets', () => {
    const { c, meter, vcc, r: resistor } = buildCircuitWithMeter();
    // Wire probes to VCC net and LED-pin net
    const vccWire = c.wires.find(w => w.from.part === vcc.id || w.to.part === vcc.id);
    const ledWire = c.wires.find(w =>
      (w.from.part === resistor.id && w.from.terminal === 'b') ||
      (w.to.part === resistor.id && w.to.terminal === 'b')
    );
    c.addWire(meter.id, 'probe_a', vcc.id, 'vcc');
    c.addWire(meter.id, 'probe_b', resistor.id, 'b');

    const reading = getMeterReading(meter, c.wires, c);
    assert.notEqual(reading.value, '---');
    // VCC (5V) minus junction (~2.1V) ≈ 2.9V
    const v = parseFloat(reading.value);
    assert.ok(!isNaN(v), `should be a number: ${reading.value}`);
  });

  it('returns "Needs the simulator" when no board', () => {
    const meter = { id: 'm1', kind: 'meter', params: { mode: 'voltage' }, terminals: ['probe_a', 'probe_b'] };
    const r = getMeterReading(meter, [], null);
    assert.ok(r.note.includes('simulator'));
  });

  it('resistance: refuses on powered board', () => {
    const { c, meter, vcc, r: resistor } = buildCircuitWithMeter();
    meter.params.mode = 'resistance';
    c.addWire(meter.id, 'probe_a', vcc.id, 'vcc');
    c.addWire(meter.id, 'probe_b', resistor.id, 'b');

    const reading = getMeterReading(meter, c.wires, c);
    assert.ok(reading.note && reading.note.includes('power OFF'),
      `should refuse: ${reading.note}`);
  });

  it('meter is filtered from engine netlist', () => {
    const c = new Circuit(5.0);
    const vcc = c.addPart('vcc', {}, 0, 0);
    const gnd = c.addPart('gnd', {}, 0, 0);
    const meter = c.addPart('meter', { mode: 'voltage' }, 0, 0);

    // The engine should not see the meter
    const engineParts = c.board.parts;
    const meterInEngine = engineParts.find(p => p.kind === 'meter');
    assert.equal(meterInEngine, undefined, 'meter should not be in engine netlist');
  });
});
