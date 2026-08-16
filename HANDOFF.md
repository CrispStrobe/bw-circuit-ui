# bw-circuit-ui -- handoff for the next session

npm test 987/0/3 (CI clean). Pendant Playwright test (test:render suite).
Parts-data index regenerated: 146 → 213 sidecar entries.
Lite push freeze in effect — batching lite forwards until coordinator lifts.
VDP keyboard: 4/4. Fabric: 11/11. Capability: 6/6. TileVGA: 3/3.
Snapshot drop: 3/3. Sensor faces: 3/3. Contract: 37/37.
Deploy current. MPL-2.0 by owner decision.

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
- **6502 pedagogy ladder** (E0-E6 + E2.5, renumbered): staged circuits from
  the 16-source breadboard survey:
  E0 clock module (555 astable + single-step), E1 CPU-alive (status LEDs:
  PHI2O/RWB/SYNC/VPB + address LEDs, NOP free-run), E2 ROM-only + NAND
  decode on A15 + data-bus LEDs, E2.5 6507SBC (R6507+RIOT+ROM+74HC04,
  decode=A12), E3 74HC374 latch LED port (simplest output, write strobe
  via NAND), E4 VIA blink, E5 LCD hello, E6 full EATER6502
  (extractor-verified = preset exactly). E1.5 reserved.
- **Z80 pedagogy ladder** (Z1-Z6 + Z1.5): staged circuits teaching Searle
  minimal Z80. Z1.5 ROM-only (28C256, A15 decode). Z2/Z3 display-only.
  Z5 extractor-verified = SEARLE preset.
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
- **6502 ladder**: E0-E6 + E2.5 (renumbered from 16-source survey).
  E0 clock module, E1 CPU-alive + status LEDs, E2 ROM-only + NAND decode
  on A15 + data LEDs, E2.5 6507SBC (R6507+MOS6532 RIOT+28C256+74HC04,
  decode=A12), E3 74HC374 latch LED port (simplest output, write strobe
  via 3 NAND gates), E4 VIA blink, E5 LCD, E6 full EATER6502. E1.5 reserved.
  Extractor test: 11 tests (7 for 6502, 4 for Z80), all pass.
  E6 = EATER6502 preset, Z5 = SEARLE preset.
- **E2 updated**: ROM at $8000-$FFFF via single NAND inverter on A15
  (was: CSB tied low). First appearance of address decode. 43 parts, 103 wires.
- **E2.5 6507SBC**: four-chip machine — R6507 + MOS6532 RIOT + 28C256 ROM +
  74HC04 hex inverter. Decode = A12: ROM $1000-$1FFF, RIOT $0000-$0FFF.
  One inverter gate drives both ROM CSB and RIOT CS1. 8 LEDs on RIOT port A.
  22 parts, 87 wires. Extractor refuses (no W65C02).
- **E3 74HC374 latch LED port**: simplest output peripheral. ROM at $8000-$FFFF,
  74HC374 with write strobe CLK = !A15 AND PHI2 (3 NAND gates from one 74HC00).
  OEB tied low, 8 red LEDs on Q0-Q7. Extractor-accepted. 44 parts, 115 wires.
- **Z1.5 ROM only**: Z80 + 28C256 at $0000-$7FFF (CSB = A15 direct).
  Data-bus + address LEDs. No gate IC needed. 36 parts, 83 wires.
- **Z80 ladder**: Z1-Z6 + Z1.5 (scripts/gen-z80-ladder.mjs).
  Z2/Z3 display-only. Z5 extractor-verified = SEARLE preset.
- **PASSTHROUGH_KINDS**: added r6507, mos6532 (engine maps to 'mcu').
- **Board presets** (scripts/gen-board-presets.mjs):
  - **YL-39 minimum system**: STC89C52 + 74HC595→4-digit 7-seg, 8 LEDs (P1),
    4 buttons (P3.2-P3.5), buzzer (P2.3), pot (P1.0). 27 parts, 48 wires.
  - **PRECHIN A2 learning board**: STC89C52 + 2× 74HC595→8×8 LED matrix,
    4×4 keypad (74C922 encoder, DA→INT0), DS1302 RTC (3-wire P1.4-P1.6),
    DS18B20 temp (1-wire P1.7, 4.7kΩ pull-up), AT24C02 I2C EEPROM (P2.0-P2.1,
    pull-ups), LCD1602 (8-bit on P0, ctrl P2.5-P2.7), IR receiver (P3.3),
    buzzer (P2.2). 18 parts, 81 wires.
  Board preset test: validates structure, registered kinds, unique IDs,
  wire targets, terminal name validity. 10 tests, all pass.
- **Face groundwork note**: face-descriptor contract (bw-board src/face.js)
  not yet landed. stc docs/ROADMAP.md describes the "hardware interaction panel"
  (S4A-style board picture + live element bindings). Board preset circuits are
  the natural first consumers when the face contract arrives.
