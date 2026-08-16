// The hd44780 terminal surface must agree across all three layers: the
// model's canonical list, the sidecar, and the engine's registered device.
// When the model list disagreed (friendly vcc/gnd/vo/bl_a/bl_k vs the
// datasheet vss/vdd/v0/a/k everywhere else), every LCD wire failed engine
// validation and the whole eater6502 bench board went phantom — the
// canvas showed a full build while the engine held nothing.
import './_setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { registerAllDevices } from '../../bw-board/src/register-all.js';
import { getDevice } from '../../bw-board/src/devices.js';

registerAllDevices();
const here = path.dirname(fileURLToPath(import.meta.url));

test('model list == engine device terminals == sidecar pins', async () => {
  const { setEngine } = await import('../src/engine.js');
  const eng = await import('../../bw-board/src/index.js');
  setEngine({ BoardImpl: eng.BoardImpl, inferNetlist: eng.inferNetlist,
    checkWiring: eng.checkWiring, hasDevice: eng.hasDevice });
  const { Circuit } = await import('../src/model/circuit.js');
  const c = new Circuit();
  const part = c.addPart('hd44780');
  const modelList = [...part.terminals].sort();
  const engineList = [...getDevice('hd44780').terminals].sort();
  assert.deepEqual(modelList, engineList, 'model vs engine');
  const sidecar = JSON.parse(readFileSync(path.join(here, '..', 'src', 'parts-data', 'hd44780.json'), 'utf8'));
  const sidecarPins = sidecar.pins ?? sidecar.terminals ?? [];
  const sidecarList = sidecarPins.map(p => (typeof p === 'string' ? p : (p.name ?? p.id))).sort();
  assert.deepEqual(modelList, sidecarList, 'model vs sidecar');
});

test('old friendly spellings migrate: a saved vcc/vo/bl_a wire still lands', async () => {
  const { setEngine } = await import('../src/engine.js');
  const eng = await import('../../bw-board/src/index.js');
  setEngine({ BoardImpl: eng.BoardImpl, inferNetlist: eng.inferNetlist,
    checkWiring: eng.checkWiring, hasDevice: eng.hasDevice });
  const { Circuit } = await import('../src/model/circuit.js');
  const c = Circuit.fromJSON({
    vcc: 5,
    parts: [
      { id: 'lcd', kind: 'hd44780' },
      { id: 'v1', kind: 'vcc' },
      { id: 'g1', kind: 'gnd' },
    ],
    wires: [
      { from: 'v1', fromTerminal: 'vcc', to: 'lcd', toTerminal: 'vcc' },
      { from: 'g1', fromTerminal: 'gnd', to: 'lcd', toTerminal: 'gnd' },
      { from: 'g1', fromTerminal: 'gnd', to: 'lcd', toTerminal: 'vo' },
      { from: 'v1', fromTerminal: 'vcc', to: 'lcd', toTerminal: 'bl_a' },
      { from: 'g1', fromTerminal: 'gnd', to: 'lcd', toTerminal: 'bl_k' },
    ],
    holeWires: [],
  });
  c._syncNetlist();
  assert.equal(c.netlistError, null, `old spellings must not reject: ${c.netlistError}`);
});

test('fromJSON guarantees a params object on every part', async () => {
  const { Circuit } = await import('../src/model/circuit.js');
  const c = Circuit.fromJSON({
    vcc: 5,
    parts: [
      { id: 'b1', kind: 'button' },
      { id: 'd1', kind: 'led', params: null },
      { id: 'r1', kind: 'resistor', params: { ohms: 220 } },
    ],
    wires: [], holeWires: [],
  });
  for (const p of c.parts) {
    assert.equal(typeof p.params, 'object');
    assert.ok(p.params !== null, `${p.id} params is an object, not null`);
  }
  assert.equal(c.parts[2].params.ohms, 220, 'existing params survive');
});
