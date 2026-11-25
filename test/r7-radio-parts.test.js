/**
 * The mixer IC, the 10.7 MHz ceramic filter, the FM IF IC, the folded dipole
 * and the ferrite rod's sliding winding: placeable, seatable and wireable on
 * the same surfaces as the other radio parts, their knobs the engine's.
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
import { terminalsForKind } from '../src/model/circuit.js';
import { FOOTPRINTS } from '../src/model/footprints.js';
import { ART_FACE_KINDS } from '../src/model/part-art.js';
import { PALETTE_DE } from '../src/i18n/palette-de.js';

registerAllDevices();
setEngine({ BoardImpl, inferNetlist, checkWiring, getMaxCurrent, PORT_LIMITS, getDevice });

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(path.join(here, '..', rel), 'utf8');
const sidecar = (kind) => JSON.parse(read(`src/parts-data/${kind}.json`));
const CANVAS = read('src/components/BoardCanvas.jsx');
const PALETTE = read('src/components/PartPalette.jsx');
const TOOLTIP = read('src/components/PartTooltip.jsx');

const KINDS = {
  ceramic_filter: ['in', 'gnd', 'out'],
  fm_if: ['in', 'gnd', 'vcc', 'out'],
  dipole: ['a', 'b'],
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

test('the mixer IC is a DIP-8 drawn with its breadboard art, on the engine terminal names', () => {
  const sc = sidecar('sa612');
  const terms = ['in_a', 'in_b', 'gnd', 'out_a', 'out_b', 'osc_b', 'osc_e', 'vcc'];
  assert.deepEqual(sc.terminals.map((x) => x.name), terms);
  assert.equal(sc.footprint.straddlesGutter, true);
  assert.deepEqual(getDevice('sa612').terminals.slice(0, 8), terms);
  assert.ok(ART_FACE_KINDS.includes('sa612'));
});

/** The palette entry object literal that carries this label. */
function paletteEntry(label) {
  const at = PALETTE.indexOf(`label: '${label}'`);
  assert.ok(at > 0, `palette entry "${label}"`);
  const start = PALETTE.lastIndexOf('{ kind:', at);
  return PALETTE.slice(start, PALETTE.indexOf('\n', at));
}

test('palette: the new radio parts with German labels and tooltips', () => {
  const expect = [
    ['Mixer IC SA612', 'sa612', []],
    ['Ceramic filter 10.7 MHz', 'ceramic_filter', ['hz: 10.7e6']],
    ['FM IF IC (limiter + detector)', 'fm_if', ['quadHz: 10.7e6']],
    ['Folded dipole (VHF)', 'dipole', ['ohms: 300']],
    ['Ferrite rod, sliding winding', 'ferrite_coil', ['slideWinding: true']],
  ];
  for (const [label, kind, params] of expect) {
    const entry = paletteEntry(label);
    assert.ok(entry.includes(`kind: '${kind}'`), `${label}: kind ${kind}`);
    for (const p of params) assert.ok(entry.includes(p), `${label}: param ${p}`);
    assert.ok(PALETTE_DE[label], `${label}: German label`);
    const tip = PALETTE.slice(PALETTE.indexOf(`label: '${label}'`)).match(/tooltip: '([^']*)'/)[1];
    assert.ok(PALETTE_DE[tip], `${label}: German tooltip`);
  }
  for (const kind of ['sa612', 'fm_if']) assert.match(TOOLTIP, new RegExp(`case '${kind}':`), `${kind}: tooltip readout`);
});

test('the dipole\'s and the FM IF IC\'s dials are engine controls; the sliding rod\'s dial moves its winding', () => {
  const b = new BoardImpl(6);
  const T = (part, terminal) => ({ part, terminal });
  b.setNetlist([
    { id: 'G', kind: 'gnd', params: {}, terminals: ['gnd'] },
    { id: 'D', kind: 'dipole', params: { angleDeg: 90 }, terminals: ['a', 'b'] },
    { id: 'R', kind: 'resistor', params: { ohms: 300 }, terminals: ['a', 'b'] },
    { id: 'L', kind: 'ferrite_coil', params: { slideWinding: true, slide: 0.25 }, terminals: ['a', 'tap', 'b', 'c1', 'c2'] },
    { id: 'C', kind: 'capacitor', params: { farads: 200e-12 }, terminals: ['a', 'b'] },
  ], [{ id: 'a', terminals: [T('D', 'a'), T('R', 'a')] }, { id: 'g', terminals: [T('G', 'gnd'), T('D', 'b'), T('R', 'b'), T('L', 'a'), T('C', 'b')] },
    { id: 't', terminals: [T('L', 'b'), T('C', 'a')] }]);
  const controls = new Map(b.getControls().map((c) => [c.id, c]));
  assert.equal(controls.get('D')?.value, 0.25, 'the dipole rests at its own turn (90° = 0.25)');
  assert.equal(controls.get('L')?.value, 0.25, 'the sliding rod rests at its winding\'s position');
  for (const kind of ['dipole', 'fm_if']) assert.match(CANVAS, new RegExp(`p.kind === '${kind}'`), `${kind}: the canvas reads its dial from the engine`);
});
