# bw-circuit-ui -- handoff for the next session

737 tests (734 pass, 3 browser-only Playwright). 0 pre-existing failures.
21/21 browser gate scenarios green. Deploy current. MPL-2.0 by owner decision.

## Completed since brief

- **Phase 1 craft parity** (9 steps): group drag, bbox marquee, undo
  correctness, copy/paste, wire color + bendpoints, rotation + flip,
  touch support, engine state across rebuilds, fine nudge + unified shortcuts
- **Phase 2 breadboard**: model, footprints (30+ kinds), seating/occupancy,
  electrical continuity via mergeNets, BreadboardView on shared lattice
- **DRC** (8 rules): source-current, missing-resistor, missing-flyback,
  floating-input, supply-short, polarity, I2C pull-up, aggregate current
  (deferred to engine's solved currents). DrcPanel + DrcOverlay wired.
  Safety-lesson canary: DRC never auto-fixes.
- **Sidecar integration**: 123 JSON + 123 SVG vendored from bw-parts,
  sync script with delete support, sidecar-first for terminalsForKind
  and getPartBBox, slug aliases (art 67/67 -- all palette kinds covered)
- **Seated-legibility**: hovering a seated part highlights its occupied
  holes AND their strips in cool-blue; selection keeps warm-orange.
  No permanent chrome -- highlights vanish on unhover/deselect.
- **Serialiser round-trip**: 92 gallery files, legacy files, 5 negative
  controls, battery->vsource silent upgrade documented
- **Terminal cross-check**: 117/123 kinds, MCU no longer skipped, category 2b
- **Wire resolution**: both flat and endpoint-object formats, tap wires,
  kind + terminal aliases (pot, lead1/lead2, cw/ccw, gate_and)
- **Schematic**: mode toggle (was split pane), SVG height fix (was 0px),
  zero-wires defect fixed (terminal alias resolution in fromJSON),
  camera property tests (5/5 pass)
- **Servo angle rendering** from board model, not block arguments
- **60+ palette kinds**, SVG thumbnails, DIP chip pin maps (22 chips)
- **BOM export** with CSV, examples browser, circuitData prop
- **Cube oracle** wired from bw-board (category 3)
- **Ledger audit**: 4 discrepancies found, denominator stated
- **Load precedence**: circuitData > pins > autosave > starter, tested
- **supply-current warning** labels + safe-circuit test
- **Slug coverage guard**: every code-referenced kind must have a sidecar
- **Pi Pico sidecar**: RP2040 board (43 terminals, 40 DIP leads),
  straddlesGutter: true, minCols: 20, seats e1-e20/j1-j20 -- verified

## Completed this session

- **infer-seated test fixed**: The ANALOG test was missing `advanceTo()`
  calls. `readAnalog` and `readPin` read from `nodeVoltages` which are
  only populated after the MNA solver runs during `advanceTo`. Added
  three `advanceTo()` calls -- all 3 infer-seated tests now pass.
- **Wire resolution aliases**: Added `pot -> potentiometer` kind alias,
  `lead1/lead2 -> a/b` for resistor, `cw/ccw -> a/b` for potentiometer.
  All 92 gallery circuit.json files now resolve cleanly.
- **Abstract logic gates**: Added `gate_and`, `gate_or`, `gate_nand`,
  `gate_nor`, `gate_xor`, `gate_not` to `terminalsForKind` with
  `in0/in1/out` terminals (or `in/out` for NOT). Added to slug coverage
  exceptions as schematic-level parts without hardware sidecars.
- **Pico sidecar verified**: pi_pico.json already synced (123 sidecars
  unchanged). Footprint seats correctly on breadboard -- 40 DIP leads
  across 20 columns, straddles gutter. SWD pins (3) correctly excluded
  from the DIP footprint.
- **Browser gate verified**: 21/21 scenarios pass. Counted by output
  lines, not grep exit codes.

## In flight

Nothing uncommitted. No branches.

## Blocked

Nothing blocked. The schematic visual check at full width needs a browser
(routed to coordinator/owner).

## What I learned that is not in a spec-update

- **Assert the property, not the symptom.** Testing for PSEN's absence
  catches only PSEN; testing that pin 32 IS P0.7 catches any wrong pin.
- **A control only proves the method works on the population you looked
  at.** State the denominator.
- **Slug aliases for art must NOT apply to terminal resolution.** The
  zero-wires defect came back when shift_register->74hc595 alias gave
  DIP terminal names instead of friendly names.
- **A tool that silently improves its input is indistinguishable from
  one that corrupts it.** DRC fixes are user-initiated only.
- **`null` means unknown, `[]` means checked-and-none.** This distinction
  was settled across three repos and must not be reopened.
- **`readAnalog` needs the solver to have run** -- it reads from
  `nodeVoltages`, which is only populated by `_solve()` (triggered by
  `setPin`, `setControl`, `setPower`, `advanceTo`). `setControl` alone
  is NOT sufficient -- you must call `advanceTo` to trigger the solve.

## Spec-updates last acted on

- bw-parts: 001-007 (all read, 005-006 acted on)
- bw-board: rst-polarity (read, no action needed)

## Convention

Scan sibling `spec-updates/` at session start per bw-parts CONVENTION.md.
