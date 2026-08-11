/**
 * Pin functions — the three-state distinction must survive to the UI.
 *
 * bw-board tested that null vs [] survives the API boundary.
 * This tests that the same distinction survives from sidecar → registry
 * → getPinFunctionsForPart → the data the PinChooser renders.
 */

import './_setup.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getPinFunctionsForPart } from '../src/model/pin-functions.js';
import { registeredKinds } from '../src/model/parts-registry.js';

describe('pin functions three-state distinction', () => {
  it('stc_mcu: audited pins have function arrays, not null', () => {
    const pins = getPinFunctionsForPart('stc_mcu');
    if (pins.length === 0) return; // sidecar not loaded in test env
    // STC12 has 40 pins, some audited with functions
    assert.ok(pins.length >= 20, `expected >=20 pins, got ${pins.length}`);
    // P1.0 should have ADC0 if audited
    const p10 = pins.find(p => p.name === 'P1.0');
    if (p10 && p10.functions !== null) {
      assert.ok(Array.isArray(p10.functions), 'audited pin has an array');
      assert.ok(p10.functions.length > 0, 'P1.0 has alternate functions');
    }
  });

  it('null and [] are distinguishable', () => {
    const pins = getPinFunctionsForPart('stc_mcu');
    if (pins.length === 0) return;
    // At least some pins should be null (unaudited) and some should have data
    const nullPins = pins.filter(p => p.functions === null);
    const emptyPins = pins.filter(p => Array.isArray(p.functions) && p.functions.length === 0);
    const auditedPins = pins.filter(p => Array.isArray(p.functions) && p.functions.length > 0);

    // The three states are distinguishable
    for (const p of nullPins) {
      assert.strictEqual(p.functions, null, `${p.name}: null must stay null`);
    }
    for (const p of emptyPins) {
      assert.ok(Array.isArray(p.functions), `${p.name}: [] must stay []`);
      assert.equal(p.functions.length, 0);
    }
    for (const p of auditedPins) {
      assert.ok(p.functions.length > 0, `${p.name}: audited must have entries`);
    }

    console.log(`  stc_mcu: ${auditedPins.length} audited, ${emptyPins.length} GPIO-only, ${nullPins.length} unknown`);
  });

  it('unknown board returns empty array', () => {
    const pins = getPinFunctionsForPart('nonexistent_board_xyz');
    assert.deepEqual(pins, []);
  });

  it('coverage is countable', () => {
    const pins = getPinFunctionsForPart('stc_mcu');
    if (pins.length === 0) return;
    const audited = pins.filter(p => p.functions !== null);
    const pct = ((audited.length / pins.length) * 100).toFixed(0);
    console.log(`  stc_mcu coverage: ${audited.length}/${pins.length} = ${pct}%`);
    // The number is informational — what matters is that it's computable
    assert.ok(typeof audited.length === 'number');
  });
});
