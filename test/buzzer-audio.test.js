/**
 * Tests for buzzer audio integration.
 *
 * We can't test actual Web Audio in Node, but we can test that
 * the circuit produces the right buzzerTone values that would
 * drive the oscillator.
 */

import './_setup.js';
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Circuit, resetIds } from '../src/model/circuit.js';
import { setSharedAudioContext, updateBuzzerAudio, stopAllBuzzers } from '../src/audio/buzzer-audio.js';

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

// The speaker and earphone report `level` (0..1, amplitude proportional to
// coil current, 1 at rated power) alongside {hz, on}; the buzzer and piezo do
// not. The oscillator's gain follows `level` when it is present and stays at
// the fixed teaching-tool volume when it is absent. Driven through a fake
// AudioContext that records every gain the module sets.
describe('tone level scales the oscillator gain', () => {
  const made = [];
  const param = (value) => ({ value, targets: [], setTargetAtTime(v) { this.targets.push(v); this.value = v; } });
  const fakeCtx = {
    state: 'running',
    currentTime: 0,
    destination: {},
    resume() {},
    createOscillator() {
      return { type: 'sine', frequency: param(0), connect() {}, start() {}, stop() {}, disconnect() {} };
    },
    createGain() {
      const g = { gain: param(1), connect() {}, disconnect() {} };
      made.push(g);
      return g;
    },
  };
  setSharedAudioContext(fakeCtx);
  const gainOf = () => made[made.length - 1].gain.value;

  it('no level (buzzer/piezo): today\'s fixed gain', () => {
    updateBuzzerAudio('lvl-bz', { hz: 440, on: true });
    assert.equal(gainOf(), 0.05);
    updateBuzzerAudio('lvl-bz', { hz: 880, on: true });
    assert.equal(gainOf(), 0.05, 'an update without level leaves the gain alone');
    stopAllBuzzers();
  });

  it('level scales the gain, and follows it on update', () => {
    updateBuzzerAudio('lvl-spk', { hz: 1000, on: true, level: 0.5, amps: 0.1 });
    assert.equal(gainOf(), 0.025, 'half level, half the full gain');
    updateBuzzerAudio('lvl-spk', { hz: 1000, on: true, level: 1, amps: 0.25 });
    assert.equal(gainOf(), 0.05, 'level 1 is the full gain');
    updateBuzzerAudio('lvl-spk', { hz: 1000, on: true, level: 0.1, amps: 0.025 });
    assert.ok(Math.abs(gainOf() - 0.005) < 1e-12, 'a quieter coil current is quieter');
    stopAllBuzzers();
  });

  it('a noisy coil current plays white noise at its level, and back to a tone', () => {
    const sources = [];
    fakeCtx.sampleRate = 1000;
    fakeCtx.createBuffer = (ch, len) => { const data = new Float32Array(len); return { getChannelData: () => data, data }; };
    fakeCtx.createBufferSource = () => { const s = { loop: false, started: 0, stopped: 0, connect() {}, disconnect() {}, start() { s.started++; }, stop() { s.stopped++; } }; sources.push(s); return s; };
    updateBuzzerAudio('lvl-noise', { hz: 812, on: true, level: 0.5, noise: true });
    assert.equal(sources.length, 1, 'a buffer source, not an oscillator');
    assert.equal(sources[0].loop, true);
    assert.ok(sources[0].buffer.data.some(v => v !== 0), 'the buffer holds noise');
    assert.equal(gainOf(), 0.025, 'at the coil\'s level');
    updateBuzzerAudio('lvl-noise', { hz: 1530, on: true, level: 1, noise: true });
    assert.equal(sources.length, 1, 'still the same noise source');
    assert.equal(gainOf(), 0.05);
    updateBuzzerAudio('lvl-noise', { hz: 400, on: true, level: 1, noise: false });
    assert.equal(sources[0].stopped, 1, 'a regular tone replaces the noise');
    stopAllBuzzers();
    delete fakeCtx.createBuffer; delete fakeCtx.createBufferSource;
  });

  it('level is clamped to 0..1: an overdriven coil is not louder than full scale', () => {
    updateBuzzerAudio('lvl-hot', { hz: 500, on: true, level: 3 });
    assert.equal(gainOf(), 0.05);
    updateBuzzerAudio('lvl-hot', { hz: 500, on: true, level: -1 });
    assert.equal(gainOf(), 0);
    stopAllBuzzers();
  });
});
