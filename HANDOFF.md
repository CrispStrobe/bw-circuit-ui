# bw-circuit-ui — handoff for the next session

638 tests green at `e46d4d7`. Deploy current. MPL-2.0 by owner decision.

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
  and getPartBBox, slug aliases (art fallback 8→2)
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

## In flight

Nothing uncommitted. No branches.

## Blocked

Nothing blocked. The schematic visual check at full width needs a browser
(routed to coordinator/owner). The pin chooser needs bw-board to confirm
the alternates schema and bw-parts to generate the `functions` data.

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

## Spec-updates last acted on

- bw-parts: 001-007 (all read, 005-006 acted on)
- bw-board: rst-polarity (read, no action needed)

## Convention

Scan sibling `spec-updates/` at session start per bw-parts CONVENTION.md.