- **Catalog↔engine contract test**: 37 tests verifying terminalsForKind
  matches BoardImpl.getTerminalsForKind for every shared kind (order matters).
  Fixed 5 divergences: potentiometer, relay, char_lcd, servo, timer_555.
  Root cause: sidecar lookup ran before switch-case, silently overriding.
  Moved sidecar to default-case fallback.
- **Gate artwork**: all 6 gate kinds (AND, OR, NOT, NAND, NOR, XOR) now
  render with proper distinctive bodies in bench view (SVG, color-coded),
  standard schematic symbols in SchematicPanel, and breadboard footprints.
  Terminal offsets: in0/in1/out for 2-input gates, in0/out for NOT.
- **Examples fabric gate**: 11 breadboard-containing examples from
  sb3-creator validated through Circuit.fromJSON (real loader: holes→strips
  →nets). Complements bw-board's engine gate (which skips breadboard
  examples). Wired into CI as a separate step.
- **Examples panel collapse**: collapsed examples section = 28px handle
  rail, parts palette auto-fills, expand restores previous split. 24/24 gate.
- **CI workflow**: npm test + fabric gate, clones bw-board + sb3-creator.
  3 DRC relay tests marked skip (bw-board device registry issue).
- **Lite reconciliation** (930000d incident): lite's designer patches
  carried upstream as new base. dip-geometry dipTerminalPositions,
  footprints gutter-straddle fix (e/f not e/j), MCU/dev-board footprints,
  starter-migration, board-geometry, wire-endpoints, breadboard-snap.
  Gate adapted to lite's radio-button UI. 23/23 gate.
- **VdpScreen**: TMS9918A video face. Canvas painting RGBA frames from
  debug target video(), rAF polling, frame-counter skip, 2x crisp pixels,
  "no signal" placeholder. Wired into debugger surface.
- **ILI9341 TFT face**: device state rendering in BoardCanvas (RGB565→RGBA
  inline conversion, foreignObject canvas, dark when sleeping/display-off).
  Terminal offsets for 9-pin SPI module. Catalog + slug exception.
- **ROM terminal**: csb → ceb in all ladder generators (28C256 sidecar match).
- **VCC voltage editable**: params.volts=5 default, InlineEditor field,
  canvas label shows actual voltage (+3.3V, +5V etc.).
- **Debugger gated on MCU**: DebugStatus, VdpScreen, debuggerPanel hidden
  for pure-circuit examples (no MCU/pins). No senseless debugger UI.
- **onProgramChange**: example loader carries program.bw to the host via
  callback (spec-update filed for bw-bundle to wire the host side).
- **i18n sweep**: ~130 EN+DE string pairs in src/i18n/strings.js.
  Components swept: CircuitDesigner, ExamplesBrowser, BoardCanvas toolbar,
  instrument panel sections. lang prop threaded through component tree.
  Remaining: Multimeter, ScopePanel (small, need lang prop threading).
- **VCC voltage editable**: params.volts=5 default, InlineEditor field,
  canvas label shows actual voltage.
- **Debugger gated on MCU**: hidden for pure-circuit examples (no MCU/pins).
- **onProgramChange**: example loader carries program.bw to host (spec-update
  filed for bw-bundle to wire the host side).
- **VdpScreen keyboard input**: arrow/WASD → setButtons(mask), focus ring,
  "click to play" hint (i18n EN+DE). Signal===false → NO SIGNAL display.
  Snake smoke passes on bw-board. setButtonsFn wired from debugState.
  Playwright test: 4 checks (arrow mask, WASD parity, blur release, hint).
- **i18n complete**: all designer components swept (Multimeter, ScopePanel,
  BoardCanvas, CircuitDesigner, ExamplesBrowser, VdpScreen, instruments).
  ~130 EN+DE string pairs. lang prop threaded through full component tree.

## DONE — standing work contract items all green
1. Multimeter + ScopePanel i18n: no hardcoded English, key parity verified.
2. Keyboard-focus routing: Playwright test 4/4, all mask bits, blur, hint.
3. CI green: npm test 727/0/3, fabric gate 11/11, contract 37/37.

## In flight

Nothing uncommitted. No branches.

## Recently completed

- **Drag-snap ghost + DIP pin-1-bottom labels** (f3841e1): ghost preview
  during drag now uses two-pass logic (tight snapGhost → seatSnapHole loose
  fallback), matching endMove exactly — what you see is what the drop does.
  Applied to both moveSelection and placeGhost (palette drag). DIP body
  renderer for retro chips: notch at left end, pin-1 dot bottom-left
  (pin-1-bottom convention), pin name labels from sidecar at each leg.
