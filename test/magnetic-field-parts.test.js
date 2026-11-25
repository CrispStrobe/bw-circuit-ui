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
import React from 'react';
import { parseSync, transformWithOxc } from 'vite';
import { Circuit, terminalsForKind } from '../src/model/circuit.js';
import { FOOTPRINTS } from '../src/model/footprints.js';
import { ART_FACE_KINDS } from '../src/model/part-art.js';
import { PALETTE_DE } from '../src/i18n/palette-de.js';
import { seatedFaceRotation } from '../src/interaction/seat-geometry.js';

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
  assert.match(CANVAS, /data-pendulum=\{id\}/);
});

test('magnetic faces read the active Board and the actual distance dial writes its control back', async () => {
  const parsed = parseSync('BoardCanvas.jsx', CANVAS, {preserveParens: false});
  assert.deepEqual(parsed.errors, []);
  function find(node, predicate) {
    if (!node || typeof node !== 'object') return null;
    if (predicate(node)) return node;
    for (const child of Object.values(node)) {
      const match = find(child, predicate);
      if (match) return match;
    }
    return null;
  }
  const owner = find(parsed.program, node => node.type === 'JSXOpeningElement' && node.name?.name === 'WokwiParts');
  assert.ok(owner, 'read the props actually supplied to the magnetic faces');
  const readback = name => {
    const call = owner.attributes.find(attr => attr.name?.name === name)?.value?.expression;
    assert.equal(call?.type, 'CallExpression', `${name}: execute the actual readback IIFE`);
    assert.equal(call.callee.type, 'ArrowFunctionExpression');
    const body = call.callee.body;
    return new Function('engineBoard', 'circuit', 'parts', CANVAS.slice(body.start + 1, body.end - 1));
  };
  const readControls = readback('controlValues'), readStates = readback('deviceStates');
  const fixture = () => Circuit.fromJSON({vcc: 5, wires: [], parts: [
    {id: 'loop', kind: 'induction_loop', params: {position: 0.5}, x: 0, y: 0},
    {id: 'pendulum', kind: 'coil_pendulum', params: {}, x: 100, y: 0},
  ]});
  const active = fixture(), fallback = fixture(), parts = active.parts;
  active.board.setControl('loop', 0.8); fallback.board.setControl('loop', 0.2);
  active.board.getDeviceState('pendulum').angleDeg = 30;
  const controls = () => readControls(active.board, fallback, parts);
  assert.equal(controls().get('loop'), 0.8, 'the dial reads the active engine, not authored defaults or the fallback board');
  assert.equal(readControls(null, fallback, parts).get('loop'), 0.2);
  assert.equal(readControls(null, null, parts), null);
  const states = readStates(active.board, fallback, parts);
  assert.equal(states.get('pendulum'), active.board.getDeviceState('pendulum'), 'the swing receives the active device state');
  assert.equal(readStates(null, fallback, parts).get('pendulum'), fallback.board.getDeviceState('pendulum'));

  // Compile the unchanged production renderer. A leaf element stands in for
  // the Wokwi custom element; its value/onInput props and the swing are real.
  const renderer = parsed.program.body.find(node => node.type === 'FunctionDeclaration' && node.id.name === 'WokwiParts');
  assert.ok(renderer);
  const {code} = await transformWithOxc(CANVAS.slice(renderer.start, renderer.end), 'WokwiParts.jsx', {jsx: {runtime: 'classic'}});
  function DialLeaf() { return null; }
  const render = new Function('React', 'WokwiPotentiometer', 'seatedFaceRotation', `${code}\nreturn WokwiParts;`)(React, DialLeaf, seatedFaceRotation);
  const elements = node => Array.isArray(node) ? node.flatMap(elements)
    : node && typeof node === 'object' ? [node, ...elements(node.props?.children)] : [];
  const face = () => elements(render({parts, simulate: true, controlValues: controls(), deviceStates: states,
    onControlChange: (id, value) => active.board.setControl(id, value)}));
  const dial = () => face().find(node => node.type === DialLeaf);
  assert.equal(dial().props.value, 0.8);
  const swing = face().find(node => node.props?.['data-pendulum'] === 'pendulum');
  assert.ok(elements(swing).some(node => node.props?.children === '30°'), 'the actual swing displays the engine angle');
  dial().props.onInput({target: {value: '0.35'}});
  assert.equal(active.board.getControl('loop'), 0.35, 'the rendered dial sends its numeric input to Board');
  assert.equal(fallback.board.getControl('loop'), 0.2, 'the inactive board is untouched');
  assert.equal(dial().props.value, 0.35, 'the dial reads back the changed engine value');
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
