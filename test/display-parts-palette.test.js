/**
 * Verify bargraph and simplevga_card are placeable circuit parts
 * with terminal lists that match the engine model exactly.
 */

import './_setup.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { terminalsForKind } from '../src/model/circuit.js';

describe('display parts — terminal parity', () => {
  it('bargraph terminals match the engine model (20 pins: a0-a9, k0-k9)', () => {
    const terms = terminalsForKind('bargraph', {});
    // Engine registers: a0,k0,a1,k1,...,a9,k9 — 20 terminals
    assert.equal(terms.length, 20, `expected 20, got ${terms.length}`);

    // Must have all 10 anodes and 10 cathodes
    for (let i = 0; i < 10; i++) {
      assert.ok(terms.includes(`a${i}`), `missing anode a${i}`);
      assert.ok(terms.includes(`k${i}`), `missing cathode k${i}`);
    }
  });

  it('simplevga_card terminals match its sidecar (3 pins: vcc, gnd, bus)', () => {
    const terms = terminalsForKind('simplevga_card', {});
    assert.equal(terms.length, 3, `expected 3, got ${terms.length}`);
    assert.ok(terms.includes('vcc'), 'has vcc');
    assert.ok(terms.includes('gnd'), 'has gnd');
    assert.ok(terms.includes('bus'), 'has bus');
  });

  it('bargraph sidecar terminals match engine terminals exactly', () => {
    // The sidecar-first path in terminalsForKind should return exactly
    // what the engine's registerDevice('bargraph') declares
    const engineTerminals = new Set([
      'a0', 'k0', 'a1', 'k1', 'a2', 'k2', 'a3', 'k3', 'a4', 'k4',
      'a5', 'k5', 'a6', 'k6', 'a7', 'k7', 'a8', 'k8', 'a9', 'k9',
    ]);
    const sidecarTerminals = new Set(terminalsForKind('bargraph', {}));
    // Sets must be identical
    const onlyEngine = [...engineTerminals].filter(t => !sidecarTerminals.has(t));
    const onlySidecar = [...sidecarTerminals].filter(t => !engineTerminals.has(t));
    assert.deepEqual(onlyEngine, [], `engine-only terminals: ${onlyEngine}`);
    assert.deepEqual(onlySidecar, [], `sidecar-only terminals: ${onlySidecar}`);
  });
});
