import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { importKicadSch } from '../src/importers/kicad-sch.js';
import { mapKicadSymbol } from '../src/importers/kicad-common.js';
import { toKicadSch } from '../src/model/exporters/kicad-sch.js';

const base = toKicadSch({ parts: [{ id: 'V1', kind: 'vsource', params: { volts: 5 } }], wires: [] }).text
  .replaceAll('pspice:VSOURCE', 'Simulation_SPICE:VSOURCE');
const withValue = value => base.replace('(property "Value" "5"', `(property "Value" "${value}"`);

describe('KiCad SPICE voltage-source scalar values', () => {
  it('retains finite zero, negative and SI-suffixed values', () => {
    for (const [source, expected] of [['0', 0], ['-2.5', -2.5], ['1.2k', 1200], ['3m', 0.003]]) {
      const result = importKicadSch(withValue(source));
      assert.equal(result.unmapped.length, 0, source);
      assert.deepEqual(result.parts.find(part => part.id === 'V1')?.params, { volts: expected, _value: source });
    }
  });

  it('refuses missing, waveform, expression, trailing-unit and non-finite values', () => {
    for (const value of ['', 'SINE(0 1 1k)', '{supply}', '5V', '1e309']) {
      assert.equal(mapKicadSymbol('Simulation_SPICE:VSOURCE', value), null, value);
      const result = importKicadSch(withValue(value));
      assert.equal(result.parts.some(part => part.id === 'V1'), false, value);
      assert.equal(result.unmapped.some(part => part.ref === 'V1' && part.value === value), true, value);
    }
  });
});

describe('KiCad SPICE current-source scalar values', () => {
  const source = toKicadSch({ parts: [{ id: 'I1', kind: 'isource', params: { amps: 0.002 } }], wires: [] }).text;

  it('retains the native current polarity and static value', () => {
    const result = importKicadSch(source);
    assert.equal(result.unmapped.length, 0);
    assert.deepEqual(result.parts.find(part => part.id === 'I1')?.params,
      { amps: 0.002, _value: '0.002' });
    assert.deepEqual(mapKicadSymbol('pspice:ISOURCE', '2m').pins,
      { 1: 'neg', 2: 'pos', '+': 'neg', '-': 'pos' });
  });
});
