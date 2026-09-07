// A seated part must not contradict the name its pin was declared under.
//
// Before this, buildSeatedFromDeclarations chose from the pin's DIRECTION alone
// and used the name only as a label, so `PIN ldr = P1.3 ANALOG` was drawn as a
// potentiometer. Measured across the sb3-creator corpus: 20 seated parts in 2
// examples contradicted their declared name, every one of them that same case.
import './_setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Circuit, resetIds } from '../src/model/circuit.js';
import { buildSeatedFromDeclarations } from '../src/model/infer-seated.js';
import { FOOTPRINTS } from '../src/model/footprints.js';
import { declaredPartKind, wirableKind } from '../src/model/declared-part-kind.js';

const kinds = Object.keys(FOOTPRINTS);
const build = pins => {
  resetIds();
  const c = new Circuit(5.0);
  buildSeatedFromDeclarations(c, { pins });
  return c;
};

test('a declared name asserts a kind only when it really names one', () => {
  assert.equal(declaredPartKind('ldr', kinds), 'ldr');
  assert.equal(declaredPartKind('buzzer', kinds), 'buzzer');
  assert.equal(declaredPartKind('speaker', kinds), 'buzzer', 'synonym');
  assert.equal(declaredPartKind('lightsense', kinds), 'ldr', 'synonym inside a longer name');
  // Asserting NOTHING is the important half: the direction default must stand.
  assert.equal(declaredPartKind('btn', kinds), null);
  assert.equal(declaredPartKind('sensor', kinds), null,
    'a bare "sensor" names no part — guessing one would invent a circuit');
  assert.equal(declaredPartKind('heater', kinds), null,
    'there is no heater footprint, so the default stands');
});

test('only kinds this path can honestly wire are wirable', () => {
  assert.equal(wirableKind('ldr', kinds, 'analog'), 'ldr');
  assert.equal(wirableKind('buzzer', kinds, 'output'), 'buzzer');
  // A motor or relay coil needs a transistor and a flyback diode. Synthesising
  // one here would be inventing electrical behaviour from a name, so the
  // default stands — wrongly, but visibly, and by decision.
  assert.equal(wirableKind('motor', kinds, 'output'), null);
  assert.equal(wirableKind('relay_ctrl', kinds, 'output'), null);
  assert.equal(wirableKind('servo', kinds, 'output'), null);
});

test('ANALOG named ldr seats an LDR divider, not a potentiometer', () => {
  const c = build([{ name: 'ldr', port: 1, bit: 3, direction: 'analog' }]);
  const ldr = c.parts.find(p => p.kind === 'ldr');
  assert.ok(ldr, 'an ldr part is seated');
  assert.ok(ldr.seat, 'and it is seated on the board, not floating');
  assert.equal(ldr.declName, 'ldr', 'it carries the declared name');
  assert.equal(c.parts.find(p => p.kind === 'potentiometer'), undefined,
    'the potentiometer the direction rule would have chosen is gone');
  // The divider needs its lower leg, or the junction floats.
  assert.ok(c.parts.some(p => p.kind === 'resistor'), 'a fixed lower leg is seated');
});

test('ANALOG named sensor still seats a potentiometer', () => {
  const c = build([{ name: 'sensor', port: 1, bit: 3, direction: 'analog' }]);
  assert.ok(c.parts.find(p => p.kind === 'potentiometer'),
    'a name that asserts nothing leaves the direction rule alone');
  assert.equal(c.parts.find(p => p.kind === 'ldr'), undefined);
});

test('OUTPUT named buzzer seats a buzzer, driven with no series resistor', () => {
  const c = build([{ name: 'buzzer', port: 1, bit: 0, direction: 'output' }]);
  const buz = c.parts.find(p => p.kind === 'buzzer');
  assert.ok(buz && buz.seat, 'a seated buzzer');
  assert.equal(c.parts.find(p => p.kind === 'led'), undefined, 'not an LED');
  assert.equal(c.parts.find(p => p.kind === 'resistor'), undefined,
    'a buzzer is not a diode and takes no current-limiting resistor');
});

test('OUTPUT named motor still seats the LED default, by decision', () => {
  const c = build([{ name: 'motor', port: 1, bit: 0, direction: 'output' }]);
  assert.ok(c.parts.find(p => p.kind === 'led'),
    'until this path can synthesise a driver, the default stands');
  assert.equal(c.parts.find(p => p.kind === 'dc_motor'), undefined,
    'and it does NOT draw a motor straight off a pin, which would teach a wrong circuit');
});

test('the existing direction rules are untouched for unnamed parts', () => {
  const c = build([
    { name: 'led1', port: 1, bit: 0, direction: 'output', activeLow: true },
    { name: 'btn', port: 3, bit: 2, direction: 'input' },
  ]);
  assert.ok(c.parts.find(p => p.kind === 'led'));
  assert.ok(c.parts.find(p => p.kind === 'button'));
});
