# bw-circuit-ui — handoff for the next session

701 tests (681 pass, 19 cancelled browser-only, 1 pre-existing infer-seated).
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
  and getPartBBox, slug aliases (art 67/67 — all palette kinds covered)
- **Seated-legibility**: hovering a seated part highlights its occupied
  holes AND their strips in cool-blue; selection keeps warm-orange.
  No permanent chrome — highlights vanish on unhover/deselect.
- **Serialiser round-trip**: 52 gallery files, legacy files, 5 negative
  controls, battery→vsource silent upgrade documented
- **Terminal cross-check**: 109/115 kinds, MCU no longer skipped, category 2b
- **Wire resolution**: both flat and endpoint-object formats, tap wires,
  kind + terminal aliases
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

## Completed this session

- **Art tail 67/67**: Added slug aliases `breadboard→breadboard_full` and
  `meter→multimeter` in `src/model/parts-registry.js`. Exported
  `resolveArtSlug()` and wired it into `PartThumbnail.jsx`. All 8 former
  slug mismatches now resolve via SLUG_ALIASES. Art coverage test updated:
  `knownFallbacks` emptied.
- **Seated-legibility hover highlight**: `BreadboardView` now accepts
  `hoveredPartId` alongside `selectedPartId`. `BoardCanvas` passes
  `hoveredPart` through. The highlight function returns `'selected'`
  (warm orange) or `'hovered'` (cool blue `#5a7a9a`/`#7aafcf`). No
  permanent chrome.
- **Browser gate verified**: 21/21 scenarios pass. Counted by output
  lines, not grep exit codes.

## In flight

Nothing uncommitted. No branches.

## Known issue: infer-seated test failure

`test/infer-seated.test.js:28` — "ANALOG: pot wiper reaches the pin" fails:
`readAnalog('P1.3')` returns 0 instead of ~2.5V.

**Root cause identified**: The test calls `setControl(pot.id, 0.5)` but never
calls `advanceTo()`. However, `setControl` DOES call `_solve()` internally.
The deeper issue is that `_solve()` routes through `_solveViaMNA()` because
the circuit contains a `vsource` (which is in `MNA_ONLY_KINDS`). The MNA
solver may not be handling the potentiometer correctly, OR the netlist wiring
for the analog path (pot seated at a5, wiper at column 7, tapped to MCU P1.3)
may not be creating the right net topology.

**Next step**: Add a diagnostic before the assertion — dump `c.board.nets`,
`c.board.nodeVoltages`, and check whether the pot's wiper terminal actually
connects to the MCU pin's net. If the nets are correct, the issue is in the
MNA solver (bw-board territory — file a spec-update, don't fix here).

This failure is **pre-existing** — reproduces on the commit before this
session's changes (`0586694`).

## Blocked

Nothing blocked. The schematic visual check at full width needs a browser
(routed to coordinator/owner).

## What I learned that is not in a spec-update

- **Assert the property, not the symptom.** Testing for PSEN's absence
  catches only PSEN; testing that pin 32 IS P0.7 catches any wrong pin.
- **A control only proves the method works on the population you looked
  at.** State the denominator.
- **Slug aliases for art must NOT apply to terminal resolution.** The
  zero-wires defect came back when shift_register→74hc595 alias gave
  DIP terminal names instead of friendly names.
- **A tool that silently improves its input is indistinguishable from
  one that corrupts it.** DRC fixes are user-initiated only.
- **`null` means unknown, `[]` means checked-and-none.** This distinction
  was settled across three repos and must not be reopened.
- **`readAnalog` needs the solver to have run** — it reads from
  `nodeVoltages`, which is only populated by `_solve()` (triggered by
  `setPin`, `setControl`, `setPower`, `advanceTo`).

## Spec-updates last acted on

- bw-parts: 001-007 (all read, 005-006 acted on)
- bw-board: rst-polarity (read, no action needed)

## Convention

Scan sibling `spec-updates/` at session start per bw-parts CONVENTION.md.
