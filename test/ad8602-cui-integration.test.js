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
const physicalTerminals = ['1_out', '1_neg', '1_pos', 'vneg', '2_pos', '2_neg', '2_out', 'vpos'];
const channelTerminals = ['inp', 'inn', 'vpos', 'vneg', 'out'];
const partsSha = 'bdadcaa969cfabde737778f013e19cf99602850c';
const sourceSha = '2e179beb1909fce966b27ce673c920139831b6dae59f9c417322d3d9a24fb552';

registerAllDevices();

test('the vendored AD8602 is exactly the production R-8 SOIC sibling part', () => {
  const sidecar = getSidecar('ad8602');
  assert.ok(sidecar, 'generated parts-data index exposes AD8602');
  assert.deepEqual(sidecar.terminals.map(t => t.name), physicalTerminals);
  assert.equal(sidecar.footprint, undefined, 'bare SOIC must not claim direct breadboard seating');
  assert.match(sidecar._note, /RM-8 MSOP parts must not borrow this face/);
  assert.equal(JSON.parse(read('.github/ci-siblings.json'))['bw-parts'].sha, partsSha);
  assert.match(read('src/parts-data/ad8602.svg'), />AD8602</);
  assert.deepEqual(getLandPattern('ad8602', 'soic-8').pads.map(pad => pad.terminal), physicalTerminals);
  assert.deepEqual(carrierOptionsForPart({ kind: 'ad8602' }).map(option => option.id), ['soic8-dip8']);
});

test('palette, canvas, BOM and schematic metadata name one physical R-8 dual', () => {
  assert.match(read('src/components/PartPalette.jsx'), /kind: 'ad8602', label: 'AD8602'/);
  assert.match(read('src/components/BoardCanvas.jsx'), /ad8602:\s*'AD8602'/);
  assert.match(read('src/model/bom.js'), /ad8602: 'AD8602 Dual Rail-to-Rail Operational Amplifier'/);
  assert.match(read('scripts/verify-interaction.mjs'), /\[data-part-face="ad8602"\]\[data-soic-body="ad8602"\]/);
  assert.match(read('scripts/verify-interaction.mjs'), /ad8602Dots\.length === 8/);
  assert.equal(PART_SYMBOLS.ad8602.kicadSymbol, undefined,
    'no generic single-record KiCad symbol is inferred from a package order code');
  assert.equal(PART_SYMBOLS.ad8602.kicadFootprint, 'Package_SO:SOIC-8_3.9x4.9mm_P1.27mm');
});

test('only reviewed production R-8 order codes acquire the physical package', () => {
  const expected = Object.fromEntries(physicalTerminals.map((name, i) => [String(i + 1), name]));
  for (const name of ['AD8602ARZ', 'AD8602ARZ-REEL', 'AD8602ARZ-REEL7', 'AD8602DRZ']) {
    const easy = mapEasyEdaPart({ descriptor: name, value: name, spicePre: 'U', pinCount: 8, package: 'SOIC-8' });
    assert.equal(easy.kind, 'ad8602', name);
    assert.deepEqual(easy.pins, expected, name);
    const kicad = mapKicadSymbol(`MyAmplifiers:${name}`, name);
    assert.equal(kicad.kind, 'ad8602', name);
    for (let pin = 1; pin <= 8; pin++) {
      assert.equal(terminalFor(kicad, String(pin), '~'), physicalTerminals[pin - 1], `${name} pin ${pin}`);
    }
  }
  assert.notEqual(mapEasyEdaPart({ descriptor: 'AD8602ARMZ-REEL', value: 'AD8602', pinCount: 8 })?.kind, 'ad8602');
  assert.notEqual(mapKicadSymbol('MyAmplifiers:AD8601ARZ', 'AD8601ARZ')?.kind, 'ad8602');
});

const asc = 'Version 4\nSHEET 1 800 600\nSYMBOL OpAmps\\AD8602 200 200 R0\nSYMATTR InstName U1\n';

