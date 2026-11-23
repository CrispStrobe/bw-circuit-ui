/**
 * Speaker, earphone and the crystal-set parts (antenna, earth, tuning_cap,
 * ferrite_coil) are placeable, seatable, wireable, audible and — for the
 * tuning capacitor — turnable, on the same surfaces as their nearest
 * existing relatives (piezo/buzzer for sound, potentiometer for the knob).
 *
 * Like two-lead-builtin-footprints.test.js this file deliberately does NOT
 * import ./_setup.js: it loads the way a headless gate does, with no sidecars
 * registered, so a seat that only works when the sidecars happen to be
 * registered shows up here. The sidecars are read from disk to hold the
 * built-in copies equal to them.
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
import { registeredKinds } from '../src/model/parts-registry.js';
import { PALETTE_DE } from '../src/i18n/palette-de.js';

registerAllDevices();
setEngine({ BoardImpl, inferNetlist, checkWiring, getMaxCurrent, PORT_LIMITS, getDevice });

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(path.join(here, '..', rel), 'utf8');
const sidecar = (kind) => JSON.parse(read(`src/parts-data/${kind}.json`));
const CANVAS = read('src/components/BoardCanvas.jsx');
const PALETTE = read('src/components/PartPalette.jsx');
const DESIGNER = read('src/components/CircuitDesigner.jsx');
const TOOLTIP = read('src/components/PartTooltip.jsx');

const KINDS = {
  speaker: ['a', 'b'],
  earphone: ['a', 'b'],
  antenna: ['a'],
  earth: ['earth'],
  tuning_cap: ['a', 'b'],
  ferrite_coil: ['a', 'tap', 'b', 'c1', 'c2'],
  // Round 4: the VHF coil and the varicap.
  air_coil: ['a', 'b'],
  varicap: ['anode', 'cathode'],
};

test('headless: no sidecars are registered in this file', () => {
  assert.equal(registeredKinds().length, 0);
});

test('every new kind has a built-in footprint equal to its sidecar', () => {
  for (const kind of Object.keys(KINDS)) {
    const sc = sidecar(kind);
    assert.ok(FOOTPRINTS[kind], `${kind}: built-in footprint`);
    assert.deepEqual(FOOTPRINTS[kind].leads, sc.footprint.leads, `${kind} leads`);
    assert.equal(FOOTPRINTS[kind].refTerminal, sc.footprint.refTerminal, `${kind} refTerminal`);
  }
});

test('terminal names are the engine\'s, even with no sidecar registered', () => {
  for (const [kind, terms] of Object.entries(KINDS)) {
    assert.deepEqual(terminalsForKind(kind, {}), terms, kind);
    assert.deepEqual(sidecar(kind).terminals.map((t) => t.name), terms, `${kind} sidecar`);
  }
});

const bench = (part) => ({
  vcc: 9,
  parts: [
    { id: 'bb1', kind: 'breadboard', params: {}, terminals: [], x: 0, y: 0, rotation: 0 },
    { ...part, x: 0, y: 0, rotation: 0 },
  ],
  wires: [],
});
const seatedTerminalsOf = (c, id) => c.parts.find((p) => p.id === id)?.seat?.leadMap;

test('a seated ferrite coil keeps its five-hole seat', () => {
  const leadMap = { a: 'a10', tap: 'a11', b: 'a12', c1: 'a13', c2: 'a14' };
  const c = Circuit.fromJSON(bench({ id: 'L1', kind: 'ferrite_coil', params: {}, seat: { boardId: 'bb1', leadMap } }));
  assert.deepEqual(seatedTerminalsOf(c, 'L1'), leadMap);
  // Each lead on its own strip: five distinct nets, none missing.
  const nets = Object.keys(leadMap).map((t) => c.board.getNets()
    .find((n) => (n.terminals || []).some((x) => x.part === 'L1' && x.terminal === t))?.id);
  assert.ok(nets.every(Boolean), `every lead on a net: ${nets}`);
  assert.equal(new Set(nets).size, 5, 'five separate strips');
});

test('one-lead parts seat in one hole: antenna and earth', () => {
  for (const [kind, term] of [['antenna', 'a'], ['earth', 'earth']]) {
    const leadMap = { [term]: 'a20' };
    const c = Circuit.fromJSON(bench({ id: 'X1', kind, params: {}, seat: { boardId: 'bb1', leadMap } }));
    assert.deepEqual(seatedTerminalsOf(c, 'X1'), leadMap, kind);
  }
});

test('a seated speaker, earphone and tuning capacitor keep their seats', () => {
  for (const [kind, leadMap] of [
    ['speaker', { a: 'a30', b: 'a32' }],
    ['earphone', { a: 'a30', b: 'a31' }],
    ['tuning_cap', { a: 'a30', b: 'a34' }],
  ]) {
    const c = Circuit.fromJSON(bench({ id: 'X1', kind, params: {}, seat: { boardId: 'bb1', leadMap } }));
    assert.deepEqual(seatedTerminalsOf(c, 'X1'), leadMap, kind);
  }
});

test('placed free, every multi-terminal new kind has canvas geometry from its sidecar', () => {
  const body = CANVAS.slice(CANVAS.indexOf('function terminalOffsetsForPart'), CANVAS.indexOf('function terminalPos'));
  for (const kind of Object.keys(KINDS)) {
    assert.match(body, new RegExp(`case '${kind}':`), `${kind}: a terminalOffsetsForPart case`);
  }
});

/** The palette entry object literal that carries this label. */
function paletteEntry(label) {
  const at = PALETTE.indexOf(`label: '${label}'`);
  assert.ok(at > 0, `palette entry "${label}"`);
  const start = PALETTE.lastIndexOf('{ kind:', at);
  return PALETTE.slice(start, PALETTE.indexOf('\n', at));
}

