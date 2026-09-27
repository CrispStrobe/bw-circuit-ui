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
import { getSidecar } from '../src/model/parts-registry.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => readFileSync(join(root, rel), 'utf8');
const terminals = ['offset_1', 'inn', 'inp', 'vneg', 'offset_5', 'out', 'vpos', 'nc'];

registerAllDevices();

test('the vendored LT1001 is the exact physical PDIP-8 sibling part', () => {
  const sidecar = getSidecar('lt1001');
  assert.ok(sidecar, 'generated parts-data index exposes LT1001 to every bundler');
  assert.deepEqual(sidecar.terminals.map(t => t.name), terminals);
  assert.deepEqual(sidecar.footprint.leads.out, { dRow: 5, dCol: 2 });
  assert.deepEqual(sidecar.footprint.leads.vpos, { dRow: 5, dCol: 1 });
  const pins = JSON.parse(read('.github/ci-siblings.json'));
  assert.equal(pins['bw-parts'].sha, '9308fa7dbfc28435427ecea0cf84e0c5ccd78c86');
  assert.match(read('src/parts-data/lt1001.svg'), />LT1001</);
});

test('palette, canvas, schematic and export metadata name the real LT1001', () => {
  const palette = read('src/components/PartPalette.jsx');
  const canvas = read('src/components/BoardCanvas.jsx');
  const interaction = read('scripts/verify-interaction.mjs');
  assert.match(palette, /kind: 'lt1001', label: 'LT1001'/);
  assert.match(canvas, /lt1001:\s*'LT1001'/);
  assert.match(interaction, /\[data-part-face="lt1001"\]\[data-dip-body="lt1001"\]/);
  assert.match(interaction, /lt1001Dots\.length === 8/);
  assert.equal(PART_SYMBOLS.lt1001.kicadSymbol, undefined,
    'KiCad has no official LT1001 symbol, so the exporter must not invent one');
  assert.equal(PART_SYMBOLS.lt1001.kicadFootprint, 'Package_DIP:DIP-8_W7.62mm');
});

test('EasyEDA and custom KiCad exact LT1001 DIP names retain all eight pins', () => {
  const expected = Object.fromEntries(terminals.map((name, i) => [String(i + 1), name]));
  const easy = mapEasyEdaPart({
    descriptor: 'LT1001ACN8#PBF', value: 'LT1001', spicePre: 'U', pinCount: 8, package: 'DIP-8',
  });
  assert.equal(easy.kind, 'lt1001');
  assert.deepEqual(easy.pins, expected);
  const kicad = mapKicadSymbol('MyAmplifiers:LT1001CN8', 'LT1001CN8');
  assert.equal(kicad.kind, 'lt1001');
  assert.deepEqual(kicad.terminals, terminals);
  for (let pin = 1; pin <= 8; pin++) {
    assert.equal(terminalFor(kicad, String(pin), '~'), terminals[pin - 1]);
  }
  assert.notEqual(mapKicadSymbol('MyAmplifiers:LT1001S8', 'LT1001S8')?.kind, 'lt1001',
    'the SO-8 package must not silently acquire the PDIP-8 physical face');
});

function follower({ input = 1, feedback = true, offset = 5e-6 } = {}) {
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
    { id: 'U1', kind: 'lt1001', params: { inputOffsetV: offset }, terminals },
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

test('the exact pinned engine solves LT1001 precision and dynamic behavior', () => {
  assert.ok(getDevice('lt1001'), 'the pinned engine registers the named real part');
  const finite = follower({ input: 1e-6, feedback: false, offset: 0 });
  finite.advanceTo(80_000n);
  assert.ok(Math.abs(finite.nodeVoltage('output') - 5) < 0.01,
    `5 MV/V open-loop output was ${finite.nodeVoltage('output')} V`);

  const precision = follower({ input: 1, offset: 10e-6 });
  precision.advanceTo(40_000n);
  assert.ok(Math.abs(precision.nodeVoltage('output') - 1.00001) < 5e-6,
    `precision follower output was ${precision.nodeVoltage('output')} V`);

  const dynamic = follower({ input: 0, offset: 0 });
  dynamic.advanceTo(10_000n);
  dynamic.setControl('VIN', 10);
  const t0 = dynamic.timeNs;
  const v0 = dynamic.nodeVoltage('output');
  dynamic.advanceTo(t0 + 4_000n);
  const moved = dynamic.nodeVoltage('output') - v0;
  assert.ok(moved > 0.75 && moved <= 1.01,
    `0.25 V/us slew allows at most 1 V in 4 us; moved ${moved} V`);
});
