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
const terminals = ['out', 'sense_adj', 'gnd_3', 'byp', 'shdn', 'gnd_6', 'gnd_7', 'in'];

registerAllDevices();

test('the vendored LT1763 is the exact physical SO-8 sibling part', () => {
  const sidecar = getSidecar('lt1763');
  assert.ok(sidecar, 'generated parts-data index exposes LT1763 to every bundler');
  assert.deepEqual(sidecar.terminals.map(t => t.name), terminals);
  assert.equal('footprint' in sidecar, false, 'surface-mount package must not claim breadboard seating');
  const pins = JSON.parse(read('.github/ci-siblings.json'));
  assert.equal(pins['bw-parts'].sha, '395d50027b894d8a97b3158641b92f561c0609e2');
  assert.match(read('src/parts-data/lt1763.svg'), />LT1763</);
});

test('palette, canvas and export metadata name the real LT1763', () => {
  const palette = read('src/components/PartPalette.jsx');
  const canvas = read('src/components/BoardCanvas.jsx');
  const interaction = read('scripts/verify-interaction.mjs');
  assert.match(palette, /kind: 'lt1763', label: 'LT1763'/);
  assert.match(canvas, /case 'lt1763'/);
  assert.match(canvas, /500mA LDO · SO-8/);
  assert.match(interaction, /\[data-part-face="lt1763"\]\[data-soic-body="lt1763"\]/);
  assert.match(interaction, /ltDots\.length === 8/);
  assert.equal(PART_SYMBOLS.lt1763.kicadSymbol, undefined,
    'KiCad has no official LT1763 symbol, so the exporter must not invent one');
  assert.equal(PART_SYMBOLS.lt1763.kicadFootprint, 'Package_SO:SOIC-8_3.9x4.9mm_P1.27mm');
});

test('EasyEDA and custom KiCad exact LT1763 names retain all eight physical pins', () => {
  const expected = Object.fromEntries(terminals.map((name, i) => [String(i + 1), name]));
  const easy = mapEasyEdaPart({
    descriptor: 'LT1763CS8-5#PBF', value: 'LT1763', spicePre: 'U',
    pinCount: 8, package: 'SO-8',
  });
  assert.equal(easy.kind, 'lt1763');
  assert.deepEqual(easy.pins, expected);
  const kicad = mapKicadSymbol('MyPower:LT1763CS8-5', 'LT1763CS8-5');
  assert.equal(kicad.kind, 'lt1763');
  assert.deepEqual(kicad.terminals, terminals);
  for (let pin = 1; pin <= 8; pin++) {
    assert.equal(terminalFor(kicad, String(pin), '~'), terminals[pin - 1]);
  }
  assert.notEqual(mapKicadSymbol('MyPower:LT1762-5', 'LT1762-5')?.kind, 'lt1763',
    'a nearby but electrically different regulator must not inherit this model');
});

function ldoRig({ adjustable = false } = {}) {
  const board = new BoardImpl(5);
  const parts = [
    { id: 'VIN', kind: 'vsource', params: { volts: 8 }, terminals: ['pos', 'neg'] },
    { id: 'SHDN', kind: 'vsource', params: { volts: 3.3 }, terminals: ['pos', 'neg'] },
    { id: 'G', kind: 'gnd', params: {}, terminals: ['gnd'] },
    { id: 'U1', kind: 'lt1763', params: adjustable ? { adjustable: true } : { vOut: 5 }, terminals },
    { id: 'RL', kind: 'resistor', params: { ohms: 10000 }, terminals: ['a', 'b'] },
  ];
  const nets = [
    { id: 'vin', terminals: [{ part: 'VIN', terminal: 'pos' }, { part: 'U1', terminal: 'in' }] },
    { id: 'shdn', terminals: [{ part: 'SHDN', terminal: 'pos' }, { part: 'U1', terminal: 'shdn' }] },
    { id: 'out', terminals: [{ part: 'U1', terminal: 'out' }, { part: 'RL', terminal: 'a' }] },
    { id: 'byp', terminals: [{ part: 'U1', terminal: 'byp' }] },
    { id: 'gnd', terminals: [
      { part: 'G', terminal: 'gnd' }, { part: 'VIN', terminal: 'neg' },
      { part: 'SHDN', terminal: 'neg' }, { part: 'U1', terminal: 'gnd_3' },
      { part: 'U1', terminal: 'gnd_6' }, { part: 'U1', terminal: 'gnd_7' },
      { part: 'RL', terminal: 'b' },
    ] },
  ];
  if (adjustable) {
    parts.push(
      { id: 'RT', kind: 'resistor', params: { ohms: 30000 }, terminals: ['a', 'b'] },
      { id: 'RB', kind: 'resistor', params: { ohms: 10000 }, terminals: ['a', 'b'] },
    );
    nets[2].terminals.push({ part: 'RT', terminal: 'a' });
    nets.push({ id: 'sense', terminals: [
      { part: 'U1', terminal: 'sense_adj' }, { part: 'RT', terminal: 'b' }, { part: 'RB', terminal: 'a' },
    ] });
    nets[4].terminals.push({ part: 'RB', terminal: 'b' });
  } else {
    nets[2].terminals.push({ part: 'U1', terminal: 'sense_adj' });
  }
  board.setNetlist(parts, nets);
  board.advanceTo(1n);
  return board;
}

test('the exact pinned engine solves fixed and adjustable LT1763 circuits', () => {
  assert.ok(getDevice('lt1763'), 'the pinned engine registers the named real part');
  const fixed = ldoRig();
  assert.ok(Math.abs(fixed.nodeVoltage('out') - 5) < 0.003,
    `fixed output was ${fixed.nodeVoltage('out')} V`);
  const adjustable = ldoRig({ adjustable: true });
  assert.ok(Math.abs(adjustable.nodeVoltage('sense') - 1.22) < 0.004,
    `adjustable sense was ${adjustable.nodeVoltage('sense')} V`);
  assert.ok(Math.abs(adjustable.nodeVoltage('out') - 4.88) < 0.015,
    `adjustable output was ${adjustable.nodeVoltage('out')} V`);
});
