# Source-declared analysis profiles

Brickwright has three deliberately distinct execution paths:

- The GUI live simulator uses the board's `interactive-v1` default. Its timer
  and speed controls do not opt into a numerical-analysis profile.
- The GUI **Run source analyses at precision-v1** action creates an independent
  circuit and opts its transient cards into `precision-v1`. It does not mutate
  the live simulator.
- `bwc analyze FILE --profile precision-v1` is the CLI form of that explicit
  action. `--json` emits the complete machine-readable result. Both entrypoints
  also expose an observation-profile choice: `source-declared-v1` preserves a
  positive authored TSTEP grid, while opt-in `bounded-research-v1` may replace
  an unrepresentable or over-budget output grid and reports the exact before /
  after point counts as `original-adapted` evidence.

Library callers may compare the two fixed profiles on the same source grid:

```js
runSourceAnalyses(imported, { transientProfile: 'interactive-v1' });
runSourceAnalyses(imported, { transientProfile: 'precision-v1' });
```

Transient source fields are not conflated. TSTEP requests output cadence;
TSTART limits the published output window while integration still begins at
zero; TMAX is an integration-step ceiling and execution refuses if the chosen
engine profile is looser. A non-divisible positive TSTEP grid includes TSTOP
as a documented final observation. `UIC`, `startup`, `.ic`, and `.nodeset`
remain separate initialization semantics—unsupported state semantics refuse
instead of being discarded. Fractional-nanosecond waveform corners stay in
their authored seconds and are handled by the engine's source-edge barrier;
they are never rounded into fabricated public nanosecond timestamps.

`.four`, `.meas`, plotting/probe cards, and the exact LTspice output-compression
card `.options plotwinsize=0` are retained as typed, unrequested output
directives. They are shown in source-analysis provenance but are not themselves
executed analyses. Other options and unknown directives remain blockers because
they may change physics or solver semantics.

Omitting `transientProfile` selects and records `interactive-v1`; it does not
bypass work accounting.

A transient result records the exact engine-owned profile, its cumulative
attempt/solve/advance counts, the adapter's total-work limits, source-grid
adaptations, evidence class, and thermal statement. `accuracyMet` qualifies
the engine's local transient-step acceptance and solve convergence only. It is
not a global output-error guarantee and is not agreement with an external
simulator. GUI and CLI results therefore say `oracleComparison: not-performed`.

If the profile cannot meet its qualification, or actual cumulative work
exceeds a fixed total limit, the analysis is refused. Long runs whose minimum
work already exceeds the limit are rejected by `ceil(stop/maxStepSec)`
preflight instead of being abandoned by a wall-clock timeout.

Before local or CI qualification, `npm run verify:board-provenance` binds the
full package declaration and lock resolution to the package Node actually
loads. Installed copies are checked against a reviewed runtime-tree hash;
symlinked checkouts additionally report and require the exact Board HEAD and a
clean worktree. An enclosing CUI repository HEAD is never accepted as the
identity of an installed Board copy.
