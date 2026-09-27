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
const physicalTerminals = ['offset_1', 'inn', 'inp', 'vneg', 'nc', 'out', 'vpos', 'offset_8'];
const channelTerminals = ['inp', 'inn', 'vpos', 'vneg', 'out'];
const partsSha = '897eee90699d8d01cfabca294f7d5d6703bb01fb';
const symbols = [
  ['LT1007', '27cc3c47f6f99673d395c5cba0238868c898935424ca84194b0a81f976702b55', 'unspecified'],
  ['LT1007A', '6b83e0cd0122fbccc0747de0718c100aa1a5d8fb84613121ffc68111649ec2f9', 'unspecified'],
  ['LT1007CS', '2df754764366610988df336094580ae523b1b8b10ed4f82bdc84baa25d0aaabf', 'SOIC-8'],
];

registerAllDevices();

test('the vendored LT1007 is exactly the production N8 PDIP sibling part', () => {
  const sidecar = getSidecar('lt1007');
  assert.ok(sidecar, 'generated parts-data index exposes LT1007');
  assert.deepEqual(sidecar.terminals.map(t => t.name), physicalTerminals);
  assert.deepEqual(sidecar.footprint.leads.nc, { dRow: 5, dCol: 3 });
  assert.deepEqual(sidecar.footprint.leads.offset_8, { dRow: 5, dCol: 0 });
  assert.equal(JSON.parse(read('.github/ci-siblings.json'))['bw-parts'].sha, partsSha);
  assert.match(read('src/parts-data/lt1007.svg'), />LT1007</);
  assert.match(sidecar._note, /S8 packages must not borrow this face/);
});

test('palette, canvas, schematic, BOM and browser name the physical N8 part', () => {
  assert.match(read('src/components/PartPalette.jsx'), /kind: 'lt1007', label: 'LT1007'/);
  assert.match(read('src/components/BoardCanvas.jsx'), /lt1007:\s*'LT1007'/);
  assert.match(read('src/model/bom.js'), /lt1007: 'LT1007 Low-Noise Precision Operational Amplifier'/);
  assert.match(read('src/components/BoardCanvas.jsx'), /sourcePackage === 'unspecified' \|\| kind === 'lt1007_channel'/,
    'the five-terminal CS source symbol must not fall through to an N8 or ghost face');
  const interaction = read('scripts/verify-interaction.mjs');
  assert.match(interaction, /\[data-part-face="lt1007"\]\[data-dip-body="lt1007"\]/);
  assert.match(interaction, /lt1007Dots\.length === 8/);
  assert.equal(PART_SYMBOLS.lt1007.kicadSymbol, undefined,
    'no reviewed official KiCad LT1007 symbol is claimed');
  assert.equal(PART_SYMBOLS.lt1007.kicadFootprint, 'Package_DIP:DIP-8_W7.62mm');
});

test('only exact production N8 order codes acquire the eight-pin breadboard face', () => {
  const expected = Object.fromEntries(physicalTerminals.map((name, i) => [String(i + 1), name]));
  for (const name of ['LT1007ACN8#PBF', 'LT1007CN8#PBF', 'LT1007IN8#PBF']) {
    const easy = mapEasyEdaPart({ descriptor: name, value: name, spicePre: 'U', pinCount: 8, package: 'DIP-8' });
    assert.equal(easy.kind, 'lt1007', name);
    assert.deepEqual(easy.pins, expected, name);
    const kicad = mapKicadSymbol(`MyAmplifiers:${name}`, name);
    assert.equal(kicad.kind, 'lt1007', name);
    for (let pin = 1; pin <= 8; pin++) {
      assert.equal(terminalFor(kicad, String(pin), '~'), physicalTerminals[pin - 1], `${name} pin ${pin}`);
    }
  }
  assert.notEqual(mapEasyEdaPart({ descriptor: 'LT1007CS8', value: 'LT1007', pinCount: 8 })?.kind, 'lt1007');
  assert.notEqual(mapKicadSymbol('MyAmplifiers:LT1007CS8', 'LT1007CS8')?.kind, 'lt1007');
});