test('the official LTspice symbol remains a logical channel with exact model blocker', () => {
  const result = importLtspiceAsc(asc);
  assert.deepEqual(result.unmapped, []);
  assert.equal(result.losses.length, 1);
  assert.match(result.losses[0].source, /SpiceModel AD8602\.lib.*Value2 AD8602/);
  assert.match(result.losses[0].reason, /native ad8602_channel behavioural card/);
  const part = result.parts[0];
  assert.equal(part.kind, 'ad8602_channel');
  assert.equal(part.sourcePackage, 'unspecified');
  assert.deepEqual(part.terminals, channelTerminals);
  assert.equal(part.verifiedBuiltinSymbolSha256, sourceSha);
  assert.equal(part.sourceModelFile, 'AD8602.lib');
  assert.equal(part.sourceSubcircuit, 'AD8602');
  assert.deepEqual(result.sourceDocument.instances[0].pins.map(pin => [pin.spiceOrder, pin.pinName, pin.x, pin.y]), [
    [1, 'inp', -32, 80], [2, 'inn', -32, 48], [3, 'vpos', 0, 32],
    [4, 'vneg', 0, 96], [5, 'out', 32, 64],
  ]);
  const restored = Circuit.fromJSON({ parts: result.parts, wires: result.wires });
  assert.equal(restored.analysisBlockers.length, 1);
  assert.throws(() => restored.operatingPoint(), /blocked by 1 persisted import finding/);
  assert.deepEqual(physicalPackageBindingsForPart(part), [],
    'an unnamed source channel cannot fabricate channel A/B or the second channel');
  assert.equal(restored.bindPhysicalPackage(part.id, 'ad8602-arz'), false);
  assert.equal(restored.parts[0].kind, 'ad8602_channel');
  assert.deepEqual(restored.parts[0].terminals, channelTerminals);
  assert.equal(restored.parts[0].sourceModelFile, 'AD8602.lib');
});

test('the exact pinned engine exposes both identities and two bounded channels', () => {
  assert.deepEqual(getDevice('ad8602').terminals, physicalTerminals);
  assert.deepEqual(getDevice('ad8602_channel').terminals, channelTerminals);
  const board = new BoardImpl(5);
  board.setNetlist([
    { id: 'VS', kind: 'vsource', params: { volts: 5 }, terminals: ['pos', 'neg'] },
    { id: 'V1', kind: 'vsource', params: { volts: 1 }, terminals: ['pos', 'neg'] },
    { id: 'V2', kind: 'vsource', params: { volts: 4 }, terminals: ['pos', 'neg'] },
    { id: 'G', kind: 'gnd', params: {}, terminals: ['gnd'] },
    { id: 'U1', kind: 'ad8602', params: { inputOffsetV: 0 }, terminals: physicalTerminals },
  ], [
    { id: 'gnd', terminals: [{ part: 'G', terminal: 'gnd' }, { part: 'VS', terminal: 'neg' }, { part: 'V1', terminal: 'neg' }, { part: 'V2', terminal: 'neg' }, { part: 'U1', terminal: 'vneg' }] },
    { id: 'vpos', terminals: [{ part: 'VS', terminal: 'pos' }, { part: 'U1', terminal: 'vpos' }] },
    { id: 'in1', terminals: [{ part: 'V1', terminal: 'pos' }, { part: 'U1', terminal: '1_pos' }] },
    { id: 'out1', terminals: [{ part: 'U1', terminal: '1_out' }, { part: 'U1', terminal: '1_neg' }] },
    { id: 'in2', terminals: [{ part: 'V2', terminal: 'pos' }, { part: 'U1', terminal: '2_pos' }] },
    { id: 'out2', terminals: [{ part: 'U1', terminal: '2_out' }, { part: 'U1', terminal: '2_neg' }] },
  ]);
  board.advanceTo(10_000n);
  assert.ok(Math.abs(board.nodeVoltage('out1') - 1) < 0.0001);
  assert.ok(Math.abs(board.nodeVoltage('out2') - 4) < 0.0001);
});
