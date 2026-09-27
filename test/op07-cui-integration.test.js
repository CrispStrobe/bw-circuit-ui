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

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => readFileSync(join(root, rel), 'utf8');
const terminals = ['offset_1', 'inn', 'inp', 'vneg', 'offset_5', 'out', 'vpos', 'nc'];

registerAllDevices();

test('the vendored OP07 is the exact P-suffix PDIP-8 sibling part', () => {
  const sidecar = getSidecar('op07');
  assert.ok(sidecar, 'generated parts-data index exposes OP07 to every bundler');
  assert.deepEqual(sidecar.terminals.map(t => t.name), terminals);
  assert.deepEqual(sidecar.footprint.leads.offset_5, { dRow: 5, dCol: 3 });
  assert.deepEqual(sidecar.footprint.leads.vpos, { dRow: 5, dCol: 1 });
  const pins = JSON.parse(read('.github/ci-siblings.json'));
  assert.equal(pins['bw-parts'].sha, 'd9446a1095ca9efd45226173bc6774efe76e23f0');
  assert.match(read('src/parts-data/op07.svg'), />OP07</);
  assert.match(sidecar._note, /SOIC imports must not acquire this breadboard face/);
});

test('palette, canvas, schematic, BOM and export metadata name the real OP07', () => {
  const palette = read('src/components/PartPalette.jsx');
  const canvas = read('src/components/BoardCanvas.jsx');
  const bom = read('src/model/bom.js');
  const interaction = read('scripts/verify-interaction.mjs');
  assert.match(palette, /kind: 'op07', label: 'OP07'/);
  assert.match(canvas, /op07:\s*'OP07'/);
  assert.match(bom, /op07: 'OP07 Precision Operational Amplifier'/);
  assert.match(interaction, /\[data-part-face="op07"\]\[data-dip-body="op07"\]/);
  assert.match(interaction, /op07Dots\.length === 8/);
  assert.equal(PART_SYMBOLS.op07.kicadSymbol, undefined,
    'no reviewed official KiCad OP07 symbol is claimed');
  assert.equal(PART_SYMBOLS.op07.kicadFootprint, 'Package_DIP:DIP-8_W7.62mm');
});

test('EasyEDA and custom KiCad exact OP07 PDIP names retain all eight pins', () => {
  const expected = Object.fromEntries(terminals.map((name, i) => [String(i + 1), name]));
  const easy = mapEasyEdaPart({
    descriptor: 'OP07CPZ', value: 'OP07', spicePre: 'U', pinCount: 8, package: 'DIP-8',
  });
  assert.equal(easy.kind, 'op07');
  assert.deepEqual(easy.pins, expected);
  const kicad = mapKicadSymbol('MyAmplifiers:OP07EPZ', 'OP07EPZ');
  assert.equal(kicad.kind, 'op07');
  assert.deepEqual(kicad.terminals, terminals);
  for (let pin = 1; pin <= 8; pin++) {
    assert.equal(terminalFor(kicad, String(pin), '~'), terminals[pin - 1]);
  }
  assert.notEqual(mapKicadSymbol('MyAmplifiers:OP07CSZ', 'OP07CSZ')?.kind, 'op07',
    'the S-suffix SOIC must not silently acquire the P-suffix PDIP face');
});

test('the audited LTspice symbol reaches OP07 electrically without inventing a package', () => {
  const source = `Version 4
SHEET 1 800 600
SYMBOL OpAmps\\OP07 200 200 R0
SYMATTR InstName U1
`;
  const result = importLtspiceAsc(source);
  assert.deepEqual(result.unmapped, []);
  assert.equal(result.losses.length, 1);
  assert.equal(result.losses[0].kind, 'source-model-substitution');
  assert.match(result.losses[0].source, /SpiceModel LTC\.lib.*Value2 LT1001/);
  assert.match(result.losses[0].reason, /native op07 behavioural card.*is not that source subcircuit/);
  assert.equal(result.parts[0].kind, 'op07');
  assert.deepEqual(result.parts[0].terminals, ['inp', 'inn', 'vpos', 'vneg', 'out']);
  assert.equal(result.parts[0].sourcePackage, 'unspecified');
  assert.equal(result.parts[0].verifiedBuiltinSymbolSha256,
    '577ff165a528ef7fd38298ffac12113a905c4a431dbf6c85b6001df4117c1442');
  assert.equal(result.parts[0].sourceSymbolSha256, undefined);
  assert.equal(result.parts[0].sourceLibrary, 'opamps/op07');
  assert.equal(result.parts[0].sourceModelFile, 'LTC.lib');
  assert.equal(result.parts[0].sourceSubcircuit, 'LT1001');
  assert.equal(result.parts[0].analysisBlockers.length, 1);
  assert.equal(result.sourceDocument.electricalProjection.mappedInstances[0].numericStatus,
    'blocked-model-or-instance-semantics');
});

test('a caller-supplied official OP07 symbol produces one load-bearing substitution blocker', () => {
  const source = `Version 4
SHEET 1 800 600
SYMBOL OpAmps\\OP07 200 200 R0
SYMATTR InstName U1
`;
  const symbol = `Version 4
SymbolType CELL
SYMATTR Value OP07
SYMATTR Prefix X
SYMATTR SpiceModel LTC.lib
SYMATTR Value2 LT1001
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
  const result = importLtspiceAsc(source, {
    symbols: new Map([['opamps/op07', symbol]]),
  });
  assert.deepEqual(result.unmapped, []);
  assert.equal(result.losses.length, 1);
  assert.equal(result.losses[0].kind, 'source-model-substitution');
  assert.equal(result.parts[0].analysisBlockers.length, 1);
});

function follower({ input = 1, feedback = true, offset = 60e-6 } = {}) {
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
    { id: 'U1', kind: 'op07', params: { inputOffsetV: offset }, terminals },
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

test('the exact pinned engine solves OP07 finite gain, offset and slew', () => {
  assert.ok(getDevice('op07'), 'the pinned engine registers the named real part');
  const finite = follower({ input: 10e-6, feedback: false, offset: 0 });
  finite.advanceTo(30_000n);
  assert.ok(Math.abs(finite.nodeVoltage('output') - 4) < 0.01,
    `400 kV/V open-loop output was ${finite.nodeVoltage('output')} V`);

  const precision = follower({ input: 1 });
  precision.advanceTo(50_000n);
  assert.ok(Math.abs(precision.nodeVoltage('output') - 1.0000575) < 5e-6,
    `precision follower output was ${precision.nodeVoltage('output')} V`);

  const dynamic = follower({ input: 0, offset: 0 });
  dynamic.advanceTo(10_000n);
  dynamic.setControl('VIN', 10);
  const t0 = dynamic.timeNs;
  const v0 = dynamic.nodeVoltage('output');
  dynamic.advanceTo(t0 + 4_000n);
  const moved = dynamic.nodeVoltage('output') - v0;
  assert.ok(moved > 0.9 && moved <= 1.21,
    `0.3 V/us slew allows at most 1.2 V in 4 us; moved ${moved} V`);
});
