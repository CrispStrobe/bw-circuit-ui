# bw-circuit-ui -- handoff for the next session

747 tests (741 pass, 6 pre-existing: 3 DRC relay + 2 browser-only + 1 DRC gallery relay).
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
- **Sidecar integration**: 124 JSON + 124 SVG vendored from bw-parts,
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
- **Board seating verification**: Arduino Nano (DIP-30, 15 cols), Pi Pico
  (DIP-40, 20 cols), ATtiny85 (DIP-8, 4 cols) -- all three verified:
  legs snap, strips visualize, solver conducts through shared strips

## Completed this session

- **infer-seated test fixed**: Missing `advanceTo()` calls -- readAnalog
  and readPin need the MNA solver to run, which happens during advanceTo.
- **Wire resolution aliases**: `pot -> potentiometer`, `lead1/lead2 -> a/b`,
  `cw/ccw -> a/b`. Abstract gate terminals (gate_and, etc.) added.
  All 92 gallery circuit.json files resolve cleanly.
- **Board-kind engine mapping** (`engineKindFor`): arduino_nano, pi_pico,
  arduino_uno, arduino_mega, attiny85, microbit all map to 'mcu' for
  the engine's setNetlist. Without this, the engine validator rejects
  board-level kind names it doesn't know.
- **Column-strip conduction fix**: Two tap wires into different rows of
  the same unoccupied column now share one fabricated strip net. Without
  this, a resistor at a5 and an LED at b5 produce separate nets. Rail
  strips excluded to avoid the bw-board cap-companion bug (spec-update
  filed: `spec-updates/cap-companion-setpin.md`).
- **Parts-data sync**: 124 sidecars (was 123). Footprint column fixes
  for 555, arduino_nano, pi_pico, attiny85 (U-shape pin numbering).
  New sidecars: arduino_mega (78 terminals), microbit (5 edge pins).
- **Board seating test** (`test/board-seating.test.js`): 3 checks x 3
  boards (Nano, Pico, ATtiny85). All 9 pass.

## In flight

Nothing uncommitted. No branches.

## Pre-existing failures (not from this session)

- **DRC relay tests** (3): source-current and floating-input rules don't
  fire for relay-driven-from-quasi-pin. Likely a bw-board device registry
  issue -- relay may not be registering as a device model. Needs diagnosis.
- **Browser-only** (2): e2e and rendering tests require Playwright/Chromium.

## Spec-updates filed

- `spec-updates/cap-companion-setpin.md`: bw-board bug where setPin after
  advanceTo zeros all voltages due to cap companion G = C/0.

## Blocked

Nothing blocked. The schematic visual check at full width needs a browser
(routed to coordinator/owner).

## What I learned that is not in a spec-update

- **`readAnalog` needs the solver to have run** -- it reads from
  `nodeVoltages`, which is only populated after `advanceTo`. `setControl`
  alone is NOT sufficient.
- **Board-level MCU kinds must map to 'mcu' for the engine.** The engine
  validator only knows 'mcu', not 'arduino_nano' or 'pi_pico'. The
  circuit model preserves the original kind for UI/serialization but
  sends 'mcu' to setNetlist.
- **Unoccupied column strips don't auto-merge.** deriveNets only produces
  nets for strips with seated parts. Tap wires into empty strips need
  explicit tracking so multiple taps share one net.
- **Top and bottom rails are separate.** A real breadboard needs a jumper
  wire to connect them. Tests must include cross-rail jumpers for boards
  with pins on both sides (ATtiny85's VCC is on the bottom rail side).
- **bw-board cap companion bug:** calling setPin after advanceTo at the
  same timeNs zeros all node voltages. Workaround: exclude rail strips
  from the fabricated-net merge so caps stay floating.

## Convention

Scan sibling `spec-updates/` at session start per bw-parts CONVENTION.md.
