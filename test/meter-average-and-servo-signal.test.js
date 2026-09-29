/**
 * Both meter readers show the engine's AVERAGE, and a commanded servo is not
 * "no signal" (Lite task B5, docs/OPEN-TASKS-2026-09-29.md).
 *
 * 1. On a PWM net the instantaneous solve is on or off, so a meter that reads
 *    `nodeVoltage` / `branchCurrent` showed 0 V or 5 V depending on the frame.
 *    A real DMM shows the mean. bw-board's meterVoltage / meterCurrent average
 *    over 100 ms; Circuit.meterVoltage / meterCurrent reach them, and BOTH
 *    readers — the Instruments multimeter (readMeter) and the placed meter
 *    part (getMeterReading) — go through them. An engine without them keeps
 *    the instantaneous reading (the DC answer is the same number).
 * 2. servoHasSignal: a servo whose angle was set by setDeviceControl (no pulse)
 *    or whose first pulse rose at t = 0 used to read "no signal".
 *
 * The engine's averaging itself is held in bw-board
 * (test/actuator-intent-and-meter-mean.test.mjs) against the real solve; here
 * the engine is replaced at the one seam this tree owns, so the test says
 * which number each reader shows, not how the engine computes it.
 */

import './_setup.js';
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Circuit, resetIds } from '../src/model/circuit.js';
import { createMeterState, readMeter } from '../src/model/multimeter.js';
import { getMeterReading } from '../src/model/meter-reading.js';
import { servoHasSignal } from '../src/model/servo-signal.js';

const MS = 1_000_000n;
beforeEach(() => resetIds());

/** pin → 1 k → GND with a placed voltmeter across the resistor. */
function bench() {
  const c = new Circuit(5.0);
  const mcu = c.addPart('mcu', { pins: ['D9'] }, 0, 0);
  const r = c.addPart('resistor', { ohms: 1000 }, 0, 0);
  const gnd = c.addPart('gnd', {}, 0, 0);
  const meter = c.addPart('meter', { mode: 'voltage' }, 0, 0);
  const w1 = c.addWire(mcu.id, 'D9', r.id, 'a');
  const w2 = c.addWire(r.id, 'b', gnd.id, 'gnd');
  c.addWire(meter.id, 'probe_a', r.id, 'a');
  c.addWire(meter.id, 'probe_b', gnd.id, 'gnd');
  c.setPin('D9', 'pushpull', true);
  c.advanceTo(10n * MS);
  return { c, r, meter, w1, w2 };
}

/** Stand in for a board whose meter averages: record what was asked, answer `v`/`i`. */
function averaging(c, v, i) {
  const asked = [];
  c.board.meterVoltage = (a, b) => { asked.push(['v', a, b]); return v; };
  c.board.meterCurrent = (p, t) => { asked.push(['i', p, t]); return i; };
  return asked;
}

describe('meters read the engine average', () => {
  it('the Instruments multimeter shows meterVoltage, not the instant', () => {
    const { c, w1, w2 } = bench();
    const asked = averaging(c, 1.25, -0.00125);
    const m = createMeterState();
    m.probeA = { netId: w1.netId, partId: null, terminal: null };
    m.probeB = { netId: w2.netId, partId: null, terminal: null };
    const r = readMeter(m, c);
    assert.equal(r.siValue, 1.25);
    assert.equal(r.value, '1.250');
    assert.deepEqual(asked, [['v', w1.netId, w2.netId]]);
  });

  it('the Instruments multimeter shows meterCurrent in A mode', () => {
    const { c, r } = bench();
    averaging(c, 0, -0.00125);
    const m = createMeterState();
    m.mode = 'current';
    m.probeA = { netId: null, partId: r.id, terminal: 'a' };
    const out = readMeter(m, c);
    assert.equal(out.siValue, -0.00125);
    assert.equal(out.unit, 'mA');
  });

  it('the placed meter part shows the same average', () => {
    const { c, meter, r } = bench();
    averaging(c, 1.25, -0.00125);
    const v = getMeterReading(meter, c.wires, c);
    assert.equal(v.value, '1.250');
    meter.params.mode = 'current';
    const cur = getMeterReading({ ...meter, params: { mode: 'current' } },
      [{ from: { part: meter.id, terminal: 'probe_a' }, to: { part: r.id, terminal: 'a' } }], c);
    assert.equal(cur.value, '1.3', 'magnitude, one decimal: the legacy face');
  });

  it('an engine without meterVoltage keeps the instantaneous DC reading', () => {
    const { c, w1, w2, meter } = bench();
    c.board.meterVoltage = undefined;
    c.board.meterCurrent = undefined;
    const dc = c.nodeVoltage(w1.netId) - c.nodeVoltage(w2.netId);
    assert.ok(dc > 4, `DC across the resistor: ${dc}`);
    const m = createMeterState();
    m.probeA = { netId: w1.netId, partId: null, terminal: null };
    m.probeB = { netId: w2.netId, partId: null, terminal: null };
    assert.equal(readMeter(m, c).siValue, dc);
    assert.equal(getMeterReading(meter, c.wires, c).value, dc.toFixed(3));
  });
});

describe('servoHasSignal', () => {
  it('reads the engine\'s signal source, and the rise time on an older engine', () => {
    assert.equal(servoHasSignal(null), false);
    assert.equal(servoHasSignal({ signal: null, _riseNs: 0n }), false, 'nothing has set it');
    assert.equal(servoHasSignal({ signal: 'control', _riseNs: 0n }), true, 'setDeviceControl angle, no pulse');
    assert.equal(servoHasSignal({ signal: 'pulse', _riseNs: 0n }), true, 'first rise at t = 0');
    assert.equal(servoHasSignal({ _riseNs: 5n }), true, 'older engine: a rise after t = 0');
    assert.equal(servoHasSignal({ _riseNs: 0n }), false, 'older engine, no rise');
  });
});
