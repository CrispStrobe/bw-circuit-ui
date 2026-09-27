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
const terminals = ['vin', 'gnd', 'en', 'nc', 'vout'];
const partsSha = '897eee90699d8d01cfabca294f7d5d6703bb01fb';
const symbolSha = '4bb81b51e80c66b9ec9ec5c1fba4baa49b0f364a49fe6bb7c6bd6eefa09e6642';

registerAllDevices();

test('the vendored ADP151 is the exact five-lead TSOT sibling part', () => {
  const sidecar = getSidecar('adp151');
  assert.ok(sidecar, 'generated parts-data index exposes ADP151');
  assert.deepEqual(sidecar.terminals.map(t => t.name), terminals);
  assert.equal('footprint' in sidecar, false, 'TSOT is not a breadboard package');
  assert.equal(JSON.parse(read('.github/ci-siblings.json'))['bw-parts'].sha, partsSha);
  assert.match(read('src/parts-data/adp151.svg'), />ADP151</);
  assert.match(sidecar._note, /LFCSP and WLCSP imports must not acquire this face/);
});

test('palette, canvas, BOM and export metadata name only the physical TSOT part', () => {
  assert.match(read('src/components/PartPalette.jsx'), /kind: 'adp151', label: 'ADP151'/);
  assert.match(read('src/components/BoardCanvas.jsx'), /data-tsot-body/);
  assert.match(read('src/model/bom.js'), /adp151: 'ADP151 200mA Ultralow-Noise LDO'/);
  const interaction = read('scripts/verify-interaction.mjs');
  assert.match(interaction, /\[data-part-face="adp151"\]\[data-tsot-body="adp151"\]/);
  assert.match(interaction, /adp151Dots\.length === 5/);
  assert.equal(PART_SYMBOLS.adp151.kicadSymbol, undefined);
  assert.equal(PART_SYMBOLS.adp151.kicadFootprint, 'Package_TO_SOT_SMD:TSOT-23-5');
});

test('exact AUJZ order codes retain all five TSOT pins and reject other packages', () => {
  const expected = Object.fromEntries(terminals.map((name, i) => [String(i + 1), name]));
  const easy = mapEasyEdaPart({
    descriptor: 'ADP151AUJZ-3.3-R7', value: 'ADP151AUJZ-3.3-R7', spicePre: 'U',
    pinCount: 5, package: 'TSOT-23-5',
  });
  assert.equal(easy.kind, 'adp151');
  assert.deepEqual(easy.pins, expected);
  const kicad = mapKicadSymbol('Private:ADP151AUJZ-3.3-R7', 'ADP151AUJZ-3.3-R7');
  assert.equal(kicad.kind, 'adp151');
  assert.deepEqual(kicad.terminals, terminals);
  for (let pin = 1; pin <= 5; pin++) {
    assert.equal(terminalFor(kicad, String(pin), '~'), terminals[pin - 1]);
  }
  assert.notEqual(mapKicadSymbol('Private:ADP151ACPZ-3.3-R7', 'ADP151ACPZ-3.3-R7')?.kind,
    'adp151', 'the six-lead LFCSP must not borrow the TSOT face');
  assert.notEqual(mapKicadSymbol('Private:ADP151ACBZ-3.3-R7', 'ADP151ACBZ-3.3-R7')?.kind,
    'adp151', 'the four-ball WLCSP must not borrow the TSOT face');
});

const asc = voltage => `Version 4
SHEET 1 800 600
SYMBOL PowerProducts\\ADP151-${voltage} 200 200 R0
SYMATTR InstName U1
`;

