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
const terminals = ['vout_1', 'vout_2', 'sense_adj', 'gnd', 'en', 'ss', 'vin_7', 'vin_8'];

registerAllDevices();

test('the vendored ADP7118 is the exact physical SOIC-8 sibling part', () => {
  const sidecar = getSidecar('adp7118');
  assert.ok(sidecar, 'generated parts-data index exposes ADP7118 to every bundler');
  assert.deepEqual(sidecar.terminals.map(t => t.name), terminals);
  assert.equal('footprint' in sidecar, false, 'surface-mount package must not claim breadboard seating');
  const pins = JSON.parse(read('.github/ci-siblings.json'));
  assert.equal(pins['bw-parts'].sha, 'bdadcaa969cfabde737778f013e19cf99602850c');
  assert.match(read('src/parts-data/adp7118.svg'), />ADP7118</);
});

test('palette, canvas, schematic and export metadata name the real LDO', () => {
  const palette = read('src/components/PartPalette.jsx');
  const canvas = read('src/components/BoardCanvas.jsx');
  const interaction = read('scripts/verify-interaction.mjs');
  assert.match(palette, /kind: 'adp7118', label: 'ADP7118'/);
  assert.match(canvas, /case 'adp7118'/);
  assert.match(canvas, /data-soic-body=\{kind === 'adp151' \? undefined : kind\}/,
    'the shared surface-mount renderer exposes a SOIC marker only for SOIC/SO-8 parts');
  assert.match(interaction, /\[data-part-face="adp7118"\]\[data-soic-body="adp7118"\]/);
  assert.match(interaction, /adpDots\.length === 8/);
  assert.equal(PART_SYMBOLS.adp7118.kicadSymbol, 'Regulator_Linear:ADP7118ARDZ');
  assert.equal(PART_SYMBOLS.adp7118.kicadFootprint,
    'Package_SO:SOIC-8-1EP_3.9x4.9mm_P1.27mm_EP2.29x3mm');
});

test('EasyEDA and KiCad exact ADP7118 names retain all eight physical pins', () => {
  const expected = Object.fromEntries(terminals.map((name, i) => [String(i + 1), name]));
  const easy = mapEasyEdaPart({
    descriptor: 'ADP7118ARDZ-5.0-R7', value: 'ADP7118', spicePre: 'U',
    pinCount: 8, package: 'SOIC-8-EP',
  });
  assert.equal(easy.kind, 'adp7118');
  assert.deepEqual(easy.pins, expected);
  const kicad = mapKicadSymbol('Regulator_Linear:ADP7118ARDZ', 'ADP7118ARDZ-5.0');
  assert.equal(kicad.kind, 'adp7118');
  assert.deepEqual(kicad.terminals, terminals);
  for (let pin = 1; pin <= 8; pin++) {
    assert.equal(terminalFor(kicad, String(pin), '~'), terminals[pin - 1]);
  }
  assert.notEqual(mapKicadSymbol('Regulator_Linear:ADP7142ARDZ', 'ADP7142')?.kind, 'adp7118',
    'a nearby but electrically different regulator must not inherit this model');
});

function ldoRig({adjustable = false} = {}) {
  const board = new BoardImpl(5);
  const parts = [
    {id: 'VIN', kind: 'vsource', params: {volts: 8}, terminals: ['pos', 'neg']},
    {id: 'VEN', kind: 'vsource', params: {volts: 3.3}, terminals: ['pos', 'neg']},
    {id: 'G', kind: 'gnd', params: {}, terminals: ['gnd']},
    {id: 'U1', kind: 'adp7118', params: adjustable ? {adjustable: true} : {vOut: 5}, terminals},
    {id: 'RL', kind: 'resistor', params: {ohms: 10000}, terminals: ['a', 'b']},
  ];
  const nets = [
    {id: 'vin7', terminals: [{part: 'VIN', terminal: 'pos'}, {part: 'U1', terminal: 'vin_7'}]},
    {id: 'vin8', terminals: [{part: 'U1', terminal: 'vin_8'}]},
    {id: 'en', terminals: [{part: 'VEN', terminal: 'pos'}, {part: 'U1', terminal: 'en'}]},
    {id: 'out', terminals: [{part: 'U1', terminal: 'vout_1'}, {part: 'RL', terminal: 'a'}]},
    {id: 'out2', terminals: [{part: 'U1', terminal: 'vout_2'}]},
    {id: 'ss', terminals: [{part: 'U1', terminal: 'ss'}]},
    {id: 'gnd', terminals: [
      {part: 'G', terminal: 'gnd'}, {part: 'VIN', terminal: 'neg'},
      {part: 'VEN', terminal: 'neg'}, {part: 'U1', terminal: 'gnd'}, {part: 'RL', terminal: 'b'},
    ]},
  ];
  if (adjustable) {
    parts.push(
      {id: 'RT', kind: 'resistor', params: {ohms: 30000}, terminals: ['a', 'b']},
      {id: 'RB', kind: 'resistor', params: {ohms: 10000}, terminals: ['a', 'b']},
    );
    nets[3].terminals.push({part: 'RT', terminal: 'a'});
    nets.push({id: 'sense', terminals: [
      {part: 'U1', terminal: 'sense_adj'}, {part: 'RT', terminal: 'b'}, {part: 'RB', terminal: 'a'},
    ]});
    nets[6].terminals.push({part: 'RB', terminal: 'b'});
  } else {
    nets[3].terminals.push({part: 'U1', terminal: 'sense_adj'});
  }
  board.setNetlist(parts, nets);
  board.advanceTo(1n);
  return board;
}

test('the exact pinned engine solves fixed and adjustable ADP7118 circuits', () => {
  assert.ok(getDevice('adp7118'), 'the pinned engine registers the named real part');
  const fixed = ldoRig();
  assert.ok(Math.abs(fixed.nodeVoltage('out') - 5) < 0.002,
    `fixed output was ${fixed.nodeVoltage('out')} V`);
  const adjustable = ldoRig({adjustable: true});
  assert.ok(Math.abs(adjustable.nodeVoltage('sense') - 1.2) < 0.004,
    `adjustable sense was ${adjustable.nodeVoltage('sense')} V`);
  assert.ok(Math.abs(adjustable.nodeVoltage('out') - 4.8) < 0.015,
    `adjustable output was ${adjustable.nodeVoltage('out')} V`);
});
