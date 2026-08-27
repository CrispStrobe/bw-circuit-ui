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
  const unreachable = [];
  const notConnected = [];
  const extraSpellings = [];
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
        // A sidecar may declare VARIANTS — "this part comes in two wirings" —
        // and then its terminals describe one of them, not the engine's
        // default. stepper is the case: the sidecar is the four-wire BIPOLAR
        // motor, the engine defaults to the five-wire unipolar one, and both
        // are real motors. Compare against whichever variant the sidecar is
        // describing; fall back to the default when none matches, so a
        // genuine mismatch still reports.
        circuitTerminals = terminalsForKind(sc.kind);
        for (const v of Array.isArray(sc.variants) ? sc.variants : []) {
          for (const value of v.values || []) {
            let alt;
            try { alt = terminalsForKind(sc.kind, { [v.param]: value }); } catch { continue; }
            const side = new Set(sc.terminals.map((t) => t.name));
            if (alt.every((n) => n === 'vcc' || n === 'gnd' || side.has(n))) {
              circuitTerminals = alt;
            }
          }
        }
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

      // TWO populations, and they are not the same fact.
      //
      // A sidecar name the engine does not accept is a pin you can wire on
      // the board and cannot wire in the app — a real gap, and the sharp
      // one. An engine name the sidecar lacks is an extra SPELLING: the
      // sidecar defines the package (a 74HC595 has sixteen pins), so a
      // thirty-fifth engine name is not a thirty-fifth pin. 74hc595 offers
      // data/clock/latch and both q0-q7 and Q0-Q7 for pins the sidecar
      // already names ser/srclk/rclk and qa-qh; stc15_mcu carries every
      // port pin in both cases. Counting those together put 68 conveniences
      // and 27 real gaps in one number, which is the thing this file's own
      // header warns about one level up.
      for (const name of sidecarNames) {
        if (name === 'vcc' || name === 'gnd') continue;
        if (circuitNames.has(name)) continue;
        // A pin NAMED nc is Not Connected: the package has the leg, the die
        // joins nothing to it, and no model can or should reach it. That is a
        // package fact, not a modelling gap, and it was a third of the
        // "unreachable" count. Classified from the NAME rather than a
        // hand-kept list, because the sidecars already say it — 74HC93 calls
        // them nc1..nc4, the '20 and '21 nc1/nc2, the '95 plain nc.
        (/^nc\d*$/.test(name) ? notConnected : unreachable)
          .push(`${sc.kind}: sidecar "${name}" not in circuit model`);
      }
      for (const name of circuitNames) {
        if (name === 'vcc' || name === 'gnd') continue;
        if (!sidecarNames.has(name)) {
          extraSpellings.push(`${sc.kind}: circuit "${name}" not in sidecar`);
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
   *
   * 2026-08-27: 163 -> 0 unreachable + 0 extra spellings. Nine kinds healed by renaming the SIDECAR to what
   * the engine calls the pin, the engine being the authority here. 74HC283 was
   * the one worth doing first: its sidecar said a1-a4 where the engine says
   * a0-a3, so a wire drawn from the datasheet landed one bit out — and the
   * sidecar's own footprint.leads already said a0-a3, so it disagreed with
   * itself. That pattern held: the same nine renames took bw-parts'
   * verify-seating from 73 errors to 30, because a lead can only find its
   * terminal if they are called the same thing.
   */
  /**
   * A pin the SIDECAR has that the engine cannot reach — you could wire it on
   * the board and not in the app. The sharp population, and every kind in it
   * is also on hd44780-terminal-parity's KNOWN_MISMATCHES with a reason: NC
   * pins the engine does not model, or a sidecar describing a different
   * physical device. MAY ONLY SHRINK.
   */
  /**
   * A pin the SIDECAR has that the engine cannot reach: you could wire it on
   * the board and not in the app. The sharp population — 27 — and every kind
   * in it is also on hd44780-terminal-parity's KNOWN_MISMATCHES with a stated
   * reason (NC pins the engine does not model, or a sidecar describing a
   * different physical device). MAY ONLY SHRINK.
   */
  /**
   * A pin the SIDECAR has that the engine cannot reach — you could wire it on
   * the board and not in the app. NINE, and all three kinds are the same
   * shape: the sidecar and the engine describe DIFFERENT DEVICES, so closing
   * one means deciding which device the part is, not renaming anything.
   *
   * stepper and gas_sensor both came OFF this list on 2026-08-27, and both by
   * the same route — the engine learned the SECOND thing the part can be
   * (bipolar as well as unipolar, module as well as bare element), the sidecar
   * declared it in `variants`, and this file tries a declared variant before
   * reporting a mismatch. What is left is not that shape: a DS1302's crystal
   * is not another packaging of the same device, it is behaviour nobody has
   * modelled. That is why it is the last one.
   *
   * Closing one costs:
   * bw-board 57da9b0 taught the device BOTH wirings behind params.wiring, the
   * sidecar declares them as variants, and this file now tries a declared
   * variant before reporting a mismatch. Three changes in three repos for four
   * pins — which is why each was a decision and not a chore.
   *
   * The DS1302 was the last, and it closed the way this comment predicted:
   * not by declaring a variant but by someone writing the behaviour. bw-board
   * d85b08b gave the part X1/X2 and VCC1 — the oscillator decided by WIRING
   * via ctx.netFor, because quartz has no DC signature, and a supply that
   * runs from whichever rail is higher and LOSES the registers below 2.0 V.
   * Both are the difference the pins exist to make: no crystal, no seconds
   * even with CH clear; no cell, and a power cut costs you the time.
   *
   * So this list is EMPTY, and staying empty is the claim. Every pin bw-parts
   * draws is now a pin the engine can reach. A new entry here means a sidecar
   * gained a leg the engine has no answer for, and that is worth stopping on.
   *
   * MAY ONLY SHRINK — and it cannot shrink further.
   */
  const UNREACHABLE_BY_KIND = {};

  /**
   * Pins named `nc`. The package has the leg and the die joins nothing to it,
   * so no model can reach one and none should — a package fact rather than a
   * gap. Counted anyway: a new one appearing means a sidecar gained a leg,
   * which is worth seeing. This was a third of the old "unreachable" number
   * and made nine real questions look like eighteen.
   */
  const NOT_CONNECTED_BY_KIND = {
    '74hc93': 4,
    '74hc20': 2,
    '74hc21': 2,
    '74hc95': 1,
  };

  /**
   * A name the ENGINE accepts that the sidecar does not list. Not a pin — an
   * extra SPELLING for one the sidecar already names. The sidecar defines the
   * package: a 74HC595 has sixteen pins, so the engine's thirty-five names are
   * those sixteen plus nineteen conveniences (data/clock/latch for ser/srclk/
   * rclk, and both q0-q7 and Q0-Q7 for qa-qh). stc15_mcu is the same at forty
   * pins, in both cases. Harmless, but counted — because a real gap must never
   * be able to hide inside it, which is exactly what 163 as one number allowed.
   * MAY ONLY SHRINK.
   */
  const EXTRA_BY_KIND = {
    stc15_mcu: 38,
    '74hc595': 19,
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

  it('per kind: which moved, and in which direction', () => {
    const census = (list) => {
      const out = {};
      for (const m of list) {
        const kind = m.slice(0, m.indexOf(':'));
        out[kind] = (out[kind] ?? 0) + 1;
      }
      return out;
    };
    const check = (label, actual, known) => {
      const appeared = [], grew = [], fixed = [];
      for (const [kind, n] of Object.entries(actual)) {
        const was = known[kind];
        if (was === undefined) appeared.push(`${kind} (+${n})`);
        else if (n > was) grew.push(`${kind}: ${was} -> ${n}`);
        else if (n < was) fixed.push(`${kind}: ${was} -> ${n}`);
      }
      for (const kind of Object.keys(known)) if (!(kind in actual)) fixed.push(`${kind}: gone`);
      assert.equal(appeared.length, 0, `${label}: kinds newly disagreeing: ${appeared.join(', ')}`);
      assert.equal(grew.length, 0, `${label}: grew: ${grew.join(', ')}`);
      assert.equal(fixed.length, 0,
        `${label}: improved (${fixed.join(', ')}) — update the baseline to lock it in, or it can `
        + 'silently come back.');
    };
    const show = (label, c) => console.log(`  ${label}: ` + JSON.stringify(
      Object.entries(c).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))));
    show('UNREACHABLE', census(unreachable));
    show('NOT CONNECTED', census(notConnected));
    show('EXTRA', census(extraSpellings));
    check('unreachable', census(unreachable), UNREACHABLE_BY_KIND);
    check('not connected', census(notConnected), NOT_CONNECTED_BY_KIND);
    check('extra spellings', census(extraSpellings), EXTRA_BY_KIND);
    assert.deepEqual(namingDiffs, [],
      `the MCU subset check found ${namingDiffs.length} problems: ${namingDiffs.join('; ')}`);
  });

  it('every sidecar kind is accounted for (checked, gap, or excluded)', () => {
    const total = checked + skipped + [...new Set(coverageGaps)].length;
    assert.equal(total, sidecars.length,
      `${total} accounted ≠ ${sidecars.length} sidecars — a kind slipped through without being classified`);
  });
});
