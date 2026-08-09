// Tests for the cube scan accumulator.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CubeScanAccumulator } from '../src/model/cube-scan.js';

describe('CubeScanAccumulator', () => {
  it('accumulates pin state samples', () => {
    const acc = new CubeScanAccumulator();
    acc.sample(0n, [
      { pin: 'P2.0', mode: 'pushpull', driveHigh: false }, // select line 0 active (low)
      { pin: 'P0.3', mode: 'pushpull', driveHigh: true },  // data bit 3 high
    ]);
    const history = acc.getHistory();
    assert.equal(history.length, 1);
    // P2.0 low → select bit 0 is 0 → select = 0xFE
    assert.equal(history[0].select, 0xFE);
    assert.equal(history[0].data, 0x08); // bit 3
  });

  it('keeps only the 20ms window', () => {
    const acc = new CubeScanAccumulator();
    // Add frames spanning 30ms
    for (let i = 0; i < 30; i++) {
      acc.sample(BigInt(i) * 1_000_000n, []);
    }
    const history = acc.getHistory();
    // Should keep only frames from 10ms onwards (last 20ms)
    assert.ok(history.length <= 21, `should trim to ~20ms window, got ${history.length}`);
    assert.ok(history.length >= 19);
  });

  it('reset clears all history', () => {
    const acc = new CubeScanAccumulator();
    acc.sample(0n, []);
    acc.sample(1_000_000n, []);
    assert.equal(acc.getHistory().length, 2);
    acc.reset();
    assert.equal(acc.getHistory().length, 0);
  });

  it('correctly reads P2 select active-low pattern', () => {
    const acc = new CubeScanAccumulator();
    // Simulate the vendor firmware's FE FD FB F7 pattern
    const selects = [0xFE, 0xFD, 0xFB, 0xF7];
    for (let i = 0; i < selects.length; i++) {
      const pins = [];
      for (let bit = 0; bit < 8; bit++) {
        pins.push({
          pin: `P2.${bit}`,
          mode: 'pushpull',
          driveHigh: !!(selects[i] & (1 << bit)),
        });
      }
      pins.push({ pin: 'P0.0', mode: 'pushpull', driveHigh: true });
      acc.sample(BigInt(i) * 1_235_000n, pins);
    }
    const history = acc.getHistory();
    assert.equal(history.length, 4);
    assert.equal(history[0].select, 0xFE);
    assert.equal(history[1].select, 0xFD);
    assert.equal(history[2].select, 0xFB);
    assert.equal(history[3].select, 0xF7);
  });
});
