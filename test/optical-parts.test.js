/**
 * Optical-link parts (bw-board optics.js): the laser diode seats like an LED,
 * a light path has no leads, sits off the board and wears a knob, and both
 * are on the palette with German labels. Loads headless (no _setup.js) like
 * speaker-radio-parts.test.js, so the built-in tables must carry them.
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
import { PALETTE_DE } from '../src/i18n/palette-de.js';

registerAllDevices();
setEngine({ BoardImpl, inferNetlist, checkWiring, getMaxCurrent, PORT_LIMITS, getDevice });

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(path.join(here, '..', rel), 'utf8');
const sidecar = (kind) => JSON.parse(read(`src/parts-data/${kind}.json`));

test('laser_diode: two leads, built-in footprint equal to its sidecar', () => {
  assert.deepEqual(terminalsForKind('laser_diode'), ['anode', 'cathode']);
  assert.deepEqual(FOOTPRINTS.laser_diode.leads, sidecar('laser_diode').footprint.leads);
});

test('light_path: no leads, no footprint', () => {
  assert.deepEqual(terminalsForKind('light_path'), []);
  assert.equal(FOOTPRINTS.light_path, undefined);
  assert.deepEqual(sidecar('light_path').terminals, []);
});

test('a placed light path carries an LED\'s light to a phototransistor, and its knob moves it', () => {
  const c = new Circuit();
  const bat = c.addPart('vsource', { volts: 9 }, 0, 0);
  const r = c.addPart('resistor', { ohms: 330 }, 0, 0);
  const d = c.addPart('led', { color: 'red' }, 0, 0);
  const q = c.addPart('phototransistor', {}, 0, 0);
  const rl = c.addPart('resistor', { ohms: 1000 }, 0, 0);
  const p = c.addPart('light_path', { medium: 'air', distanceCm: 3, knob: 'distanceCm', knobMin: 1, knobMax: 30 }, 0, 0);
  c.addWire(bat.id, 'pos', r.id, 'a'); c.addWire(r.id, 'b', d.id, 'anode'); c.addWire(d.id, 'cathode', bat.id, 'neg');
  c.addWire(bat.id, 'pos', rl.id, 'a'); c.addWire(rl.id, 'b', q.id, 'collector'); c.addWire(q.id, 'emitter', bat.id, 'neg');
  const near = c.opticalReport().receivers[q.id].light;
  assert.ok(near > 0.1, `light at 3 cm: ${near}`);
  const ctl = c.getControls().find(k => k.id === p.id);
  assert.ok(ctl && Math.abs(ctl.value - 2 / 29) < 1e-9, 'knob rests at 3 cm');
  c.board.setControl(p.id, 1);
  assert.ok(c.opticalReport().receivers[q.id].light < near / 50, 'at 30 cm');
  const json = JSON.parse(JSON.stringify(c.toJSON()));
  const back = Circuit.fromJSON(json);
  assert.equal(back.parts.find(x => x.kind === 'light_path').params.medium, 'air', 'round trip');
});

test('palette: an Optics category with the laser, IR LED and light paths, all in German', () => {
  const PALETTE = read('src/components/PartPalette.jsx');
  assert.match(PALETTE, /name: 'Optics'/);
  for (const label of ['Laser diode', 'IR LED', 'Phototransistor', 'Optical bench (air)', 'Light guide (fibre)',
    'Lens on the bench', 'Coloured surface', 'Prism and slit', 'Glass of liquid', 'Plucked string']) {
    assert.ok(PALETTE.includes(`label: '${label}'`), label);
    assert.ok(PALETTE_DE[label], `${label}: German`);
  }
  assert.equal(PALETTE_DE.Optics, 'Optik');
});

test('canvas: the light path turns the potentiometer knob face', () => {
  const CANVAS = read('src/components/BoardCanvas.jsx');
  assert.match(CANVAS, /'tuning_cap', 'light_path'\]\);/);
  assert.match(CANVAS, /case 'light_path':\n\s+case 'tuning_cap':\n\s+case 'potentiometer': \{/);
});
