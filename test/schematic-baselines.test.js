/**
 * Reviewed schematic baselines — the ten worst circuits from the audit.
 *
 * A change to the projection is otherwise invisible until someone opens the
 * app and squints. These ten SVGs are the drawings that were WRONG before the
 * router learned to treat foreign pins as obstacles (docs/SCHEMATIC-AUDIT.md):
 * every one of them ran a conductor through pins on other nets, 30-odd times
 * each. Baselining exactly those means the regression that matters shows up
 * as a diff, not as an argument.
 *
 * When one fails: render it, LOOK at it, and only then accept the new output
 * with `EXAMPLES_DIR=... node scripts/render-schematic.mjs --baselines`.
 * A baseline updated without being looked at is worse than no baseline, since
 * it converts a visible regression into a committed one.
 *
 * @module
 */

import './_setup.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { BASELINE_CASES, CLASS_I_WORST, CONTACT_WORST, ART_FIT_WORST,
  SYMBOL_CONTACT_EXEMPLAR, MISSING_PIN_EXEMPLAR,
  BASELINE_DIR, renderCircuitFile } from '../scripts/render-schematic.mjs';
import { discover, analyse } from '../scripts/schematic-audit.mjs';

const EXPLICIT_ROOT = process.env.EXAMPLES_DIR || null;
if (EXPLICIT_ROOT && !existsSync(EXPLICIT_ROOT)) {
  throw new Error(`EXAMPLES_DIR=${EXPLICIT_ROOT} does not exist. An explicitly selected `
    + 'corpus is never silently replaced by another one — fix the path or unset it.');
}
const here = path.dirname(new URL(import.meta.url).pathname);
const CORPUS_ROOTS = EXPLICIT_ROOT ? [EXPLICIT_ROOT] : [
  path.resolve(here, '../../sb3-creator/examples'),
  path.resolve(here, '../../lego/brickwright-lite/overlay/scratch-gui/examples'),
  path.join(process.env.HOME || '', 'code', 'sb3-creator', 'examples'),
];
const examplesRoot = CORPUS_ROOTS.find(r => existsSync(r)) || null;

describe('reviewed schematic baselines', () => {
  test('the corpus the baselines were reviewed against is present', () => {
    assert.notEqual(examplesRoot, null,
      `Corpus absent. Tried:\n  ${CORPUS_ROOTS.join('\n  ')}\nA baseline gate that cannot `
      + 'render must not report green.');
    // Five groups, because there have been three audit passes and two
    // exemplar classes — see docs/SCHEMATIC-AUDIT.md §10 and §16.
    assert.equal(CLASS_I_WORST.length, 10, 'the first pass named ten worst circuits');
    assert.equal(CONTACT_WORST.length, 10, 'the second pass named ten worst circuits');
    assert.equal(ART_FIT_WORST.length, 10, 'the third pass named ten worst circuits');
    assert.equal(SYMBOL_CONTACT_EXEMPLAR.length, 1, 'class S is represented by one exemplar');
    assert.equal(MISSING_PIN_EXEMPLAR.length, 1, 'class O is represented by one exemplar');
    assert.equal(BASELINE_CASES.length, 32, 'every group must be in the gated set');
  });

  test('every baselined circuit still exists in the corpus', () => {
    const missing = BASELINE_CASES
      .filter(([rel]) => !existsSync(path.join(examplesRoot, rel)))
      .map(([rel]) => rel);
    assert.deepEqual(missing, [],
      'a baselined circuit was renamed or deleted upstream. Re-point the case at its new '
      + 'path, or pick the next-worst circuit — silently dropping it shrinks the coverage '
      + 'this gate claims.');
  });

  test('each baseline renders byte-for-byte as reviewed', () => {
    for (const [rel, name] of BASELINE_CASES) {
      const reviewedPath = path.join(BASELINE_DIR, name);
      assert.ok(existsSync(reviewedPath), `${name} has no reviewed baseline on disk`);
      const actual = renderCircuitFile(path.join(examplesRoot, rel));
      const reviewed = readFileSync(reviewedPath, 'utf-8');
      assert.equal(actual, reviewed,
        `${name} changed. Render it and LOOK at it before accepting: `
        + `node scripts/render-schematic.mjs --circuit ${rel} --out /tmp/x`);
    }
  });

  test('rendering twice gives the same bytes (no id or ordering leak)', () => {
    const [rel] = BASELINE_CASES[0];
    const a = renderCircuitFile(path.join(examplesRoot, rel));
    const b = renderCircuitFile(path.join(examplesRoot, rel));
    assert.equal(a, b, 'the renderer is not deterministic — a baseline would churn forever');
  });

  /**
   * The baselines are only worth their bytes if they cover the drawings that
   * were actually wrong. This asserts that claim rather than trusting the
   * comment above it.
   */
  test('the baselined circuits are still the dense drawings they were chosen for', () => {
    const files = discover(examplesRoot);
    const scored = [];
    for (const f of files) {
      try {
        const r = analyse(f.path);
        // Score by the pin-count of the DIP-heavy drawings the class-I defect
        // hit: the ranking is historical, so re-derive it from something the
        // fixed tree still exposes — how much geometry each drawing carries.
        scored.push({ id: f.id, pins: r.visibleCount, segs: r.segCount });
      } catch { /* another gate's problem */ }
    }
    const baselined = new Set(BASELINE_CASES.map(([rel]) => rel));
    for (const rel of baselined) {
      const row = scored.find(s => s.id === rel);
      assert.ok(row, `${rel} vanished from the corpus scan`);
      // The class-O exemplar is deliberately a SMALL drawing — its whole point
      // is a four-pin MCU that used to be a one-pin MCU — so the density floor
      // applies to the two "worst" groups only.
      const floor = MISSING_PIN_EXEMPLAR.some(([r]) => r === rel) ? 4 : 12;
      assert.ok(row.pins >= floor,
        `${rel} now draws only ${row.pins} pins — it is no longer the drawing this baseline `
        + 'set was chosen for');
    }
  });
});
