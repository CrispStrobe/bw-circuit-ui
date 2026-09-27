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
const physicalTerminals = ['nc_1', 'inn', 'inp', 'vneg', 'nc_5', 'out', 'vpos', 'nc_8'];
const channelTerminals = ['inp', 'inn', 'vpos', 'vneg', 'out'];
const partsSha = '897eee90699d8d01cfabca294f7d5d6703bb01fb';
const sourceSha = '3f12555d6c336ca54459c2c58c791de281b56b68f5940edf8d19d6ca40fd347d';

registerAllDevices();

test('the vendored AD8541 is exactly the production R-8 SOIC sibling part', () => {
  const sidecar = getSidecar('ad8541');
  assert.ok(sidecar, 'generated parts-data index exposes AD8541');
  assert.deepEqual(sidecar.terminals.map(t => t.name), physicalTerminals);
  assert.equal(sidecar.footprint, undefined, 'bare SOIC must not claim direct breadboard seating');
  assert.match(sidecar._note, /does not establish R-8 rather than the production RJ-5 or KS-5 packages/);
  assert.equal(JSON.parse(read('.github/ci-siblings.json'))['bw-parts'].sha, partsSha);
  assert.match(read('src/parts-data/ad8541.svg'), />AD8541</);
  assert.deepEqual(getLandPattern('ad8541', 'soic-8').pads.map(pad => pad.terminal), physicalTerminals);
  assert.deepEqual(carrierOptionsForPart({ kind: 'ad8541' }).map(option => option.id), ['soic8-dip8']);
});

test('palette, canvas, BOM and schematic metadata name one physical R-8 package', () => {
  assert.match(read('src/components/PartPalette.jsx'), /kind: 'ad8541', label: 'AD8541'/);
  assert.match(read('src/components/BoardCanvas.jsx'), /ad8541:\s*'AD8541'/);
  assert.match(read('src/model/bom.js'), /ad8541: 'AD8541 Rail-to-Rail Operational Amplifier'/);
  assert.match(read('scripts/verify-interaction.mjs'), /\[data-part-face="ad8541"\]\[data-soic-body="ad8541"\]/);
  assert.match(read('scripts/verify-interaction.mjs'), /ad8541Dots\.length === 8/);
  assert.equal(PART_SYMBOLS.ad8541.kicadSymbol, undefined,
    'no generic single-record KiCad symbol is inferred from a package order code');
  assert.equal(PART_SYMBOLS.ad8541.kicadFootprint, 'Package_SO:SOIC-8_3.9x4.9mm_P1.27mm');
});

test('only reviewed production R-8 order codes acquire the physical package', () => {
  const expected = Object.fromEntries(physicalTerminals.map((name, i) => [String(i + 1), name]));
  for (const name of ['AD8541ARZ', 'AD8541ARZ-REEL', 'AD8541ARZ-REEL7']) {
    const easy = mapEasyEdaPart({ descriptor: name, value: name, spicePre: 'U', pinCount: 8, package: 'SOIC-8' });
    assert.equal(easy.kind, 'ad8541', name);
    assert.deepEqual(easy.pins, expected, name);
    const kicad = mapKicadSymbol(`MyAmplifiers:${name}`, name);
    assert.equal(kicad.kind, 'ad8541', name);
    for (let pin = 1; pin <= 8; pin++) {
      assert.equal(terminalFor(kicad, String(pin), '~'), physicalTerminals[pin - 1], `${name} pin ${pin}`);
    }
  }
  assert.notEqual(mapEasyEdaPart({ descriptor: 'AD8541ARTZ-REEL7', value: 'AD8541', pinCount: 5 })?.kind, 'ad8541');
  assert.notEqual(mapKicadSymbol('MyAmplifiers:AD8541AKSZ', 'AD8541AKSZ')?.kind, 'ad8541');
});

