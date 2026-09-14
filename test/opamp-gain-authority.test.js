/**
 * ONE AUTHORITY FOR THE OP-AMP'S OPEN-LOOP GAIN.
 *
 * The palette carried `params: { gain: 100000 }` on its op-amp entry while
 * bw-board's `src/mna.js` defaults an op-amp to 1e6 — so every op-amp a user
 * placed solved at a TENTH of the gain the engine documents, and the number
 * that governed lived in a React component. That is a restated default which
 * had drifted from the thing it restated, and it was found by another lane's
 * scan rather than by anything electrical failing.
 *
 * The fix is not to correct the copy to 1e6. It is to delete the copy, so the
 * engine is the only authority and there is nothing left to drift.
 *
 * This file holds that ONE value. The general rule — that no palette entry may
 * restate an engine default — is a separate scan in the controlled-sources
 * lane, and duplicating it here would make two gates for one rule.
 */

import './_setup.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const palette = readFileSync(path.join(here, '../src/components/PartPalette.jsx'), 'utf-8');

describe('op-amp open-loop gain has one home', () => {
  it('the palette entry states no gain at all', () => {
    const entry = palette.split('\n').find((l) => /kind: 'opamp'/.test(l));
    assert.ok(entry, 'the op-amp palette entry must still exist');
    assert.ok(!/gain/.test(entry),
      `the palette must not state a gain: ${entry.trim()}`);
  });

  it('no palette entry anywhere states a gain', () => {
    // Guard every reach, not the one you see: the defect was one entry, the
    // rule is about the file.
    const offenders = palette.split('\n')
      .filter((l) => /kind: '/.test(l) && /\bgain\s*:/.test(l));
    assert.deepEqual(offenders, [],
      `palette entries stating a gain: ${offenders.join(' | ')}`);
  });

  it("the engine's default is what an untouched op-amp solves at, and it is 1e6", () => {
    // Read it from the engine rather than restating it here — a test that
    // pins its own copy of a default agrees with itself forever.
    const mna = readFileSync(
      path.join(here, '../node_modules/bw-board/src/mna.js'), 'utf-8');
    const m = /part\.params\.gain \?\? \(part\.kind === 'vcvs' \? 1 : ([\deE.+-]+)\)/.exec(mna);
    assert.ok(m, 'could not locate the op-amp gain default in bw-board/src/mna.js');
    assert.equal(Number(m[1]), 1e6,
      'if the engine default moves, this test should be re-read, not re-pinned');
  });
});
