/**
 * Design-rule check — falsifiable tests.
 *
 * Every rule has a circuit that TRIPS it and a circuit that MUST NOT.
 * A checker that warns on everything gets ignored; one that under-reports
 * is the silent-degradation bug wearing a hat.
 */

import './_setup.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Circuit, resetIds } from '../src/model/circuit.js';
import { runDrc } from '../src/model/drc.js';

const MS = 1_000_000n;

function setup() {
  resetIds();
  return new Circuit(5.0);
}

function findRule(warnings, rule) {
  return warnings.filter(w => w.rule === rule);
}

// ── Rule 1: Source-current violation ─────────────────────────────

describe('DRC: source-current', () => {
  it('warns: relay driven directly from quasi-bidir pin', () => {
    const c = setup();
    const vcc = c.addPart('vcc', {}, 0, 0);
    const gnd = c.addPart('gnd', {}, 0, 0);
    const mcu = c.addPart('mcu', { pins: ['P1.0'] }, 0, 0);
    const relay = c.addPart('relay', {}, 0, 0);

    c.addWire(mcu.id, 'P1.0', relay.id, 'coil_a');
    c.addWire(relay.id, 'coil_b', gnd.id, 'gnd');
    c.addWire(vcc.id, 'vcc', mcu.id, 'P1.0'); // VCC to MCU net

    c.setPin('P1.0', 'quasi', true); // source mode
    c.advanceTo(25n * MS);

    const w = runDrc(c, c.board);
    const hits = findRule(w, 'source-current');
    assert.ok(hits.length > 0, 'should warn about relay on quasi pin');
    assert.ok(hits[0].explanation.includes('230'), 'should cite the 230 µA limit');
    assert.ok(hits[0].fix, 'should offer a fix');
  });

  it('no warning: relay driven through NPN transistor', () => {
    const c = setup();
    const vcc = c.addPart('vcc', {}, 0, 0);
    const gnd = c.addPart('gnd', {}, 0, 0);
    const mcu = c.addPart('mcu', { pins: ['P1.0'] }, 0, 0);
    const npn = c.addPart('npn', { beta: 100 }, 0, 0);
    const relay = c.addPart('relay', {}, 0, 0);
    const r = c.addPart('resistor', { ohms: 1000 }, 0, 0);

    c.addWire(mcu.id, 'P1.0', r.id, 'a');
    c.addWire(r.id, 'b', npn.id, 'base');
    c.addWire(npn.id, 'collector', relay.id, 'coil_a');
    c.addWire(relay.id, 'coil_b', vcc.id, 'vcc');
    c.addWire(npn.id, 'emitter', gnd.id, 'gnd');

    c.setPin('P1.0', 'quasi', true);
    c.advanceTo(25n * MS);

    const w = runDrc(c, c.board);
    const hits = findRule(w, 'source-current');
    assert.equal(hits.length, 0, 'relay through transistor should not trigger');
  });
});

// ── Rule 2: Missing series resistor ─────────────────────────────

describe('DRC: missing-resistor', () => {
  it('warns: LED direct from VCC to GND', () => {
    const c = setup();
    const vcc = c.addPart('vcc', {}, 0, 0);
    const gnd = c.addPart('gnd', {}, 0, 0);
    const led = c.addPart('led', { vf: 2.0, color: 'red' }, 0, 0);

    c.addWire(vcc.id, 'vcc', led.id, 'anode');
    c.addWire(led.id, 'cathode', gnd.id, 'gnd');

    c.advanceTo(25n * MS);

    const w = runDrc(c, c.board);
    const hits = findRule(w, 'missing-resistor');
    assert.ok(hits.length > 0, 'should warn about missing resistor');
    assert.ok(hits[0].fixPart === 'resistor');
  });

  it('no warning: LED with series resistor', () => {
    const c = setup();
    const vcc = c.addPart('vcc', {}, 0, 0);
    const gnd = c.addPart('gnd', {}, 0, 0);
    const r = c.addPart('resistor', { ohms: 220 }, 0, 0);
    const led = c.addPart('led', { vf: 2.0, color: 'red' }, 0, 0);

    c.addWire(vcc.id, 'vcc', r.id, 'a');
    c.addWire(r.id, 'b', led.id, 'anode');
    c.addWire(led.id, 'cathode', gnd.id, 'gnd');

    c.advanceTo(25n * MS);

    const w = runDrc(c, c.board);
    const hits = findRule(w, 'missing-resistor');
    assert.equal(hits.length, 0, 'LED with resistor should not trigger');
  });
});

