/**
 * THE ORACLE IS HELD TO THE SAME STANDARD AS THE ENGINE.
 *
 * `judgeForeignDeck` already refuses OUR answer when the solver reports
 * `converged: false`, on the ground that a non-converged solve is an iterate and
 * not an answer. It was not applying that to ngspice — the same claim about the
 * other operand — and ngspice STILL PRINTS A BIAS-POINT TABLE after giving up,
 * with no change in exit status.
 *
 * The corpus case (ADI2005 v3 row 11, a common-emitter amplifier whose output
 * hangs off a 3 uF coupling capacitor and is therefore floating at `.op`):
 *
 *   Warning: singular matrix:  check node out
 *   Warning: Dynamic gmin stepping failed
 *   Warning: True gmin stepping failed
 *   Warning: source stepping failed
 *   base 1.110813e-03   emit 3.073119e-12   coll 1.200000e+01
 *
 * A 36k/7.5k divider off 12 V puts that base at 2.07 V and nothing in the deck
 * says otherwise. Scoring against those numbers manufactures false
 * disagreements AND false agreements, and the second kind is worse because it
 * inflates the corpus figure: 277 of a 2,000-deck sample were being scored
 * against a non-converged run, and 257 of them were counted as AGREEING.
 *
 * It is also an independent confirmation of where ngspice puts GMIN. A
 * junction-free floating node makes its matrix singular, which cannot happen if
 * every node carries a conductance to the reference.
 */

import './_setup.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runNgspice, judgeForeignDeck, haveNgspice } from '../scripts/spice-oracle.mjs';

const HAVE = haveNgspice();

// Self-authored: the output node is reachable only through the capacitor, so at
// a bias point it is floating and ngspice's matrix is singular.
const FLOATING = [
  '* a node reachable only through a coupling capacitor',
  'VCC VCC 0 12',
  'R1 VCC BASE 36k',
  'R2 BASE 0 7.5k',
  'RC VCC COLL 510',
  'RE EMIT 0 240',
  'Q1 COLL BASE EMIT QN',
  'COUT COLL OUT 3u',
  '.model QN NPN (BF=200 IS=1e-14)',
  '.op',
  '.end',
].join('\n');

// The same circuit with the dangling node tied down: ngspice converges.
const GROUNDED = FLOATING.replace('COUT COLL OUT 3u', 'ROUT COLL OUT 1k\nR3 OUT 0 1k');

describe('ngspice non-convergence is reported, not scored', () => {
  it('runNgspice reports a singular matrix separately from a deck error', (t) => {
    if (!HAVE) { t.skip('ngspice not installed'); return; }
    const dir = mkdtempSync(join(tmpdir(), 'nonconv-'));
    try {
      const r = runNgspice(FLOATING, dir, 'floating');
      assert.equal(r.error, null, 'the deck itself is accepted — this is not a syntax refusal');
      assert.ok(r.nonConverged, 'a singular matrix must be reported');
      assert.match(r.nonConverged, /singular matrix/i);
      // And it printed a table anyway, which is exactly the trap.
      assert.ok(Object.keys(r.nodes).length > 0,
        'ngspice prints a bias-point table after giving up; that is why this check exists');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('and reports nothing for a deck it does solve', (t) => {
    if (!HAVE) { t.skip('ngspice not installed'); return; }
    const dir = mkdtempSync(join(tmpdir(), 'nonconv-'));
    try {
      const r = runNgspice(GROUNDED, dir, 'grounded');
      assert.equal(r.error, null);
      assert.equal(r.nonConverged, null,
        `a converging deck must not be flagged: ${r.nonConverged}`);
      assert.ok(Object.keys(r.nodes).length > 0);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('the judge REFUSES rather than comparing, and says which node', async (t) => {
    if (!HAVE) { t.skip('ngspice not installed'); return; }
    const dir = mkdtempSync(join(tmpdir(), 'nonconv-'));
    try {
      const r = await judgeForeignDeck('floating.cir', FLOATING, dir, {});
      assert.equal(r.ok, false);
      assert.equal(r.compared, 0, 'nothing may be compared against a failed iterate');
      assert.match(r.reason, /^oracle-non-convergence:/,
        `the reason must name the cause, got: ${r.reason}`);
      assert.ok(r.lines.some((l) => /failed iterate/.test(l)),
        'the report must say what the printed table is');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('the same circuit with the node tied down is judged normally', async (t) => {
    if (!HAVE) { t.skip('ngspice not installed'); return; }
    // The separating control: without it, a refusal that fired for ANY reason
    // would satisfy the test above.
    const dir = mkdtempSync(join(tmpdir(), 'nonconv-'));
    try {
      const r = await judgeForeignDeck('grounded.cir', GROUNDED, dir, {});
      assert.ok(r.compared > 0,
        `the control deck must actually be compared, got compared=${r.compared} reason=${r.reason}`);
      assert.ok(!/oracle-non-convergence/.test(r.reason || ''),
        `the control must not be refused for non-convergence: ${r.reason}`);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
