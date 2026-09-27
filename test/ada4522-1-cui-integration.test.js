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
import { carrierOptionsForPart } from '../src/model/carriers.js';
import { Circuit } from '../src/model/circuit.js';
import { getLandPattern } from '../src/model/land-patterns.js';
import { getSidecar } from '../src/model/parts-registry.js';
import { physicalPackageBindingsForPart } from '../src/model/physical-package-bindings.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => readFileSync(join(root, rel), 'utf8');
const physicalTerminals = ['nic_1', 'inn', 'inp', 'vneg', 'nic_5', 'out', 'vpos', 'nic_8'];
const channelTerminals = ['inp', 'inn', 'vpos', 'vneg', 'out'];
const partsSha = '897eee90699d8d01cfabca294f7d5d6703bb01fb';
const sourceSha = 'd36914a39d3c53db68fb36939212a67b8b063ff61ac5b847c17b760b29f5b78a';

registerAllDevices();

test('the vendored ADA4522-1 is exactly the production R-8 SOIC sibling part', () => {
  const sidecar = getSidecar('ada4522_1');
  assert.ok(sidecar, 'generated parts-data index exposes ADA4522-1');
  assert.deepEqual(sidecar.terminals.map(t => t.name), physicalTerminals);
  assert.equal(sidecar.footprint, undefined, 'bare SOIC must not claim direct breadboard seating');
  assert.match(sidecar._note, /RM-8 MSOP order codes must not borrow this larger face/);
  assert.equal(JSON.parse(read('.github/ci-siblings.json'))['bw-parts'].sha, partsSha);
  assert.match(read('src/parts-data/ada4522_1.svg'), />ADA4522-1</);
  assert.deepEqual(getLandPattern('ada4522_1', 'soic-8').pads.map(pad => pad.terminal), physicalTerminals);
  assert.deepEqual(carrierOptionsForPart({ kind: 'ada4522_1' }).map(option => option.id), ['soic8-dip8']);
});

test('palette, canvas, BOM and schematic metadata name one physical R-8 package', () => {
  assert.match(read('src/components/PartPalette.jsx'), /kind: 'ada4522_1', label: 'ADA4522-1'/);
  assert.match(read('src/components/BoardCanvas.jsx'), /ada4522_1:\s*'ADA4522-1'/);
  assert.match(read('src/model/bom.js'), /ada4522_1: 'ADA4522-1 Zero-Drift Precision Operational Amplifier'/);
  assert.match(read('scripts/verify-interaction.mjs'), /\[data-part-face="ada4522_1"\]\[data-soic-body="ada4522_1"\]/);
  assert.match(read('scripts/verify-interaction.mjs'), /ada4522Dots\.length === 8/);
  assert.equal(PART_SYMBOLS.ada4522_1.kicadSymbol, undefined);
  assert.equal(PART_SYMBOLS.ada4522_1.kicadFootprint, 'Package_SO:SOIC-8_3.9x4.9mm_P1.27mm');
});

test('only reviewed production R-8 order codes acquire the physical package', () => {
  const expected = Object.fromEntries(physicalTerminals.map((name, i) => [String(i + 1), name]));
  for (const name of ['ADA4522-1ARZ', 'ADA4522-1ARZ-R7', 'ADA4522-1ARZ-RL']) {
    const easy = mapEasyEdaPart({ descriptor: name, value: name, spicePre: 'U', pinCount: 8, package: 'SOIC-8' });
    assert.equal(easy.kind, 'ada4522_1', name);
    assert.deepEqual(easy.pins, expected, name);
    const kicad = mapKicadSymbol(`MyAmplifiers:${name}`, name);
    assert.equal(kicad.kind, 'ada4522_1', name);
    for (let pin = 1; pin <= 8; pin++) {
      assert.equal(terminalFor(kicad, String(pin), '~'), physicalTerminals[pin - 1], `${name} pin ${pin}`);
    }
  }
  assert.notEqual(mapEasyEdaPart({ descriptor: 'ADA4522-1ARMZ-R7', value: 'ADA4522-1', pinCount: 8 })?.kind, 'ada4522_1');
  assert.notEqual(mapKicadSymbol('MyAmplifiers:ADA4522-2ARZ', 'ADA4522-2ARZ')?.kind, 'ada4522_1');
});

