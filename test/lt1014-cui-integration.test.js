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
import { importLtspiceAsc } from '../src/importers/ltspice-asc.js';
import { getSidecar } from '../src/model/parts-registry.js';
import { Circuit } from '../src/model/circuit.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => readFileSync(join(root, rel), 'utf8');
const physicalTerminals = [
  '1_out', '1_neg', '1_pos', 'vpos', '2_pos', '2_neg', '2_out',
  '3_out', '3_neg', '3_pos', 'vneg', '4_pos', '4_neg', '4_out',
];
const channelTerminals = ['inp', 'inn', 'vpos', 'vneg', 'out'];
const partsSha = 'e5e263c05d86f9b79022224f289b32e754d66951';
const symbolShas = new Map([
  ['LT1014', 'b7233d9b52d2876b34faa47772a90b139e2f794bba50f45ab1ef8aa9bacb7b4c'],
  ['LT1014A', '9fe778053a144464b0aab03fbd4f8580491bc5322d217fc6d9418fa11b59e9d1'],
  ['LT1014D', '38c6b8ef0d2da63719b9ed6f82fd702cb2a212f23261f3be6bc5383a6508fcd0'],
]);

registerAllDevices();

test('the vendored LT1014 is the exact physical PDIP-14 sibling part', () => {
  const sidecar = getSidecar('lt1014');
  assert.ok(sidecar, 'generated parts-data index exposes LT1014');
  assert.deepEqual(sidecar.terminals.map(t => t.name), physicalTerminals);
  assert.equal(sidecar.footprint.minCols, 7);
  assert.match(sidecar._note, /N 14-pin PDIP top view/);
  assert.equal(JSON.parse(read('.github/ci-siblings.json'))['bw-parts'].sha, partsSha);
  assert.match(read('src/parts-data/lt1014.svg'), />LT1014</);
});

test('palette, canvas, BOM and browser name one physical quad package', () => {
  assert.match(read('src/components/PartPalette.jsx'), /kind: 'lt1014', label: 'LT1014'/);
  assert.match(read('src/components/BoardCanvas.jsx'), /lt1014:\s*'LT1014'/);
  assert.match(read('src/model/bom.js'), /lt1014: 'LT1014 Quad Precision Operational Amplifier'/);
  const interaction = read('scripts/verify-interaction.mjs');
  assert.match(interaction, /\[data-part-face="lt1014"\]\[data-dip-body="lt1014"\]/);
  assert.match(interaction, /lt1014Dots\.length === 14/);
  assert.equal(PART_SYMBOLS.lt1014.kicadSymbol, undefined,
    'the single-record KiCad importer must not claim a multi-unit LT1014 symbol');
  assert.equal(PART_SYMBOLS.lt1014.kicadFootprint, 'Package_DIP:DIP-14_W7.62mm');
});

test('exact EasyEDA N-package names retain all fourteen physical pins', () => {
  const expected = Object.fromEntries(physicalTerminals.map((name, i) => [String(i + 1), name]));
  for (const name of ['LT1014CN', 'LT1014AIN', 'LT1014DMN']) {
    const mapped = mapEasyEdaPart({
      descriptor: name, value: name, spicePre: 'U', pinCount: 14, package: 'PDIP-14',
    });
    assert.equal(mapped.kind, 'lt1014', name);
    assert.deepEqual(mapped.pins, expected, name);
  }
});

const asc = name => `Version 4
SHEET 1 800 600
SYMBOL OpAmps\\${name} 200 200 R0
SYMATTR InstName U1
`;

test('official LTspice symbols remain logical channels with LT1013 substitution blockers', () => {
  for (const [name, sha] of symbolShas) {
    const result = importLtspiceAsc(asc(name));
    assert.deepEqual(result.unmapped, [], name);
    assert.equal(result.losses.length, 1, name);
    assert.equal(result.losses[0].kind, 'source-model-substitution', name);
    assert.match(result.losses[0].source, /SpiceModel LT1013\.sub.*Value2 LT1013/, name);
    assert.match(result.losses[0].reason, /native lt1014_channel behavioural card/, name);
    const part = result.parts[0];
    assert.equal(part.kind, 'lt1014_channel', name);
    assert.equal(part.sourcePackage, 'unspecified', name);
    assert.deepEqual(part.terminals, channelTerminals, name);
    assert.equal(part.verifiedBuiltinSymbolSha256, sha, name);
    assert.equal(part.sourceModelFile, 'LT1013.sub', name);
    assert.equal(part.sourceSubcircuit, 'LT1013', name);
    assert.equal(result.sourceDocument.instances[0].pins.length, 5, name);
    const restored = Circuit.fromJSON({ parts: result.parts, wires: result.wires });
    assert.equal(restored.analysisBlockers.length, 1, name);
    assert.throws(() => restored.operatingPoint(), /blocked by 1 persisted import finding/, name);
  }
});

test('the exact pinned engine keeps the package and logical-channel contracts distinct', () => {
  assert.deepEqual(getDevice('lt1014').terminals, physicalTerminals);
  assert.deepEqual(getDevice('lt1014_channel').terminals, channelTerminals);
  const board = new BoardImpl(5);
  board.setNetlist([
    { id: 'VS', kind: 'vsource', params: { volts: 5 }, terminals: ['pos', 'neg'] },
    { id: 'VIN', kind: 'vsource', params: { volts: 1 }, terminals: ['pos', 'neg'] },
    { id: 'G', kind: 'gnd', params: {}, terminals: ['gnd'] },
    { id: 'U1', kind: 'lt1014', params: { inputOffsetV: 0 }, terminals: physicalTerminals },
    { id: 'RL', kind: 'resistor', params: { ohms: 10000 }, terminals: ['a', 'b'] },
  ], [
    { id: 'gnd', terminals: [
      { part: 'G', terminal: 'gnd' }, { part: 'VS', terminal: 'neg' },
      { part: 'VIN', terminal: 'neg' }, { part: 'U1', terminal: 'vneg' },
      { part: 'RL', terminal: 'b' },
    ] },
    { id: 'vpos', terminals: [{ part: 'VS', terminal: 'pos' }, { part: 'U1', terminal: 'vpos' }] },
    { id: 'input', terminals: [{ part: 'VIN', terminal: 'pos' }, { part: 'U1', terminal: '1_pos' }] },
    { id: 'output', terminals: [
      { part: 'U1', terminal: '1_out' }, { part: 'U1', terminal: '1_neg' }, { part: 'RL', terminal: 'a' },
    ] },
  ]);
  board.advanceTo(80_000n);
  assert.ok(Math.abs(board.nodeVoltage('output') - 1) < 0.0001,
    `physical channel follower output was ${board.nodeVoltage('output')} V`);
});
