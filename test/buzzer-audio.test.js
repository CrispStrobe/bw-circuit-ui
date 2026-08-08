/**
 * Tests for buzzer audio integration.
 *
 * We can't test actual Web Audio in Node, but we can test that
 * the circuit produces the right buzzerTone values that would
 * drive the oscillator.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Circuit, resetIds } from '../src/model/circuit.js';

const MS = 1_000_000n;

beforeEach(() => resetIds());

describe('buzzer tone from engine', () => {
  function buildBuzzerCircuit() {
    const c = new Circuit(5.0);
    const buzzer = c.addPart('buzzer', {}, 0, 0);
    const mcu = c.addPart('mcu', { pins: ['P1.5'] }, 0, 0);
    const gnd = c.addPart('gnd', {}, 0, 0);

    c.addWire(buzzer.id, 'a', mcu.id, 'P1.5');
    c.addWire(buzzer.id, 'b', gnd.id, 'gnd');

    return { c, buzzer, mcu };
  }

  it('no toggling → buzzer off', () => {
    const { c, buzzer } = buildBuzzerCircuit();
    c.setPin('P1.5', 'pushpull', false);
    c.advanceTo(10n * MS);

    const tone = c.buzzerTone(buzzer.id);
    assert.equal(tone.on, false, 'buzzer should be off without toggling');
  });

  it('toggling at 500 Hz → buzzer on at ~500 Hz', () => {
    const { c, buzzer } = buildBuzzerCircuit();
    // Toggle every 1ms = 500 Hz
    for (let i = 0; i < 20; i++) {
      c.board.advanceTo(BigInt(i) * MS);
      c.board.setPin('P1.5', 'pushpull', i % 2 === 0);
    }

    const tone = c.buzzerTone(buzzer.id);
    assert.ok(tone.on, 'buzzer should be on');
    assert.ok(tone.hz > 400 && tone.hz < 600,
      `freq ${tone.hz} should be ~500 Hz`);
  });

  it('toggling at 1 kHz → buzzer on at ~1000 Hz', () => {
    const { c, buzzer } = buildBuzzerCircuit();
    const halfPeriod = 500_000n; // 0.5ms
    for (let i = 0; i < 20; i++) {
      c.board.advanceTo(BigInt(i) * halfPeriod);
      c.board.setPin('P1.5', 'pushpull', i % 2 === 0);
    }

    const tone = c.buzzerTone(buzzer.id);
    assert.ok(tone.on, 'buzzer should be on');
    assert.ok(tone.hz > 800 && tone.hz < 1200,
      `freq ${tone.hz} should be ~1000 Hz`);
  });

  it('different toggle rates → different frequencies', () => {
    const { c, buzzer } = buildBuzzerCircuit();
    // Toggle every 2ms = 250 Hz
    const halfPeriod = 2n * MS;
    for (let i = 0; i < 10; i++) {
      c.board.advanceTo(BigInt(i) * halfPeriod);
      c.board.setPin('P1.5', 'pushpull', i % 2 === 0);
    }

    const tone = c.buzzerTone(buzzer.id);
    assert.ok(tone.on, 'buzzer should be on');
    assert.ok(tone.hz > 200 && tone.hz < 300,
      `freq ${tone.hz} should be ~250 Hz`);
  });
});
