/**
 * The VCC symbol must print the rail it actually delivers.
 *
 * It printed `params.volts ?? 5`, so on a 3.3 V board every supply cap read
 * "+5V" — a number nothing in the circuit had, sitting next to node voltages
 * the solver had computed from 3.3. The engine resolves the rail as
 * knob > params.volts > board default (bw-board ebf77e9e); the label has to
 * agree with at least the last two, since it is drawn where the argument
 * about what is delivered happens.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { effectiveRailVolts } from '../src/model/format.js';

describe('the VCC cap label', () => {
  it('prints the board rail when the symbol authors none', () => {
    assert.equal(effectiveRailVolts({ kind: 'vcc', params: {} }, 3.3), 3.3);
    assert.equal(effectiveRailVolts({ kind: 'vcc', params: {} }, 9), 9);
    assert.equal(effectiveRailVolts({ kind: 'vcc' }, 5), 5);
  });

  it('prefers the rail the symbol authors', () => {
    // The 3.3 V rail beside a 5 V board is the case params.volts exists for.
    assert.equal(effectiveRailVolts({ kind: 'vcc', params: { volts: 3.3 } }, 5), 3.3);
    assert.equal(effectiveRailVolts({ kind: 'vcc', params: { volts: 12 } }, 5), 12);
  });

  it('never invents 5 V for a board that runs on something else', () => {
    // The specific defect: a hardcoded fallback that outranked the truth.
    for (const board of [1.8, 3.3, 9, 12]) {
      assert.notEqual(effectiveRailVolts({ kind: 'vcc', params: {} }, board), 5);
    }
  });

  it('ignores a nonsense authored value rather than printing it', () => {
    for (const bad of [null, undefined, NaN, Infinity, 'nine']) {
      assert.equal(effectiveRailVolts({ kind: 'vcc', params: { volts: bad } }, 5), 5);
    }
  });
});

/**
 * The editor must OFFER the voltage field, not just render one that exists.
 * Mirrors InlineEditor's rule so the behaviour is asserted without importing
 * JSX; the component builds its list from the same merge.
 */
describe('which params the inline editor offers', () => {
  const IMPLICIT = { vcc: { volts: 5 } };
  const offered = (part, supplyVolts = 5) => {
    const implicit = part.kind === 'vcc' ? { volts: supplyVolts } : (IMPLICIT[part.kind] || {});
    return Object.entries({ ...implicit, ...(part.params || {}) })
      .filter(([k]) => k !== 'pins')
      .map(([k]) => k);
  };

  it('offers volts on a VCC symbol that authors none', () => {
    // Every generated bench writes `params: {}` here, so without this the
    // field never appeared and the rail could not be changed from the app.
    assert.deepEqual(offered({ kind: 'vcc', params: {} }), ['volts']);
  });

  it('seeds it with what the supply actually delivers', () => {
    const part = { kind: 'vcc', params: {} };
    const implicit = { volts: 3.3 };
    const merged = { ...implicit, ...(part.params || {}) };
    assert.equal(merged.volts, 3.3, 'opening the editor must not silently retune the rail');
  });

  it('lets an authored value win over the seed', () => {
    const merged = { ...{ volts: 5 }, ...{ volts: 9 } };
    assert.equal(merged.volts, 9);
  });

  it('adds nothing to a part that is not a supply', () => {
    assert.deepEqual(offered({ kind: 'resistor', params: { ohms: 220 } }), ['ohms']);
    assert.deepEqual(offered({ kind: 'gnd', params: {} }), []);
  });
});
