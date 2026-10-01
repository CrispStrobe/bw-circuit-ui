/**
 * A `spiceCard: 'X'` part the engine models as a plain DC resistance is now
 * EMITTED, with its number from bw-board's parts library.
 *
 * Why this exists: the exporter skipped every 'X' kind, so a buzzer bench went
 * to ngspice with its only load missing — the deck was a different circuit from
 * the one the solver ran, and it "agreed" because neither had anything to
 * disagree about. The engine's own buzzer resistance was in three homes inside
 * bw-board (the stamp, the extraction, and both node walkers) before
 * parts-library took it; a copy here would have been the fourth.
 *
 * What is deliberately NOT emitted matters as much. `dc_motor` and `relay` also
 * carry an `ohms` card and are still skipped, because one resistor is not the
 * whole device: the motor is a back-EMF source in series with its winding and
 * only looks resistive at omega = 0, and the relay's coil says nothing about
 * the contacts that ARE the circuit on a relay bench. Emitting either would
 * make ngspice agree with us about a simpler device than the solver runs, which
 * is worse than skipping it.
 */
import './_setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toSpice } from '../src/model/exporters/spice.js';
import { classDefaults } from 'bw-board/parts-library.js';

/** VCC → part → GND, so the part is the only load in the loop. */
const loadNetlist = (kind, params = {}) => ({
  parts: [
    { refdes: 'V1', kind: 'vcc', pins: ['vcc'], params: {} },
    { refdes: 'LS1', kind, pins: ['a', 'b'], params },
    { refdes: 'G1', kind: 'gnd', pins: ['gnd'], params: {} },
  ],
  nets: [
    { name: 'VCC', nodes: [{ refdes: 'V1', pin: 'vcc' }, { refdes: 'LS1', pin: 'a' }] },
    { name: 'GND', nodes: [{ refdes: 'LS1', pin: 'b' }, { refdes: 'G1', pin: 'gnd' }] },
  ],
});

const elementLines = deck => deck.split('\n').filter(l => /^[A-Z]+\w*\s+\S+\s+\S+/.test(l) && !l.startsWith('.'));

test('a buzzer is emitted as its card resistance, and the card is the only source of the number', () => {
  const card = classDefaults('buzzer');
  assert.equal(card.ohms, 100, 'the fixture assumes the shipped card; if this moved, the assertions below still derive from it');
  const { text, skipped } = toSpice(loadNetlist('buzzer'));
  // Scoped to the part under test: `vcc` and `gnd` are rail parts and are
  // legitimately in `skipped` — they become synthesized supplies, not elements.
  // The first version asserted the whole list was empty and failed on them,
  // which would have read as "the buzzer is still skipped" when it was not.
  assert.deepEqual(skipped.filter(l => l.includes('LS1')), [],
    `the buzzer must no longer be skipped:\n${text}`);
  assert.match(text, new RegExp(`^RLS1 \\S+ \\S+ ${card.ohms}$`, 'm'), text);
  // An explicit param still wins over the card — a user who typed it meant it.
  const { text: explicit } = toSpice(loadNetlist('buzzer', { ohms: 400 }));
  assert.match(explicit, /^RLS1 \S+ \S+ 400$/m, explicit);
  assert.doesNotMatch(explicit, /^RLS1 \S+ \S+ 100$/m);
});

test('the emitted value FOLLOWS the card rather than being copied here', () => {
  // The proof a golden deck cannot give: if this file held its own 100, the
  // deck would be right today and wrong the day the card moves. Drive it by
  // asking for the card's value and asserting the deck carries THAT, not a
  // literal — and separately that a different value really does change the deck.
  const card = classDefaults('buzzer');
  const { text } = toSpice(loadNetlist('buzzer'));
  const emitted = Number(text.match(/^RLS1 \S+ \S+ (\S+)$/m)[1]);
  assert.equal(emitted, Number(card.ohms), 'the deck does not carry the card\'s number');
  const { text: other } = toSpice(loadNetlist('buzzer', { ohms: Number(card.ohms) * 3 }));
  assert.notEqual(other.match(/^RLS1 \S+ \S+ (\S+)$/m)[1], String(card.ohms),
    'a changed resistance left the deck unchanged: the value is not being read');
});

test('dc_motor and relay stay SKIPPED although they carry an ohms card', () => {
  // The interesting negative. Both have a number this exporter could reach, and
  // reaching for it would be the defect: one resistor is not the device.
  for (const kind of ['dc_motor', 'relay']) {
    assert.ok(classDefaults(kind).ohms > 0, `${kind} does carry an ohms card, so this is a real restraint`);
    const { text, skipped } = toSpice(loadNetlist(kind));
    const mine = skipped.filter(l => l.includes('LS1'));
    assert.equal(mine.length, 1, `${kind} must be refused by name, not emitted:\n${text}`);
    assert.match(mine[0], /no SPICE model/);
    assert.doesNotMatch(text, /^R\S+ \S+ \S+ \d/m, `${kind} must not appear as a resistor`);
  }
});

test('every element line in a buzzer deck has both of its nodes', () => {
  // The failure this kills is the one that hid across the repos: an element
  // written with a missing node still parses, and ngspice simulates a DIFFERENT
  // circuit in silence.
  const { text } = toSpice(loadNetlist('buzzer'));
  const els = elementLines(text);
  assert.ok(els.length >= 1, `no element lines at all:\n${text}`);
  for (const l of els) {
    const fields = l.trim().split(/\s+/);
    assert.ok(fields.length >= 4, `element line is missing a field: ${l}`);
    assert.ok(!fields.includes('undefined'), `element line carries a literal "undefined": ${l}`);
  }
});
