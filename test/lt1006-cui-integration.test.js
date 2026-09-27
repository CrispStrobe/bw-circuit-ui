import './_setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BoardImpl } from 'bw-board/board.js';
import { getDevice } from 'bw-board/devices.js';
import { registerAllDevices } from 'bw-board/register-all.js';
import { PART_SYMBOLS } from '../src/data/easyeda-symbols.js';
import { mapEasyEdaPart } from '../src/importers/easyeda.js';
import { mapKicadSymbol, terminalFor } from '../src/importers/kicad-common.js';
import { importLtspiceAsc } from '../src/importers/ltspice-asc.js';
import { getSidecar } from '../src/model/parts-registry.js';
import { Circuit } from '../src/model/circuit.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => readFileSync(join(root, rel), 'utf8');
const physicalTerminals = ['offset_1', 'inn', 'inp', 'vneg', 'offset_5', 'out', 'vpos', 'iset'];
const electricalTerminals = ['inp', 'inn', 'vpos', 'vneg', 'out'];
const partsSha = 'a58bc844d1b3f295e3f41bac2b1062d48728b812';
const symbolShas = new Map([
  ['LT1006', '2964d9e9ced195230ed5aa7a4bb1d11ddfcc4beb4d5ce76c4f021459b68466ae'],
  ['LT1006A', 'a49fb0bd6e33731241e2333c066ec82c16231955fbd5982dcae2d82a569a9468'],
  ['LT1006S8', 'd1fcbe8a7d56d3dd358b49829ec1850f3a5530d2bd2ce5c1f1b83cc6559e67ba'],
]);

registerAllDevices();

test('the vendored LT1006 is the exact S8 SOIC sibling part', () => {
  const sidecar = getSidecar('lt1006');
  assert.ok(sidecar, 'generated parts-data index exposes LT1006 to every bundler');
  assert.deepEqual(sidecar.terminals.map(t => t.name), physicalTerminals);
  assert.equal(sidecar.footprint, undefined, 'surface-mount S8 claims no breadboard seating');
  assert.match(sidecar._note, /Pin 8 is the supply-current-set input, not NC/);
  assert.equal(JSON.parse(read('.github/ci-siblings.json'))['bw-parts'].sha, partsSha);
  assert.match(read('src/parts-data/lt1006.svg'), />LT1006</);
});

test('palette, canvas, BOM and export metadata name only the physical S8 part', () => {
  assert.match(read('src/components/PartPalette.jsx'), /kind: 'lt1006', label: 'LT1006'/);
  assert.match(read('src/components/BoardCanvas.jsx'), /lt1006:\s*'LT1006'/);
  assert.match(read('src/model/bom.js'), /lt1006: 'LT1006 Precision Single-Supply Operational Amplifier'/);
  const interaction = read('scripts/verify-interaction.mjs');
  assert.match(interaction, /\[data-part-face="lt1006"\]\[data-soic-body="lt1006"\]/);
  assert.match(interaction, /lt1006Dots\.length === 8/);
  assert.equal(PART_SYMBOLS.lt1006.kicadSymbol, undefined,
    'no reviewed official KiCad LT1006 symbol is claimed');
  assert.equal(PART_SYMBOLS.lt1006.kicadFootprint, 'Package_SO:SOIC-8_3.9x4.9mm_P1.27mm');
});

test('EasyEDA and custom KiCad exact S8 names retain all eight physical pins', () => {
  const expected = Object.fromEntries(physicalTerminals.map((name, i) => [String(i + 1), name]));
  const easy = mapEasyEdaPart({
    descriptor: 'LT1006S8', value: 'LT1006S8', spicePre: 'U', pinCount: 8, package: 'SOIC-8',
  });
  assert.equal(easy.kind, 'lt1006');
  assert.deepEqual(easy.pins, expected);
  const kicad = mapKicadSymbol('MyAmplifiers:LT1006S8', 'LT1006S8');
  assert.equal(kicad.kind, 'lt1006');
  assert.deepEqual(kicad.terminals, physicalTerminals);
  for (let pin = 1; pin <= 8; pin++) {
    assert.equal(terminalFor(kicad, String(pin), '~'), physicalTerminals[pin - 1]);
  }
  assert.notEqual(mapKicadSymbol('MyAmplifiers:LT1006CN8', 'LT1006CN8')?.kind, 'lt1006',
    'the N8 PDIP must not silently acquire the S8 SOIC face');
});

