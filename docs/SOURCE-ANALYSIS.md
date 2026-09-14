# Source-declared analysis profiles

Brickwright has three deliberately distinct execution paths:

- The GUI live simulator uses the board's `interactive-v1` default. Its timer
  and speed controls do not opt into a numerical-analysis profile.
- The GUI **Run source analyses at precision-v1** action creates an independent
  circuit and opts its transient cards into `precision-v1`. It does not mutate
  the live simulator.
- `bwc analyze FILE --profile precision-v1` is the CLI form of that explicit
  action. `--json` emits the complete machine-readable result.

Library callers may compare the two fixed profiles on the same source grid:

```js
runSourceAnalyses(imported, { transientProfile: 'interactive-v1' });
runSourceAnalyses(imported, { transientProfile: 'precision-v1' });
```

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
