// Every palette kind must have a defined path into the engine — the ratchet.
//
// The failure this kills: a sidecar kind that is neither stamped, nor a
// registered device, nor aliased, nor in PASSTHROUGH_KINDS reaches
// setNetlist RAW, the whole netlist is REJECTED, the designer board is
// silently EMPTY, and the debug runner falls back to the inferred phantom
// bench — the canvas shows one circuit while the emulator drives another
// (stc15_mcu, the retro console, 2026-08-16; same family as "Blink
// stopped blinking").
//
// KNOWN_GAPS documents the kinds that currently lack an engine path. It
// may only SHRINK: fixing a kind means removing it here in the same
// commit. Adding a kind to it requires a stated reason, not silence.
import './_setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { registerAllDevices } from '../../bw-board/src/register-all.js';
import { getDevice } from '../../bw-board/src/devices.js';
import { KIND_ALIASES } from '../src/model/terminal-aliases.js';

registerAllDevices();

const here = path.dirname(fileURLToPath(import.meta.url));

// Kinds mna.js stamps directly plus structural kinds the model filters.
const STAMPED = new Set([
  'vcc', 'gnd', 'resistor', 'capacitor', 'diode', 'led', 'potentiometer',
  'button', 'switch', 'buzzer', 'ldr', 'ntc', 'npn', 'pnp', 'inductor',
  // transformer: mna-stamped coupled pair since bw-board 52f6f3e (E3.4).
  'transformer',
  'zener', 'nmos', 'pmos', 'opamp', 'vsource', 'isource', 'mcu',
  'seven_segment', 'shift_register', 'ir_receiver', 'temp_sensor',
  'eeprom', 'led_matrix', 'led_cube', 'rgb_led', 'char_lcd',
  'breadboard', 'meter',
  // seven_seg_3: engine composite since bw-board 71957c3 (24 LEDs over a
  // shared segment bus, sevenSeg3Brightness reader) — healed from the ledger.
  'seven_seg_3',
  // seven_seg_4: same composite generalized to 4 digits (the Prechin A2
  // tube), sevenSeg3Brightness(id, 4) reader — engine sibling of _3.
  'seven_seg_4',
]);

// The debt ledger — kinds with NO engine path today. Every entry is a
// bench that will silently break the moment an example seats it. Burn
// this down; never let it grow.
const KNOWN_GAPS = new Set([
  // All gaps burned down:
  //   556        → dual 555 device (timer-555.js)
  //   74c922     → keypad encoder device (tier2-parts.js)
  //   74hc374    → octal D-FF device (chip-composer.js)
  //   74hc688    → 8-bit comparator device (chip-composer.js)
  //   pololu_motor_ctrl → PASSTHROUGH_KINDS (module, no engine model)
]);

function passthroughKinds() {
  const src = readFileSync(path.join(here, '..', 'src', 'model', 'circuit.js'), 'utf8');
  const m = src.match(/PASSTHROUGH_KINDS = new Set\(\[([\s\S]*?)\]\)/);
  assert.ok(m, 'PASSTHROUGH_KINDS found in circuit.js');
  return new Set([...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]));
}

function sidecarKinds() {
  const dir = path.join(here, '..', 'src', 'parts-data');
  const kinds = new Set();
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    try {
      const d = JSON.parse(readFileSync(path.join(dir, f), 'utf8'));
      if (d && d.kind) kinds.add(d.kind);
    } catch { /* not a sidecar */ }
  }
  return kinds;
}

test('every palette kind reaches the engine, or is a DOCUMENTED gap', () => {
  const listed = passthroughKinds();
  const orphans = [];
  for (const k of sidecarKinds()) {
    if (STAMPED.has(k)) continue;
    if (getDevice(k)) continue;
    if (KIND_ALIASES[k]) continue;
    if (listed.has(k)) continue;
    if (KNOWN_GAPS.has(k)) continue;
    orphans.push(k);
  }
  assert.deepEqual(orphans.sort(), [],
    `these kinds reach setNetlist RAW and will EMPTY any board that seats them — ` +
    `give each an engine device, an alias, a PASSTHROUGH entry, or (with a reason) a KNOWN_GAPS line`);
});

test('KNOWN_GAPS only shrinks: healed kinds must leave the ledger', () => {
  const listed = passthroughKinds();
  const healed = [...KNOWN_GAPS].filter(k =>
    STAMPED.has(k) || getDevice(k) || KIND_ALIASES[k] || listed.has(k));
  assert.deepEqual(healed, [],
    `remove from KNOWN_GAPS, now covered: ${healed}`);
});

test('the console bench builds: stc15_mcu collapses to mcu, never rejects', async () => {
  const { setEngine } = await import('../src/engine.js');
  const eng = await import('../../bw-board/src/index.js');
  setEngine({ BoardImpl: eng.BoardImpl, inferNetlist: eng.inferNetlist,
    checkWiring: eng.checkWiring, hasDevice: eng.hasDevice });
  const { Circuit } = await import('../src/model/circuit.js');
  const c = new Circuit();
  c.addPart('stc15_mcu');
  c.addPart('vcc');
  c.addPart('gnd');
  c._syncNetlist();
  assert.equal(c.netlistError, null,
    `an MCU-class palette kind must never reject the netlist: ${c.netlistError}`);
});
