# bw-circuit-ui — campaign close-out

621 tests green. Gate 12/12. Deploy current at `sb3-creator` `203b2a3`.
Nothing here has run on real silicon.

## What was verified (numbers, categories)

All categories per `stc/docs/EVIDENCE-CATEGORIES.md`.

| Claim | Number | Category | Notes |
|-------|--------|----------|-------|
| Serialiser round-trip: gallery corpus | 0 losses across 52 files | **2c** — single implementation, negative controls prove comparator works | 5 mutation classes tested |
| Serialiser round-trip: legacy files | Stable derivation, silent upgrade (battery→vsource idempotent) | **2c** | Legacy files are upgraded to current format on first save |
| Terminal cross-check: bw-parts sidecars | 109 of 115 kinds checked, 0 coverage gaps | **2b** — both written from same datasheets this campaign | Cannot catch a shared misreading |
| Cube trace: scan accumulator | 64 voxels, 32 lit at 12.5% duty, 32 dark | **2b** — bw-board and bw-circuit-ui scan accumulators agree | Cube oracle wired (category 3: voxel map empty, polarity unverified) |
| DRC: 8 rules | Source-current, missing-resistor, missing-flyback, floating-input, supply-short, polarity, I2C pull-up, aggregate current (deferred to engine) | **2c** — single implementation | 22 tests including negative controls and the safety-lesson canary |
| Wire resolution: gallery corpus | Every wire terminal resolves across 53+ gallery circuits | **2c** | Both flat and endpoint-object wire formats handled |
| Breadboard electrical continuity | LED lights through strips alone — no drawn wires | **2b** — model + engine agree | Seating, unseating, multi-board independence, 555 DIP gutter straddling all tested |

## Defects found and fixed

Each produced a plausible wrong answer that was invisible to everything
except the check that caught it.

| What was wrong | How it presented | What found it |
|----------------|-----------------|---------------|
| MCU skipped in terminal cross-check | PSEN/ALE/EA disagreement invisible — "agreement" by exclusion | Coordinator asking why the check passed |
| `terminalsForKind` entries lost during restructuring | seven_segment, char_lcd, shift_register, ir_receiver, temp_sensor, eeprom fell to default `['a','b']` | Terminal cross-check (first hour of existence) |
| `getWarnings()` current-budget warning dropped by overlay | Warning had no `partId`, BoardCanvas line 1978 dropped it, DrcOverlay only showed runDrc output | Tracing the path from `checkCurrentBudget` to the screen |
| Aggregate-current test fixture stopped exercising null path | bw-board reclassified `potentiometer` from null to 0; test passed without testing what it claimed | Running after bw-board update — the pot was no longer null-rated |
| Schematic panel invisible (zero-height SVG) | `height="100%"` in a flex item with no definite height → 0px. Nobody ever saw the projection render | Owner report: "totally broken" |
| DRC `fixPart` could auto-fix on load path | Safety-lesson examples encode deliberate mistakes that a normaliser must not "fix" | bw-blocks encoding the rule, independently |
| Hand-copied current ratings in drc.js | Three constants duplicated from bw-board's pin-model.js with a comment admitting manual sync | Coordinator grep |
| Cube-golden cross-check had no guard on empty trace | A loop over 0 events passed every assertion — 0 mismatches | Fleet note on silent degradation |
| `registerSidecar` had zero call sites | 115 sidecars vendored, terminal data available, nothing consumed it — third producer-with-no-consumer | Coordinator grep |

## What is open, with bench IDs

| What | Bench ID | What would settle it |
|------|----------|---------------------|
| Cube polarity (BW_CUBE_ACTIVE_HIGH) | **BENCH-CUBE** | Photograph of lit LED at (FE,01) |
| Cube voxel map ((select,bit)→(x,y,z)) | **BENCH-CUBE** | Physical probe of each voxel position |
| Servo angle rendering accuracy | **BENCH-PWM** | Servo horn position on real hardware |
| DRC source-current threshold (230 µA) | **BENCH-PWM** | Milliamp measurement on quasi-bidir source |
| Terminal positions match real packages | **BENCH-CUBE** / physical | A third-party parts library or package photograph |
| LED ghost vs placed size mismatch | — | Owner-reported visual defect, not hardware-blocked |
| Seated part legibility | — | Owner-reported visual defect, not hardware-blocked |

## What I would pick up next

1. **LED ghost size mismatch** — the FOOTPRINTS dimensions and the wokwi-led
   natural size disagree. One source of truth for a part's visual box.
2. **Seated part legibility** — highlight occupied holes and strip on
   hover/select of a seated part. Short column labels near seated legs.
3. **Schematic projection quality at full width** — now visible for the first
   time. The rendering is unverified; any mis-drawing is its own finding.

## What I did not finish

- **Pane slots (slice 4)** — moved to bw-bundle, correctly. The state is
  modelled but not rendered; `pane-column.jsx` is the missing half.
- **bw-parts SVG art in the canvas renderer** — palette thumbnails render
  sidecar SVGs, but the canvas still uses wokwi elements and hand-drawn
  SVG parts. Full sidecar-art rendering on the canvas is the remaining
  integration.
- **The 12 palette slug mismatches** — my palette uses `pir_sensor`, sidecar
  is `pir`; `shift_register` vs `74hc595`; etc. Each is a kind alias away
  from zero, but the alias table grows and the canonical slug question
  (`bw-parts` owns names) should be settled first.

## The principle this campaign taught me

Assert the property, not the symptom. A check that looks for the absence
of the wrong thing you thought of catches only that thing. A check that
asserts the presence of the right thing catches everything that could
displace it. The MCU terminal cross-check is the concrete case: testing
for PSEN's absence would have passed; testing that pin 32 IS P0.7 catches
any wrong pin in that position.

And: a control only proves the method works on the population you actually
looked at. State the denominator.
