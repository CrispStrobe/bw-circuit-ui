/**
 * The one-line tally beside the heading.
 *
 * IT MUST ACCOUNT FOR EVERY WARNING THE HEADING COUNTS. The heading shows
 * `warnings.length`, and the tally used to count only `danger` and `warning`.
 * An `info` row was therefore counted in the heading and in neither bucket, so
 * a board whose single finding was a note rendered as
 *
 *     Circuit Check (1)        0 problems, 0 checks
 *
 * — a header and a body disagreeing about the same array (owner report,
 * 2026-09-07, on an implicitly powered MCU).
 *
 * "0 checks" was the worse half. `SEVERITY_LABELS` calls a `warning` a
 * "Check", so the phrase meant "no warnings"; it READ as "no checks were
 * performed", which tells a user the result they are looking at is worthless.
 * A tally that can say a true thing in words that mean the opposite is not a
 * tally worth keeping.
 *
 * So: derive from ONE pass, name each bucket with the SAME vocabulary the rows
 * use, and omit empty buckets rather than printing a zero. The counts then sum
 * to `warnings.length` by construction, which is what the test asserts.
 */
export function severityCounts (warnings) {
  const counts = { danger: 0, warning: 0, info: 0 };
  for (const w of warnings || []) {
    // Anything not explicitly danger/warning is shown with the 'i' glyph and
    // the "Note" label by the row renderer, so it is counted as one here too.
    counts[w && (w.severity === 'danger' || w.severity === 'warning') ? w.severity : 'info'] += 1;
  }
  return counts;
}

const PLURAL = {
  danger: ['problem', 'problems'],
  warning: ['check', 'checks'],
  info: ['note', 'notes'],
};

export function summariseSeverities (warnings) {
  const counts = severityCounts(warnings);
  const parts = [];
  for (const key of ['danger', 'warning', 'info']) {
    const n = counts[key];
    if (n > 0) parts.push(`${n} ${PLURAL[key][n === 1 ? 0 : 1]}`);
  }
  // Unreachable from the panel, which returns early when there are none, but
  // a helper that lies when handed an empty array is a trap for its next caller.
  return parts.length ? parts.join(', ') : 'nothing to report';
}