test('the audited LTspice fixed-output symbol stays package-neutral and model-blocked', () => {
  const result = importLtspiceAsc(asc('3.3'));
  assert.deepEqual(result.unmapped, []);
  assert.equal(result.losses.length, 1);
  assert.equal(result.losses[0].kind, 'source-model-substitution');
  assert.match(result.losses[0].source,
    /SpiceModel ADP151-x\.x\.sub.*Value2 ADP151-x\.x T=2\.3Meg/);
  assert.equal(result.parts[0].kind, 'adp151');
  assert.deepEqual(result.parts[0].terminals, ['vin', 'gnd', 'en', 'vout']);
  assert.deepEqual(result.parts[0].params, { vOut: 3.3 });
  assert.equal(result.parts[0].sourcePackage, 'unspecified');
  assert.equal(result.parts[0].verifiedBuiltinSymbolSha256, symbolSha);
  assert.equal(result.parts[0].sourceModelFile, 'ADP151-x.x.sub');
  assert.equal(result.parts[0].sourceSubcircuit, 'ADP151-x.x T=2.3Meg');
  const restored = Circuit.fromJSON({ parts: result.parts, wires: result.wires });
  assert.equal(restored.analysisBlockers.length, 1);
  assert.throws(() => restored.operatingPoint(), /blocked by 1 persisted import finding/);
});

test('every internally consistent LTspice voltage selects its documented native output', () => {
  for (const voltage of ['1.1', '1.2', '1.5', '1.8', '2.5', '2.6', '2.75', '2.8', '3.0', '3.3']) {
    const result = importLtspiceAsc(asc(voltage));
    assert.deepEqual(result.unmapped, [], voltage);
    assert.equal(result.parts[0].params.vOut, Number(voltage), voltage);
    assert.equal(result.losses[0].kind, 'source-model-substitution', voltage);
  }
});

test('the corrupt built-in 2.85 symbol remains refused by name', () => {
  const result = importLtspiceAsc(asc('2.85'));
  assert.equal(result.parts.length, 0);
  assert.equal(result.unmapped.length, 1);
  assert.match(result.unmapped[0].libsource, /ADP151-2\.85: no symbol pin definition/);
});

function regulatorRig({ vOut = 3.3, loadOhms = 1000, enabled = true } = {}) {
  const board = new BoardImpl(5);
  board.setNetlist([
    { id: 'VIN', kind: 'vsource', params: { volts: 5 }, terminals: ['pos', 'neg'] },
    { id: 'VEN', kind: 'vsource', params: { volts: enabled ? 3.3 : 0 }, terminals: ['pos', 'neg'] },
    { id: 'G', kind: 'gnd', params: {}, terminals: ['gnd'] },
    { id: 'U1', kind: 'adp151', params: { vOut }, terminals },
    { id: 'RL', kind: 'resistor', params: { ohms: loadOhms }, terminals: ['a', 'b'] },
  ], [
    { id: 'vin', terminals: [{ part: 'VIN', terminal: 'pos' }, { part: 'U1', terminal: 'vin' }] },
    { id: 'en', terminals: [{ part: 'VEN', terminal: 'pos' }, { part: 'U1', terminal: 'en' }] },
    { id: 'out', terminals: [{ part: 'U1', terminal: 'vout' }, { part: 'RL', terminal: 'a' }] },
    { id: 'gnd', terminals: [
      { part: 'G', terminal: 'gnd' }, { part: 'VIN', terminal: 'neg' },
      { part: 'VEN', terminal: 'neg' }, { part: 'U1', terminal: 'gnd' },
      { part: 'RL', terminal: 'b' },
    ] },
  ]);
  board.advanceTo(1n);
  return board;
}

test('the exact pinned engine solves enabled, disabled and loaded ADP151 circuits', () => {
  assert.ok(getDevice('adp151'), 'the pinned engine registers the real regulator');
  const nominal = regulatorRig();
  assert.ok(Math.abs(nominal.nodeVoltage('out') - 3.3) < 0.003,
    `3.3 V output was ${nominal.nodeVoltage('out')} V`);
  const loaded = regulatorRig({ vOut: 3.3, loadOhms: 15 });
  assert.ok(loaded.nodeVoltage('out') > 3.05 && loaded.nodeVoltage('out') < 3.3,
    `loaded dropout/current-limit output was ${loaded.nodeVoltage('out')} V`);
  const off = regulatorRig({ enabled: false });
  assert.ok(Math.abs(off.nodeVoltage('out')) < 1e-4,
    `disabled output was ${off.nodeVoltage('out')} V`);
});
