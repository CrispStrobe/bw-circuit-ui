/**
 * The sensing transducers — thermocouple, hand-wound coil (air_coil),
 * electrolysis cell — and the speaker/earphone used as a microphone are
 * placeable, seatable, wireable and learner-controllable, on the same
 * surfaces as their nearest relatives (the speaker parts for art and
 * seating, the sound module's stimulus panel for sliders).
 *
 * Like speaker-radio-parts.test.js this file does NOT import ./_setup.js: it
 * loads the way a headless gate does, with no sidecars registered, and reads
 * the sidecars from disk to hold the built-in copies equal to them.
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
  thermocouple: ['pos', 'neg'],
  air_coil: ['a', 'b'],
  electrolysis_cell: ['a', 'b'],
};

test('every new kind: built-in footprint equal to its sidecar, engine terminal names, an engine device', () => {
  for (const [kind, terms] of Object.entries(KINDS)) {
    const sc = sidecar(kind);
    assert.deepEqual(FOOTPRINTS[kind]?.leads, sc.footprint.leads, `${kind} leads`);
    assert.equal(FOOTPRINTS[kind].refTerminal, sc.footprint.refTerminal, `${kind} refTerminal`);
    assert.deepEqual(terminalsForKind(kind, {}), terms, kind);
    assert.deepEqual(sc.terminals.map((t) => t.name), terms, `${kind} sidecar`);
    assert.ok(getDevice(kind), `${kind}: bw-board models it`);
    assert.ok(ART_FACE_KINDS.includes(kind), `${kind}: drawn with its art`);
  }
  const body = CANVAS.slice(CANVAS.indexOf('function terminalOffsetsForPart'), CANVAS.indexOf('function terminalPos'));
  for (const kind of Object.keys(KINDS)) assert.match(body, new RegExp(`case '${kind}':`), `${kind}: canvas pins from the sidecar`);
});

test('seated on a breadboard, a thermocouple drives the amplifier it is wired to', () => {
  const c = Circuit.fromJSON({
    vcc: 9,
    parts: [
      { id: 'bb1', kind: 'breadboard', params: {}, terminals: [], x: 0, y: 0, rotation: 0 },
      { id: 'tc', kind: 'thermocouple', params: { type: 'K', hotC: 525 }, x: 0, y: 0, rotation: 0,
        seat: { boardId: 'bb1', leadMap: { pos: 'a10', neg: 'a11' } } },
      { id: 'r', kind: 'resistor', params: { ohms: 1e6 }, x: 0, y: 0, rotation: 0,
        seat: { boardId: 'bb1', leadMap: { a: 'b10', b: 'b11' } } },
      { id: 'g', kind: 'gnd', params: {}, x: 0, y: 0, rotation: 0 },
    ],
    wires: [{ from: { part: 'g', terminal: 'gnd' }, to: { part: 'r', terminal: 'b' } }],
  });
  c.board.setPower(true);
  const n = c.board.getNets().find((x) => x.terminals.some((t) => t.part === 'r' && t.terminal === 'a'));
  // K: E(525 °C) − E(25 °C) ≈ 20.7 mV.
  const v = c.board.nodeVoltages.get(n.id);
  assert.ok(Math.abs(v - 0.0207) < 0.0005, `thermocouple EMF across the resistor: ${v} V`);
  assert.ok(Math.abs(c.board.getDeviceState('tc').emfV - v) < 1e-6);
});

/** The palette entry object literal that carries this label. */
function paletteEntry(label) {
  const at = PALETTE.indexOf(`label: '${label}'`);
  assert.ok(at > 0, `palette entry "${label}"`);
  const start = PALETTE.lastIndexOf('{ kind:', at);
  return PALETTE.slice(start, PALETTE.indexOf('\n', at));
}

test('palette: the new parts and the listening transducers, with German labels and tooltips', () => {
  const expect = [
    ['Thermocouple type K', 'thermocouple', ["type: 'K'", 'hotC: 25']],
    ['Thermocouple copper/constantan', 'thermocouple', ["type: 'T'"]],
    ['Hand-wound coil', 'air_coil', ['turns: 200', 'radiusM: 0.015', 'lengthM: 0.03', 'wireMm: 0.25']],
    ['Electrolyte (tongue)', 'electrolysis_cell', ['ohms: 2000', 'onsetV: 1.7']],
    ['Speaker as microphone', 'speaker', ['soundDb: 85', "soundWave: 'voice'"]],
    ['Earphone as microphone', 'earphone', ["type: 'magnetic'", 'soundDb: 85']],
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

test('stimulus panel: sound level, hearing distance, flame, magnet drop and metal distance', () => {
  for (const [param, what] of [['soundDb', 'sound level'], ['distanceCm', 'distance to the heard part'],
    ['hotC', 'hot junction'], ['metalCm', 'metal distance']]) {
    assert.match(STIMULI, new RegExp(`param="${param}"`), `${what} slider`);
  }
  assert.match(STIMULI, /onSetParam\(partId, 'drops', count\.current\)/, 'a magnet drop bumps params.drops');
  for (const k of ['stimVoice', 'stimHeat', 'stimMatch', 'stimLighter', 'stimDrop', 'stimMetal', 'stimHearsTitle']) {
    assert.ok(t(k, 'en') !== k && t(k, 'de') !== k && t(k, 'en') !== t(k, 'de'), `${k}: English and German`);
  }
  for (const kind of Object.keys(KINDS)) assert.match(TOOLTIP, new RegExp(`case '${kind}':`), `${kind}: tooltip readout`);
});

test('the drop control reaches the engine: bumping drops through setPartParam induces a pulse', () => {
  const b = new BoardImpl(5);
  const T = (part, terminal) => ({ part, terminal });
  b.setNetlist([
    { id: 'G', kind: 'gnd', params: {}, terminals: ['gnd'] },
    { id: 'L', kind: 'air_coil', params: { turns: 1000 }, terminals: ['a', 'b'] },
    { id: 'R', kind: 'resistor', params: { ohms: 10000 }, terminals: ['a', 'b'] },
  ], [{ id: 'g', terminals: [T('G', 'gnd'), T('L', 'b'), T('R', 'b')] }, { id: 'o', terminals: [T('L', 'a'), T('R', 'a')] }]);
  b.setPower(true);
  b.advanceTo(5_000_000n);
  b.setPartParam('L', 'drops', 1);
  let peak = 0;
  for (let ms = 6; ms <= 200; ms += 2) { b.advanceTo(BigInt(ms) * 1_000_000n); peak = Math.max(peak, b.nodeVoltages.get('o')); }
  assert.ok(peak > 0.5, `pulse after the drop: ${peak} V`);
});
