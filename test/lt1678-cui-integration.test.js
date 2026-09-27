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
import { carrierOptionsForPart } from '../src/model/carriers.js';
import { Circuit } from '../src/model/circuit.js';
import { getLandPattern } from '../src/model/land-patterns.js';
import { getSidecar } from '../src/model/parts-registry.js';
import { physicalPackageBindingsForPart } from '../src/model/physical-package-bindings.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => readFileSync(join(root, rel), 'utf8');
const physicalTerminals = ['1_out', '1_neg', '1_pos', 'vneg', '2_pos', '2_neg', '2_out', 'vpos'];
const channelTerminals = ['inp', 'inn', 'vpos', 'vneg', 'out'];
const partsSha = 'e5e263c05d86f9b79022224f289b32e754d66951';
const symbolSha = '39e7e1f66b240267730061812d4b9b95c299bc0fa613a6e824b37777b79144bf';

registerAllDevices();

test('the vendored LT1678 is the exact physical SOIC-8 dual', () => {
  const sidecar = getSidecar('lt1678');
  assert.ok(sidecar, 'generated parts-data index exposes LT1678');
  assert.deepEqual(sidecar.terminals.map(t => t.name), physicalTerminals);
  assert.equal(sidecar.footprint, undefined, 'bare SOIC must not claim direct breadboard seating');
  assert.match(sidecar._note, /five-terminal LT1678 symbol represents one logical amplifier channel/);
  assert.equal(JSON.parse(read('.github/ci-siblings.json'))['bw-parts'].sha, partsSha);
  assert.match(read('src/parts-data/lt1678.svg'), />LT1678</);
  assert.deepEqual(getLandPattern('lt1678', 'soic-8').pads.map(pad => pad.terminal), physicalTerminals);
  assert.deepEqual(carrierOptionsForPart({ kind: 'lt1678' }).map(option => option.id), ['soic8-dip8']);
});

test('palette, canvas, BOM and schematic metadata name one physical dual package', () => {
  assert.match(read('src/components/PartPalette.jsx'), /kind: 'lt1678', label: 'LT1678'/);
  assert.match(read('src/components/BoardCanvas.jsx'), /lt1678:\s*'LT1678'/);
  assert.match(read('src/model/bom.js'), /lt1678: 'LT1678 Dual Low-Noise Precision Operational Amplifier'/);
  assert.match(read('scripts/verify-interaction.mjs'), /\[data-part-face="lt1678"\]\[data-soic-body="lt1678"\]/);
  assert.match(read('scripts/verify-interaction.mjs'), /lt1678Dots\.length === 8/);
  assert.equal(PART_SYMBOLS.lt1678.kicadSymbol, undefined,
    'the single-record KiCad importer must not claim a multi-unit LT1678 symbol');
  assert.equal(PART_SYMBOLS.lt1678.kicadFootprint, 'Package_SO:SOIC-8_3.9x4.9mm_P1.27mm');
});

test('only reviewed production SOIC order codes acquire the physical package', () => {
  const expected = Object.fromEntries(physicalTerminals.map((name, i) => [String(i + 1), name]));
  for (const name of ['LT1678CS8#PBF', 'LT1678CS8#TRPBF', 'LT1678IS8#PBF', 'LT1678IS8#TRPBF']) {
    const mapped = mapEasyEdaPart({ descriptor: name, value: name, spicePre: 'U', pinCount: 8, package: 'SOIC-8' });
    assert.equal(mapped.kind, 'lt1678', name);
    assert.deepEqual(mapped.pins, expected, name);
  }
  assert.equal(mapEasyEdaPart({ descriptor: 'LT1678', value: 'LT1678', spicePre: 'U', pinCount: 5 }), null);
});

const asc = `Version 4
SHEET 1 800 600
SYMBOL OpAmps\\LT1678 200 200 R0
SYMATTR InstName U1
`;

