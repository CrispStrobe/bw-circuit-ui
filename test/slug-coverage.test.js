/**
 * Slug coverage guard — every part kind referenced in code must exist
 * in the sidecar registry, or be explicitly listed as an exception.
 *
 * A rename that lands in the data (sidecar) but not in the code
 * (DRC, wire-router, thumbnails) silently removes a part's behaviour
 * while the part itself loads fine. This test catches that class of
 * defect: a reference to a slug with no sidecar fails loudly at test
 * time rather than degrading silently at runtime.
 *
 * Same principle as the dead-module ratchet: derive the set from the
 * source, compare, let a rename fail the suite.
 */

import './_setup.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { registeredKinds } from '../src/model/parts-registry.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));

// Extract slugs referenced in code by scanning for quoted kind strings
// in switch cases, array literals, and Set constructors.
function extractSlugsFromFile(filePath) {
  const src = readFileSync(filePath, 'utf-8');
  const slugs = new Set();
  // Match case 'kind': in switch statements
  for (const m of src.matchAll(/case\s+'([a-z0-9][a-z0-9_]+)'/g)) slugs.add(m[1]);
  // Match .kind comparisons and .includes(loadPart.kind) arrays
  for (const m of src.matchAll(/\.kind\s*===?\s*'([a-z0-9][a-z0-9_]+)'/g)) slugs.add(m[1]);
  // Exclude terminal names, modes, and other non-kind strings
  const NOT_KINDS = new Set([
    'voltage', 'current', 'resistance', 'anode', 'cathode', 'vcc', 'gnd',
    'quasi', 'pushpull', 'input', 'opendrain', 'simulate', 'build',
    'danger', 'warning', 'info', 'polarity', 'sda', 'scl',
    'r_anode', 'g_anode', 'b_anode', 'probe_a', 'probe_b',
    'base', 'collector', 'emitter', 'gate', 'drain', 'source',
    'pos', 'neg', 'wiper', 'signal', 'trigger', 'output', 'control',
    'threshold', 'discharge', 'reset', 'input_pullup',
    'realistic', 'schematic',
  ]);
  for (const nk of NOT_KINDS) slugs.delete(nk);
  return slugs;
}

// Slugs that are valid but don't have sidecars — infrastructure, dynamic,
// or UI-only kinds. Each must have a reason.
const EXCEPTIONS = new Set([
  // Infrastructure / UI-only
  'breadboard',     // infrastructure, not a component
  'meter',          // UI-only instrument
  'mcu',            // dynamic terminals from params
  'led_cube',       // composite with dynamic terminals
  // Kind aliases (resolveKind handles these)
  'h_bridge',       // → l293d
  'battery',        // → vsource
  'timer_555',      // → 555
  'vsource',        // sidecar exists; also battery alias target
  // Palette slug ≠ sidecar slug (known mismatches, each needs a kind alias)
  'shift_register', // sidecar: 74hc595
  'motor_encoder',  // sidecar: dc_motor_encoder
  'pir_sensor',     // sidecar: pir
  'tilt_sensor',    // sidecar: tilt_switch
  'dip_switch',     // sidecar: dip_switch_spst
  'keypad',         // sidecar: keypad_4x4
  // Abstract logic gates (schematic-level; gallery uses these)
  'gate_and',       // abstract 2-input AND
  'gate_or',        // abstract 2-input OR
  'gate_nand',      // abstract 2-input NAND
  'gate_nor',       // abstract 2-input NOR
  'gate_xor',       // abstract 2-input XOR
  'gate_not',       // abstract inverter
  // Device-registry parts (registered at runtime, no static sidecar)
  'ili9341',        // SPI TFT display (bw-board device registry)
  'adxl335',        // analog 3-axis accelerometer
  'memsic2125',     // thermal 2-axis accelerometer (PWM output)
  // Internal model terms (not part kinds)
  'lead',           // occupancy type in breadboard model
]);

describe('slug coverage: every code-referenced kind has a sidecar', () => {
  const registered = new Set(registeredKinds());
  const files = [
    path.join(here, '../src/model/drc.js'),
    path.join(here, '../src/model/wire-router.js'),
    path.join(here, '../src/model/circuit.js'),
  ];

  for (const f of files) {
    const basename = path.basename(f);
    it(`${basename}: no stale slugs`, () => {
      const slugs = extractSlugsFromFile(f);
      const stale = [...slugs].filter(s =>
        !registered.has(s) && !EXCEPTIONS.has(s) && s.length > 2
      );
      assert.equal(stale.length, 0,
        `stale slugs in ${basename}: ${stale.join(', ')} — ` +
        'these kinds are referenced in code but have no sidecar. ' +
        'If they are aliases, add them to EXCEPTIONS with a reason.');
    });
  }
});