// ── Rule 3: Missing flyback diode ───────────────────────────────

describe('DRC: missing-flyback', () => {
  it('warns: relay without flyback diode', () => {
    const c = setup();
    const vcc = c.addPart('vcc', {}, 0, 0);
    const gnd = c.addPart('gnd', {}, 0, 0);
    const npn = c.addPart('npn', { beta: 100 }, 0, 0);
    const relay = c.addPart('relay', {}, 0, 0);

    c.addWire(npn.id, 'collector', relay.id, 'coil_a');
    c.addWire(relay.id, 'coil_b', vcc.id, 'vcc');
    c.addWire(npn.id, 'emitter', gnd.id, 'gnd');

    const w = runDrc(c, c.board);
    const hits = findRule(w, 'missing-flyback');
    assert.ok(hits.length > 0, 'should warn about missing flyback');
    assert.ok(hits[0].explanation.includes('back-EMF') || hits[0].explanation.includes('voltage spike'));
    assert.equal(hits[0].fixPart, 'diode');
  });

  it('no warning: relay with flyback diode', () => {
    const c = setup();
    const vcc = c.addPart('vcc', {}, 0, 0);
    const gnd = c.addPart('gnd', {}, 0, 0);
    const npn = c.addPart('npn', { beta: 100 }, 0, 0);
    const relay = c.addPart('relay', {}, 0, 0);
    const diode = c.addPart('diode', { vf: 0.7 }, 0, 0);

    c.addWire(npn.id, 'collector', relay.id, 'coil_a');
    c.addWire(relay.id, 'coil_b', vcc.id, 'vcc');
    c.addWire(npn.id, 'emitter', gnd.id, 'gnd');
    // Flyback diode across relay coil
    c.addWire(diode.id, 'cathode', relay.id, 'coil_b');
    c.addWire(diode.id, 'anode', relay.id, 'coil_a');

    const w = runDrc(c, c.board);
    const hits = findRule(w, 'missing-flyback');
    assert.equal(hits.length, 0, 'relay with flyback should not trigger');
  });
});

// ── Rule 4: Floating input ──────────────────────────────────────

describe('DRC: floating-input', () => {
  it('warns: input pin with nothing connected', () => {
    const c = setup();
    c.addPart('vcc', {}, 0, 0);
    c.addPart('gnd', {}, 0, 0);
    const mcu = c.addPart('mcu', { pins: ['P1.0'] }, 0, 0);

    c.setPin('P1.0', 'input', false);
    c.advanceTo(25n * MS);

    const w = runDrc(c, c.board);
    const hits = findRule(w, 'floating-input');
    assert.ok(hits.length > 0, 'should warn about floating input');
    assert.ok(hits[0].explanation.includes('floating') || hits[0].explanation.includes('noise'));
  });

  it('no warning: input pin with button connected', () => {
    const c = setup();
    c.addPart('vcc', {}, 0, 0);
    const gnd = c.addPart('gnd', {}, 0, 0);
    const mcu = c.addPart('mcu', { pins: ['P1.0'] }, 0, 0);
    const btn = c.addPart('button', {}, 0, 0);

    c.addWire(mcu.id, 'P1.0', btn.id, 'a');
    c.addWire(btn.id, 'b', gnd.id, 'gnd');

    c.setPin('P1.0', 'input', false);
    c.advanceTo(25n * MS);

    const w = runDrc(c, c.board);
    const hits = findRule(w, 'floating-input');
    assert.equal(hits.length, 0, 'input with button should not trigger');
  });
});

// ── Rule 5: Supply short ────────────────────────────────────────

describe('DRC: supply-short', () => {
  it('warns: VCC wired directly to GND', () => {
    const c = setup();
    const vcc = c.addPart('vcc', {}, 0, 0);
    const gnd = c.addPart('gnd', {}, 0, 0);

    c.addWire(vcc.id, 'vcc', gnd.id, 'gnd');

    const w = runDrc(c, c.board);
    const hits = findRule(w, 'supply-short');
    assert.ok(hits.length > 0, 'should warn about supply short');
  });

  it('no warning: VCC to GND through resistor', () => {
    const c = setup();
    const vcc = c.addPart('vcc', {}, 0, 0);
    const gnd = c.addPart('gnd', {}, 0, 0);
    const r = c.addPart('resistor', { ohms: 1000 }, 0, 0);

    c.addWire(vcc.id, 'vcc', r.id, 'a');
    c.addWire(r.id, 'b', gnd.id, 'gnd');

    const w = runDrc(c, c.board);
    const hits = findRule(w, 'supply-short');
    assert.equal(hits.length, 0, 'VCC through resistor to GND should not trigger');
  });
});

