/**
 * Tests for BOM (Bill of Materials) generation.
 */

import './_setup.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateBom, bomToCsv } from '../src/model/bom.js';

describe('generateBom', () => {
  it('groups identical parts', () => {
    const parts = [
      { id: 'r1', kind: 'resistor', params: { ohms: 1000 } },
      { id: 'r2', kind: 'resistor', params: { ohms: 1000 } },
      { id: 'r3', kind: 'resistor', params: { ohms: 4700 } },
      { id: 'led1', kind: 'led', params: { vf: 2.0, color: 'red' } },
    ];
    const bom = generateBom(parts);
    assert.equal(bom.length, 3);
    const r1k = bom.find(b => b.kind === 'resistor' && b.qty === 2);
    assert.ok(r1k, 'two 1kΩ resistors grouped');
    assert.deepEqual(r1k.ids, ['r1', 'r2']);
  });

  it('excludes VCC, GND, meter, breadboard', () => {
    const parts = [
      { id: 'v1', kind: 'vcc', params: {} },
      { id: 'g1', kind: 'gnd', params: {} },
      { id: 'm1', kind: 'meter', params: { mode: 'voltage' } },
      { id: 'bb1', kind: 'breadboard', params: {} },
      { id: 'r1', kind: 'resistor', params: { ohms: 1000 } },
    ];
    const bom = generateBom(parts);
    assert.equal(bom.length, 1);
    assert.equal(bom[0].kind, 'resistor');
  });

  it('returns empty for empty circuit', () => {
    assert.deepEqual(generateBom([]), []);
  });

  it('labels include formatted values', () => {
    const parts = [
      { id: 'r1', kind: 'resistor', params: { ohms: 4700 } },
    ];
    const bom = generateBom(parts);
    assert.ok(bom[0].label.includes('4.7'), `label should contain 4.7: ${bom[0].label}`);
  });
});

describe('bomToCsv', () => {
  it('produces valid CSV', () => {
    const bom = generateBom([
      { id: 'r1', kind: 'resistor', params: { ohms: 1000 } },
      { id: 'led1', kind: 'led', params: { vf: 2.0, color: 'red' } },
    ]);
    const csv = bomToCsv(bom);
    assert.ok(csv.startsWith('Qty,Part,Value'));
    const lines = csv.split('\n');
    assert.equal(lines.length, 3); // header + 2 parts
  });
});
