// Distances that become a VERDICT or a FILE must be computed identically in
// every engine.
//
// `Math.hypot` is not required by the spec to be correctly rounded, so V8 and
// JavaScriptCore may differ in the last bits. That is not academic here: the
// PCB autorouter's A* built its costs from hypot, near-ties broke the other
// way in WebKit, and the same circuit came out with traces on DIFFERENT COPPER
// LAYERS in Safari than in Chrome. The board view feeds the PCB exporters, so
// a board you might send to a fab depended on your browser.
//
// `Math.sqrt` is correctly rounded per IEEE-754, so `dist` gives every engine
// the same double.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dist } from '../src/model/exact-hypot.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(here, '..', 'src');

describe('dist', () => {
  it('agrees with Math.hypot on the magnitudes a board actually uses', () => {
    // Millimetres on a PCB and world units on a canvas. If these two ever
    // disagreed the swap would be a behaviour change, not just a rounding one.
    // RELATIVE tolerance: one ULP at 1414 is far larger than at 5, so an
    // absolute epsilon fails on the big pair while passing the small ones —
    // which is a bug in the test, not in either function.
    for (const [a, b] of [[3, 4], [0.635, 1.27], [28.27, 15.57], [0, 0],
      [1e-6, 1e-6], [1000, 1000], [-5, 12]]) {
      const mine = dist(a, b), theirs = Math.hypot(a, b);
      const tol = Number.EPSILON * Math.max(1, Math.abs(theirs)) * 4;
      assert.ok(Math.abs(mine - theirs) <= tol,
        `dist(${a},${b})=${mine} vs hypot=${theirs} (tol ${tol})`);
    }
  });

  it('is exactly sqrt(dx*dx + dy*dy), which IEEE-754 pins down', () => {
    // The property that makes it portable: sqrt is correctly rounded, so this
    // identity holds bit-for-bit in every conforming engine.
    for (const [a, b] of [[3, 4], [0.1, 0.2], [7.31, 2.19]]) {
      assert.equal(dist(a, b), Math.sqrt(a * a + b * b));
    }
  });

  it('gives up the overflow guard, and that is fine for board coordinates', () => {
    // Stated rather than hidden: hypot survives inputs whose squares overflow;
    // sqrt does not. Nothing here is within thirty orders of magnitude of it.
    assert.equal(Number.isFinite(dist(1e200, 1e200)), false);
    assert.equal(Number.isFinite(Math.hypot(1e200, 1e200)), true);
    assert.ok(Number.isFinite(dist(1e150, 1e150)), 'still fine far above any board');
  });
});

/**
 * Modules whose output is persisted, exported, or asserted on. A distance
 * computed here can decide whether a DRC reports a short, which layer a trace
 * lands on, or what bytes go into an exported PCB — so it must not depend on
 * the engine. MAY ONLY SHRINK.
 */
const VERDICT_MODULES = [
  'model/pcb-drc.js', 'model/pcb-geometry.js', 'model/board-projection.js',
  'model/exporters/easyeda-pcb.js', 'model/schematic-projection.js',
  'model/schematic-symbols.js',
  'importers/kicad-pcb.js', 'importers/easyeda-pcb.js', 'importers/easyeda.js',
];

describe('Math.hypot stays out of the layers that decide things', () => {
  it('the listed modules all exist — the guard is not watching ghosts', () => {
    for (const rel of VERDICT_MODULES) {
      assert.ok(existsSync(path.join(SRC, rel)), `${rel} is gone; update the list`);
    }
  });

  it('none of them calls Math.hypot', () => {
    const offenders = [];
    for (const rel of VERDICT_MODULES) {
      const src = readFileSync(path.join(SRC, rel), 'utf8');
      const n = (src.match(/Math\.hypot\(/g) || []).length;
      if (n) offenders.push(`${rel} (${n})`);
    }
    assert.deepEqual(offenders, [],
      'these decide verdicts or write files, so they must use dist() from '
      + 'model/exact-hypot.js — Math.hypot is not correctly rounded and differs '
      + `between engines: ${offenders.join(', ')}`);
  });

  it('and they really do use dist, so the guard could fail', () => {
    // Vacuity: a module that computes no distances at all would satisfy the
    // check above by doing nothing. At least most of the list must import the
    // helper, or the previous test proves only that the files are boring.
    const importing = VERDICT_MODULES.filter(rel =>
      /from '[^']*exact-hypot\.js'/.test(readFileSync(path.join(SRC, rel), 'utf8')));
    assert.ok(importing.length >= 6,
      `only ${importing.length} of ${VERDICT_MODULES.length} import dist() — `
      + 'if the distances moved elsewhere, move the guard with them');
  });

  it('transient UI maths is deliberately NOT in the list', () => {
    // Hit-testing and drag feedback are recomputed every frame and never
    // persisted, so a last-bit difference cannot reach a file or a verdict.
    // Asserting it keeps the exclusion honest rather than accidental.
    const ui = ['interaction/hittest.js', 'interaction/machine.js'];
    for (const rel of ui) {
      assert.ok(!VERDICT_MODULES.includes(rel), `${rel} should stay excluded`);
      assert.ok(existsSync(path.join(SRC, rel)), `${rel} exists`);
    }
  });
});
