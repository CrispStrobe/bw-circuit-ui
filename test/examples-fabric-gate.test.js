/**
 * Designer-side examples gate: breadboard-fabric circuits.
 *
 * The engine-side gate (bw-board test/examples-gate.test.mjs) validates
 * all non-breadboard gallery circuits. This is the COMPLEMENT: it walks
 * the same examples directory and validates the ones containing breadboard
 * parts — which only the designer's loader can expand (holes → strips → nets).
 *
 * Each breadboard example is loaded through Circuit.fromJSON — the REAL
 * loader path — and the resulting netlist must validate and solve on the
 * engine (advanceTo must not throw).
 *
 * Sibling checkout pattern: skip cleanly when no examples directory is
 * present. CI can point EXAMPLES_DIR at a shallow clone.
 */

import './_setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Circuit } from '../src/model/circuit.js';

const here = path.dirname(fileURLToPath(import.meta.url));

// Same candidate paths as the engine gate:
// 1. EXAMPLES_DIR env var
// 2. sibling sb3-creator checkout
const CANDIDATES = [
  process.env.EXAMPLES_DIR,
  join(here, '../../sb3-creator/examples'),
].filter(Boolean);
const DIR = CANDIDATES.find(d => existsSync(d));

test('breadboard-fabric examples load and solve through the designer', (t) => {
  if (!DIR) { t.skip('no sb3-creator examples checkout'); return; }

  const entries = readdirSync(DIR, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => e.name)
    .filter(name => existsSync(join(DIR, name, 'circuit.json')));
  assert.ok(entries.length > 10, `found ${entries.length} circuit examples`);

  const fabricExamples = [];
  const failures = [];
  let engineOnly = 0;

  for (const name of entries) {
    try {
      const raw = readFileSync(join(DIR, name, 'circuit.json'), 'utf8');
      const doc = JSON.parse(raw);
      const parts = doc.parts || (doc.circuit && doc.circuit.parts) || [];

      // Only validate breadboard-containing examples here;
      // the engine gate handles the rest.
      if (!parts.some(p => p.kind === 'breadboard')) {
        engineOnly++;
        continue;
      }

      fabricExamples.push(name);

      // Load through the REAL designer path: fromJSON handles
      // kind resolution, wire normalization, breadboard occupancy,
      // hole-wire expansion, and _syncNetlist (which calls setNetlist
      // on the engine board — validating terminals and solving).
      const circuit = Circuit.fromJSON(doc);

      // Must have parts and nets after loading
      assert.ok(circuit.parts.length > 0, `${name}: has parts`);

      // The netlist must solve: advanceTo must not throw.
      // A short advance is enough to verify the solver runs.
      circuit.advanceTo(1_000_000n); // 1 ms
    } catch (err) {
      failures.push(`${name}: ${String(err.message).split('\n')[0]}`);
    }
  }

  console.log(`fabric gate: ${fabricExamples.length} breadboard examples validated, ${engineOnly} engine-only`);
  if (fabricExamples.length > 0) {
    console.log(`  validated: ${fabricExamples.join(', ')}`);
  }

  assert.ok(fabricExamples.length > 0,
    'expected at least one breadboard-fabric example');

  assert.deepEqual(failures, [],
    `broken fabric examples:\n  ${failures.join('\n  ')}`);
});
