# Sweep canvas interaction diagnosis

The reported PR 20 `sweep-canvas-live` zero-motion failure is being investigated
from pinned base `657e0217fa14fe345ad2781ae87d7f1e9b1e42fe`. This change adds
diagnostics; **it is not a claimed fix for an unconfirmed product defect**.
Production UI code, package dependencies and the original drag threshold and
resistor selector are unchanged.

Validation of the final diagnostic implementation: the focused interaction,
interaction-machine, rendering-regression, sim-edit-exclusion and four sweep
test files pass **97/97 tests across 19 suites, no skips**. This is a scoped
selection, not a claim that the repository-wide unit suite was run.

## Repeat a specific instrument scenario

```sh
BW_GATE_SCENARIO=sweep-canvas-live \
BW_GATE_PORT=3157 \
BW_GATE_CHROMIUM=/path/to/chromium \
BW_GATE_ARTIFACT_DIR=/path/to/new-artifact-directory \
  npm run verify:interaction
```

The filter accepts only an exact declared instrument-scenario ID. It preserves
the shared function-generator/resistor/meter/scope setup, prints prerequisite
outcomes, and requires both the selected scenario and `zero-page-errors` in its
roll-call. Output explicitly says **TARGETED DIAGNOSTIC ONLY**. A targeted pass
must not be reported as the full interaction gate passing.

Filtering is refused whenever `CI` is set. Without a filter the original **34
scenarios** and their full roll-call remain mandatory. Tests verify the default
denominator, exact-ID refusal and prohibition on filtering in CI.

The Vite child now runs directly under the gate's Node executable, using this
checkout's installed dependency. Its bounded stdout/stderr tail is retained for
startup failures, rather than discarding the actual cause. The gate terminates
the server it owns. A supplied Chromium executable is optional; the default
still uses Playwright's installed browser.

## Evidence collected

The sweep diagnostic records:

- Running state and the same before/after resistor rectangles used by the gate.
- Pointer events, event targets, capture/loss/cancellation and timestamps.
- Hit target and resistor model positions on pointer down/up.
- Bounded browser long-task timings.

It prints JSON in the log. With an artifact directory it also writes
`sweep-drag.json` and `sweep-drag.png`; JSON refuses to overwrite a prior receipt.
CI preserves these through its always-running artifact upload step.

Listeners are installed in the **existing pre-sweep label-observer evaluation**.
There is no additional awaited evaluation between bounding-box capture and the
original pointer gesture: adding one there could conceal a layout race. No
forced click, retry-until-green, longer acceptance delay, relaxed movement
threshold or suppressed failing scenario has been added.

## Initial local observations

Environment: Node 22.12.0, local Chromium 150, own-tree `npm ci` at the pinned
dependency lock; no peer dependency tree was modified.

An initial targeted run and a complete 34-scenario run both moved the original
first resistor **139.7 px**, with the sweep running beforehand and intact
pointer capture. They showed no pointer cancellation or occlusion. The complete
run reported **34/34 passed**, with zero page errors. Those initial diagnostics
did include an extra pre-drag evaluation; its possible timing influence was
identified and removed before the follow-up targeted run.

The follow-up, with the original bounding-box-to-pointer await sequence
preserved, again passed both targeted outcomes: **139.7 px**, valid capture,
zero page errors, and model evidence that `resistor_12` moved and was unseated.
Thus the zero-motion failure was **not reproduced in these three local runs**.
On that shared-load run the drag lasted 14.5 seconds and a long task reached
1.352 seconds; those observations still do not identify the CI failure's cause.

The initial full-context gesture took approximately **9.1 seconds** between
pointer down and up, and the largest observed long task was **672 ms**. This is
evidence of poor responsiveness in that run, **not proof that the sweep itself
caused the reported zero-motion failure**. The first selected resistor belongs
to the starter breadboard, so dragging also exercises unseating; it is not the
newly added free resistor. That original choice is retained for reproduction.

No product change should be called a fix until a failing trace or other concrete
reproducer identifies the cause. The diagnostic artifacts are intended to make
the next CI failure distinguish hit-target, capture, model/layout and main-thread
timing behavior without weakening the gate.
