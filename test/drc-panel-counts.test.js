/**
 * The Circuit Check heading and its tally must describe the SAME array.
 *
 * The heading renders `warnings.length`. The tally used to count only
 * `danger` and `warning`, so an `info` row was counted in the heading and in
 * neither bucket, and a board whose one finding was a note rendered as
 *
 *     Circuit Check (1)        0 problems, 0 checks
 *
 * (owner report, 2026-09-07, on an MCU the simulator powers implicitly). Two
 * numbers over one array, disagreeing, with no way for a reader to tell which
 * was wrong.
 *
 * These tests hold the invariant rather than the wording: whatever the tally
 * says must ACCOUNT FOR every warning the heading counts.
 */

import './_setup.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { severityCounts, summariseSeverities } from '../src/components/drc-severity.js';

const w = (severity) => ({ severity, rule: 'engine', partId: 'mcu1', explanation: 'x' });

describe('Circuit Check tally', () => {
  it('THE INVARIANT: the buckets sum to what the heading counts', () => {
    const cases = [
      [],
      [w('info')],
      [w('danger'), w('warning'), w('info')],
      [w('danger'), w('danger'), w('info'), w('info'), w('info')],
      [w(undefined), w('mystery'), w(null)],
    ];
    for (const warnings of cases) {
      const c = severityCounts(warnings);
      assert.equal(c.danger + c.warning + c.info, warnings.length,
        `buckets must sum to the heading's count for ${JSON.stringify(warnings.map(x => x && x.severity))}`);
    }
  });

  it('THE OWNER\'S CASE: one note reads as a note, not as "0 problems, 0 checks"', () => {
    const text = summariseSeverities([w('info')]);
    assert.equal(text, '1 note');
    assert.doesNotMatch(text, /0 problems/, 'a single note must not be reported as zero of anything');
    assert.doesNotMatch(text, /0 checks/,
      '"0 checks" reads as "no checks were performed" — it must never appear');
  });

  it('an unknown severity is a note, because that is how the row renders it', () => {
    // The row renderer falls back to the 'i' glyph and the "Note" label for
    // anything that is not danger/warning. The tally must agree with the rows.
    assert.deepEqual(severityCounts([w('mystery')]), { danger: 0, warning: 0, info: 1 });
  });

  it('never prints a zero bucket, and pluralises', () => {
    assert.equal(summariseSeverities([w('danger')]), '1 problem');
    assert.equal(summariseSeverities([w('warning'), w('warning')]), '2 checks');
    assert.equal(summariseSeverities([w('danger'), w('info')]), '1 problem, 1 note');
    assert.doesNotMatch(summariseSeverities([w('danger'), w('warning'), w('info')]), /\b0\b/);
  });

  it('MUTATION: dropping info from the buckets reproduces the reported defect', () => {
    // What the code did before. Kept as an executable statement of the bug so
    // the fix cannot be silently reverted.
    const old = (warnings) =>
      `${warnings.filter(x => x.severity === 'danger').length} problems, ` +
      `${warnings.filter(x => x.severity === 'warning').length} checks`;
    assert.equal(old([w('info')]), '0 problems, 0 checks');
    assert.notEqual(summariseSeverities([w('info')]), old([w('info')]),
      'the fix must not reproduce the old text');
  });

  it('the empty case does not lie', () => {
    // The panel returns early on an empty list, but a helper that reports
    // "0 problems" for nothing at all is a trap for its next caller.
    assert.equal(summariseSeverities([]), 'nothing to report');
  });
});
