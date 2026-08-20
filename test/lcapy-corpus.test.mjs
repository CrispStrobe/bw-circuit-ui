/**
 * The imported CORPUS against lcapy.
 *
 * The synthetic oracle in bw-board checks fourteen circuits somebody wrote on
 * purpose. This one checks circuits nobody wrote for us: real published
 * schematics, imported through our own EAGLE and KiCad readers, solved by our
 * MNA and by an independent symbolic solver.
 *
 * That difference found a bug the synthetic set could not. Every board carries
 * several VCC symbols — a schematic draws one per connection point — and each
 * used to get its own constraint row, which made the matrix singular and
 * returned 0 V for every node including the rail. 25 of 26 boards failed. See
 * bw-board's rail-duplicate-symbols.test.mjs.
 *
 * SKIPS, LOUDLY, when the corpus or lcapy is absent. Both are local research
 * material and neither is vendored: the corpus is third-party hardware under
 * assorted licences, and lcapy is LGPL and is run, never copied.
 */

import './_setup.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectLinearCircuits } from './lcapy/collect.mjs';
import { solveMNA } from '../../bw-board/src/mna.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CORPUS = process.env.EAGLE_CORPUS
  || path.join(process.env.HOME || '', 'code', 'eagle-corpus');

function findLcapyPython() {
  const cands = [process.env.LCAPY_PYTHON,
    path.join(process.env.HOME || '', '.local/pipx/venvs/lcapy/bin/python'), 'python3'].filter(Boolean);
  for (const py of cands) {
    if (py !== 'python3' && !existsSync(py)) continue;
    try { execFileSync(py, ['-c', 'import lcapy'], { stdio: 'ignore' }); return py; } catch { /* next */ }
  }
  return null;
}

const PY = findLcapyPython();
const SKIP = !existsSync(CORPUS)
  ? `no corpus at ${CORPUS} — set EAGLE_CORPUS (local research material, never vendored)`
  : !PY ? 'no Python with lcapy — tried $LCAPY_PYTHON, ~/.local/pipx/venvs/lcapy/bin/python, python3. '
        + 'Install with: pipx install lcapy'
  : false;

describe('imported corpus vs lcapy', { skip: SKIP }, () => {
  const { specs, ours, skipped } = collectLinearCircuits(CORPUS);
  const names = Object.keys(specs);
  const reference = names.length
    ? JSON.parse(execFileSync(PY, [path.join(HERE, 'lcapy', 'run-lcapy.py')],
        { input: JSON.stringify(specs), encoding: 'utf8', maxBuffer: 16 << 20 }))
    : {};

  test('the corpus still yields circuits a linear solver can check', () => {
    // If the eligibility filter or an importer regresses, this collapses to
    // zero and every assertion below would pass by having nothing to do.
    assert.ok(names.length >= 20,
      `only ${names.length} linear circuits collected from ${CORPUS} `
      + `(${skipped.length} skipped) — an importer or the filter has regressed`);
  });

  test('every board our solver answers agrees with lcapy', () => {
    const bad = [];
    let compared = 0;
    for (const name of names) {
      const r = reference[name];
      // lcapy REFUSES ill-posed circuits ("the circuit graph is disjoint").
      // Real boards have capacitively isolated nodes all the time, so that is
      // a difference in strictness, not a disagreement about physics.
      if (r.__error__) continue;
      const { parts, nets, node } = ours[name];
      const res = solveMNA(parts, nets, new Map(), new Map(), 5);
      if (!res.converged) { bad.push(`${name}: our solver did not converge`); continue; }
      const byNum = new Map(Object.entries(node).map(([id, n]) => [String(n), id]));
      for (const [n, want] of Object.entries(r)) {
        const got = res.nodeVoltages.get(byNum.get(String(n)));
        if (got === undefined) continue;
        compared++;
        // 1e-5 V, not tighter: an inductor is a 1 mOhm wire here and an exact
        // short in lcapy, which shows up as microvolts on boards with ferrites.
        if (Math.abs(got - want) > 1e-5) {
          bad.push(`${name} node ${n}: lcapy ${want} vs ours ${got}`);
        }
      }
    }
    assert.ok(compared >= 50, `only ${compared} node voltages compared — the check has hollowed out`);
    assert.deepEqual(bad, [], `real boards disagree with an independent solver:\n  ${bad.join('\n  ')}`);
  });
});