const asc = 'Version 4\nSHEET 1 800 600\nSYMBOL OpAmps\\AD8541 200 200 R0\nSYMATTR InstName U1\n';

test('the official LTspice symbol remains a logical channel with exact model blocker', () => {
  const result = importLtspiceAsc(asc);
  assert.deepEqual(result.unmapped, []);
  assert.equal(result.losses.length, 1);
  assert.match(result.losses[0].source, /SpiceModel AD8541\.lib.*Value2 AD8541/);
  assert.match(result.losses[0].reason, /native ad8541_channel behavioural card/);
  const part = result.parts[0];
  assert.equal(part.kind, 'ad8541_channel');
  assert.equal(part.sourcePackage, 'unspecified');
  assert.deepEqual(part.terminals, channelTerminals);
  assert.equal(part.verifiedBuiltinSymbolSha256, sourceSha);
  assert.equal(part.sourceModelFile, 'AD8541.lib');
  assert.equal(part.sourceSubcircuit, 'AD8541');
  assert.deepEqual(result.sourceDocument.instances[0].pins.map(pin => [pin.spiceOrder, pin.pinName, pin.x, pin.y]), [
    [1, 'inp', -32, 80], [2, 'inn', -32, 48], [3, 'vpos', 0, 32],
    [4, 'vneg', 0, 96], [5, 'out', 32, 64],
  ]);
  const restored = Circuit.fromJSON({ parts: result.parts, wires: result.wires });
  assert.equal(restored.analysisBlockers.length, 1);
  assert.throws(() => restored.operatingPoint(), /blocked by 1 persisted import finding/);
  assert.deepEqual(physicalPackageBindingsForPart(part).map(binding => binding.id), ['ad8541-arz']);
  assert.equal(restored.bindPhysicalPackage(part.id, 'ad8541-arz'), true);
  assert.equal(restored.parts[0].kind, 'ad8541');
  assert.deepEqual(restored.parts[0].terminals, physicalTerminals);
  assert.equal(restored.parts[0].sourceModelFile, 'AD8541.lib');
});

test('the exact pinned engine exposes both identities and bounded AD8541 dynamics', () => {
  assert.deepEqual(getDevice('ad8541').terminals, physicalTerminals);
  assert.deepEqual(getDevice('ad8541_channel').terminals, channelTerminals);
  const board = new BoardImpl(5);
  board.setNetlist([
    { id: 'VS', kind: 'vsource', params: { volts: 5 }, terminals: ['pos', 'neg'] },
    { id: 'VIN', kind: 'vsource', params: { volts: 1 }, terminals: ['pos', 'neg'] },
    { id: 'G', kind: 'gnd', params: {}, terminals: ['gnd'] },
    { id: 'U1', kind: 'ad8541', params: { inputOffsetV: 0 }, terminals: physicalTerminals },
    { id: 'RL', kind: 'resistor', params: { ohms: 10000 }, terminals: ['a', 'b'] },
  ], [
    { id: 'gnd', terminals: [{ part: 'G', terminal: 'gnd' }, { part: 'VS', terminal: 'neg' }, { part: 'VIN', terminal: 'neg' }, { part: 'U1', terminal: 'vneg' }, { part: 'RL', terminal: 'b' }] },
    { id: 'vpos', terminals: [{ part: 'VS', terminal: 'pos' }, { part: 'U1', terminal: 'vpos' }] },
    { id: 'input', terminals: [{ part: 'VIN', terminal: 'pos' }, { part: 'U1', terminal: 'inp' }] },
    { id: 'output', terminals: [{ part: 'U1', terminal: 'out' }, { part: 'U1', terminal: 'inn' }, { part: 'RL', terminal: 'a' }] },
  ]);
  board.advanceTo(30_000n);
  assert.ok(Math.abs(board.nodeVoltage('output') - 1) < 0.0001,
    `rail-to-rail follower output was ${board.nodeVoltage('output')} V`);
});