test('the official LTspice symbol remains one logical channel with its exact model blocker', () => {
  const result = importLtspiceAsc(asc);
  assert.deepEqual(result.unmapped, []);
  assert.equal(result.losses.length, 1);
  assert.match(result.losses[0].source, /SpiceModel LTC2\.lib.*Value2 LT1678/);
  assert.match(result.losses[0].reason, /native lt1678_channel behavioural card/);
  const part = result.parts[0];
  assert.equal(part.kind, 'lt1678_channel');
  assert.equal(part.sourcePackage, 'unspecified');
  assert.deepEqual(part.terminals, ['inp', 'inn', 'out', 'vpos', 'vneg']);
  assert.equal(part.verifiedBuiltinSymbolSha256, symbolSha);
  assert.equal(part.sourceModelFile, 'LTC2.lib');
  assert.equal(part.sourceSubcircuit, 'LT1678');
  assert.deepEqual(result.sourceDocument.instances[0].pins.map(pin => [pin.spiceOrder, pin.pinName, pin.x, pin.y]), [
    [1, 'inp', -32, 16], [2, 'inn', -32, -16], [3, 'out', 32, 0],
    [4, 'vpos', 0, -32], [5, 'vneg', 0, 32],
  ]);
  const restored = Circuit.fromJSON({ parts: result.parts, wires: result.wires });
  assert.equal(restored.analysisBlockers.length, 1);
  assert.throws(() => restored.operatingPoint(), /blocked by 1 persisted import finding/);
  assert.deepEqual(physicalPackageBindingsForPart(part), [],
    'a single source channel cannot choose channel 1 or 2 of an entire dual package');
  assert.equal(restored.bindPhysicalPackage(part.id, 'lt1678-cs8-pbf'), false);
});

test('the exact pinned engine keeps both shared-rail channels independent', () => {
  assert.deepEqual(getDevice('lt1678').terminals, physicalTerminals);
  assert.deepEqual(getDevice('lt1678_channel').terminals, channelTerminals);
  const board = new BoardImpl(5);
  board.setNetlist([
    { id: 'VP', kind: 'vsource', params: { volts: 15 }, terminals: ['pos', 'neg'] },
    { id: 'VN', kind: 'vsource', params: { volts: 15 }, terminals: ['pos', 'neg'] },
    { id: 'V1', kind: 'vsource', params: { volts: -2 }, terminals: ['pos', 'neg'] },
    { id: 'V2', kind: 'vsource', params: { volts: 3 }, terminals: ['pos', 'neg'] },
    { id: 'G', kind: 'gnd', params: {}, terminals: ['gnd'] },
    { id: 'RL1', kind: 'resistor', params: { ohms: 10000 }, terminals: ['a', 'b'] },
    { id: 'RL2', kind: 'resistor', params: { ohms: 10000 }, terminals: ['a', 'b'] },
    { id: 'U1', kind: 'lt1678', params: { inputOffsetV: 0 }, terminals: physicalTerminals },
  ], [
    { id: 'gnd', terminals: [{ part: 'G', terminal: 'gnd' }, { part: 'VP', terminal: 'neg' }, { part: 'VN', terminal: 'pos' }, { part: 'V1', terminal: 'neg' }, { part: 'V2', terminal: 'neg' }, { part: 'RL1', terminal: 'b' }, { part: 'RL2', terminal: 'b' }] },
    { id: 'vpos', terminals: [{ part: 'VP', terminal: 'pos' }, { part: 'U1', terminal: 'vpos' }] },
    { id: 'vneg', terminals: [{ part: 'VN', terminal: 'neg' }, { part: 'U1', terminal: 'vneg' }] },
    { id: 'in1', terminals: [{ part: 'V1', terminal: 'pos' }, { part: 'U1', terminal: '1_pos' }] },
    { id: 'out1', terminals: [{ part: 'U1', terminal: '1_out' }, { part: 'U1', terminal: '1_neg' }, { part: 'RL1', terminal: 'a' }] },
    { id: 'in2', terminals: [{ part: 'V2', terminal: 'pos' }, { part: 'U1', terminal: '2_pos' }] },
    { id: 'out2', terminals: [{ part: 'U1', terminal: '2_out' }, { part: 'U1', terminal: '2_neg' }, { part: 'RL2', terminal: 'a' }] },
  ]);
  board.advanceTo(20_000n);
  assert.ok(Math.abs(board.nodeVoltage('out1') + 2) < 0.001, `channel 1 was ${board.nodeVoltage('out1')} V`);
  assert.ok(Math.abs(board.nodeVoltage('out2') - 3) < 0.001, `channel 2 was ${board.nodeVoltage('out2')} V`);
});
