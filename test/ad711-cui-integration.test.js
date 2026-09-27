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
const physicalTerminals = ['offset_1', 'inn', 'inp', 'vneg', 'offset_5', 'out', 'vpos', 'nc'];
const channelTerminals = ['inp', 'inn', 'vpos', 'vneg', 'out'];
const partsSha = 'a3750229c2b77369bc70fe62487b119ef1860419';
const sourceSha = '661d0a0e03267c8b0cebcedae656689402c82941fe998bea5e100ebcb7b543e5';

registerAllDevices();

test('the vendored AD711 is exactly the production N8 PDIP sibling part', () => {
  const sidecar = getSidecar('ad711');
  assert.ok(sidecar, 'generated parts-data index exposes AD711');
  assert.deepEqual(sidecar.terminals.map(t => t.name), physicalTerminals);
  assert.deepEqual(sidecar.footprint.leads.offset_5, { dRow: 5, dCol: 3 });
  assert.deepEqual(sidecar.footprint.leads.nc, { dRow: 5, dCol: 0 });
  assert.equal(JSON.parse(read('.github/ci-siblings.json'))['bw-parts'].sha, partsSha);
  assert.match(read('src/parts-data/ad711.svg'), />AD711</);
  assert.match(sidecar._note, /RN-8 SOIC, Q-8 ceramic DIP and H-08A metal-can parts must not borrow this face/);
});

test('palette, canvas, schematic, BOM and browser name the physical N8 part', () => {
  assert.match(read('src/components/PartPalette.jsx'), /kind: 'ad711', label: 'AD711'/);
  assert.match(read('src/components/BoardCanvas.jsx'), /ad711:\s*'AD711'/);
  assert.match(read('src/model/bom.js'), /ad711: 'AD711 Precision JFET-Input Operational Amplifier'/);
  assert.match(read('src/components/BoardCanvas.jsx'), /kind === 'ad711_channel'/,
    'the five-terminal source symbol must not fall through to an N8 or ghost face');
  const interaction = read('scripts/verify-interaction.mjs');
  assert.match(interaction, /\[data-part-face="ad711"\]\[data-dip-body="ad711"\]/);
  assert.match(interaction, /ad711Dots\.length === 8/);
  assert.equal(PART_SYMBOLS.ad711.kicadSymbol, undefined,
    'no reviewed official KiCad AD711 symbol is claimed');
  assert.equal(PART_SYMBOLS.ad711.kicadFootprint, 'Package_DIP:DIP-8_W7.62mm');
});

test('only exact production N8 order codes acquire the eight-pin breadboard face', () => {
  const expected = Object.fromEntries(physicalTerminals.map((name, i) => [String(i + 1), name]));
  for (const name of ['AD711JNZ', 'AD711JN', 'AD711KN']) {
    const easy = mapEasyEdaPart({ descriptor: name, value: name, spicePre: 'U', pinCount: 8, package: 'DIP-8' });
    assert.equal(easy.kind, 'ad711', name);
    assert.deepEqual(easy.pins, expected, name);
    const kicad = mapKicadSymbol(`MyAmplifiers:${name}`, name);
    assert.equal(kicad.kind, 'ad711', name);
    for (let pin = 1; pin <= 8; pin++) {
      assert.equal(terminalFor(kicad, String(pin), '~'), physicalTerminals[pin - 1], `${name} pin ${pin}`);
    }
  }
  assert.notEqual(mapEasyEdaPart({ descriptor: 'AD711JR', value: 'AD711', pinCount: 8 })?.kind, 'ad711');
  assert.notEqual(mapKicadSymbol('MyAmplifiers:AD711RN8', 'AD711RN8')?.kind, 'ad711');
});

test('official LTspice symbol stays a logical channel with exact provenance and blocker', () => {
    const asc = 'Version 4\nSHEET 1 800 600\nSYMBOL OpAmps\\AD711 200 200 R0\nSYMATTR InstName U1\n';
    const result = importLtspiceAsc(asc);
    assert.deepEqual(result.unmapped, []);
    assert.equal(result.losses.length, 1);
    assert.equal(result.losses[0].kind, 'source-model-substitution');
    assert.match(result.losses[0].source, /SpiceModel ADI1\.lib.*Value2 AD712/);
    assert.match(result.losses[0].reason, /native ad711_channel behavioural card/);
    const part = result.parts[0];
    assert.equal(part.kind, 'ad711_channel');
    assert.deepEqual(part.terminals, channelTerminals);
    assert.equal(part.sourcePackage, 'unspecified');
    assert.equal(part.verifiedBuiltinSymbolSha256, sourceSha);
    assert.equal(part.sourceLibrary, 'opamps/ad711');
    assert.equal(part.sourceModelFile, 'ADI1.lib');
    assert.equal(part.sourceSubcircuit, 'AD712');
    assert.equal(part.analysisBlockers.length, 1);
    assert.equal(result.sourceDocument.electricalProjection.mappedInstances[0].numericStatus,
      'blocked-model-or-instance-semantics');
    const restored = Circuit.fromJSON({ parts: result.parts, wires: result.wires });
    assert.equal(restored.analysisBlockers.length, 1);
    assert.throws(() => restored.operatingPoint(), /blocked by 1 persisted import finding/);
});

function follower({ input = 1, feedback = true, offset = 0.3e-3 } = {}) {
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
    { id: 'U1', kind: 'ad711', params: { inputOffsetV: offset }, terminals: physicalTerminals },
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

test('the exact pinned engine keeps physical/package-neutral identities and AD711 dynamics', () => {
  assert.deepEqual(getDevice('ad711').terminals, physicalTerminals);
  assert.deepEqual(getDevice('ad711_channel').terminals, channelTerminals);
  const finite = follower({ input: 25e-6, feedback: false, offset: 0 });
  finite.advanceTo(30_000n);
  assert.ok(Math.abs(finite.nodeVoltage('output') - 10) < 0.03,
    `400 kV/V open-loop output was ${finite.nodeVoltage('output')} V`);

  const precision = follower({ input: 1 });
  precision.advanceTo(50_000n);
  assert.ok(Math.abs(precision.nodeVoltage('output') - 1.0002975) < 3e-6,
    `precision follower output was ${precision.nodeVoltage('output')} V`);

  const dynamic = follower({ input: 0, offset: 0 });
  dynamic.advanceTo(10_000n);
  dynamic.setControl('VIN', 20);
  const t0 = dynamic.timeNs;
  const v0 = dynamic.nodeVoltage('output');
  dynamic.advanceTo(t0 + 1_000n);
  const moved = dynamic.nodeVoltage('output') - v0;
  assert.ok(moved > 13.7 && moved <= 13.81,
    `20 V/us slew reaches the 13.8 V positive output limit within 1 us; moved ${moved} V`);
});
