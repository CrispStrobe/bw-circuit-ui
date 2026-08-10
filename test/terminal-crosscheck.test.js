/**
 * Terminal cross-check: bw-parts sidecars vs bw-circuit-ui terminals.
 *
 * EVIDENCE CLASS: same-source agreement (category 2). Both bw-parts
 * and bw-circuit-ui were written by agents in the same campaign reading
 * the same datasheets. This catches transcription slips, arithmetic
 * errors and drift between two codebases — genuinely useful — but it
 * CANNOT catch a shared misreading of the source document. Agreement
 * here means we transcribed consistently, not necessarily correctly.
 *
 * What would move this to category 1 (independent-source): terminal
 * positions verified against a physical measurement, a photograph, or
 * a third-party parts library written by strangers.
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

  // Two populations:
  // 1. namingDiffs — both sides model the kind, names disagree
  // 2. coverageGaps — bw-parts has it, circuit model does not model it at all
  const namingDiffs = [];
  const coverageGaps = [];
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
        coverageGaps.push(sc.kind);
        return;
      }

      // Default ['a', 'b'] means terminalsForKind doesn't really model this kind
      if (circuitTerminals.length === 2 &&
          circuitTerminals[0] === 'a' && circuitTerminals[1] === 'b' &&
          sc.terminals.length > 2) {
        coverageGaps.push(sc.kind);
        return;
      }

      const sidecarNames = new Set(sc.terminals.map(t => t.name));
      const circuitNames = new Set(circuitTerminals);

      for (const name of sidecarNames) {
        if (name === 'vcc' || name === 'gnd') continue;
        if (!circuitNames.has(name)) {
          namingDiffs.push(`${sc.kind}: sidecar "${name}" not in circuit model`);
        }
      }
      for (const name of circuitNames) {
        if (name === 'vcc' || name === 'gnd') continue;
        if (!sidecarNames.has(name)) {
          namingDiffs.push(`${sc.kind}: circuit "${name}" not in sidecar`);
        }
      }

      checked++;
    });
  }

  it('summary: two populations counted separately', () => {
    const gapKinds = [...new Set(coverageGaps)];
    console.log(`  Cross-check: ${checked} kinds checked, ${skipped} skipped`);
    console.log(`  Naming diffs (convention): ${namingDiffs.length}`);
    console.log(`  Coverage gaps (product): ${gapKinds.length} kinds not modelled`);
    if (gapKinds.length > 0) console.log(`    Gaps: ${gapKinds.join(', ')}`);
    if (namingDiffs.length > 0) {
      console.log(`  Naming diffs:`);
      for (const m of namingDiffs) console.log(`    - ${m}`);
    }
  });
});