test('palette: every new part, its defaults, and German labels', () => {
  const expect = [
    ['Speaker', 'Lautsprecher', 'speaker', ['ohms: 8', 'henrys: 0.0002', 'ratedWatts: 0.5']],
    ['Earphone', 'Ohrhörer', 'earphone', ["type: 'magnetic'", 'ohms: 2000', 'henrys: 0.1', 'ratedWatts: 0.001']],
    ['Crystal earphone', 'Kristall-Ohrhörer', 'earphone', ["type: 'crystal'", 'capacitance: 10e-9', 'leakOhms: 10e6']],
    ['Antenna (long wire)', 'Antenne (Langdraht)', 'antenna', ['heightM: 5', 'ohms: 50', 'farads: 200e-12']],
    ['Earth', 'Erde', 'earth', ['ohms: 30']],
    ['Tuning capacitor', 'Drehkondensator', 'tuning_cap', ['minFarads: 10e-12', 'maxFarads: 500e-12', 'position: 0.5']],
    ['Ferrite-rod coil (MW)', 'Ferritstab-Spule (MW)', 'ferrite_coil',
      ['henrys: 250e-6', 'tap: 0.25', 'couplingRatio: 0.1', 'k: 0.98', 'couplingK: 0.9', 'q: 120']],
    ['Germanium diode 1N34A', 'Germaniumdiode 1N34A', 'diode', ["part: '1N34A'"]],
  ];
  for (const [label, de, kind, params] of expect) {
    const entry = paletteEntry(label);
    assert.ok(entry.includes(`kind: '${kind}'`), `${label}: kind ${kind}`);
    for (const p of params) assert.ok(entry.includes(p), `${label}: param ${p}`);
    assert.equal(PALETTE_DE[label], de, `${label}: German`);
  }
  assert.equal(PALETTE_DE.Radio, 'Radio', 'the Radio category has its German heading');
});

test('sound: speaker and earphone play through the buzzer tone surface', () => {
  const kinds = DESIGNER.match(/const TONE_KINDS = new Set\(\[([^\]]*)\]\)/);
  assert.ok(kinds, 'TONE_KINDS declared in CircuitDesigner.jsx');
  const effect = DESIGNER.slice(DESIGNER.indexOf('updateBuzzerAudio(bz.id, tone)') - 400,
    DESIGNER.indexOf('updateBuzzerAudio(bz.id, tone)'));
  assert.match(effect, /parts\.filter\(p => TONE_KINDS\.has\(p\.kind\)\)/, 'the audio effect plays every TONE_KINDS part');
  for (const kind of ['buzzer', 'piezo', 'speaker', 'earphone']) {
    assert.ok(kinds[1].includes(`'${kind}'`), `${kind} feeds updateBuzzerAudio`);
    assert.match(TOOLTIP, new RegExp(`case '${kind}':`), `${kind}: tooltip shows its tone`);
  }
});

test('the tuning capacitor turns like the potentiometer knob', () => {
  // The knob face, the layer that keeps SvgParts from drawing a second body,
  // and the control read-back that keeps the knob on the engine's value.
  const wokwiLayer = CANVAS.slice(CANVAS.indexOf('const WOKWI_LAYER_KINDS'), CANVAS.indexOf(']);', CANVAS.indexOf('const WOKWI_LAYER_KINDS')));
  assert.ok(wokwiLayer.includes("'tuning_cap'"), 'tuning_cap is drawn by the Wokwi layer');
  assert.match(CANVAS, /case 'tuning_cap':\s*case 'potentiometer':\s*\{/, 'one knob face for both kinds');
  assert.match(CANVAS, /p\.kind === 'potentiometer' \|\| p\.kind === 'tuning_cap'/, 'controlValues reads the tuning cap back');
});

test('the ferrite rod turns: the engine lists it as a control and the canvas draws its dial', () => {
  const b = new BoardImpl(5);
  b.setNetlist([{ id: 'L1', kind: 'ferrite_coil', params: { angleDeg: 90 }, terminals: ['a', 'tap', 'b', 'c1', 'c2'] }], []);
  const ctl = b.getControls().find(c => c.id === 'L1');
  assert.ok(ctl, 'ferrite_coil is a control');
  assert.equal(ctl.value, 0.25, 'its rest value is the authored angle (90° = 0.25)');
  assert.match(CANVAS, /case 'ferrite_coil': \{\n\s+if \(!simulate\) return null;/, 'a dial while simulating');
  assert.match(CANVAS, /p\.kind === 'ferrite_coil'\) \{\n\s+const v = eb\.getControl/, 'the dial reads the live angle back');
});

test('VHF parts in the palette with German labels', () => {
  for (const label of ['Air-core coil (VHF)', 'Varicap diode BB910', 'VHF transistor BF199']) {
    assert.ok(PALETTE.includes(`label: '${label}'`), `${label}: palette entry`);
    assert.ok(PALETTE_DE[label], `${label}: German`);
  }
});
