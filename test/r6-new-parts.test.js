/**
 * The silicon PTC sensor, the 4046 PLL, the ruler scale and the spark gap,
 * and the surroundings-temperature slider (bw-board thermal.js surroundC):
 * placeable, seatable, wireable and learner-controllable on the same
 * surfaces as the sensing transducers.
 *
 * Like sensing-transducer-parts.test.js this file does NOT import ./_setup.js.
 */
import { setEngine } from '../src/engine.js';
import { BoardImpl } from 'bw-board/board.js';
import { inferNetlist, checkWiring } from 'bw-board/infer-netlist.js';
import { getDevice } from 'bw-board/devices.js';
import { registerAllDevices } from 'bw-board/register-all.js';
import { getMaxCurrent, PORT_LIMITS } from 'bw-board/current-ratings.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Circuit, terminalsForKind } from '../src/model/circuit.js';
import { FOOTPRINTS } from '../src/model/footprints.js';
import { ART_FACE_KINDS } from '../src/model/part-art.js';
import { PALETTE_DE } from '../src/i18n/palette-de.js';
import { t } from '../src/i18n/strings.js';

registerAllDevices();
setEngine({ BoardImpl, inferNetlist, checkWiring, getMaxCurrent, PORT_LIMITS, getDevice });

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(path.join(here, '..', rel), 'utf8');
const sidecar = (kind) => JSON.parse(read(`src/parts-data/${kind}.json`));
const CANVAS = read('src/components/BoardCanvas.jsx');
const PALETTE = read('src/components/PartPalette.jsx');
const STIMULI = read('src/components/StimulusControls.jsx');
const TOOLTIP = read('src/components/PartTooltip.jsx');

const KINDS = {
  ptc_sensor: ['a', 'b'],
  spark_gap: ['a', 'b'],
  bending_ruler: ['vcc', 'gnd', 'ao'],
};

test('every new lead kind: built-in footprint equal to its sidecar, engine terminal names, an engine device, its art', () => {
  for (const [kind, terms] of Object.entries(KINDS)) {
    const sc = sidecar(kind);
    assert.deepEqual(FOOTPRINTS[kind]?.leads, sc.footprint.leads, `${kind} leads`);
    assert.equal(FOOTPRINTS[kind].refTerminal, sc.footprint.refTerminal, `${kind} refTerminal`);
    assert.deepEqual(terminalsForKind(kind, {}), terms, kind);
    assert.deepEqual(sc.terminals.map((x) => x.name), terms, `${kind} sidecar`);
    assert.ok(getDevice(kind), `${kind}: bw-board models it`);
    assert.ok(ART_FACE_KINDS.includes(kind), `${kind}: drawn with its art`);
  }
  const body = CANVAS.slice(CANVAS.indexOf('function terminalOffsetsForPart'), CANVAS.indexOf('function terminalPos'));
  for (const kind of Object.keys(KINDS)) assert.match(body, new RegExp(`case '${kind}':`), `${kind}: canvas pins from the sidecar`);
});

test('the 4046 is a DIP-16 drawn with its breadboard art, on the engine terminal names', () => {
  const sc = sidecar('cd4046');
  const terms = ['pcp_out', 'pc1_out', 'comp_in', 'vco_out', 'inh', 'c1a', 'c1b', 'vss',
    'vco_in', 'dem_out', 'r1', 'r2', 'pc2_out', 'sig_in', 'zener', 'vdd'];
  assert.deepEqual(sc.terminals.map((x) => x.name), terms);
  assert.equal(sc.footprint.straddlesGutter, true);
  assert.deepEqual(getDevice('cd4046').terminals, terms);
  assert.ok(ART_FACE_KINDS.includes('cd4046'));
});

