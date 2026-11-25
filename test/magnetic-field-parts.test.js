/**
 * The magnetic field source (induction_loop) and the coil pendulum
 * (coil_pendulum): placeable, seatable, wireable, the source's distance a
 * knob on the canvas, the pendulum's swing drawn from its device state.
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

registerAllDevices();
setEngine({ BoardImpl, inferNetlist, checkWiring, getMaxCurrent, PORT_LIMITS, getDevice });

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(path.join(here, '..', rel), 'utf8');
const sidecar = (kind) => JSON.parse(read(`src/parts-data/${kind}.json`));
const CANVAS = read('src/components/BoardCanvas.jsx');
const PALETTE = read('src/components/PartPalette.jsx');
const TOOLTIP = read('src/components/PartTooltip.jsx');

const KINDS = { induction_loop: ['a', 'b'], coil_pendulum: ['a', 'b'] };

test('both kinds: built-in footprint equal to the sidecar, engine terminal names, an engine device, art', () => {
  for (const [kind, terms] of Object.entries(KINDS)) {
    const sc = sidecar(kind);
    assert.deepEqual(FOOTPRINTS[kind]?.leads, sc.footprint.leads, `${kind} leads`);
    assert.equal(FOOTPRINTS[kind].refTerminal, sc.footprint.refTerminal, `${kind} refTerminal`);
    assert.deepEqual(terminalsForKind(kind, {}), terms, kind);
    assert.deepEqual(sc.terminals.map((x) => x.name), terms, `${kind} sidecar`);
    assert.ok(getDevice(kind), `${kind}: bw-board models it`);
    assert.ok(ART_FACE_KINDS.includes(kind), `${kind}: drawn with its art`);
    assert.match(TOOLTIP, new RegExp(`case '${kind}':`), `${kind}: tooltip readout`);
  }
  const body = CANVAS.slice(CANVAS.indexOf('function terminalOffsetsForPart'), CANVAS.indexOf('function terminalPos'));
  for (const kind of Object.keys(KINDS)) assert.match(body, new RegExp(`case '${kind}':`), `${kind}: canvas pins from the sidecar`);
  // The distance dial and the swing overlay.
  assert.match(CANVAS, /data-distance-control=\{id\}/);
  assert.match(CANVAS, /p\.kind === 'induction_loop'\) \{/, 'the dial tracks the engine control');
  assert.match(CANVAS, /data-pendulum=\{id\}/);
  assert.match(CANVAS, /p\.kind === 'coil_pendulum'\) \{/, 'the swing reads the device state');
});

/** The palette entry object literal that carries this label. */
function paletteEntry(label) {
  const at = PALETTE.indexOf(`label: '${label}'`);
  assert.ok(at > 0, `palette entry "${label}"`);
  const start = PALETTE.lastIndexOf('{ kind:', at);
  return PALETTE.slice(start, PALETTE.indexOf('\n', at));
}

test('palette: loop, cable and pendulum with German labels and tooltips', () => {
  for (const [label, kind, params] of [
    ['Magnetic field source (loop)', 'induction_loop', ["shape: 'loop'"]],
    ['Mains cable (two cores)', 'induction_loop', ["shape: 'cable'"]],
    ['Coil pendulum', 'coil_pendulum', ["bob: 'iron'"]],
  ]) {
    const entry = paletteEntry(label);
    assert.ok(entry.includes(`kind: '${kind}'`), `${label}: kind ${kind}`);
    for (const p of params) assert.ok(entry.includes(p), `${label}: param ${p}`);
    assert.ok(PALETTE_DE[label], `${label}: German label`);
    const tip = PALETTE.slice(PALETTE.indexOf(`label: '${label}'`)).match(/tooltip: '([^']*)'/)[1];
    assert.ok(PALETTE_DE[tip], `${label}: German tooltip`);
  }
});

test('seated on a breadboard: a tone through the loop reaches the pickup coil, more when the knob brings it near', () => {
  const build = () => Circuit.fromJSON({
    vcc: 5,
    parts: [
      { id: 'bb1', kind: 'breadboard', params: {}, terminals: [], x: 0, y: 0, rotation: 0 },
      { id: 'f', kind: 'function_gen', params: { wave: 'sine', freq: 800, amplitude: 1, offset: 0, rOut: 100 }, x: 0, y: 0, rotation: 0 },
      { id: 's', kind: 'induction_loop', params: { shape: 'loop', pickup: 'l', position: 0.2 }, x: 0, y: 0, rotation: 0,
        seat: { boardId: 'bb1', leadMap: { a: 'a10', b: 'a13' } } },
      { id: 'l', kind: 'air_coil', params: { turns: 1000 }, x: 0, y: 0, rotation: 0,
        seat: { boardId: 'bb1', leadMap: { a: 'a20', b: 'a23' } } },
      { id: 'r', kind: 'resistor', params: { ohms: 1e6 }, x: 0, y: 0, rotation: 0,
        seat: { boardId: 'bb1', leadMap: { a: 'b20', b: 'b23' } } },
      { id: 'g', kind: 'gnd', params: {}, x: 0, y: 0, rotation: 0 },
    ],
    wires: [{ from: { part: 'f', terminal: 'out' }, to: { part: 's', terminal: 'a' } },
      { from: { part: 'g', terminal: 'gnd' }, to: { part: 's', terminal: 'b' } },
      { from: { part: 'g', terminal: 'gnd' }, to: { part: 'f', terminal: 'gnd' } },
      { from: { part: 'g', terminal: 'gnd' }, to: { part: 'l', terminal: 'b' } }],
  });
  const peak = (knob) => {
    const c = build();
    c.board.setPower(true);
    c.board.setControl('s', knob);
    const n = c.board.getNets().find((x) => x.terminals.some((p) => p.part === 'l' && p.terminal === 'a'));
    let mx = 0;
    for (let us = 100; us <= 5000; us += 50) { c.board.advanceTo(BigInt(us) * 1000n); if (us > 2500) mx = Math.max(mx, Math.abs(c.board.nodeVoltages.get(n.id))); }
    return mx;
  };
  const far = peak(0.2), near = peak(0.9);
  assert.ok(far > 1e-6, `a field reaches the pickup: ${far} V`);
  assert.ok(near > 10 * far, `nearer, much more: ${far} -> ${near} V`);
});
