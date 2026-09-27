import './_setup.js';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { importLtspiceAsc } from '../src/importers/ltspice-asc.js';
import { Circuit } from '../src/model/circuit.js';
import { generateBom } from '../src/model/bom.js';

const asc = (library, value) => `Version 4
SHEET 1 800 600
SYMBOL ${library} 200 200 R0
SYMATTR InstName U1
SYMATTR Value ${value}
`;

test('exact LTspice names reach real native devices without inventing a package', () => {
  const cases = [
    ['OpAmps\\LT1001', 'LT1001', 'lt1001', {}, ['inp', 'inn', 'vpos', 'vneg', 'out']],
    ['OpAmps\\LT1001A', 'LT1001A', 'lt1001', {}, ['inp', 'inn', 'vpos', 'vneg', 'out']],
    ['PowerProducts\\ADP7118', 'ADP7118', 'adp7118', { adjustable: true },
      ['vin_7', 'sense_adj', 'en', 'ss', 'vout_1', 'gnd']],
    ['PowerProducts\\ADP7118-5.0', 'ADP7118-5.0', 'adp7118', { vOut: 5 },
      ['vin_7', 'sense_adj', 'en', 'ss', 'vout_1', 'gnd']],
    ['PowerProducts\\LT1763', 'LT1763', 'lt1763', { adjustable: true },
      ['out', 'sense_adj', 'gnd_3', 'byp', 'shdn', 'in']],
    ['PowerProducts\\LT1763-3.3', 'LT1763-3.3', 'lt1763', { vOut: 3.3 },
      ['out', 'sense_adj', 'gnd_3', 'byp', 'shdn', 'in']],
  ];
  for (const [library, value, kind, params, terminals] of cases) {
    const result = importLtspiceAsc(asc(library, value));
    assert.deepEqual(result.unmapped, [], library);
    assert.deepEqual(result.losses, [], library);
    assert.equal(result.parts[0].kind, kind);
    assert.deepEqual(result.parts[0].params, params);
    assert.deepEqual(result.parts[0].terminals, terminals);
    assert.equal(result.parts[0].sourcePackage, 'unspecified');
    assert.match(result.parts[0].sourceSymbolSha256, /^[0-9a-f]{64}$/);
    assert.equal(result.sourceDocument.electricalProjection.mappedInstances[0].mapping,
      `native-device:${kind}`);
    const circuit = Circuit.fromJSON({ parts: result.parts, wires: result.wires });
    assert.equal(circuit.netlistError, null, `${library} must reach the pinned native engine`);
    assert.equal(circuit.parts[0].sourcePackage, 'unspecified');
  }
});

test('verified fixed-output spellings bind exact outputs rather than parsing a suffix', () => {
  for (const [family, values] of [
    ['ADP7118', [['1.8', 1.8], ['2.5', 2.5], ['3.3', 3.3], ['4.5', 4.5], ['5.0', 5]]],
    ['LT1763', [['1.5', 1.5], ['1.8', 1.8], ['2.5', 2.5], ['3', 3], ['3.3', 3.3], ['5', 5]]],
  ]) {
    for (const [suffix, vOut] of values) {
      const value = `${family}-${suffix}`;
      const result = importLtspiceAsc(asc(`PowerProducts\\${value}`, value));
      assert.equal(result.parts[0]?.params.vOut, vOut, value);
      assert.deepEqual(result.unmapped, [], value);
    }
  }
});

test('SO-8 LT1001 and unknown or contradictory values remain refused by exact name', () => {
  for (const [library, value] of [
    ['OpAmps\\LT1001S8', 'LT1001S8'],
    ['OpAmps\\LT1001B', 'LT1001B'],
    ['PowerProducts\\ADP7118-2.85', 'ADP7118-2.85'],
  ]) {
    const result = importLtspiceAsc(asc(library, value));
    assert.equal(result.parts.length, 0, library);
    assert.equal(result.unmapped.length, 1, library);
  }
  const mismatched = importLtspiceAsc(asc('PowerProducts\\ADP7118-5.0', 'ADP7118-3.3'));
  assert.equal(mismatched.parts[0].params.vOut, undefined);
  assert.ok(mismatched.parts[0].analysisBlockers.some(blocker =>
    /must be exactly ADP7118-5.0/.test(blocker.reason)));
});

test('the non-contiguous LT1763 subcircuit pin order is executable', () => {
  const symbol = `Version 4
SymbolType CELL
SYMATTR Prefix X
${[
    [144, -64, 1], [144, 0, 2], [0, 112, 3], [144, 64, 4], [-144, 48, 5], [-144, -48, 8],
  ].map(([x, y, order]) => `PIN ${x} ${y} LEFT 8\nPINATTR PinName P${order}\nPINATTR SpiceOrder ${order}`).join('\n')}
`;
  const good = importLtspiceAsc(asc('PowerProducts\\LT1763-5', 'LT1763-5'), {
    symbols: new Map([['powerproducts/lt1763-5', symbol]]),
  });
  assert.deepEqual(good.unmapped, []);
  assert.deepEqual(good.sourceDocument.instances[0].pins.map(pin => pin.spiceOrder), [1, 2, 3, 4, 5, 8]);

  const bad = importLtspiceAsc(asc('PowerProducts\\LT1763-5', 'LT1763-5'), {
    symbols: new Map([['powerproducts/lt1763-5', symbol.replace('SpiceOrder 8', 'SpiceOrder 6')]]),
  });
  assert.match(bad.unmapped[0].libsource, /SpiceOrder must be exactly 1,2,3,4,5,8/);
});

test('rendering and BOM distinguish electrical identity from package authority', () => {
  const canvas = readFileSync(new URL('../src/components/BoardCanvas.jsx', import.meta.url), 'utf8');
  assert.match(canvas, /data-source-package="unspecified"/);
  assert.match(canvas, /PACKAGE UNSPECIFIED/);
  assert.match(canvas, /if \(part\.sourcePackage === 'unspecified'\)/);
  assert.match(canvas, /data-dip-body=\{kind\}/,
    'palette-created LT1001 still has its physical DIP face');
  assert.match(canvas, /data-soic-body=\{kind\}/,
    'palette-created regulators still have their physical SOIC face');

  const lines = generateBom([
    { id: 'imported', kind: 'lt1001', params: {}, sourcePackage: 'unspecified' },
    { id: 'physical', kind: 'lt1001', params: {} },
  ]);
  assert.equal(lines.length, 2);
  assert.match(lines.find(line => line.ids.includes('imported')).label, /package unspecified by source/);
  assert.doesNotMatch(lines.find(line => line.ids.includes('physical')).label, /unspecified/);
});