// ── Edge cases: must NOT over-warn ──────────────────────────────

describe('DRC: no false positives', () => {
  it('push-pull pin driving LED active-high does not trigger source-current', () => {
    const c = setup();
    const vcc = c.addPart('vcc', {}, 0, 0);
    const gnd = c.addPart('gnd', {}, 0, 0);
    const mcu = c.addPart('mcu', { pins: ['P1.0'] }, 0, 0);
    const r = c.addPart('resistor', { ohms: 220 }, 0, 0);
    const led = c.addPart('led', { vf: 2.0 }, 0, 0);

    c.addWire(mcu.id, 'P1.0', r.id, 'a');
    c.addWire(r.id, 'b', led.id, 'anode');
    c.addWire(led.id, 'cathode', gnd.id, 'gnd');

    c.setPin('P1.0', 'pushpull', true); // strong source: 20 mA
    c.advanceTo(25n * MS);

    const w = runDrc(c, c.board);
    const hits = findRule(w, 'source-current');
    assert.equal(hits.length, 0, 'push-pull can source 20 mA — no warning');
  });

  it('motor driven through MOSFET does not trigger missing-flyback for the FET', () => {
    const c = setup();
    const vcc = c.addPart('vcc', {}, 0, 0);
    const gnd = c.addPart('gnd', {}, 0, 0);
    const nmos = c.addPart('nmos', { vth: 2.0 }, 0, 0);
    const motor = c.addPart('dc_motor', {}, 0, 0);

    c.addWire(nmos.id, 'drain', motor.id, 'a');
    c.addWire(motor.id, 'b', vcc.id, 'vcc');
    c.addWire(nmos.id, 'source', gnd.id, 'gnd');

    const w = runDrc(c, c.board);
    // Should warn about missing flyback on the MOTOR, not on the MOSFET
    const hits = findRule(w, 'missing-flyback');
    assert.ok(hits.length > 0, 'motor without flyback should warn');
    assert.equal(hits[0].partId, motor.id, 'warning should be on the motor');
  });

  it('empty circuit produces no warnings', () => {
    const c = setup();
    const w = runDrc(c, c.board);
    assert.equal(w.length, 0);
  });
});

// ── Rule 6: Polarity ────────────────────────────────────────────

describe('DRC: polarity', () => {
  it('warns: polarized cap wired backward', () => {
    const c = setup();
    const vcc = c.addPart('vcc', {}, 0, 0);
    const gnd = c.addPart('gnd', {}, 0, 0);
    // Polarized cap with + terminal (a) to GND, - terminal (b) to VCC
    const cap = c.addPart('capacitor', { farads: 0.0001, polarized: true }, 0, 0);

    c.addWire(cap.id, 'a', gnd.id, 'gnd');  // + to GND (wrong)
    c.addWire(cap.id, 'b', vcc.id, 'vcc');  // - to VCC (wrong)

    c.advanceTo(25n * MS);

    const w = runDrc(c, c.board);
    const hits = findRule(w, 'polarity');
    assert.ok(hits.length > 0, 'should warn about backward cap');
  });

  it('no warning: polarized cap wired correctly', () => {
    const c = setup();
    const vcc = c.addPart('vcc', {}, 0, 0);
    const gnd = c.addPart('gnd', {}, 0, 0);
    const cap = c.addPart('capacitor', { farads: 0.0001, polarized: true }, 0, 0);

    c.addWire(cap.id, 'a', vcc.id, 'vcc');  // + to VCC (correct)
    c.addWire(cap.id, 'b', gnd.id, 'gnd');  // - to GND (correct)

    c.advanceTo(25n * MS);

    const w = runDrc(c, c.board);
    const hits = findRule(w, 'polarity');
    assert.equal(hits.length, 0, 'correctly wired cap should not trigger');
  });
});
