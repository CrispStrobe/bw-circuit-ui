/**
 * The field probe (bw-board src/fields.js) is placeable, seatable, wireable
 * and turnable on the same surfaces as its nearest relatives: the antenna (a
 * one-lead part drawn from its art) and the tuning capacitor (a knob). The
 * junction-noise transistor is an npn preset with bvEbo. A noisy coil current
 * plays as noise (test/buzzer-audio.test.js).
 *
 * Like speaker-radio-parts.test.js this file does NOT import ./_setup.js: it
 * loads the way a headless gate does, with no sidecars registered.
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
const sidecar = JSON.parse(read('src/parts-data/field_probe.json'));
const CANVAS = read('src/components/BoardCanvas.jsx');
const PALETTE = read('src/components/PartPalette.jsx');

test('field_probe: one lead a, a built-in footprint equal to its sidecar, drawn from its art', () => {
  assert.deepEqual(terminalsForKind('field_probe', {}), ['a']);
  assert.deepEqual(sidecar.terminals.map((t) => t.name), ['a']);
  assert.deepEqual(FOOTPRINTS.field_probe.leads, sidecar.footprint.leads);
  assert.equal(FOOTPRINTS.field_probe.refTerminal, 'a');
  assert.ok(ART_FACE_KINDS.includes('field_probe'));
  const body = CANVAS.slice(CANVAS.indexOf('function terminalOffsetsForPart'), CANVAS.indexOf('function terminalPos'));
  assert.match(body, /case 'field_probe':/, 'pins from the sidecar');
});

test('field_probe: seats in one hole and its knob is an engine control', () => {
  const json = {
    vcc: 9,
    parts: [
      { id: 'bb1', kind: 'breadboard', params: {}, terminals: [], x: 0, y: 0, rotation: 0 },
      { id: 'P1', kind: 'field_probe', params: { source: 'mains' }, x: 0, y: 0, rotation: 0, seat: { boardId: 'bb1', leadMap: { a: 'a20' } } },
      { id: 'R1', kind: 'resistor', params: { ohms: 1e6 }, x: 0, y: 0, rotation: 0, seat: { boardId: 'bb1', leadMap: { a: 'b20', b: 'b25' } } },
    ],
    wires: [],
  };
  const c = Circuit.fromJSON(json);
  assert.deepEqual(c.parts.find((p) => p.id === 'P1').seat.leadMap, { a: 'a20' });
  const net = c.board.getNets().find((n) => n.terminals.some((t) => t.part === 'P1' && t.terminal === 'a'));
  assert.ok(net.terminals.some((t) => t.part === 'R1' && t.terminal === 'a'), 'probe and resistor share the strip');
  const ctl = c.board.getControls().find((x) => x.id === 'P1');
  assert.ok(ctl && ctl.kind === 'field_probe' && ctl.value === 0, 'a knob at 0 (far away)');
  // The knob face and its read-back, as for the tuning capacitor.
  assert.match(CANVAS, /case 'field_probe': \{\s*const lead = /, 'a knob beside the probe');
  assert.match(CANVAS, /p\.kind === 'tuning_cap' \|\| p\.kind === 'field_probe'/, 'controlValues reads the probe back');
});

test('palette: four probe presets, the noise transistor, German labels', () => {
  const entry = (label) => {
    const at = PALETTE.indexOf(`label: '${label}'`);
    assert.ok(at > 0, `palette entry "${label}"`);
    return PALETTE.slice(PALETTE.lastIndexOf('{ kind:', at), PALETTE.indexOf('\n', at));
  };
  const expect = [
    ['Field probe (mains wiring)', 'field_probe', ["source: 'mains'", 'maxFarads: 2e-12']],
    ['Field probe (charged ruler)', 'field_probe', ["source: 'charge'", 'rodVolts: 10000']],
    ['Touch plate (finger)', 'field_probe', ["source: 'body'", "contact: 'skin'"]],
    ['Touch plate through paper', 'field_probe', ["source: 'body'", "contact: 'paper'"]],
    ['Noise transistor (B-E breakdown)', 'npn', ['bvEbo: 7.5']],
  ];
  for (const [label, kind, params] of expect) {
    const e = entry(label);
    assert.ok(e.includes(`kind: '${kind}'`), `${label}: kind ${kind}`);
    for (const p of params) assert.ok(e.includes(p), `${label}: ${p}`);
    assert.ok(PALETTE_DE[label], `${label}: German`);
  }
  assert.equal(PALETTE_DE['Fields & noise'], 'Felder & Rauschen');
});
