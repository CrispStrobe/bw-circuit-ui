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
const terminals = ['offset_1', 'inn', 'inp', 'vneg', 'offset_5', 'out', 'vpos', 'nc'];
const partsSha = 'ed7b8adda5a2820ee42fcd43b9e6a9b113175c8c';
const symbolSha = '93f2fa1510bfb884a5d5f987ad4b7325531536dd62a723a401fb96746c32ac5c';

registerAllDevices();

test('the vendored OP27 is the exact P-suffix PDIP-8 sibling part', () => {
  const sidecar = getSidecar('op27');
  assert.ok(sidecar, 'generated parts-data index exposes OP27 to every bundler');
  assert.deepEqual(sidecar.terminals.map(t => t.name), terminals);
  assert.deepEqual(sidecar.footprint.leads.offset_5, { dRow: 5, dCol: 3 });
  assert.deepEqual(sidecar.footprint.leads.vpos, { dRow: 5, dCol: 1 });
  assert.equal(JSON.parse(read('.github/ci-siblings.json'))['bw-parts'].sha, partsSha);
  assert.match(read('src/parts-data/op27.svg'), />OP27</);
  assert.match(sidecar._note,
    /S-suffix SOIC and J-suffix TO-99 imports must not acquire this breadboard face/);
});

test('palette, canvas, schematic, BOM and export metadata name the real OP27', () => {
  assert.match(read('src/components/PartPalette.jsx'), /kind: 'op27', label: 'OP27'/);
  assert.match(read('src/components/BoardCanvas.jsx'), /op27:\s*'OP27'/);
  assert.match(read('src/model/bom.js'), /op27: 'OP27 Low-Noise Precision Operational Amplifier'/);
  const interaction = read('scripts/verify-interaction.mjs');
  assert.match(interaction, /\[data-part-face="op27"\]\[data-dip-body="op27"\]/);
  assert.match(interaction, /op27Dots\.length === 8/);
  assert.equal(PART_SYMBOLS.op27.kicadSymbol, undefined,
    'no reviewed official KiCad OP27 symbol is claimed');
  assert.equal(PART_SYMBOLS.op27.kicadFootprint, 'Package_DIP:DIP-8_W7.62mm');
});

test('EasyEDA and custom KiCad exact OP27 PDIP names retain all eight pins', () => {
  const expected = Object.fromEntries(terminals.map((name, i) => [String(i + 1), name]));
  const easy = mapEasyEdaPart({
    descriptor: 'OP27EPZ', value: 'OP27', spicePre: 'U', pinCount: 8, package: 'DIP-8',
  });
  assert.equal(easy.kind, 'op27');
  assert.deepEqual(easy.pins, expected);
  const kicad = mapKicadSymbol('MyAmplifiers:OP27GPZ', 'OP27GPZ');
  assert.equal(kicad.kind, 'op27');
  assert.deepEqual(kicad.terminals, terminals);
  for (let pin = 1; pin <= 8; pin++) {
    assert.equal(terminalFor(kicad, String(pin), '~'), terminals[pin - 1]);
  }
  assert.notEqual(mapKicadSymbol('MyAmplifiers:OP27GSZ', 'OP27GSZ')?.kind, 'op27',
    'the S-suffix SOIC must not silently acquire the P-suffix PDIP face');
  assert.notEqual(mapKicadSymbol('MyAmplifiers:OP27GJZ', 'OP27GJZ')?.kind, 'op27',
    'the J-suffix TO-99 must not silently acquire the P-suffix PDIP face');
});

const asc = `Version 4
SHEET 1 800 600
SYMBOL OpAmps\\OP27 200 200 R0
SYMATTR InstName U1
`;