test('official LTspice variants stay logical channels with exact provenance and blocker', () => {
  for (const [name, sha, sourcePackage] of symbols) {
    const asc = `Version 4\nSHEET 1 800 600\nSYMBOL OpAmps\\${name} 200 200 R0\nSYMATTR InstName U1\n`;
    const result = importLtspiceAsc(asc);
    assert.deepEqual(result.unmapped, [], name);
    assert.equal(result.losses.length, 1, name);
    assert.equal(result.losses[0].kind, 'source-model-substitution', name);
    assert.match(result.losses[0].source, /SpiceModel LTC\.lib.*Value2 LT1007/, name);
    assert.match(result.losses[0].reason, /native lt1007_channel behavioural card/, name);
    const part = result.parts[0];
    assert.equal(part.kind, 'lt1007_channel', name);
    assert.deepEqual(part.terminals, channelTerminals, name);
    assert.equal(part.sourcePackage, sourcePackage, name);
    assert.equal(part.verifiedBuiltinSymbolSha256, sha, name);
    assert.equal(part.sourceLibrary, `opamps/${name.toLowerCase()}`, name);
    assert.equal(part.sourceModelFile, 'LTC.lib', name);
    assert.equal(part.sourceSubcircuit, 'LT1007', name);
    assert.equal(part.analysisBlockers.length, 1, name);
    assert.equal(result.sourceDocument.electricalProjection.mappedInstances[0].numericStatus,
      'blocked-model-or-instance-semantics', name);
    const restored = Circuit.fromJSON({ parts: result.parts, wires: result.wires });
    assert.equal(restored.analysisBlockers.length, 1, name);
    assert.throws(() => restored.operatingPoint(), /blocked by 1 persisted import finding/, name);
  }
});

function follower({ input = 1, feedback = true, offset = 10e-6 } = {}) {
  const board = new BoardImpl(5);
  const ground = [
    { part: 'G', terminal: 'gnd' }, { part: 'VP', terminal: 'neg' },
    { part: 'VN', terminal: 'pos' }, { part: 'VIN', terminal: 'neg' },
    { part: 'RL', terminal: 'b' },
  ];
  if (!feedback) ground.push({ part: 'U1', terminal: 'inn' });
  board.setNetlist([
    { id: 'VP', kind: 'vsource', params: { volts: 15 }, terminals: ['pos', 'neg'] },
    { id: 'VN', kind: 'vsource', params: { volts: 15 }, terminals: ['pos', 'neg'] },
    { id: 'VIN', kind: 'vsource', params: { volts: input }, terminals: ['pos', 'neg'] },
    { id: 'G', kind: 'gnd', params: {}, terminals: ['gnd'] },
    { id: 'U1', kind: 'lt1007', params: { inputOffsetV: offset }, terminals: physicalTerminals },
    { id: 'RL', kind: 'resistor', params: { ohms: 100000 }, terminals: ['a', 'b'] },
  ], [
    { id: 'gnd', terminals: ground },
    { id: 'vpos', terminals: [{ part: 'VP', terminal: 'pos' }, { part: 'U1', terminal: 'vpos' }] },
    { id: 'vneg', terminals: [{ part: 'VN', terminal: 'neg' }, { part: 'U1', terminal: 'vneg' }] },
    { id: 'input', terminals: [{ part: 'VIN', terminal: 'pos' }, { part: 'U1', terminal: 'inp' }] },
    { id: 'output', terminals: [
      { part: 'U1', terminal: 'out' }, { part: 'RL', terminal: 'a' },
      ...(feedback ? [{ part: 'U1', terminal: 'inn' }] : []),
    ] },
  ]);
  return board;
}

test('the exact pinned engine keeps physical/package-neutral identities and LT1007 dynamics', () => {
  assert.deepEqual(getDevice('lt1007').terminals, physicalTerminals);
  assert.deepEqual(getDevice('lt1007_channel').terminals, channelTerminals);
  const finite = follower({ input: 0.5e-6, feedback: false, offset: 0 });
  finite.advanceTo(30_000n);
  assert.ok(Math.abs(finite.nodeVoltage('output') - 10) < 0.02,
    `20 MV/V open-loop output was ${finite.nodeVoltage('output')} V`);

  const precision = follower({ input: 1 });
  precision.advanceTo(50_000n);
  assert.ok(Math.abs(precision.nodeVoltage('output') - 1.00000995) < 2e-6,
    `precision follower output was ${precision.nodeVoltage('output')} V`);

  const dynamic = follower({ input: 0, offset: 0 });
  dynamic.advanceTo(10_000n);
  dynamic.setControl('VIN', 10);
  const t0 = dynamic.timeNs;
  const v0 = dynamic.nodeVoltage('output');
  dynamic.advanceTo(t0 + 1_000n);
  const moved = dynamic.nodeVoltage('output') - v0;
  assert.ok(moved > 2.2 && moved <= 2.51,
    `2.5 V/us slew allows at most 2.5 V in 1 us; moved ${moved} V`);
});