const asc = 'Version 4\nSHEET 1 800 600\nSYMBOL OpAmps\\ADA4522-1 200 200 R0\nSYMATTR InstName U1\n';

test('the official LTspice symbol remains a logical channel with exact model blocker', () => {
  const result = importLtspiceAsc(asc);
  assert.deepEqual(result.unmapped, []);
  assert.equal(result.losses.length, 1);
  assert.match(result.losses[0].source, /SpiceModel ADA4522-1\.sub.*Value2 ADA4522-1/);
  assert.match(result.losses[0].reason, /native ada4522_1_channel behavioural card/);
  const part = result.parts[0];
  assert.equal(part.kind, 'ada4522_1_channel');
  assert.equal(part.sourcePackage, 'unspecified');
  assert.deepEqual(part.terminals, channelTerminals);
  assert.equal(part.verifiedBuiltinSymbolSha256, sourceSha);
  assert.equal(part.sourceModelFile, 'ADA4522-1.sub');
  assert.equal(part.sourceSubcircuit, 'ADA4522-1');
  assert.deepEqual(result.sourceDocument.instances[0].pins.map(pin => [pin.spiceOrder, pin.pinName, pin.x, pin.y]), [
    [1, 'inp', -32, 80], [2, 'inn', -32, 48], [3, 'vpos', 0, 32],
    [4, 'vneg', 0, 96], [5, 'out', 32, 64],
  ]);
  const restored = Circuit.fromJSON({ parts: result.parts, wires: result.wires });
  assert.equal(restored.analysisBlockers.length, 1);
  assert.throws(() => restored.operatingPoint(), /blocked by 1 persisted import finding/);
  assert.deepEqual(physicalPackageBindingsForPart(part).map(binding => binding.id), ['ada4522-1-arz']);
  assert.equal(restored.bindPhysicalPackage(part.id, 'ada4522-1-arz'), true);
  assert.equal(restored.parts[0].kind, 'ada4522_1');
  assert.deepEqual(restored.parts[0].terminals, physicalTerminals);
  assert.equal(restored.parts[0].sourceModelFile, 'ADA4522-1.sub');
});

test('the exact pinned engine exposes physical and package-neutral identities', () => {
  assert.deepEqual(getDevice('ada4522_1').terminals, physicalTerminals);
  assert.deepEqual(getDevice('ada4522_1_channel').terminals, channelTerminals);
  const board = new BoardImpl(5);
  board.setNetlist([
    { id: 'VS', kind: 'vsource', params: { volts: 24 }, terminals: ['pos', 'neg'] },
    { id: 'VIN', kind: 'vsource', params: { volts: 4 }, terminals: ['pos', 'neg'] },
    { id: 'G', kind: 'gnd', params: {}, terminals: ['gnd'] },
    { id: 'U1', kind: 'ada4522_1', params: { inputOffsetV: 0 }, terminals: physicalTerminals },
  ], [
    { id: 'gnd', terminals: [{ part: 'G', terminal: 'gnd' }, { part: 'VS', terminal: 'neg' }, { part: 'VIN', terminal: 'neg' }, { part: 'U1', terminal: 'vneg' }] },
    { id: 'vpos', terminals: [{ part: 'VS', terminal: 'pos' }, { part: 'U1', terminal: 'vpos' }] },
    { id: 'input', terminals: [{ part: 'VIN', terminal: 'pos' }, { part: 'U1', terminal: 'inp' }] },
    { id: 'output', terminals: [{ part: 'U1', terminal: 'out' }, { part: 'U1', terminal: 'inn' }] },
  ]);
  board.advanceTo(30_000n);
  assert.ok(Math.abs(board.nodeVoltage('output') - 4) < 0.0001,
    `precision follower output was ${board.nodeVoltage('output')} V`);
});
