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
const physicalTerminals = ['1_out', '1_neg', '1_pos', 'vneg', '2_pos', '2_neg', '2_out', 'vpos'];
const channelTerminals = ['inp', 'inn', 'vpos', 'vneg', 'out'];
const partsSha = 'a3750229c2b77369bc70fe62487b119ef1860419';
const symbolSha = 'b55fe8571a7ceda780cd2f7f3cd9218b3a206016502b5c1fbc6ca80668ea2c47';

registerAllDevices();

test('the vendored ADTL082 is the exact physical R-8 SOIC sibling part', () => {
  const sidecar = getSidecar('adtl082');
  assert.ok(sidecar, 'generated parts-data index exposes ADTL082');
  assert.deepEqual(sidecar.terminals.map(t => t.name), physicalTerminals);
  assert.equal(sidecar.footprint, undefined, 'surface-mount part must not claim direct breadboard seating');
  assert.match(sidecar._note, /R-8 8-lead SOIC top view/);
  assert.equal(JSON.parse(read('.github/ci-siblings.json'))['bw-parts'].sha, partsSha);
  assert.match(read('src/parts-data/adtl082.svg'), />ADTL082</);
});

test('palette, canvas, BOM and browser name one physical dual package', () => {
  assert.match(read('src/components/PartPalette.jsx'), /kind: 'adtl082', label: 'ADTL082'/);
  assert.match(read('src/components/BoardCanvas.jsx'), /adtl082:\s*'ADTL082'/);
  assert.match(read('src/model/bom.js'), /adtl082: 'ADTL082 Dual JFET-Input Operational Amplifier'/);
  const interaction = read('scripts/verify-interaction.mjs');
  assert.match(interaction, /\[data-part-face="adtl082"\]\[data-soic-body="adtl082"\]/);
  assert.match(interaction, /adtl082Dots\.length === 8/);
  assert.equal(PART_SYMBOLS.adtl082.kicadSymbol, undefined,
    'the single-record KiCad importer must not claim a multi-unit ADTL082 symbol');
  assert.equal(PART_SYMBOLS.adtl082.kicadFootprint, 'Package_SO:SOIC-8_3.9x4.9mm_P1.27mm');
});

test('exact EasyEDA R-package names retain all eight physical pins', () => {
  const expected = Object.fromEntries(physicalTerminals.map((name, i) => [String(i + 1), name]));
  for (const name of ['ADTL082RZ', 'ADTL082ARZ', 'ADTL082ARZ-REEL']) {
    const mapped = mapEasyEdaPart({ descriptor: name, value: name, spicePre: 'U', pinCount: 8, package: 'SOIC-8' });
    assert.equal(mapped.kind, 'adtl082', name);
    assert.deepEqual(mapped.pins, expected, name);
  }
});

const asc = `Version 4
SHEET 1 800 600
SYMBOL OpAmps\\ADTL082 200 200 R0
SYMATTR InstName U1
`;

test('the official LTspice symbol remains a logical channel with its ADI model blocker', () => {
  const result = importLtspiceAsc(asc);
  assert.deepEqual(result.unmapped, []);
  assert.equal(result.losses.length, 1);
  assert.equal(result.losses[0].kind, 'source-model-substitution');
  assert.match(result.losses[0].source, /SpiceModel ADI\.lib.*Value2 ADTL082/);
  assert.match(result.losses[0].reason, /native adtl082_channel behavioural card/);
  const part = result.parts[0];
  assert.equal(part.kind, 'adtl082_channel');
  assert.equal(part.sourcePackage, 'unspecified');
  assert.deepEqual(part.terminals, channelTerminals);
  assert.equal(part.verifiedBuiltinSymbolSha256, symbolSha);
  assert.equal(part.sourceModelFile, 'ADI.lib');
  assert.equal(part.sourceSubcircuit, 'ADTL082');
  assert.equal(result.sourceDocument.instances[0].pins.length, 5);
  const restored = Circuit.fromJSON({ parts: result.parts, wires: result.wires });
  assert.equal(restored.analysisBlockers.length, 1);
  assert.throws(() => restored.operatingPoint(), /blocked by 1 persisted import finding/);
});

test('the exact pinned engine keeps the physical dual and logical channel distinct', () => {
  assert.deepEqual(getDevice('adtl082').terminals, physicalTerminals);
  assert.deepEqual(getDevice('adtl082_channel').terminals, channelTerminals);
  const board = new BoardImpl(5);
  board.setNetlist([
    { id: 'VP', kind: 'vsource', params: { volts: 15 }, terminals: ['pos', 'neg'] },
    { id: 'VN', kind: 'vsource', params: { volts: 15 }, terminals: ['pos', 'neg'] },
    { id: 'V1', kind: 'vsource', params: { volts: -2 }, terminals: ['pos', 'neg'] },
    { id: 'V2', kind: 'vsource', params: { volts: 3 }, terminals: ['pos', 'neg'] },
    { id: 'G', kind: 'gnd', params: {}, terminals: ['gnd'] },
    { id: 'U1', kind: 'adtl082', params: { inputOffsetV: 0 }, terminals: physicalTerminals },
  ], [
    { id: 'gnd', terminals: [{ part: 'G', terminal: 'gnd' }, { part: 'VP', terminal: 'neg' }, { part: 'VN', terminal: 'pos' }, { part: 'V1', terminal: 'neg' }, { part: 'V2', terminal: 'neg' }] },
    { id: 'vpos', terminals: [{ part: 'VP', terminal: 'pos' }, { part: 'U1', terminal: 'vpos' }] },
    { id: 'vneg', terminals: [{ part: 'VN', terminal: 'neg' }, { part: 'U1', terminal: 'vneg' }] },
    { id: 'in1', terminals: [{ part: 'V1', terminal: 'pos' }, { part: 'U1', terminal: '1_pos' }] },
    { id: 'out1', terminals: [{ part: 'U1', terminal: '1_out' }, { part: 'U1', terminal: '1_neg' }] },
    { id: 'in2', terminals: [{ part: 'V2', terminal: 'pos' }, { part: 'U1', terminal: '2_pos' }] },
    { id: 'out2', terminals: [{ part: 'U1', terminal: '2_out' }, { part: 'U1', terminal: '2_neg' }] },
  ]);
  board.advanceTo(20_000n);
  assert.ok(Math.abs(board.nodeVoltage('out1') + 2) < 0.001, `channel 1 was ${board.nodeVoltage('out1')} V`);
  assert.ok(Math.abs(board.nodeVoltage('out2') - 3) < 0.001, `channel 2 was ${board.nodeVoltage('out2')} V`);
});
