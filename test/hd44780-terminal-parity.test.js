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
  // 2026-08-17).
  // No blanket exceptions. char_lcd used to sit here as "the logical-bus
  // model whose physical twin is hd44780" — but bw-board's char_lcd device
  // carries all sixteen module pins (vcc gnd vo bl_a bl_k included), so the
  // sidecar simply spelled five of them the datasheet's way (vdd vss v0 a k).
  // Renaming those five in the sidecar made the two agree exactly, and the
  // exception went with them (2026-08-20).
  const EXCEPTIONS = new Map([]);
  // THE BURN-DOWN LEDGER — sidecar/engine mismatches. Every entry is a
  // phantom-bench landmine: an example wiring these kinds' mismatched pins
  // is silently rejected whole. The ledger may only SHRINK — fixing a kind
  // means removing it here in the same commit; adding one requires a stated
  // reason beside it, not silence. (Owner-bug class: 'several parts are
  // ghosts' / 'nothing shows'.)
  //
  // 2026-08-17: opened with 21 entries.
  // 2026-08-20: down to 11. The ten that healed (74hc283 74hc73 74hc74
  //   cd4511 keypad_4x4 ld1117v33 lm7805 soil_moisture solenoid tmp36) were
  //   pure SPELLING differences over the same physical pin, so the sidecar
  //   was renamed to bw-board's names — which also keeps the measured pin
  //   POSITIONS reachable now that terminalsForKind returns engine names.
  //
  // What is left is of two kinds, and neither is a spelling problem:
  //   (a) EXTRA-ONLY — the sidecar carries real package pins bw-board's
  //       model does not simulate. Harmless for positions (every engine
  //       terminal still has one) but the sets are not equal.
  //   (b) DIFFERENT DEVICE — the sidecar art and the engine model describe
  //       different hardware. Fixing these means an engine change, and
  //       bw-board is not this repo.
  const KNOWN_MISMATCHES = new Map([
    // (a) extra-only: package pins with no electrical model.
    ['74hc20', 'sidecar carries the two NC pins (3, 11); engine models none'],
    ['74hc21', 'sidecar carries the two NC pins (3, 11); engine models none'],
    ['74hc93', 'sidecar carries the four NC pins (2, 3, 4, 13)'],
    ['74hc95', 'sidecar carries the NC pin (13)'],
    ['74hc75', 'sidecar carries the four inverted outputs 1qn..4qn; the engine latch model has Q only'],
    ['at24c02', 'sidecar carries a0/a1/a2 address straps and wp; the engine model has no addressing'],
    ['ds1302', 'sidecar carries the crystal pins x1/x2 and the vcc1 backup rail; engine models neither'],
    ['pcf8574', 'sidecar carries a0/a1/a2 address straps; the engine model has no addressing'],
    // (b) different device: an engine change, not a catalog one.
    ['gas_sensor', 'sidecar is the 4-pin breakout MODULE (vcc gnd aout dout); the engine models the bare MQ element and its heater (a b heater_a heater_b)'],
    ['ir_remote', 'sidecar is art only — it declares NO terminals at all; the engine models the emitting LED (anode cathode)'],
    ['stepper', 'sidecar is a 4-wire BIPOLAR motor (coil_a1 coil_b1 coil_a2 coil_b2); the engine models a 5-wire UNIPOLAR one (coil1..coil4 com)'],
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
