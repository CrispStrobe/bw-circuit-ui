/**
 * engineKindFor consults the engine's device registry: a board kind with a
 * REGISTERED model (arduino_uno, attiny85, ...) keeps its identity in the
 * engine netlist — its power pins source and its GPIO follows pin states.
 * Without the accessor (older engines), it collapses to 'mcu' as before.
 *
 * This test used to inject `hasDevice` — a name engine.js's contract has never
 * defined; it documents `getDevice`. So the feature worked HERE, against an
 * engine this file built, and nowhere else: the real injected engine has no
 * hasDevice, `typeof eng.hasDevice === 'function'` was false on every call in
 * production, and every passthrough kind collapsed to 'mcu'. A 28c256 reached
 * the solver as a generic MCU with no memory behaviour. Hence the second test
 * below, which asks the engine the APP builds — not one assembled here.
 */
import './_setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setEngine, getEngine } from '../src/engine.js';
import { Circuit } from '../src/model/circuit.js';
import { BoardImpl } from '../../bw-board/src/board.js';
import { inferNetlist, checkWiring } from '../../bw-board/src/infer-netlist.js';
import { getDevice } from '../../bw-board/src/devices.js';
import { registerAllDevices } from '../../bw-board/src/register-all.js';

registerAllDevices();
const prev = getEngine();

test('registered board kind keeps its identity in the engine netlist', () => {
  setEngine({ BoardImpl, inferNetlist, checkWiring, getDevice });
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

test('machine-executed DIP keeps its real circuit identity without a duplicate electrical model', () => {
  setEngine({ BoardImpl, inferNetlist, checkWiring, getDevice });
  try {
    const c = new Circuit(5.0);
    const cpu = c.addPart('w65c02', 100, 100);
    const via = c.addPart('w65c22', 200, 100);
    c.addWire({ part: cpu.id, terminal: 'd0' }, { part: via.id, terminal: 'd0' });

    assert.equal(c.parts.find(part => part.id === cpu.id).kind, 'w65c02',
      'the authored circuit still identifies the CPU for rendering and extraction');
    assert.equal(c.parts.find(part => part.id === via.id).kind, 'w65c22');

    const kinds = Object.fromEntries(c.board.getParts().map(part => [part.id, part.kind]));
    assert.equal(kinds[cpu.id], 'mcu', 'the machine adapter, not the passive DIP shell, executes the CPU');
    assert.equal(kinds[via.id], 'mcu', 'the machine adapter, not the passive DIP shell, executes the VIA');
  } finally {
    setEngine(prev);
  }
});

test('functional registered memory still reaches the electrical engine', () => {
  setEngine({ BoardImpl, inferNetlist, checkWiring, getDevice });
  try {
    const c = new Circuit(5.0);
    const rom = c.addPart('28c256', 100, 100);
    const led = c.addPart('led', 200, 100);
    c.addWire({ part: rom.id, terminal: 'd0' }, { part: led.id, terminal: 'anode' });
    const kinds = Object.fromEntries(c.board.getParts().map(part => [part.id, part.kind]));
    assert.equal(kinds[rom.id], '28c256', 'a functional memory model must not collapse to a passive surface');
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

test('the engine the app injects exposes the accessor engineKindFor needs', () => {
  // The guard the test above cannot be: it builds its own engine, so it can
  // satisfy any contract it likes. This one asks the real one.
  const eng = getEngine();
  assert.equal(typeof eng.getDevice, 'function',
    'engine.js documents getDevice as the device-registry accessor and engineKindFor calls it. '
    + 'Without it every kind in PASSTHROUGH_KINDS silently degrades to a generic mcu — memories '
    + 'stop driving their data pins and nothing reports an error.');
  assert.ok(eng.getDevice('28c256'), 'a registered memory model must be reachable through it');
});
