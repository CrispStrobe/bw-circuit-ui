# bw-circuit-ui -- handoff for the next session

812 tests (806 pass, 6 pre-existing: 3 DRC relay + 2 browser-only + 1 DRC gallery relay).
21/21 browser gate scenarios green. Deploy current. MPL-2.0 by owner decision.

## Completed since brief

- **Phase 1 craft parity** (9 steps): group drag, bbox marquee, undo
  correctness, copy/paste, wire color + bendpoints, rotation + flip,
  touch support, engine state across rebuilds, fine nudge + unified shortcuts
- **Phase 2 breadboard**: model, footprints (30+ kinds), seating/occupancy,
  electrical continuity via mergeNets, BreadboardView on shared lattice
- **DRC** (8 rules): source-current, missing-resistor, missing-flyback,
  floating-input, supply-short, polarity, I2C pull-up, aggregate current.
  DrcPanel + DrcOverlay wired. Safety-lesson canary: DRC never auto-fixes.
- **Sidecar integration**: 146 JSON + 146 SVG vendored from bw-parts,
  sync script with delete support, sidecar-first for terminalsForKind
  and getPartBBox, slug aliases (art 67/67 -- all palette kinds covered)
- **Board seating verification**: 8 boards (24 tests), all pass:
  MCU: Nano (DIP-30), Pico (DIP-40), ATtiny85 (DIP-8)
  Retro DIP: W65C02 (DIP-40), W65C22 (DIP-40), W65C51 (DIP-28),
  28C256 EEPROM (DIP-28), 62256 SRAM (DIP-28)
- **6502 pedagogy ladder** (E0-E6, renumbered): staged circuits from the
  16-source breadboard survey:
  E0 clock module (555 astable + single-step), E1 CPU-alive (status LEDs:
  PHI2O/RWB/SYNC/VPB + address LEDs, NOP free-run), E2 ROM-only + data-bus
  LEDs (write-to-unmapped teachable moment), E3 74HC374 latch LED port
  (simplest output, write strobe via NAND), E4 VIA blink, E5 LCD hello,
  E6 full EATER6502 (extractor-verified = preset exactly).
  E1.5/E2.5 reserved for future rungs.
- **Z80 pedagogy ladder** (Z1-Z6): staged circuits teaching Searle minimal Z80.
  Z2/Z3 marked display-only. Z5 extractor verification blocked on z80-extract.js.
- **Terminal aliases**: pot->potentiometer, lead1/lead2, cw/ccw, gate_and,
  28c256.csb->ceb
- **PASSTHROUGH_KINDS**: MCU boards + retro DIPs + Z80/MC6850 all map to 'mcu'
  for the engine validator
- **Column-strip conduction**: fabricated-net merge for unoccupied columns
  (rail strips excluded to avoid bw-board cap-companion bug)
- All prior work: serialiser, schematic, wire resolution, slug coverage,
  seated-legibility, BOM, cube oracle, load precedence, etc.

## Completed this session

- **infer-seated test fixed**: Missing advanceTo() calls
- **Wire resolution aliases**: pot, lead1/lead2, cw/ccw, abstract gates
- **Board-kind engine mapping** (engineKindFor/PASSTHROUGH_KINDS):
  arduino_nano, pi_pico, attiny85, arduino_mega, microbit, w65c02,
  w65c22, w65c51, 28c256, 62256, z80, mc6850 all map to 'mcu' for engine
- **Column-strip conduction fix**: Two taps in same unoccupied column
  share one net. Rail strips excluded (spec-update filed for bw-board
  cap-companion bug: spec-updates/cap-companion-setpin.md)
- **Parts-data sync**: 146 sidecars. Tier-2 DIPs: 74HC374 (latch),
  74HC138 (decoder), 74HC245 (transceiver), 74C922 (keypad encoder),
  AT24C02, DS1302, DS18B20, KY-040, R6507, MOS6532, NS16C550, ST7920.
- **Board seating test**: 8 boards, 24 tests
- **6502 ladder**: E0-E6 (renumbered from 16-source survey).
  E0 clock module, E1 CPU-alive + status LEDs, E2 ROM-only + data LEDs,
  E3 74HC374 latch LED port (simplest output, write strobe via 3 NAND gates),
  E4 VIA blink, E5 LCD, E6 full EATER6502. E1.5/E2.5 reserved.
  Extractor test: 8 tests (5 for 6502, 3 for Z80), all pass.
  E6 = EATER6502 preset, Z5 = SEARLE preset.
- **E3 74HC374 latch LED port**: simplest output peripheral. ROM at $8000-$FFFF,
  74HC374 with write strobe CLK = !A15 AND PHI2 (3 NAND gates from one 74HC00).
  OEB tied low, 8 red LEDs on Q0-Q7. Extractor-accepted (ROM decode valid,
  latch invisible to extractor). 44 parts, 115 wires.
- **Z80 ladder**: Z1-Z6 (scripts/gen-z80-ladder.mjs).
  Z2/Z3 display-only. Z5 extractor-verified = SEARLE preset.

## In flight

Nothing uncommitted. No branches.

## Blocked / waiting

- **Arduino Mega footprint**: arduino_mega.json has 78 terminals but
  footprint is null. bw-parts needs header-style footprint definition.
- **z80-extract.js**: Does not exist yet. Z5 SEARLE extractor verification
  blocked. The Z5 circuit is wired for: ROM $0000-$1FFF, RAM $2000-$FFFF,
  MC6850 at I/O port $80 (CS2B=IORQB, CS0=A7). When the extractor lands,
  run it over Z5 and assert config equals SEARLE preset.
- **28c256 terminal name**: Extractor uses 'csb', sidecar names pin 'ceb'.
  Terminal alias added in bw-circuit-ui. The extractor in bw-board should
  also be updated to use 'ceb' (or the sidecar renamed). This is a latent
  mismatch — the circuits work because they wire using 'csb' and the alias
  resolves it in the circuit model, but the extractor reads wires directly.

## Pre-existing failures (not from this session)

- **DRC relay tests** (3): source-current and floating-input don't fire
  for relay-driven-from-quasi-pin. Device registry issue in bw-board.
- **Browser-only** (2): e2e + rendering need Playwright/Chromium.

## Spec-updates filed

- `spec-updates/cap-companion-setpin.md`: bw-board bug where setPin after
  advanceTo zeros all voltages due to cap companion G=C/0.

## Key learnings

- **readAnalog needs advanceTo** to populate nodeVoltages
- **Board-level kinds must map to 'mcu'** for the engine validator
- **Unoccupied column strips need fabricated-net tracking**
- **Top/bottom rails are separate** — need cross-rail jumpers
- **bw-board cap companion bug**: setPin at same timeNs zeros voltages.
  Workaround: exclude rail strips from fabricated merge.
- **Address decode with 2-input NAND gates** is a tree: NOT(A), OR(A,B) =
  NAND(!A,!B), 3-input AND needs NAND cascade. 8 gates (2x 74HC00) is
  tight but sufficient for both Eater and Searle decodes.

## Convention

Scan sibling spec-updates/ at session start per bw-parts CONVENTION.md.
