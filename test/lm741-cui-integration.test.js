import './_setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
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

test('the vendored LM741 is the exact physical PDIP-8 sibling part', () => {
  const sidecar = getSidecar('lm741');
  assert.ok(sidecar, 'generated parts-data index exposes LM741 to every bundler');
  assert.deepEqual(sidecar.terminals.map(t => t.name), terminals);
  assert.deepEqual(sidecar.footprint.leads.out, {dRow: 5, dCol: 2});
  assert.deepEqual(sidecar.footprint.leads.vpos, {dRow: 5, dCol: 1});
  const pins = JSON.parse(read('.github/ci-siblings.json'));
  assert.equal(pins['bw-parts'].sha, '9308fa7dbfc28435427ecea0cf84e0c5ccd78c86');
  const sibling = process.env.BW_PARTS_DIR || join(root, '..', 'bw-parts', 'parts');
  if (existsSync(sibling)) {
    assert.equal(read('src/parts-data/lm741.json'), readFileSync(join(sibling, 'lm741.json'), 'utf8'));
    assert.equal(read('src/parts-data/lm741.svg'), readFileSync(join(sibling, 'lm741.svg'), 'utf8'));
  }
});

test('palette, canvas, schematic and export metadata name the real part', () => {
  const palette = read('src/components/PartPalette.jsx');
  const canvas = read('src/components/BoardCanvas.jsx');
  const interaction = read('scripts/verify-interaction.mjs');
  assert.match(palette, /kind: 'lm741', label: 'LM741'/);
  assert.match(canvas, /lm741:\s*'LM741'/);
  assert.match(interaction, /\[data-part-face="lm741"\]\[data-dip-body="lm741"\]/,
    'the browser proof must observe the real LM741 face rather than a palette-only entry');
  assert.match(interaction, /lm741Dots\.length === 8/,
    'the browser proof must require every physical LM741 pin to remain wireable');
  assert.equal(PART_SYMBOLS.lm741.kicadSymbol, 'Amplifier_Operational:LM741');
  assert.equal(PART_SYMBOLS.lm741.kicadFootprint, 'Package_DIP:DIP-8_W7.62mm');
});

test('EasyEDA and KiCad exact LM741 names retain all eight physical pins', () => {
  const expected = Object.fromEntries(terminals.map((name, i) => [String(i + 1), name]));
  const easy = mapEasyEdaPart({descriptor: 'LM741CN', value: 'LM741', spicePre: 'U', pinCount: 8, package: 'DIP-8'});
  assert.equal(easy.kind, 'lm741');
  assert.deepEqual(easy.pins, expected);
  const kicad = mapKicadSymbol('Amplifier_Operational:LM741', 'LM741');
  assert.equal(kicad.kind, 'lm741');
  assert.deepEqual(kicad.terminals, terminals);
  for (let pin = 1; pin <= 8; pin++) {
    assert.equal(terminalFor(kicad, String(pin), '~'), terminals[pin - 1]);
  }
  assert.equal(mapKicadSymbol('Amplifier_Operational:TL072', 'TL072').kind, 'opamp',
    'unmodelled op-amp families remain the explicit generic approximation');
});

test('the exact pinned engine solves a dual-supply LM741 voltage follower', () => {
  assert.ok(getDevice('lm741'), 'the pinned engine registers the named real part');
  const board = new BoardImpl(5);
  board.setNetlist([
    {id: 'VP', kind: 'vsource', params: {volts: 15}, terminals: ['pos', 'neg']},
    {id: 'VN', kind: 'vsource', params: {volts: 15}, terminals: ['pos', 'neg']},
    {id: 'VI', kind: 'vsource', params: {volts: 1}, terminals: ['pos', 'neg']},
    {id: 'G', kind: 'gnd', params: {}, terminals: ['gnd']},
    {id: 'U1', kind: 'lm741', params: {}, terminals},
    {id: 'RL', kind: 'resistor', params: {ohms: 100000}, terminals: ['a', 'b']},
  ], [
    {id: 'gnd', terminals: [
      {part: 'G', terminal: 'gnd'}, {part: 'VP', terminal: 'neg'},
      {part: 'VN', terminal: 'pos'}, {part: 'VI', terminal: 'neg'}, {part: 'RL', terminal: 'b'},
    ]},
    {id: 'vpos', terminals: [{part: 'VP', terminal: 'pos'}, {part: 'U1', terminal: 'vpos'}]},
    {id: 'vneg', terminals: [{part: 'VN', terminal: 'neg'}, {part: 'U1', terminal: 'vneg'}]},
    {id: 'input', terminals: [{part: 'VI', terminal: 'pos'}, {part: 'U1', terminal: 'inp'}]},
    {id: 'output', terminals: [
      {part: 'U1', terminal: 'inn'}, {part: 'U1', terminal: 'out'}, {part: 'RL', terminal: 'a'},
    ]},
  ]);
  board.advanceTo(10_000n);
  assert.ok(Math.abs(board.nodeVoltage('output') - 1.001) < 0.02,
    `real LM741 follower output was ${board.nodeVoltage('output')} V`);
});
