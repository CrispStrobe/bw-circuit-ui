/**
 * Terminal cross-check: bw-parts sidecars vs bw-circuit-ui terminals.
 *
 * EVIDENCE CLASS: 2b — same-source agreement.
 * (Numbering per stc/docs/ canonical taxonomy; see bw-board VERIFICATION.md)
 *
 * Both bw-parts and bw-circuit-ui were written by agents in the same
 * campaign reading the same datasheets. This catches transcription slips,
 * arithmetic errors and drift between two codebases — genuinely useful —
 * but it CANNOT catch a shared misreading of the source document.
 * Agreement here means we transcribed consistently, not necessarily
 * correctly.
 *
 * What would move this to 2a (independent-source): terminal positions
 * verified against a physical measurement, a photograph, or a third-party
 * parts library written by strangers.
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
// - 'breadboard': sidecar has no terminals (holes, not component)
// - 'meter': UI-only part, sidecar may not exist
const SKIP_KINDS = new Set(['breadboard', 'meter', 'oscilloscope', 'function_gen']);

// MCU is a special case: circuit model has DYNAMIC terminals (params.pins),
// sidecar has the FULL DIP-40 pinout. We check that the sidecar's pin names
// are valid port designators, not that they match the circuit model's subset.
const MCU_SUBSET_CHECK = new Set(['mcu', 'stc_mcu']);

// Kinds where terminal count differs because circuit model has VCC/GND
// integrated while sidecar does not (or vice versa) — document, don't skip
const KNOWN_DIFFS = new Map();

describe('terminal cross-check: bw-parts sidecars vs circuit model', () => {
  if (!sidecars) {
    it('needs a bw-parts checkout', { skip: `bw-parts not found at ${bwPartsDir}` }, () => {});
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
      // MCU special case: circuit model has a dynamic subset of the full
      // DIP-40 pinout. Check that no sidecar terminal contains a bogus
      // pin name (like PSEN/ALE/EA which don't exist on STC12), and that
      // every circuit-model terminal exists in the sidecar.
      if (MCU_SUBSET_CHECK.has(sc.kind)) {
        const sidecarNames = new Set(sc.terminals.map(t => t.name));
        // Verify no AT89C51 ghost pins
        const bogus = ['PSEN', 'ALE', 'EA', 'psen', 'ale', 'ea'];
        for (const b of bogus) {
          if (sidecarNames.has(b)) {
            namingDiffs.push(`${sc.kind}: sidecar has AT89C51 pin "${b}" that does not exist on STC12`);
          }
        }
        // Every pin used by the circuit model must exist in the sidecar
        const testPins = ['P1.0', 'P1.1', 'P3.2', 'P3.5', 'P0.0', 'P2.7'];
        for (const pin of testPins) {
          if (!sidecarNames.has(pin)) {
            namingDiffs.push(`${sc.kind}: circuit model uses "${pin}" but sidecar lacks it`);
          }
        }
        checked++;
        return;
      }

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

  /**
   * The two populations, as they stand. Naming diffs are a CONVENTION
   * difference (sidecar vs engine spelling); coverage gaps are a PRODUCT fact
   * (a kind the engine does not model). Counted apart on purpose — merging
   * them would let a real gap hide inside a naming churn. MAY ONLY SHRINK.
   */
  const KNOWN = { gapKinds: 4, minChecked: 240 };

  /**
   * Naming diffs PER KIND, against a fresh clone of bw-parts main.
   *
   * This replaced a single total (162), which could not do the job for two
   * reasons. It never ran: ci.yml cloned bw-board and sb3-creator but not
   * bw-parts, so loadSidecars() returned null and the whole cross-check
   * skipped on CI — 162 had never gated a push, which is why nobody noticed
   * the real count was 163. And it could not be trusted when it did run: the
   * total is taken across TWO sibling checkouts nobody pins, so a stale one
   * moves it with nothing in this repo or bw-parts having changed. Measured:
   * against an older bw-board the count reads 165 rather than 163, and the
   * total alone cannot say whether that is real drift, a stale engine, or a
   * colleague mid-edit.
   *
   * Per kind, both answers are legible: a changed count NAMES the part, and a
   * kind absent from this map is reported as newly disagreeing rather than
   * silently folded into a total. That is not hypothetical — run against the
   * older engine above it reports `attiny88 (+2)`, which is what turned a
   * wrong guess about the cause into the actual one.
   *
   * MAY ONLY SHRINK. Lower an entry when a name is fixed; never raise one.
   */
  const KNOWN_BY_KIND = {
    stc15_mcu: 38,
    '74hc595': 19,
    cd4511: 16,
    '74hc93': 12,
    stepper: 9,
    '74hc75': 8,
    char_lcd: 8,
    '74hc283': 6,
    gas_sensor: 6,
    pcf8574: 5,
    '74hc73': 4,
    '74hc74': 4,
    ld1117v33: 4,
    lm7805: 4,
    solenoid: 4,
    ds1302: 3,
    '74hc20': 2,
    '74hc21': 2,
    bmp280: 2,
    soil_moisture: 2,
    tmp36: 2,
    '74hc95': 1,
    simplevga_card: 1,
    tcs34725: 1,
  };

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

    // Previously this printed and asserted NOTHING, so either population could
    // grow without limit and the suite stayed green while printing the bigger
    // number. Found by sweeping every test() for a body with no assertion.
    assert.ok(checked >= KNOWN.minChecked,
      `only ${checked} kinds cross-checked — a summary over nothing reports "no diffs" and `
      + 'means nothing');
    assert.ok(gapKinds.length <= KNOWN.gapKinds,
      `${gapKinds.length} kinds the engine does not model (${gapKinds.join(', ')}), ratcheted `
      + `at ${KNOWN.gapKinds}. A new gap is a product regression, not a naming quibble.`);
    if (gapKinds.length < KNOWN.gapKinds) {
      assert.fail(`the coverage gaps shrank (${gapKinds.length} vs ${KNOWN.gapKinds}) — lower `
        + 'KNOWN.gapKinds to lock it in.');
    }
  });

  it('naming diffs: which kind moved, not just that a number did', () => {
    const actual = {};
    for (const m of namingDiffs) {
      const kind = m.slice(0, m.indexOf(':'));
      actual[kind] = (actual[kind] ?? 0) + 1;
    }

    const appeared = [], grew = [], fixed = [];
    for (const [kind, n] of Object.entries(actual)) {
      const known = KNOWN_BY_KIND[kind];
      if (known === undefined) appeared.push(`${kind} (+${n})`);
      else if (n > known) grew.push(`${kind}: ${known} -> ${n}`);
      else if (n < known) fixed.push(`${kind}: ${known} -> ${n}`);
    }
    for (const kind of Object.keys(KNOWN_BY_KIND)) {
      if (!(kind in actual)) fixed.push(`${kind}: gone`);
    }

    assert.equal(appeared.length, 0,
      `kinds whose sidecar and engine names newly disagree: ${appeared.join(', ')}. Either the `
      + 'name is wrong on one side, or this is a sidecar the engine has not caught up with.');
    assert.equal(grew.length, 0, `naming drift grew: ${grew.join(', ')}`);
    assert.equal(fixed.length, 0,
      `names agree that did not before (${fixed.join(', ')}) — update KNOWN_BY_KIND to lock the `
      + 'win in, or it can silently come back.');
  });

  it('every sidecar kind is accounted for (checked, gap, or excluded)', () => {
    const total = checked + skipped + [...new Set(coverageGaps)].length;
    assert.equal(total, sidecars.length,
      `${total} accounted ≠ ${sidecars.length} sidecars — a kind slipped through without being classified`);
  });
});
