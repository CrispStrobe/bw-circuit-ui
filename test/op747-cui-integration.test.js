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
  '1_neg', '1_pos', 'vpos', '2_pos', '2_neg', '2_out', '4_out',
  '4_neg', '4_pos', 'vneg', '3_pos', '3_neg', '3_out', '1_out',
];
const channelTerminals = ['inp', 'inn', 'vpos', 'vneg', 'out'];
const partsSha = 'a3750229c2b77369bc70fe62487b119ef1860419';
const symbolSha = 'bb7e907e13d16c3c72452f4527fbf4f8abdfea25e9745478b0319dab13ae1db4';

registerAllDevices();

test('the vendored OP747 is the exact physical R-14 SOIC sibling part', () => {
  const sidecar = getSidecar('op747');
  assert.ok(sidecar, 'generated parts-data index exposes OP747');
  assert.deepEqual(sidecar.terminals.map(t => t.name), physicalTerminals);
  assert.equal(sidecar.footprint, undefined, 'surface-mount part must not claim direct breadboard seating');
  assert.match(sidecar._note, /R-14 narrow 14-lead SOIC top view/);
  assert.equal(JSON.parse(read('.github/ci-siblings.json'))['bw-parts'].sha, partsSha);
  assert.match(read('src/parts-data/op747.svg'), />OP747</);
});

test('palette, canvas, BOM and browser name one physical quad package', () => {
  assert.match(read('src/components/PartPalette.jsx'), /kind: 'op747', label: 'OP747'/);
  assert.match(read('src/components/BoardCanvas.jsx'), /op747:\s*'OP747'/);
  assert.match(read('src/model/bom.js'), /op747: 'OP747 Quad Precision Operational Amplifier'/);
  const interaction = read('scripts/verify-interaction.mjs');
  assert.match(interaction, /\[data-part-face="op747"\]\[data-soic-body="op747"\]/);
  assert.match(interaction, /op747Dots\.length === 14/);
  assert.equal(PART_SYMBOLS.op747.kicadSymbol, undefined,
    'the single-record KiCad importer must not claim a multi-unit OP747 symbol');
  assert.equal(PART_SYMBOLS.op747.kicadFootprint, 'Package_SO:SOIC-14_3.9x8.7mm_P1.27mm');
});

test('exact EasyEDA R-package names retain the nonstandard fourteen-pin order', () => {
  const expected = Object.fromEntries(physicalTerminals.map((name, i) => [String(i + 1), name]));
  for (const name of ['OP747ARZ', 'OP747ARZ-REEL', 'OP747ARZ-REEL7']) {
    const mapped = mapEasyEdaPart({ descriptor: name, value: name, spicePre: 'U', pinCount: 14, package: 'SOIC-14' });
    assert.equal(mapped.kind, 'op747', name);
    assert.deepEqual(mapped.pins, expected, name);
  }
});

const asc = `Version 4
SHEET 1 800 600
SYMBOL OpAmps\\OP747 200 200 R0
SYMATTR InstName U1
`;

test('the official LTspice symbol remains a logical channel with its ADI model blocker', () => {
  const result = importLtspiceAsc(asc);
  assert.deepEqual(result.unmapped, []);
  assert.equal(result.losses.length, 1);
  assert.equal(result.losses[0].kind, 'source-model-substitution');
  assert.match(result.losses[0].source, /SpiceModel ADI\.lib.*Value2 OP747/);
  assert.match(result.losses[0].reason, /native op747_channel behavioural card/);
  const part = result.parts[0];
  assert.equal(part.kind, 'op747_channel');
  assert.equal(part.sourcePackage, 'unspecified');
  assert.deepEqual(part.terminals, channelTerminals);
  assert.equal(part.verifiedBuiltinSymbolSha256, symbolSha);
  assert.equal(part.sourceModelFile, 'ADI.lib');
  assert.equal(part.sourceSubcircuit, 'OP747');
  assert.equal(result.sourceDocument.instances[0].pins.length, 5);
  const restored = Circuit.fromJSON({ parts: result.parts, wires: result.wires });
  assert.equal(restored.analysisBlockers.length, 1);
  assert.throws(() => restored.operatingPoint(), /blocked by 1 persisted import finding/);
});

test('the exact pinned engine keeps the physical quad and logical channel distinct', () => {
  assert.deepEqual(getDevice('op747').terminals, physicalTerminals);
  assert.deepEqual(getDevice('op747_channel').terminals, channelTerminals);
  const board = new BoardImpl(5);
  const parts = [
    { id: 'VP', kind: 'vsource', params: { volts: 15 }, terminals: ['pos', 'neg'] },
    { id: 'VN', kind: 'vsource', params: { volts: 15 }, terminals: ['pos', 'neg'] },
    { id: 'G', kind: 'gnd', params: {}, terminals: ['gnd'] },
    { id: 'U1', kind: 'op747', params: { inputOffsetV: 0 }, terminals: physicalTerminals },
  ];
  const nets = [
    { id: 'gnd', terminals: [{ part: 'G', terminal: 'gnd' }, { part: 'VP', terminal: 'neg' }, { part: 'VN', terminal: 'pos' }] },
    { id: 'vpos', terminals: [{ part: 'VP', terminal: 'pos' }, { part: 'U1', terminal: 'vpos' }] },
    { id: 'vneg', terminals: [{ part: 'VN', terminal: 'neg' }, { part: 'U1', terminal: 'vneg' }] },
  ];
  for (const [channel, volts] of [[1, -3], [2, -1], [3, 2], [4, 4]]) {
    const source = `V${channel}`;
    parts.push({ id: source, kind: 'vsource', params: { volts }, terminals: ['pos', 'neg'] });
    nets[0].terminals.push({ part: source, terminal: 'neg' });
    nets.push({ id: `in${channel}`, terminals: [{ part: source, terminal: 'pos' }, { part: 'U1', terminal: `${channel}_pos` }] });
    nets.push({ id: `out${channel}`, terminals: [{ part: 'U1', terminal: `${channel}_out` }, { part: 'U1', terminal: `${channel}_neg` }] });
  }
  board.setNetlist(parts, nets);
  board.advanceTo(500_000n);
  for (const [channel, volts] of [[1, -3], [2, -1], [3, 2], [4, 4]]) {
    assert.ok(Math.abs(board.nodeVoltage(`out${channel}`) - volts) < 0.001,
      `channel ${channel} was ${board.nodeVoltage(`out${channel}`)} V`);
  }
});