const asc = name => `Version 4
SHEET 1 800 600
SYMBOL OpAmps\\${name} 200 200 R0
SYMATTR InstName U1
`;

test('the three audited LTspice symbols retain package and proprietary-model truth', () => {
  for (const name of symbolShas.keys()) {
    const result = importLtspiceAsc(asc(name));
    assert.deepEqual(result.unmapped, [], name);
    assert.equal(result.losses.length, 1, name);
    assert.equal(result.losses[0].kind, 'source-model-substitution', name);
    assert.match(result.losses[0].source, /SpiceModel LTC\.lib.*Value2 LT1006/, name);
    assert.match(result.losses[0].reason, /native lt1006 behavioural card.*is not that source subcircuit/, name);
    const part = result.parts[0];
    assert.equal(part.kind, 'lt1006', name);
    assert.equal(part.verifiedBuiltinSymbolSha256, symbolShas.get(name), name);
    assert.equal(part.sourceModelFile, 'LTC.lib', name);
    assert.equal(part.sourceSubcircuit, 'LT1006', name);
    assert.equal(part.analysisBlockers.length, 1, name);
    assert.equal(result.sourceDocument.instances[0].pins.length, 5, name);
    if (name === 'LT1006S8') {
      assert.equal(part.sourcePackage, 'SOIC-8');
      assert.deepEqual(part.terminals, physicalTerminals);
    } else {
      assert.equal(part.sourcePackage, 'unspecified');
      assert.deepEqual(part.terminals, electricalTerminals);
    }
    const restored = Circuit.fromJSON({ parts: result.parts, wires: result.wires });
    assert.equal(restored.analysisBlockers.length, 1, name);
    assert.throws(() => restored.operatingPoint(), /blocked by 1 persisted import finding/, name);
  }
});

function follower({ input = 1, offset = 80e-6 } = {}) {
  const board = new BoardImpl(5);
  board.setNetlist([
    { id: 'VS', kind: 'vsource', params: { volts: 5 }, terminals: ['pos', 'neg'] },
    { id: 'VIN', kind: 'vsource', params: { volts: input }, terminals: ['pos', 'neg'] },
    { id: 'G', kind: 'gnd', params: {}, terminals: ['gnd'] },
    { id: 'U1', kind: 'lt1006', params: { inputOffsetV: offset }, terminals: physicalTerminals },
    { id: 'RL', kind: 'resistor', params: { ohms: 10000 }, terminals: ['a', 'b'] },
  ], [
    { id: 'gnd', terminals: [
      { part: 'G', terminal: 'gnd' }, { part: 'VS', terminal: 'neg' },
      { part: 'VIN', terminal: 'neg' }, { part: 'U1', terminal: 'vneg' },
      { part: 'RL', terminal: 'b' },
    ] },
    { id: 'vpos', terminals: [{ part: 'VS', terminal: 'pos' }, { part: 'U1', terminal: 'vpos' }] },
    { id: 'input', terminals: [{ part: 'VIN', terminal: 'pos' }, { part: 'U1', terminal: 'inp' }] },
    { id: 'output', terminals: [
      { part: 'U1', terminal: 'out' }, { part: 'U1', terminal: 'inn' }, { part: 'RL', terminal: 'a' },
    ] },
  ]);
  return board;
}

test('the exact pinned engine solves the ground-sensing LT1006 card', () => {
  assert.ok(getDevice('lt1006'), 'the pinned engine registers the named real part');
  const precision = follower();
  precision.advanceTo(80_000n);
  assert.ok(Math.abs(precision.nodeVoltage('output') - 1.00008) < 5e-6,
    `precision follower output was ${precision.nodeVoltage('output')} V`);

  const ground = follower({ input: 0, offset: 0 });
  ground.advanceTo(40_000n);
  assert.ok(ground.nodeVoltage('output') > 0.014 && ground.nodeVoltage('output') < 0.016,
    `ground-referred output was ${ground.nodeVoltage('output')} V`);
});
