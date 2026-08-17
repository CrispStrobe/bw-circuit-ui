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
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

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

test('EVERY sidecar with an engine device agrees on terminals', () => {
  // The generalization of the hd44780 lesson: a sidecar naming terminals
  // the engine device does not have (or missing ones it has) makes every
  // wire to those pins fail validation — the whole bench goes phantom.
  // 74hc244 simply had NO sidecar and fell back to a/b (z80-pd-bench,
  // 2026-08-17). Kinds listed in EXCEPTIONS carry a stated reason.
  const EXCEPTIONS = new Map([
    // sidecar models the PHYSICAL module (power+contrast+backlight pins);
    // engine char_lcd is the logical-bus model — hd44780 is the physical twin.
    ['char_lcd', 'logical-bus model; the physical sidecar twin is hd44780'],
  ]);
  // THE BURN-DOWN LEDGER — pre-existing sidecar/engine mismatches found the
  // day this test generalized (2026-08-17). Every entry is a phantom-bench
  // landmine: an example wiring these kinds' mismatched pins is silently
  // rejected whole. The ledger may only SHRINK — fixing a kind means
  // removing it here in the same commit; adding one requires a stated
  // reason beside it, not silence. (Owner-bug class: 'several parts are
  // ghosts' / 'nothing shows'.)
  const KNOWN_MISMATCHES = new Set([
    '74hc20', '74hc21', '74hc283', '74hc73', '74hc74', '74hc75', '74hc93',
    '74hc95', 'at24c02', 'cd4511', 'ds1302', 'gas_sensor', 'ir_remote',
    'keypad_4x4', 'ld1117v33', 'lm7805', 'pcf8574',
    'soil_moisture', 'solenoid', 'stepper', 'tmp36',
  ]);
  const dir = path.join(here, '..', 'src', 'parts-data');
  const fs2 = require('node:fs');
  const bad = [];
  for (const f of fs2.readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    let side;
    try { side = JSON.parse(fs2.readFileSync(path.join(dir, f), 'utf8')); } catch { continue; }
    const kind = side.kind;
    if (!kind || EXCEPTIONS.has(kind)) continue;
    const dev = getDevice(kind);
    if (!dev || !Array.isArray(dev.terminals)) continue;
    const sideNames = new Set((side.terminals || []).map(t => typeof t === 'string' ? t : t.name));
    const devNames = new Set(dev.terminals);
    const missing = [...devNames].filter(n => !sideNames.has(n));
    const extra = [...sideNames].filter(n => !devNames.has(n));
    if (missing.length || extra.length) {
      if (KNOWN_MISMATCHES.has(kind)) continue;
      bad.push(`${kind}: sidecar missing [${missing}] extra [${extra}]`);
    } else if (KNOWN_MISMATCHES.has(kind)) {
      bad.push(`${kind}: healed — remove it from KNOWN_MISMATCHES`);
    }
  }
  assert.deepEqual(bad, [], `sidecar/engine terminal parity:\n${bad.join('\n')}`);
});
