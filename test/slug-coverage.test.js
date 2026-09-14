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
function extractSlugs(src) {
  const slugs = new Set();
  // Match case 'kind': in switch statements
  for (const m of src.matchAll(/case\s+'([a-z0-9][a-z0-9_]+)'/g)) slugs.add(m[1]);
  // Match .kind comparisons and .includes(loadPart.kind) arrays
  for (const m of src.matchAll(/\.kind\s*===?\s*'([a-z0-9][a-z0-9_]+)'/g)) slugs.add(m[1]);
  // Match the quoted members of kind arrays and Sets. These are separate
  // syntax classes from the `.kind` expression that consumes them: scanning
  // only that expression missed both gearmotor DRC lists in spec-update 006.
  const quotedMembers = text => {
    for (const m of text.matchAll(/'([a-z0-9][a-z0-9_]+)'/g)) slugs.add(m[1]);
  };
  for (const m of src.matchAll(/\[([^\]]*)\]\.includes\([^)]*\.kind\)/gs)) quotedMembers(m[1]);
  for (const m of src.matchAll(/new\s+Set\s*\(\s*\[([^\]]*)\]\s*\)/gs)) quotedMembers(m[1]);
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

function extractSlugsFromFile(filePath) {
  return extractSlugs(readFileSync(filePath, 'utf-8'));
}

// Slugs that are valid but don't have sidecars — infrastructure, dynamic,
// or UI-only kinds. Each must have a reason.
const EXCEPTIONS = new Set([
  // Trimmed 2026-09-14: 23 entries named kinds that HAVE had a sidecar for a
  // while, several with comments still saying "sidecar art not yet authored".
  // They changed nothing -- the scan skips a registered kind before it ever
  // consults this set -- but a list of false statements is where a real gap
  // hides, so the honesty is now asserted below rather than trusted.
  //
  // Infrastructure / UI-only
  'breadboard',     // infrastructure, not a component
  'meter',          // UI-only instrument
  // Palette slug != sidecar slug (known mismatches, each needs a kind alias)
  'shift_register', // sidecar: 74hc595
  'motor_encoder',  // sidecar: dc_motor_encoder
  'pir_sensor',     // sidecar: pir
  'keypad',         // sidecar: keypad_4x4
  // Abstract logic gates (schematic-level; gallery uses these)
  'gate_and',       // abstract 2-input AND
  'gate_or',        // abstract 2-input OR
  'gate_nand',      // abstract 2-input NAND
  'gate_nor',       // abstract 2-input NOR
  'gate_xor',       // abstract 2-input XOR
  'gate_not',       // abstract inverter
  // Kinds whose terminals are declared in terminalsForKind with no sidecar art
  'sh1106',         // SH1106 variant (same terminals as SSD1306)
  'mono_lcd',       // parametric W x H mono graphical LCD (EV3/NXT)
  'rgb_light',      // RGB status indicator (WeDo 2 / Boost)
  // Internal model terms (not part kinds)
  'lead',           // occupancy type in breadboard model
]);

describe('slug coverage: every code-referenced kind has a sidecar', () => {
  const registered = new Set(registeredKinds());
  const files = [
    path.join(here, '../src/model/drc.js'),
    path.join(here, '../src/model/wire-router.js'),
    path.join(here, '../src/model/circuit.js'),
    path.join(here, '../src/components/PartThumbnail.jsx'),
  ];

  const staleSlugs = src => [...extractSlugs(src)].filter(s =>
    !registered.has(s) && !EXCEPTIONS.has(s) && s.length > 2
  );

  it('no exception names a kind that already has a sidecar', () => {
    // An exception says "this kind has no sidecar, and that is fine". Once the
    // sidecar lands the line is a false statement that the scan never reads,
    // so nothing fails and the comment beside it rots -- two of these still
    // said the controlled sources deliberately had no UI art on the day the
    // art was authored. Keeping the set honest is the only way a future
    // reader can trust what it claims.
    const dead = [...EXCEPTIONS].filter(k => registered.has(k));
    assert.deepEqual(dead, [],
      'these exceptions now have sidecars and must be deleted, with their comments: '
      + dead.join(', '));
    // Driven: the check does react to a kind that has one.
    assert.ok(registered.has('resistor'), 'the registry is populated, so an empty result means something');
    assert.deepEqual([...new Set(['resistor', 'lead'])].filter(k => registered.has(k)), ['resistor']);
  });

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

  const oldSlug = 'hobby_gearmotor';
  const mutations = [
    ['drc high-current array', '../src/model/drc.js', "'dc_motor', 'gearmotor', 'servo'"],
    ['drc inductive Set', '../src/model/drc.js', "'dc_motor', 'gearmotor', 'vibration_motor'"],
    ['circuit terminals switch', '../src/model/circuit.js', "case 'dc_motor': case 'gearmotor': return ['a', 'b'];"],
    ['wire-router bounds switch', '../src/model/wire-router.js', "case 'dc_motor': case 'gearmotor': return { x: p.x - 22"],
    ['thumbnail renderer switch', '../src/components/PartThumbnail.jsx', "case 'dc_motor': case 'gearmotor':"]
  ];
  for (const [name, relative, needle] of mutations) {
    it(`mutation: ${name} rejects the retired slug`, () => {
      const source = readFileSync(path.join(here, relative), 'utf-8');
      assert.equal(source.split(needle).length, 2, `${name} mutation anchor must be unique`);
      const mutated = source.replace(needle, needle.replace('gearmotor', oldSlug));
      assert.deepEqual(staleSlugs(mutated), [oldSlug]);
    });
  }
});
