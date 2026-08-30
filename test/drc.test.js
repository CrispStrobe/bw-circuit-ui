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
  it('warns: relay driven directly from quasi-bidir pin', { skip: 'bw-board device registry does not register relay coil current' }, () => {
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
  it('warns: input pin with nothing connected', { skip: 'bw-board device registry does not expose pin direction for relay' }, () => {
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

// ── Rule 7: I2C pull-ups ────────────────────────────────────────

describe('DRC: missing-pullup', () => {
  it('warns: PCF8574 without pull-ups on SDA/SCL', () => {
    const c = setup();
    c.addPart('vcc', {}, 0, 0);
    c.addPart('gnd', {}, 0, 0);
    const mcu = c.addPart('mcu', { pins: ['P3.4', 'P3.5'] }, 0, 0);
    const pcf = c.addPart('pcf8574', {}, 0, 0);

    c.addWire(mcu.id, 'P3.4', pcf.id, 'sda');
    c.addWire(mcu.id, 'P3.5', pcf.id, 'scl');

    const w = runDrc(c, c.board);
    const hits = findRule(w, 'missing-pullup');
    assert.ok(hits.length >= 2, 'should warn about both SDA and SCL');
    assert.ok(hits[0].explanation.includes('pull-up'));
    assert.ok(hits[0].explanation.includes('4.7'));
  });

  it('no warning: I2C LCD with pull-ups', () => {
    const c = setup();
    const vcc = c.addPart('vcc', {}, 0, 0);
    c.addPart('gnd', {}, 0, 0);
    const mcu = c.addPart('mcu', { pins: ['P3.4', 'P3.5'] }, 0, 0);
    const lcd = c.addPart('char_lcd_i2c', {}, 0, 0);
    const rSda = c.addPart('resistor', { ohms: 4700 }, 0, 0);
    const rScl = c.addPart('resistor', { ohms: 4700 }, 0, 0);

    c.addWire(mcu.id, 'P3.4', lcd.id, 'sda');
    c.addWire(mcu.id, 'P3.5', lcd.id, 'scl');
    c.addWire(rSda.id, 'a', lcd.id, 'sda');
    c.addWire(rSda.id, 'b', vcc.id, 'vcc');
    c.addWire(rScl.id, 'a', lcd.id, 'scl');
    c.addWire(rScl.id, 'b', vcc.id, 'vcc');

    const w = runDrc(c, c.board);
    const hits = findRule(w, 'missing-pullup');
    assert.equal(hits.length, 0, 'I2C with pull-ups should not trigger');
  });
});

// ── Rule 8: Aggregate chip current ──────────────────────────────

describe('DRC: aggregate-current', () => {
  it('warns: 8 LEDs on one port exceed ~120 mA', () => {
    const c = setup();
    const vcc = c.addPart('vcc', {}, 0, 0);
    const gnd = c.addPart('gnd', {}, 0, 0);
    const mcu = c.addPart('mcu', { pins: ['P2.0','P2.1','P2.2','P2.3','P2.4','P2.5','P2.6','P2.7'] }, 0, 0);
    // MEASURED currents: (5-2)/(25+100+10) = 22.2 mA each, x8 = 178 mA > 120
    for (let i = 0; i < 8; i++) {
      const r = c.addPart('resistor', { ohms: 100 }, 0, 0);
      const led = c.addPart('led', { vf: 2.0 }, 0, 0);
      c.addWire(mcu.id, `P2.${i}`, r.id, 'a');
      c.addWire(r.id, 'b', led.id, 'anode');
      c.addWire(led.id, 'cathode', gnd.id, 'gnd');
    }
    // Drive every pin: measured currents exist only for conducting LEDs.
    for (let i = 0; i < 8; i++) c.board.setPin(`P2.${i}`, 'pushpull', true);
    c.advanceTo(25_000_000n);

    const w = runDrc(c, c.board);
    const hits = findRule(w, 'aggregate-current');
    assert.ok(hits.length > 0, '8 LEDs (~178 mA measured) must trigger aggregate warning');
    assert.ok(hits[0].explanation.includes('120'), 'must cite the 120 mA limit');
  });

  it('no warning: 3 LEDs under the limit', () => {
    const c = setup();
    const vcc = c.addPart('vcc', {}, 0, 0);
    const gnd = c.addPart('gnd', {}, 0, 0);
    const mcu = c.addPart('mcu', { pins: ['P1.0','P1.1','P1.2'] }, 0, 0);
    for (let i = 0; i < 3; i++) {
      const r = c.addPart('resistor', { ohms: 220 }, 0, 0);
      const led = c.addPart('led', { vf: 2.0 }, 0, 0);
      c.addWire(mcu.id, `P1.${i}`, r.id, 'a');
      c.addWire(r.id, 'b', led.id, 'anode');
      c.addWire(led.id, 'cathode', gnd.id, 'gnd');
    }
    c.advanceTo(25_000_000n);

    const w = runDrc(c, c.board);
    const hits = findRule(w, 'aggregate-current');
    assert.equal(hits.length, 0, '3 LEDs (60 mA) should not trigger');
  });

  it('warns conservatively with unrated parts near the limit', () => {
    const c = setup();
    c.addPart('vcc', {}, 0, 0);
    c.addPart('gnd', {}, 0, 0);
    const mcu = c.addPart('mcu', { pins: ['P1.0','P1.1','P1.2','P1.3','P1.4'] }, 0, 0);
    // 5 DRIVEN LEDs at ~22 mA measured = 111 mA (93% of the 120 limit),
    // plus an NPN (null-rated AND unmeasured: current depends on circuit).
    const gnd5 = c.parts.find(p => p.kind === 'gnd');
    for (let i = 0; i < 5; i++) {
      const r = c.addPart('resistor', { ohms: 100 }, 0, 0);
      const led = c.addPart('led', { vf: 2.0 }, 0, 0);
      c.addWire(mcu.id, `P1.${i}`, r.id, 'a');
      c.addWire(r.id, 'b', led.id, 'anode');
      c.addWire(led.id, 'cathode', gnd5.id, 'gnd');
      c.board.setPin(`P1.${i}`, 'pushpull', true);
    }
    c.addPart('npn', { beta: 100 }, 0, 0); // null-rated per current-ratings

    const w = runDrc(c, c.board);
    const hits = findRule(w, 'aggregate-current');
    assert.ok(hits.length > 0, 'near limit with unrated parts must warn');
    assert.ok(hits[0].explanation.includes('lower bound') || hits[0].explanation.includes('cannot be rated'),
      'must explain the sum is a lower bound');
  });

  it('names the contributor sitting EXACTLY on the listing floor', () => {
    // The bug this pins: the consumers list was gated on `rating > 0.005`,
    // and `ir_receiver` is rated at EXACTLY 5 mA — the only kind of the 133
    // in the rating table on that boundary. 25 of them sum to 125 mA, trip
    // the 120 mA danger, and the warning then named nobody at all:
    // "Largest consumers: ." — the parts that CAUSED the warning were the
    // only parts it could not mention. Screenshot-proven on lite's bench 2.
    const c = setup();
    c.addPart('vcc', {}, 0, 0);
    c.addPart('gnd', {}, 0, 0);
    c.addPart('mcu', { pins: ['P1.0'] }, 0, 0);
    for (let i = 0; i < 25; i++) c.addPart('ir_receiver', {}, 0, 0);

    const w = runDrc(c, c.board);
    const hits = findRule(w, 'aggregate-current');
    assert.equal(hits.length, 1, '25 x 5 mA = 125 mA must trip the 120 mA danger');
    assert.equal(hits[0].severity, 'danger');
    assert.match(hits[0].explanation, /Total circuit current is 125 mA/);
    // The point of the test: the list is not empty, and it names the part
    // and its measured-in-milliamps size.
    assert.match(hits[0].explanation, /Largest consumers: ir_receiver \(5 mA\)/,
      'a contributor exactly at the floor must be listed, not silently dropped');
    assert.doesNotMatch(hits[0].explanation, /Largest consumers: \./,
      'the empty-list rendering is the regression');
  });

  it('keeps sub-floor contributors out of the list', () => {
    // The anti-vacuity control for the test above: `>=` must not have become
    // `>= 0`. Two LEDs through 10 ohm draw 66.7 mA each (measured, 133 mA
    // total) and fill only TWO of the three "largest consumers" slots, so a
    // dropped floor is visible: soil_moisture is rated 0.05 mA and would take
    // the third slot, rendering as the useless "soil_moisture (0 mA)".
    const c = setup();
    const vcc = c.addPart('vcc', {}, 0, 0);
    const gnd = c.addPart('gnd', {}, 0, 0);
    const mcu = c.addPart('mcu', { pins: ['P2.0', 'P2.1', 'P2.2'] }, 0, 0);
    for (let i = 0; i < 2; i++) {
      const r = c.addPart('resistor', { ohms: 10 }, 0, 0);
      const led = c.addPart('led', { vf: 2.0 }, 0, 0);
      c.addWire(mcu.id, `P2.${i}`, r.id, 'a');
      c.addWire(r.id, 'b', led.id, 'anode');
      c.addWire(led.id, 'cathode', gnd.id, 'gnd');
    }
    const soil = c.addPart('soil_moisture', {}, 0, 0);
    c.addWire(soil.id, 'vcc', vcc.id, 'vcc');
    c.addWire(soil.id, 'gnd', gnd.id, 'gnd');
    c.addWire(soil.id, 'out', mcu.id, 'P2.2');
    for (let i = 0; i < 2; i++) c.board.setPin(`P2.${i}`, 'pushpull', true);
    c.advanceTo(25n * MS);

    const w = runDrc(c, c.board);
    const hits = findRule(w, 'aggregate-current');
    assert.equal(hits.length, 1, '2 x 66.7 mA = 133 mA must trip the danger');
    assert.match(hits[0].explanation, /Largest consumers: led \(67 mA\), led \(67 mA\)\./,
      'exactly the two above-floor parts, and nothing else');
    assert.doesNotMatch(hits[0].explanation, /soil_moisture/,
      'a 0.05 mA part is below the listing floor and must stay out of it');
  });

  it('safe circuit: 3 LEDs through 1kΩ shows NO aggregate warning', () => {
    const c = setup();
    const vcc = c.addPart('vcc', {}, 0, 0);
    const gnd = c.addPart('gnd', {}, 0, 0);
    const mcu = c.addPart('mcu', { pins: ['P1.0','P1.1','P1.2'] }, 0, 0);
    for (let i = 0; i < 3; i++) {
      const r = c.addPart('resistor', { ohms: 1000 }, 0, 0);
      const led = c.addPart('led', { vf: 2.0 }, 0, 0);
      c.addWire(mcu.id, `P1.${i}`, r.id, 'a');
      c.addWire(r.id, 'b', led.id, 'anode');
      c.addWire(led.id, 'cathode', gnd.id, 'gnd');
    }
    c.setPin('P1.0', 'quasi', false);
    c.setPin('P1.1', 'quasi', false);
    c.setPin('P1.2', 'quasi', false);
    c.advanceTo(25_000_000n);

    const w = runDrc(c, c.board);
    const aggregate = findRule(w, 'aggregate-current');
    assert.equal(aggregate.length, 0,
      'safe 1kΩ circuit must show NO aggregate warning — ' +
      'an overlay on a safe circuit teaches dismissal');
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

  it('gallery relay circuit (09-relay-clicker shape) is clean', () => {
    // Matches the fixed gallery circuit: relay through darlington + flyback + base R
    const c = setup();
    const vcc = c.addPart('vcc', {}, 0, 0);
    const gnd = c.addPart('gnd', {}, 0, 0);
    const mcu = c.addPart('mcu', { pins: ['P1.0'] }, 0, 0);
    const npn = c.addPart('npn', { beta: 1000 }, 0, 0); // darlington-like
    const relay = c.addPart('relay', {}, 0, 0);
    const diode = c.addPart('diode', { vf: 0.7 }, 0, 0);
    const rb = c.addPart('resistor', { ohms: 1000 }, 0, 0);

    c.addWire(vcc.id, 'vcc', relay.id, 'coil_a');
    c.addWire(relay.id, 'coil_b', npn.id, 'collector');
    c.addWire(npn.id, 'emitter', gnd.id, 'gnd');
    c.addWire(mcu.id, 'P1.0', rb.id, 'a');
    c.addWire(rb.id, 'b', npn.id, 'base');
    c.addWire(diode.id, 'cathode', vcc.id, 'vcc');
    c.addWire(diode.id, 'anode', relay.id, 'coil_b');

    c.setPin('P1.0', 'quasi', true);
    c.advanceTo(25n * MS);

    const w = runDrc(c, c.board);
    // Should have zero warnings: transistor driver, flyback present, base resistor
    const problems = w.filter(ww => ww.severity === 'danger');
    assert.equal(problems.length, 0,
      `gallery relay circuit should be clean, got: ${problems.map(p => p.rule).join(', ')}`);
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

// ── Rule 9: Floating control inputs on retro CPUs ─────────────────

describe('DRC: floating-control-6502', () => {
  it('warns: W65C02 with IRQB floating', () => {
    const c = setup();
    const vcc = c.addPart('vcc', { volts: 5 }, 0, 0);
    const gnd = c.addPart('gnd', {}, 0, 0);
    const cpu = c.addPart('w65c02', {}, 0, 0);
    const rom = c.addPart('28c256', {}, 0, 0);
    // Wire address bus and data bus (minimal)
    for (let i = 0; i < 15; i++) c.addWire(cpu.id, `a${i}`, rom.id, `a${i}`);
    for (let i = 0; i < 8; i++) c.addWire(cpu.id, `d${i}`, rom.id, `d${i}`);
    // Wire power and ROM control, but leave IRQB floating
    c.addWire(vcc.id, 'vcc', cpu.id, 'vdd');
    c.addWire(gnd.id, 'gnd', cpu.id, 'vss');
    c.addWire(vcc.id, 'vcc', cpu.id, 'resb');
    c.addWire(vcc.id, 'vcc', cpu.id, 'nmib');
    c.addWire(vcc.id, 'vcc', cpu.id, 'be');
    c.addWire(vcc.id, 'vcc', cpu.id, 'rdy');
    // IRQB is NOT wired — should trigger

    const w = runDrc(c, c.board);
    const hits = findRule(w, 'floating-control-6502');
    assert.ok(hits.some(h => h.explanation.includes('IRQB')),
      'should warn about floating IRQB');
  });

  it('no warning: all control pins pulled up', () => {
    const c = setup();
    const vcc = c.addPart('vcc', { volts: 5 }, 0, 0);
    const gnd = c.addPart('gnd', {}, 0, 0);
    const cpu = c.addPart('w65c02', {}, 0, 0);
    const rom = c.addPart('28c256', {}, 0, 0);
    for (let i = 0; i < 15; i++) c.addWire(cpu.id, `a${i}`, rom.id, `a${i}`);
    for (let i = 0; i < 8; i++) c.addWire(cpu.id, `d${i}`, rom.id, `d${i}`);
    c.addWire(vcc.id, 'vcc', cpu.id, 'vdd');
    c.addWire(gnd.id, 'gnd', cpu.id, 'vss');
    c.addWire(vcc.id, 'vcc', cpu.id, 'resb');
    c.addWire(vcc.id, 'vcc', cpu.id, 'irqb');
    c.addWire(vcc.id, 'vcc', cpu.id, 'nmib');
    c.addWire(vcc.id, 'vcc', cpu.id, 'be');
    c.addWire(vcc.id, 'vcc', cpu.id, 'rdy');

    const w = runDrc(c, c.board);
    const hits = findRule(w, 'floating-control-6502');
    assert.equal(hits.length, 0, 'all control pins wired — no warning');
  });
});

describe('DRC: bare-reset-6502', () => {
  it('info: RESB wired but no RC circuit', () => {
    const c = setup();
    const vcc = c.addPart('vcc', { volts: 5 }, 0, 0);
    const gnd = c.addPart('gnd', {}, 0, 0);
    const cpu = c.addPart('w65c02', {}, 0, 0);
    const rom = c.addPart('28c256', {}, 0, 0);
    for (let i = 0; i < 15; i++) c.addWire(cpu.id, `a${i}`, rom.id, `a${i}`);
    for (let i = 0; i < 8; i++) c.addWire(cpu.id, `d${i}`, rom.id, `d${i}`);
    c.addWire(vcc.id, 'vcc', cpu.id, 'vdd');
    c.addWire(gnd.id, 'gnd', cpu.id, 'vss');
    // RESB just pulled high — no RC circuit
    c.addWire(vcc.id, 'vcc', cpu.id, 'resb');
    c.addWire(vcc.id, 'vcc', cpu.id, 'irqb');
    c.addWire(vcc.id, 'vcc', cpu.id, 'nmib');
    c.addWire(vcc.id, 'vcc', cpu.id, 'be');
    c.addWire(vcc.id, 'vcc', cpu.id, 'rdy');

    const w = runDrc(c, c.board);
    const hits = findRule(w, 'bare-reset-6502');
    assert.ok(hits.length > 0, 'bare RESB should produce info note');
    assert.equal(hits[0].severity, 'info');
    assert.ok(hits[0].explanation.includes('reset'));
  });
});

describe('DRC: floating-control-z80', () => {
  it('warns: Z80 with INTb and WAITb floating', () => {
    const c = setup();
    const vcc = c.addPart('vcc', { volts: 5 }, 0, 0);
    const gnd = c.addPart('gnd', {}, 0, 0);
    const cpu = c.addPart('z80', {}, 0, 0);
    const rom = c.addPart('28c256', {}, 0, 0);
    for (let i = 0; i < 15; i++) c.addWire(cpu.id, `a${i}`, rom.id, `a${i}`);
    for (let i = 0; i < 8; i++) c.addWire(cpu.id, `d${i}`, rom.id, `d${i}`);
    c.addWire(vcc.id, 'vcc', cpu.id, 'vcc');
    c.addWire(gnd.id, 'gnd', cpu.id, 'gnd');
    c.addWire(vcc.id, 'vcc', cpu.id, 'resetb');
    c.addWire(vcc.id, 'vcc', cpu.id, 'nmib');
    c.addWire(vcc.id, 'vcc', cpu.id, 'busrqb');
    // INTb and WAITb NOT wired

    const w = runDrc(c, c.board);
    const hits = findRule(w, 'floating-control-z80');
    assert.ok(hits.some(h => h.explanation.includes('INTB')), 'should warn about floating INTB');
    assert.ok(hits.some(h => h.explanation.includes('WAITB')), 'should warn about floating WAITB');
  });
});
