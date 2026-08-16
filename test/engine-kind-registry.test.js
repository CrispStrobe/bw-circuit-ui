/**
 * engineKindFor consults the engine's device registry: a board kind with a
 * REGISTERED model (arduino_uno, attiny85, ...) keeps its identity in the
 * engine netlist — its power pins source and its GPIO follows pin states.
 * Without hasDevice (older engines), it collapses to 'mcu' as before.
 */
import './_setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setEngine, getEngine } from '../src/engine.js';
import { Circuit } from '../src/model/circuit.js';
import { BoardImpl } from '../../bw-board/src/board.js';
import { inferNetlist, checkWiring } from '../../bw-board/src/infer-netlist.js';
import { hasDevice } from '../../bw-board/src/devices.js';
import { registerAllDevices } from '../../bw-board/src/register-all.js';

registerAllDevices();
const prev = getEngine();

test('registered board kind keeps its identity in the engine netlist', () => {
  setEngine({ BoardImpl, inferNetlist, checkWiring, hasDevice });
  try {
    const c = new Circuit(5.0);
    const uno = c.addPart('arduino_uno', 100, 100);
    const led = c.addPart('led', 200, 100);
    c.addWire({ part: uno.id, terminal: 'd13' }, { part: led.id, terminal: 'anode' });
    const kinds = Object.fromEntries(c.board.getParts().map(p => [p.id, p.kind]));
    assert.equal(kinds[uno.id], 'arduino_uno',
      'registered kind passes through (was collapsed to mcu)');
  } finally {
    setEngine(prev);
  }
});

test('without hasDevice the kind collapses to mcu (old-engine compatibility)', () => {
  setEngine({ BoardImpl, inferNetlist, checkWiring });
  try {
    const c = new Circuit(5.0);
    const uno = c.addPart('arduino_uno', 100, 100);
    const led = c.addPart('led', 200, 100);
    c.addWire({ part: uno.id, terminal: 'd13' }, { part: led.id, terminal: 'anode' });
    const kinds = Object.fromEntries(c.board.getParts().map(p => [p.id, p.kind]));
    assert.equal(kinds[uno.id], 'mcu');
  } finally {
    setEngine(prev);
  }
});
