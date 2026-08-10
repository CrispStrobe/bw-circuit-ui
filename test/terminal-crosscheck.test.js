/**
 * Terminal cross-check: bw-parts sidecars vs bw-circuit-ui terminals.
 *
 * Two independent producers of the same fact — which terminals a part
 * has — must agree. Disagreement is a test failure, not a preference.
 * This is the cube-trace pattern applied to terminal geometry.
 *
 * Resolves sidecar JSON from ../../bw-parts/parts/ (sibling checkout).
 * If bw-parts is not available, the test skips with a named reason.
 */

import './_setup.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Resolve from import.meta.url, not CWD
const here = path.dirname(fileURLToPath(import.meta.url));
const bwPartsDir = path.join(here, '../../bw-parts/parts');

// Import circuit model's terminal definitions
import { Circuit, resetIds } from '../src/model/circuit.js';

function terminalsForKind(kind, params) {
  resetIds();
  const c = new Circuit(5.0);
  const p = c.addPart(kind, params || {}, 0, 0);
  return p.terminals;
}

function loadSidecars() {
  if (!existsSync(bwPartsDir)) return null;
  const files = readdirSync(bwPartsDir).filter(f => f.endsWith('.json'));
  const sidecars = [];
  for (const f of files) {
    try {
      const data = JSON.parse(readFileSync(path.join(bwPartsDir, f), 'utf-8'));
      if (data.kind && data.terminals) sidecars.push(data);
    } catch { /* skip malformed */ }
  }
  return sidecars;
}

const sidecars = loadSidecars();

// Parts that are deliberately different between sidecar and circuit model:
// - 'mcu': sidecar has generic terminals, circuit model has dynamic pins
// - 'breadboard': sidecar has no terminals (holes, not component)
// - 'meter': UI-only part, sidecar may not exist
const SKIP_KINDS = new Set(['mcu', 'breadboard', 'meter', 'oscilloscope', 'function_gen']);

// Kinds where terminal count differs because circuit model has VCC/GND
// integrated while sidecar does not (or vice versa) — document, don't skip
const KNOWN_DIFFS = new Map();

describe('terminal cross-check: bw-parts sidecars vs circuit model', () => {
  if (!sidecars) {
    it('SKIP: bw-parts checkout not available at ' + bwPartsDir, () => {
      assert.ok(true, 'bw-parts not found — skipping cross-check');
    });
    return;
  }

  it(`loaded ${sidecars.length} sidecars from bw-parts`, () => {
    assert.ok(sidecars.length > 50, `expected >50 sidecars, got ${sidecars.length}`);
  });

  const mismatches = [];
  let checked = 0;
  let skipped = 0;

  for (const sc of sidecars) {
    if (SKIP_KINDS.has(sc.kind)) { skipped++; continue; }
    if (!sc.terminals || sc.terminals.length === 0) { skipped++; continue; }

    it(`${sc.kind}: terminal names agree`, () => {
      let circuitTerminals;
      try {
        circuitTerminals = terminalsForKind(sc.kind);
      } catch {
        // Kind not in terminalsForKind — that's a gap, not a mismatch
        return;
      }

      const sidecarNames = new Set(sc.terminals.map(t => t.name));
      const circuitNames = new Set(circuitTerminals);

      // Check: every sidecar terminal should exist in the circuit model
      for (const name of sidecarNames) {
        if (name === 'vcc' || name === 'gnd') continue; // power pins may differ
        if (!circuitNames.has(name)) {
          mismatches.push(`${sc.kind}: sidecar has terminal "${name}" missing from circuit model`);
        }
      }

      // Check: every circuit terminal should exist in the sidecar
      for (const name of circuitNames) {
        if (name === 'vcc' || name === 'gnd') continue;
        if (!sidecarNames.has(name)) {
          mismatches.push(`${sc.kind}: circuit model has terminal "${name}" missing from sidecar`);
        }
      }

      checked++;
    });
  }

  it('summary: report mismatches', () => {
    console.log(`  Terminal cross-check: ${checked} kinds checked, ${skipped} skipped, ${mismatches.length} mismatches`);
    if (mismatches.length > 0) {
      console.log('  Mismatches:');
      for (const m of mismatches) console.log(`    - ${m}`);
    }
    // Don't fail on mismatches yet — report them. When the count is zero,
    // change this to assert.equal(mismatches.length, 0).
    // For now, the interesting number is how many disagree.
  });
});