test('the audited LTspice symbol reaches OP27 electrically without inventing a package', () => {
  const result = importLtspiceAsc(asc);
  assert.deepEqual(result.unmapped, []);
  assert.equal(result.losses.length, 1);
  assert.equal(result.losses[0].kind, 'source-model-substitution');
  assert.match(result.losses[0].source, /SpiceModel ADI\.lib.*Value2 OP27/);
  assert.match(result.losses[0].reason, /native op27 behavioural card.*is not that source subcircuit/);
  assert.equal(result.parts[0].kind, 'op27');
  assert.deepEqual(result.parts[0].terminals, ['inp', 'inn', 'vpos', 'vneg', 'out']);
  assert.equal(result.parts[0].sourcePackage, 'unspecified');
  assert.equal(result.parts[0].verifiedBuiltinSymbolSha256, symbolSha);
  assert.equal(result.parts[0].sourceSymbolSha256, undefined);
  assert.equal(result.parts[0].sourceLibrary, 'opamps/op27');
  assert.equal(result.parts[0].sourceModelFile, 'ADI.lib');
  assert.equal(result.parts[0].sourceSubcircuit, 'OP27');
  assert.equal(result.parts[0].analysisBlockers.length, 1);
  assert.equal(result.sourceDocument.electricalProjection.mappedInstances[0].numericStatus,
    'blocked-model-or-instance-semantics');
  const restored = Circuit.fromJSON({ parts: result.parts, wires: result.wires });
  assert.equal(restored.analysisBlockers.length, 1,
    'the part-owned source substitution survives a minimal Circuit JSON round trip');
  assert.throws(() => restored.operatingPoint(), /blocked by 1 persisted import finding/,
    'an ADI.lib source deck cannot become native OP27 numerical evidence after save/load');
});

test('a caller-supplied official OP27 symbol produces one load-bearing substitution blocker', () => {
  const symbol = `Version 4
SymbolType CELL
SYMATTR Value OP27
SYMATTR Prefix X
SYMATTR SpiceModel ADI.lib
SYMATTR Value2 OP27
PIN -32 80 NONE 0
PINATTR PinName In+
PINATTR SpiceOrder 1
PIN -32 48 NONE 0
PINATTR PinName In-
PINATTR SpiceOrder 2
PIN 0 32 NONE 0
PINATTR PinName V+
PINATTR SpiceOrder 3
PIN 0 96 NONE 0
PINATTR PinName V-
PINATTR SpiceOrder 4
PIN 32 64 NONE 0
PINATTR PinName OUT
PINATTR SpiceOrder 5
`;
  const result = importLtspiceAsc(asc, { symbols: new Map([['opamps/op27', symbol]]) });
  assert.deepEqual(result.unmapped, []);
  assert.equal(result.losses.length, 1);
  assert.equal(result.losses[0].kind, 'source-model-substitution');
  assert.equal(result.parts[0].analysisBlockers.length, 1);
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
    { id: 'U1', kind: 'op27', params: { inputOffsetV: offset }, terminals },
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

test('the exact pinned engine solves OP27 finite gain, offset and slew', () => {
  assert.ok(getDevice('op27'), 'the pinned engine registers the named real part');
  const finite = follower({ input: 5e-6, feedback: false, offset: 0 });
  finite.advanceTo(30_000n);
  assert.ok(Math.abs(finite.nodeVoltage('output') - 9) < 0.02,
    `1.8 MV/V open-loop output was ${finite.nodeVoltage('output')} V`);

  const precision = follower({ input: 1 });
  precision.advanceTo(50_000n);
  assert.ok(Math.abs(precision.nodeVoltage('output') - 1.00000944) < 2e-6,
    `precision follower output was ${precision.nodeVoltage('output')} V`);

  const dynamic = follower({ input: 0, offset: 0 });
  dynamic.advanceTo(10_000n);
  dynamic.setControl('VIN', 10);
  const t0 = dynamic.timeNs;
  const v0 = dynamic.nodeVoltage('output');
  dynamic.advanceTo(t0 + 1_000n);
  const moved = dynamic.nodeVoltage('output') - v0;
  assert.ok(moved > 2.5 && moved <= 2.81,
    `2.8 V/us slew allows at most 2.8 V in 1 us; moved ${moved} V`);
});
