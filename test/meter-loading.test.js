/**
 * D21 — a placed meter has a finite input impedance, and being wired in does
 * not destroy the circuit.
 *
 * THE ORACLE, computed by hand and not by this code.
 *
 *   5 V ──[ R1 = 1 MΩ ]──┬──[ R2 = 1 MΩ ]── GND
 *                        │
 *                    meter probes (10 MΩ)
 *
 *   Unloaded:  Vmid = 5 · R2/(R1+R2) = 5 · ½ = 2.5 V exactly.
 *   Loaded:    R2 ∥ Rm = R2·Rm/(R2+Rm), and for R1 = R2 = R the whole thing
 *              collapses to one term worth memorising:
 *
 *                  Vmid = 5 · (R ∥ Rm) / (R + R ∥ Rm)
 *                       = 5 · R·Rm / (R² + 2·R·Rm)
 *                       = 5 · Rm / (R + 2·Rm)
 *
 *              R = 1 MΩ, Rm = 10 MΩ:  5·1e7/(1e6+2e7) = 50/21
 *                                     = 2.380952380952381 V
 *   The meter reads 4.762 % low, which is the whole lesson.
 *
 *   Meter current    = Vmid / Rm = (50/21)/1e7 = 2.380952e-7 A
 *   Source current   = (5 − 50/21)/1e6 = (55/21)/1e6 = 2.619048e-6 A
 *
 * On a 1 kΩ divider the same formula makes the meter nearly invisible:
 * 5·1e7/(1e3 + 2e7) = 2.4998750062496875 V, which is 2.500 V on the face. Both
 * facts are asserted, because "it loads" and "it does not always matter enough
 * to see" are one lesson and not two.
 */

import './_setup.js';
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Circuit, resetIds } from '../src/model/circuit.js';
import { getMeterReading } from '../src/model/meter-reading.js';
import { METER_INPUT_OHMS, meterInputOhms, applyMeterLoads } from '../src/model/meter-load.js';

const MS = 1_000_000n;
beforeEach(() => resetIds());

/** VCC → R1 → mid → R2 → GND, with the meter across R2 unless probes:false. */
function divider({ ohms = 1e6, mode = 'voltage', inputOhms, probes = true } = {}) {
  const c = new Circuit(5.0);
  const vcc = c.addPart('vcc', {}, 0, 0);
  const gnd = c.addPart('gnd', {}, 0, 0);
  const r1 = c.addPart('resistor', { ohms }, 0, 0);
  const r2 = c.addPart('resistor', { ohms }, 0, 0);
  const params = inputOhms === undefined ? { mode } : { mode, inputOhms };
  const meter = c.addPart('meter', params, 0, 0);
  c.addWire(vcc.id, 'vcc', r1.id, 'a');
  c.addWire(r1.id, 'b', r2.id, 'a');
  c.addWire(r2.id, 'b', gnd.id, 'gnd');
  if (probes) {
    c.addWire(meter.id, 'probe_a', r1.id, 'b');
    c.addWire(meter.id, 'probe_b', gnd.id, 'gnd');
  }
  c.advanceTo(10n * MS);
  const mid = c.board.getNets().find(n =>
    (n.terminals || []).some(t => t.part === r1.id && t.terminal === 'b'));
  return { c, meter, r1, r2, gnd, midNet: mid ? mid.id : null };
}

