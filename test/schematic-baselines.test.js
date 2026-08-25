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
  BASELINE_DIR, renderCircuitFile,
  sourceHash, corpusSha, readCorpusStamp } from '../scripts/render-schematic.mjs';
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

  test('the corpus these baselines were reviewed against is recorded', () => {
    // A baseline is a picture of ANOTHER repository's tree, and that tree
    // moves: 78-a2-calculator/circuit.json was held back and released again
    // three times on 2026-08-25. Without a stamp the gate can only say
    // "X.svg changed", which lands on whoever pushes next and reads like a
    // rendering regression when it is an upstream edit.
    const stamp = readCorpusStamp();
    assert.ok(stamp, 'docs/schematic-baselines/CORPUS.json is missing. Regenerate the '
      + 'baselines (node scripts/render-schematic.mjs --baselines), which writes it in the '
      + 'same act — a stamp written separately is a stamp that drifts.');

    const missing = BASELINE_CASES.map(([rel]) => rel).filter((rel) => !(rel in stamp.sources));
    assert.deepEqual(missing, [],
      'a baselined circuit has no recorded source hash — the baseline set grew without the '
      + 'stamp being rewritten, so the gate cannot tell an upstream change from a rendering one '
      + 'for those cases.');

    const now = corpusSha(examplesRoot);
    if (now && stamp.corpusSha && now !== stamp.corpusSha) {
      // NOT a failure: the corpus moving is normal, and most moves touch
      // nothing these baselines draw. It is worth SAYING, so the next reader
      // is not surprised by which sha they are looking at.
      console.log(`\n  corpus has moved since the baselines were stamped: `
        + `${stamp.corpusSha.slice(0, 7)} -> ${now.slice(0, 7)}`);
    }
  });

  test('each baseline renders byte-for-byte as reviewed', () => {
    const stamp = readCorpusStamp() || { sources: {} };
    const upstream = [];   // the SOURCE moved: not this repo's change
    const ours = [];       // source identical, drawing different: ours
    for (const [rel, name] of BASELINE_CASES) {
      const reviewedPath = path.join(BASELINE_DIR, name);
      assert.ok(existsSync(reviewedPath), `${name} has no reviewed baseline on disk`);
      const actual = renderCircuitFile(path.join(examplesRoot, rel));
      const reviewed = readFileSync(reviewedPath, 'utf-8');
      if (actual === reviewed) continue;
      const before = stamp.sources[rel];
      const after = sourceHash(path.join(examplesRoot, rel));
      (before && after && before !== after ? upstream : ours).push({ rel, name, before, after });
    }

    // Report the upstream ones FIRST and separately: they are somebody else's
    // edit arriving, and conflating them with a rendering regression is how a
    // corpus move gets blamed on whoever pushed next.
    assert.deepEqual(upstream.map((u) => u.name), [],
      'THE CORPUS MOVED under these baselines — the source circuit changed upstream, so this '
      + 'is not a rendering regression:\n'
      + upstream.map((u) => `    ${u.rel}  ${u.before} -> ${u.after}  (${u.name})`).join('\n')
      + '\n  Look at the new drawing, then re-stamp with '
      + '`EXAMPLES_DIR=... node scripts/render-schematic.mjs --baselines`.');

    assert.deepEqual(ours.map((o) => o.name), [],
      'the drawing changed while every source circuit stayed byte-identical, so this IS a '
      + 'rendering change in this repo. Render it and LOOK at it before accepting: '
      + `node scripts/render-schematic.mjs --circuit ${ours[0]?.rel ?? '<case>'} --out /tmp/x`);
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