- **UX polish** (15af19d): DrcPanel INFO-severity notes get italic 'i' icon
  + neutral slate (#64748b) instead of '!' affordance. ExamplesBrowser: denser
  cards (single-row layout), prominent search with magnifier + clear button,
  result count in placeholder. Better discoverability at 202 entries.
- **MCU device-specific sidecar** (de008eb): MCU body renderer looks up
  device-specific sidecar (attiny88, z80, w65c02, eater6502) first, falls
  back to generic 'mcu'. Body width computed from actual pin count. Parts-data
  index.js regenerated: 146 → 213 entries (68 sidecars were on disk but not
  registered: attiny88, eater6502, matrix8x8, adxl335, ili9341, etc.).
- **Device picker + MCU label completeness** (12db6f6): DEVICE_LABELS adds
  micro:bit. Needs badge neutral slate (#94a3b8) not orange. mcuChipInfo
  covers atmega168p, arduino-uno/nano/mega, eater6502, micro:bit. Pendant
  example Playwright test verifies ATtiny88 label on canvas (test:render).
- **Click-through fix** (e75b0be): two-pass partAt() — non-breadboard first,
  breadboards only if nothing else hit. Seated parts selectable again.
- **Auto-seat MCU** (e75b0be): on example load, unseated MCU-class parts
  auto-seat onto breadboard at e1. Leveraged fix for ~200 legacy examples.
- **SerialConsole** (b76d227): terminal emulator for serial-bearing machines.
  Wired to debugState.onSerial/sendSerial. Serves z80 BBC BASIC, eater6502
  Tali Forth, and any ACIA-bearing machine automatically.
- **matrix8x8 face + attiny88** (4e2eaaf): 8x8 LED matrix SVG with
  brightness-driven dot grid from deviceStates. catalog terminals,
  terminal offsets, deviceStates collection. attiny88 target in factory.
  rgb_led r/g/b aliases for Arduino examples.
- **Sensor faces** (62fc91c, cf9e8df): OrientationInput (drag/sliders →
  {x,y,z} g for adxl335/memsic2125/mpu6050 — kind-aware param names
  gx/gy/gz vs accelX/Y/Z), MidiMonitor (note-on/off from 31250 baud TX),
  StimulusControls (knock-tap impulse, distance slider for ultrasonic).
  Catalog: adxl335 + memsic2125 terminals. Buzzer pos/neg aliases.
  Playwright 3/3. Second serial monitor blocked on bw-board (no Serial1).
  AY audio: z80 debug target currently returns ULA beeper only; AY
  channels expose audioTone-shaped summaries but need debug-target
  wiring (coordinator owns z80-debug.js).
- **Snapshot drop-zone** (2ce27e1): drag .SNA or .Z80 onto VdpScreen to
  load into running Spectrum machine. Extension filter, visual feedback.
  Kempston joystick (bw-board 39a10cb) makes arrows/WASD drive archive
  games automatically via the existing setButtons path.
  Playwright: 3 checks (.sna, .z80, .txt rejection). i18n EN+DE.
- **Build Machine flow** (00ab540): extractor-driven wired-computer builder.
  Runs extract6502Machine/extractZ80Machine on the designer's circuit,
  evaluating NAND decode at all 65536 addresses. Refusals render verbatim
  (the named-address errors ARE the lesson). Success dispatches
  bw-machine-extracted event for the host to boot. 5 tests, i18n EN+DE.
- **Spectrum beeper** (91ca8df): polls debugState.audio() per rAF, pipes
  {hz,on} to updateBuzzerAudio (existing WebAudio). Stops on unmount.
- **ULA keyboard** (91ca8df): VdpScreen detects setKeysFn and routes full
  keyboard (browser→Spectrum matrix mapping) instead of 4-dir setButtons.
- **char_lcd live text** (91ca8df): device state text replaces hardcoded
  "Hello World!". Both SvgParts and WokwiParts get deviceStates for LCD.
- **TileVGA 320x240 face** (ed03b6d): VdpScreen now adapts to any video
  frame resolution (was hardcoded 256x192). Canvas scales 2x crisp (max
  640px). Playwright test: 3 checks (native dims, CSS scale, hello-world).
- **Debugger UI capabilities-driven** (9564380): step-over/step-out buttons
  gated on capabilities().steps. Watchpoint add-field gated on breakpoints
  includes 'write'. onStep/onStepOver/onStepOut/onAddWatchpoint wired from
  debugState. Capability combo tests (6 checks). i18n EN+DE (6 new pairs).
- **DIP chip power pins fix** (f0ab371): logicChipTerminals no longer strips
  vcc/gnd. lead1/lead2 aliases for pot/button. 5 gallery regressions fixed.

## Blocked on bw-board

Nothing currently blocked.

## Blocked / waiting

- **Arduino Mega footprint**: arduino_mega.json has 78 terminals but
  footprint is null. bw-parts needs header-style footprint definition.

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