describe('D21: the meter loads the circuit it measures', () => {
  it('a 10 MΩ meter on a 1 MΩ divider reads 50/21 V, not 2.5 V', () => {
    const { c, midNet } = divider();
    assert.ok(midNet, 'the mid net must survive into the engine');
    const v = c.nodeVoltage(midNet);
    assert.ok(Math.abs(v - 50 / 21) < 1e-9,
      `hand-computed 50/21 = ${(50 / 21).toFixed(12)}, engine gave ${v.toFixed(12)}`);
    // And it is NOT the unloaded answer — the assertion the old code passed.
    assert.ok(Math.abs(v - 2.5) > 0.11, `must differ from the ideal 2.5 V, got ${v}`);
  });

  it('the same meter on a 1 kΩ divider is invisible to three decimals', () => {
    const { c, midNet, meter } = divider({ ohms: 1000 });
    const v = c.nodeVoltage(midNet);
    // 5·Rm/(R + 2·Rm) = 5e7/20001000 = 2.4998750062496875
    assert.ok(Math.abs(v - 2.4998750062496875) < 1e-9, `expected 2.4998750062, got ${v}`);
    assert.equal(getMeterReading(meter, c.wires, c).value, '2.500');
  });

  it('a 1 MΩ meter loads the 1 MΩ divider harder — the parameter is real', () => {
    const { c, midNet } = divider({ inputOhms: 1e6 });
    // R2‖Rm = 500 kΩ → Vmid = 5·(0.5)/(1.5) = 5/3 = 1.666666...
    const v = c.nodeVoltage(midNet);
    assert.ok(Math.abs(v - 5 / 3) < 1e-9, `hand-computed 5/3, engine gave ${v.toFixed(12)}`);
  });

  it('the meter draws its own current: Vmid/Rm = 2.381e-7 A', () => {
    const { c, meter } = divider();
    const i = Math.abs(c.board.branchCurrent(meter.id, 'a'));
    const oracle = (50 / 21) / 1e7;
    // 1e-5 relative, not exact: branchCurrent re-solves through its own MNA
    // cache and lands ~5e-7 relative from the transient node voltage. That is
    // the solver's tolerance, not the meter's, and it is far below the 4.76 %
    // effect under test.
    assert.ok(Math.abs(i - oracle) / oracle < 1e-5,
      `hand-computed ${oracle.toExponential(6)} A, engine gave ${i.toExponential(6)}`);
    assert.notEqual(i, 0, 'the whole defect was that this was exactly zero');
  });

  it('the reading states the impedance that decided it', () => {
    const { c, meter } = divider();
    const r = getMeterReading(meter, c.wires, c);
    assert.equal(r.value, '2.381');
    assert.equal(r.unit, 'V');
    assert.equal(r.spec, '10 MΩ');
  });

  it('an unwired probe loads nothing — no phantom resistor to ground', () => {
    const { c, midNet } = divider({ probes: false });
    assert.ok(Math.abs(c.nodeVoltage(midNet) - 2.5) < 1e-9,
      'with no probes wired the divider is exactly 2.5 V');
  });

  it('Ω and A modes do not stamp an input impedance', () => {
    for (const mode of ['resistance', 'current']) {
      const { c, midNet } = divider({ mode });
      assert.ok(Math.abs(c.nodeVoltage(midNet) - 2.5) < 1e-9,
        `${mode} mode must not load the divider`);
      assert.equal(c.loadingMeters.length, 0);
    }
  });
});

describe('D21: wiring a meter must not empty the board', () => {
  // The unrecorded half. bw-board's validator has refused a net that names a
  // part it was not given since 4bd9bb2 (2026-08-08), and the meter's probe
  // terminals stayed in the nets after the meter was filtered out of the parts.
  // Measured before the fix on this exact bench: 5 engine parts before the
  // probes were wired, 0 after, netlistError 'Net "net_7" references unknown
  // part "meter_6"' — and the meter then read a fabricated 0 V off nothing.
  function ledBench() {
    const c = new Circuit(5.0);
    const vcc = c.addPart('vcc', {}, 0, 0);
    c.addPart('gnd', {}, 0, 0);
    const r = c.addPart('resistor', { ohms: 1000 }, 0, 0);
    const led = c.addPart('led', { vf: 2.0 }, 0, 0);
    const mcu = c.addPart('mcu', { pins: ['P1.0'] }, 0, 0);
    const meter = c.addPart('meter', { mode: 'voltage' }, 0, 0);
    c.addWire(vcc.id, 'vcc', r.id, 'a');
    c.addWire(r.id, 'b', led.id, 'anode');
    c.addWire(led.id, 'cathode', mcu.id, 'P1.0');
    c.setPin('P1.0', 'quasi', false);
    c.advanceTo(25n * MS);
    return { c, meter, vcc, r };
  }

  it('the board survives the probes, and the reading is not a fabricated zero', () => {
    const { c, meter, vcc, r } = ledBench();
    const before = c.board.parts.length;
    assert.equal(before, 5);
    c.addWire(meter.id, 'probe_a', vcc.id, 'vcc');
    c.addWire(meter.id, 'probe_b', r.id, 'b');
    assert.equal(c.netlistError, null, `netlist must stay valid: ${c.netlistError}`);
    assert.equal(c.board.parts.length, before + 1, 'the meter joins as its own resistor');
    const reading = getMeterReading(meter, c.wires, c);
    assert.notEqual(reading.value, '0');
    assert.ok(Number(reading.value) > 2.5, `≈2.9 V across the resistor, got ${reading.value}`);
  });

  it('a non-loading meter is stripped from the nets, not left dangling', () => {
    const { c, meter, vcc, r } = ledBench();
    meter.params.mode = 'resistance';
    c.addWire(meter.id, 'probe_a', vcc.id, 'vcc');
    c.addWire(meter.id, 'probe_b', r.id, 'b');
    assert.equal(c.netlistError, null, `netlist must stay valid: ${c.netlistError}`);
    for (const n of c.board.getNets()) {
      for (const t of n.terminals || []) {
        assert.notEqual(t.part, meter.id, 'no net may name a part the engine does not have');
      }
    }
  });
});