test('seated on a breadboard, a PTC in ice water reads less than at the bench', () => {
  const build = (surroundC) => {
    const c = Circuit.fromJSON({
      vcc: 5,
      parts: [
        { id: 'bb1', kind: 'breadboard', params: {}, terminals: [], x: 0, y: 0, rotation: 0 },
        { id: 's', kind: 'ptc_sensor', params: { surroundC, thermalTau: 0.2 }, x: 0, y: 0, rotation: 0,
          seat: { boardId: 'bb1', leadMap: { a: 'a10', b: 'a12' } } },
        { id: 'r', kind: 'resistor', params: { ohms: 2000 }, x: 0, y: 0, rotation: 0,
          seat: { boardId: 'bb1', leadMap: { a: 'b8', b: 'b10' } } },
        { id: 'v', kind: 'vcc', params: {}, x: 0, y: 0, rotation: 0 },
        { id: 'g', kind: 'gnd', params: {}, x: 0, y: 0, rotation: 0 },
      ],
      wires: [{ from: { part: 'v', terminal: 'vcc' }, to: { part: 'r', terminal: 'a' } },
        { from: { part: 'g', terminal: 'gnd' }, to: { part: 's', terminal: 'b' } }],
    });
    c.board.setPower(true);
    c.board.advanceTo(2_000_000_000n);
    const n = c.board.getNets().find((x) => x.terminals.some((p) => p.part === 's' && p.terminal === 'a'));
    return c.board.nodeVoltages.get(n.id);
  };
  const room = build(25);
  const ice = build(0);
  assert.ok(Math.abs(room - 2.5) < 0.02, `2 k against 2 k at 25 °C: ${room} V`);
  // R(0 °C) = 2000 (1 - 0.197 + 0.0121) = 1630 Ohm: 5 x 1630/3630 = 2.245 V.
  assert.ok(Math.abs(ice - 2.245) < 0.02, `ice water: ${ice} V`);
});

/** The palette entry object literal that carries this label. */
function paletteEntry(label) {
  const at = PALETTE.indexOf(`label: '${label}'`);
  assert.ok(at > 0, `palette entry "${label}"`);
  const start = PALETTE.lastIndexOf('{ kind:', at);
  return PALETTE.slice(start, PALETTE.indexOf('\n', at));
}

test('palette: the new parts with German labels and tooltips', () => {
  const expect = [
    ['Silicon PTC sensor', 'ptc_sensor', ['r25: 2000', 'surroundC: 25']],
    ['NPN on a lead (thermometer)', 'npn', ['surroundC: 25']],
    ['Ruler scale (Hall)', 'bending_ruler', ['loadG: 0']],
    ['Spark gap', 'spark_gap', ['gapMm: 1']],
    ['4046 PLL', 'cd4046', []],
  ];
  for (const [label, kind, params] of expect) {
    const entry = paletteEntry(label);
    assert.ok(entry.includes(`kind: '${kind}'`), `${label}: kind ${kind}`);
    for (const p of params) assert.ok(entry.includes(p), `${label}: param ${p}`);
    assert.ok(PALETTE_DE[label], `${label}: German label`);
    const tip = PALETTE.slice(PALETTE.indexOf(`label: '${label}'`)).match(/tooltip: '([^']*)'/)[1];
    assert.ok(PALETTE_DE[tip], `${label}: German tooltip`);
  }
});

test('stimulus panel: surroundings temperature, ruler load and spark gap sliders; tooltip readouts', () => {
  for (const [param, what] of [['surroundC', 'surroundings temperature'], ['loadG', 'ruler load'], ['gapMm', 'spark gap']]) {
    assert.match(STIMULI, new RegExp(`param="${param}"`), `${what} slider`);
  }
  for (const k of ['stimTemp', 'stimTempTitle', 'stimIce', 'stimFingers', 'stimHotWater', 'stimLoad', 'stimLoadTitle', 'stimGap', 'stimGapTitle']) {
    assert.ok(t(k, 'en') !== k && t(k, 'de') !== k, `${k}: English and German`);
  }
  for (const kind of [...Object.keys(KINDS), 'cd4046']) assert.match(TOOLTIP, new RegExp(`case '${kind}':`), `${kind}: tooltip readout`);
});

test('the load slider reaches the engine: loadG through setPartParam raises the Hall output', () => {
  const b = new BoardImpl(5);
  const T = (part, terminal) => ({ part, terminal });
  b.setNetlist([
    { id: 'V', kind: 'vcc', params: {}, terminals: ['vcc'] },
    { id: 'G', kind: 'gnd', params: {}, terminals: ['gnd'] },
    { id: 'S', kind: 'bending_ruler', params: { loadG: 0 }, terminals: ['vcc', 'gnd', 'ao'] },
    { id: 'R', kind: 'resistor', params: { ohms: 100000 }, terminals: ['a', 'b'] },
  ], [{ id: 'v', terminals: [T('V', 'vcc'), T('S', 'vcc')] }, { id: 'o', terminals: [T('S', 'ao'), T('R', 'a')] },
    { id: 'g', terminals: [T('G', 'gnd'), T('S', 'gnd'), T('R', 'b')] }]);
  b.setPower(true);
  b.advanceTo(1_000_000n);
  const rest = b.nodeVoltages.get('o');
  b.setPartParam('S', 'loadG', 100);
  b.advanceTo(2_000_000n);
  assert.ok(b.nodeVoltages.get('o') - rest > 0.1, `100 g lifts the output: ${rest} -> ${b.nodeVoltages.get('o')} V`);
});
