/**
 * Tests for formatting utilities.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fmtOhms, fmtFarads, partLabel } from '../src/model/format.js';

describe('fmtOhms', () => {
  it('formats ohms', () => {
    assert.equal(fmtOhms(100), '100Ω');
    assert.equal(fmtOhms(1000), '1kΩ');
    assert.equal(fmtOhms(4700), '4.7kΩ');
    assert.equal(fmtOhms(10000), '10kΩ');
    assert.equal(fmtOhms(1000000), '1MΩ');
    assert.equal(fmtOhms(2200000), '2.2MΩ');
  });
});

describe('fmtFarads', () => {
  it('formats farads', () => {
    assert.equal(fmtFarads(0.001), '1.0mF');
    assert.equal(fmtFarads(0.0001), '100µF');
    assert.equal(fmtFarads(0.000001), '1µF');
    assert.equal(fmtFarads(0.0000001), '100nF');
    assert.equal(fmtFarads(0.000000001), '1nF');
    assert.equal(fmtFarads(0.000000000001), '1pF');
  });
});

describe('partLabel', () => {
  it('formats resistor', () => {
    assert.equal(partLabel({ id: 'resistor_3', kind: 'resistor', params: { ohms: 4700 } }), 'R3 4.7kΩ');
  });

  it('formats LED', () => {
    assert.equal(partLabel({ id: 'led_1', kind: 'led', params: { vf: 2 } }), 'LED1');
  });

  it('formats capacitor', () => {
    assert.equal(partLabel({ id: 'capacitor_2', kind: 'capacitor', params: { farads: 0.0001 } }), 'C2 100µF');
  });

  it('formats button', () => {
    assert.equal(partLabel({ id: 'button_5', kind: 'button', params: {} }), 'BTN5');
  });

  it('formats potentiometer', () => {
    assert.equal(partLabel({ id: 'potentiometer_1', kind: 'potentiometer', params: { ohms: 10000 } }), 'POT1 10kΩ');
  });

  it('falls back to id for unknown kinds', () => {
    assert.equal(partLabel({ id: 'foo_99', kind: 'vcc', params: {} }), 'foo_99');
  });
});