describe('D21: the impedance is a stated number', () => {
  it('defaults to 10 MΩ and refuses a nonsense override', () => {
    assert.equal(METER_INPUT_OHMS, 10e6);
    assert.equal(meterInputOhms({ params: {} }), 10e6);
    assert.equal(meterInputOhms({ params: { inputOhms: 1e6 } }), 1e6);
    assert.equal(meterInputOhms({ params: { inputOhms: 0 } }), 10e6, 'a 0 Ω voltmeter is a short');
    assert.equal(meterInputOhms({ params: { inputOhms: -5 } }), 10e6);
    assert.equal(meterInputOhms({ params: { inputOhms: 'nonsense' } }), 10e6);
  });

  it('a dangling reference is reported, not silently swallowed', () => {
    // The terminal is dropped so one bad reference cannot empty the board, but
    // dropping it QUIETLY would trade a loud bug for a quiet one — and a quiet
    // one is exactly what hid D21's second half.
    const nets = [{ id: 'n1', terminals: [{ part: 'ghost', terminal: 'a' }, { part: 'R1', terminal: 'b' }] }];
    const out = applyMeterLoads([], [{ id: 'R1', kind: 'resistor' }], nets);
    assert.deepEqual(out.dropped, ['ghost']);
    assert.equal(out.nets[0].terminals.length, 1);
    // A non-loading meter is EXPECTED to vanish from the nets and says nothing.
    const quiet = applyMeterLoads(
      [{ id: 'm1', kind: 'meter', params: { mode: 'resistance' } }],
      [{ id: 'R1', kind: 'resistor' }],
      [{ id: 'n1', terminals: [{ part: 'm1', terminal: 'probe_a' }, { part: 'R1', terminal: 'b' }] }]);
    assert.deepEqual(quiet.dropped, []);
  });

  it('applyMeterLoads renames the probes to the resistor terminals mna.js looks for', () => {
    const ui = [{ id: 'm1', kind: 'meter', params: { mode: 'voltage' } }];
    const nets = [
      { id: 'n1', terminals: [{ part: 'm1', terminal: 'probe_a' }, { part: 'R1', terminal: 'b' }] },
      { id: 'n2', terminals: [{ part: 'm1', terminal: 'probe_b' }, { part: 'G', terminal: 'gnd' }] },
    ];
    const out = applyMeterLoads(ui, [{ id: 'R1', kind: 'resistor' }, { id: 'G', kind: 'gnd' }], nets);
    assert.deepEqual(out.loaded, ['m1']);
    assert.equal(out.parts.at(-1).kind, 'resistor');
    assert.deepEqual(out.parts.at(-1).terminals, ['a', 'b']);
    assert.equal(out.parts.at(-1).params.ohms, 10e6);
    assert.equal(out.nets[0].terminals[0].terminal, 'a');
    assert.equal(out.nets[1].terminals[0].terminal, 'b');
  });
});
