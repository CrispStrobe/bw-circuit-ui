# bw-circuit-ui -- handoff for the next session

## 2026-08-29 (later) — the browser gate is in CI, and it is green

`npm run verify:interaction` now runs as the `interaction-gate` job in
`.github/workflows/ci.yml`: it clones the sibling `bw-board` the dev harness
imports, installs Chromium with its system libraries, and fails the build on
any scenario failure. **31 scenarios, 31 passed, 0 failed** on a clean runner
(run `33278054707`). Everything the section below records as red was the PROBE,
not the app — the three "pre-existing defects" and the four "load-sensitive"
transport scenarios all had probe-layer causes, and every one of them is fixed
at the layer that was actually wrong.

**wheel-pan** read `[data-canvas] svg` `.first()`, which is the fit-to-parts
button's 18×18 icon; its viewBox is the constant `0 0 24 24`, so comparing it
before and after a wheel measured nothing. The camera svg now carries
`data-canvas-svg`. Measured: viewBox origin `-15, 4.7 → 51.2, 54.4` with the
width term unmoved. The app had always panned.

**pin-chooser** aimed through "the first div whose inline transform contains
`scale(`". Palette thumbnails scale themselves and come first in document
order, so the gesture was drawn at x≈135 — inside the parts palette, while the
canvas begins at x≈214. The world layer now carries `data-wokwi-layer`. Two
further wrong aims surfaced once that was fixed and are worth keeping: the
start hole was chosen by arithmetic (`bb.x - (62*14)/2 + 19*14`, and a
full-size breadboard has **63** columns, so the press landed between holes),
and the first correction picked a hole 91 px from the chip centre which is
*under* a DIP-40 — body beats hole, so the press dragged the chip. Start hole
and release point are now both read off the rendered lattice: occupancy from
`__circuit.breadboards.get(id).occupantOf(hole)` (the DOM cannot answer that —
the canvas hit-tests pointers in WORLD space, so `elementFromPoint` over the
board returns the one big svg, never a hole circle), position from
`[data-hole]`, and the chip's centre from averaging the screen positions of
the holes its own `leadMap` names.

**scope-panel** asked for a Scope button inside the instruments column, which
is COLLAPSED in this harness — `rightOpen` seeds from `debuggerOn||benchOpen`
and the dev page passes neither, so `getByRole('button', {name:/Scope/i})`
matched zero elements. Opening the column by its own labelled control is now
scenario `instruments-expand`, and it has to run after every reload: the
column is React state while the scope toggle inside it is localStorage, so a
reload leaves the panel "shown" inside a column nobody has opened. That
mismatch also explains why scenario 6 (which reloads first) looked different.

**The transport four were never load-sensitive.** A Playwright click will not
fire until the element holds still across consecutive animation frames, and
the sidebar re-renders on every 50 ms sim tick; that wait, not the app, is
what reported reachable buttons as "unclickable" — and when the instruments
column was collapsed the same locators found nothing at all. They are now
aimed pointer presses whose target is verified against `elementFromPoint`
BEFORE the press, so a mis-aim is reported rather than silently missed, and
every assertion reads the board clock rather than pixels.

**The count is asserted.** `EXPECTED` lists all 31 scenario ids; each reports
exactly one outcome; a missing id, an unexpected id, or a pass after a fail
fails the run and names it. Mutation-proven — see `scripts/verify-interaction.mjs`.

**`sweep-canvas-live` no longer passes vacuously.** The drag now happens
immediately after the run press and records whether the sweep was still
working; a drag against an idle page fails with that as the reason.
`sweep-progress` records every label the run button wears (MutationObserver)
instead of polling for one, because a sweep that finishes in under a second
did report all 60 points and the poll saw none of them.

**Every exit reaches the count line.** The roll-call is a function, and all
six navigations (four gotos, two reloads) report a failure to load as named
scenario failures before running it. This was not theoretical: a local run
died at `goto(?nopins=1)` with a stack trace and no count, because a Vite dev
server compiles on demand and a new entry URL pays for a transform like the
first request did. `NAV_MS` is the harness's patience for that compile — not a
ceiling on anything the product promises.

**Evidence.**

| | run |
| --- | --- |
| green, master tip `6fc9f67` | `33279469194` — 31 scenarios · 31 passed · 0 failed (all three jobs) |
| green, local, load **17** on four cores | `31 scenarios · 31 passed · 0 failed` (build lock held, per `wt/BUILD-LOCK-PROTOCOL.md`) |
| RED — all three defects reintroduced | `33278282918` — 24 passed, 7 failed: `wheel-pan`/`wheel-no-zoom` (`no unique [data-canvas-svg]`), `pin-chooser-opens`/`-wires` (`no unique [data-wokwi-layer]`), `instruments-expand` + `scope-panel` + `scope-channel` |
| RED — one scenario silently reports nothing | `33278397665` — **30 passed, 0 failed, red anyway**: `ROLL-CALL FAILED: 1 scenario(s) never reported: selectors-restore` |

The second red run is the house-rule-4 proof: nothing failed, and the gate
failed the build regardless, because 30 outcomes is not 31.

**Found, not fixed.** The instruments column is collapsed by default in the
standalone designer (`rightOpen = debuggerOn || benchOpen`, and the dev
harness passes neither), so the scope, the meter, the sweep and the whole
simulation transport sit behind one `‹` chevron with no visible label. That is
app behaviour and it is reachable — the gate opens it through the same control
a user has, and asserts that the control works — but whether a first-time user
finds four instruments behind that chevron is an owner question, not a probe
question.

## 2026-08-29 — the instruments (D21, D31, D24/X2.2, D9/X2.6)

Four defects off `brickwright-lite/docs/WAVE-OPEN-DEFECTS.md`, all of them the
same shape the ledger names: *a readout gap on top of an engine that computes
the right answer*. Each landed with its oracle, and every one of the six
mutations tried bites.

**D21 was two defects, and the second was not on the ledger.** The row says the
meter is filtered out of the netlist so it "cannot load anything". True — and
the probe terminals stayed IN the nets after the part came out, so bw-board's
validator (which has refused a net naming an unknown part since `4bd9bb2`,
2026-08-08) rejected the WHOLE netlist. Measured on a VCC → 1 k → LED → pin
bench: **5 engine parts before the probes were wired, 0 after**, and the meter
then read a fabricated `0 V` off the empty board. `test/meter-reading.test.js`'s
"reads difference between two nets" had been green over that empty board.
A placed meter now becomes a resistor of `params.inputOhms` (10 MΩ default,
editable in the inspector, printed on the meter face). Hand-computed oracle,
R1 = R2 = 1 MΩ: **Vmid = 5·Rm/(R + 2·Rm) = 50/21 = 2.380952380952 V**, engine
agrees to 1e-9; the same meter on a 1 kΩ divider reads 2.4998750062, i.e.
invisible. Ω and A modes do NOT load, each for a stated reason.

**D31** — vertical scale is per channel (`model/scope-scale.js`) and each channel
PRINTS its span. The old auto was worse than a shared manual setting: it ranged
across all channels at once, so a 50 mV trace beside a 5 V rail drew as a line
on the axis, which is what a dead net looks like. Verified in a real browser:
`-10.000 … 15.000 V · 5.000 V/div` beside `2.375 … 2.625 V · 0.050 V/div`.

**D24 / X2.2** — there is a spectrum view, and it is a SECOND TAP, not a
transform of the trace above it. The drawing ring is a (min, max) envelope whose
two numbers are two different instants, so an FFT over it describes a waveform
that never existed. bw-board grew `addScopeChannel({capture: 'sample'})` whose
sample instants are **solve points** (`9441e4f`, `825b019`); `model/fft.js`
refuses an envelope buffer BY NAME. Measured in the browser on the harness's own
1 kHz function generator: `peak 1.000 kHz @ 2.0000 V · THD 0.00 %`.

Two things the ROADMAP's acceptance got wrong before anyone measured, both now
recorded there: "> 40 dB to the next bin" is a rectangular-window claim (a Hann
mainlobe is four bins wide by construction), and amplitudes must come from the
lobe's ENERGY, not its tallest bin — scalloping made a square wave's harmonics
read 0.322/0.180/0.127 against the series' 0.333/0.200/0.143.

**The spectrum tap costs solver steps, and the rate is where you pay.** A sample
channel puts a solve point on every sample instant. At 10 kHz (the default) that
is a 100 µs step, which is the fidelity floor the integrator already used, so it
costs nothing; at 100 kHz it is 10 µs and the whole simulation runs ~5× slower —
measured in a browser, the page stopped answering clicks for 30 s. The control
is labelled by the bandwidth it buys.

**X2.6 / D9 (cui half)** — the sweep yields between points. Rows are
`assert.equal`-identical to the synchronous path, not close. **A worker alone
was impossible**: the engine arrives through `setEngine` as live JS objects and
a class is not structured-cloneable, so what crosses the boundary is a NETLIST
(`model/sweep-protocol.js`) and the host supplies the worker
(`setEngine({createSweepWorker})`, reference implementation in
`dev/sweep-worker.js`). Without one the same points run chunked on this
thread; the panel's status line says which path produced the numbers.
**The dev harness never injected `runDcSweep`/`runAcSweep`/`logSpace` at all**,
so `SweepPanel` refused every run there and no browser scenario could reach it.

### The browser gate, and why its count moved

`npm run verify:interaction` is **red at origin/master on this box** — measured,
byte-identical failure lists on a base worktree and on this branch. Three things
were wrong with the gate itself, none of them regressions:

1. **It aborted on the first unclickable button.** On a loaded box (load 22 on
   four cores) the transport bar's live clock re-lays-out faster than
   Playwright's stability check settles, so `⏸ Pause` never became "stable" and
   the run died at 6b with five scenarios never attempted. `clickOrFail` turns
   that into a reported failure; the failure still fails.
2. **Scenario 5 asked for the scope panel by TEXT.** `getByText('Scope').first()`
   matches every ancestor whose text contains "Scope", and ancestors come first
   in document order — so it clicked a container div and then reported "no scope
   panel in the sidebar" about a panel it had never asked for. By role now.
3. **The instrument toggles are not idempotent** — they remember themselves in
   localStorage, so after scenario 6's reload an unconditional click CLOSES the
   panel. They are guarded on the panel's presence now.

The gate prints its own count (`N scenarios · P passed · F failed`), because
"it was green" is not a result if it silently ran fewer than last time. Six new
outcomes were added for the four defects above — the count goes UP.

**Measured, both halves under the same load, same script:**

| | origin/master | this branch |
| --- | --- | --- |
| | 30 outcomes · 17 passed · 13 failed | 30 outcomes · **22 passed** · 8 failed |
| meter probes | ✖ `wiring a meter emptied the board: 6 → 0 parts` | ✔ `6 → 7 engine parts` |
| per-channel V/div | ✖ `controls missing (0 + 0)` | ✔ `spans 100×` |
| spectrum | ✖ `showed nothing at all` / `neither peaked nor refused` | ✔ `peaks at 1000.0 Hz on a 1000 Hz generator` |
| sweep progress | ✖ `no per-point progress: "▶ Sweep"` | ✔ `"… 26/60"` |
| canvas during sweep | ✔ (vacuously — base REFUSES the sweep, so nothing was running) | ✔ `140 px` |

The base column IS the mutation proof for the new scenarios, and its meter line
is D21 reproducing inside the gate itself.

Eight failures remain on this branch and every one of them is the box or a
pre-existing gate wart, not the branch: `wheel did not pan`, `no scope panel in
the sidebar` (after scenarios 1–4, and only there — scenario 6, which reloads
first, passes) and `pin chooser did not open` all reproduce at origin/master,
and the transport bar's four come and go with load — they PASSED in the run
before this one, at load 13, and failed at load 22.

**`dev/sweep-worker.js` is outside `src/` on purpose.** lite vendors this
library by walking `src/` and skipping only `main.jsx`; from
`lib/bw-circuit-ui/`, `../../bw-board` resolves to nothing. A second harness
file under `src/` would have needed a second entry on that skip list.

## 2026-08-27

npm test **2271/0/6** (CI clean). Four repos moved together today —
bw-circuit-ui, bw-board, bw-parts, sb3-creator — and all four are green.

**The teaching ladders are complete.** `gallery/l0..l10` (AND gate to a diode
keypad) and `gallery/c0..c17` (a 555 ticking to an eight-bit stored-program
computer under microcode: control ROM, conditional jumps, an 8-bit ALU deriving
its own flags, a stack, CALL/RET, the machine again with a ROM where its matrix
was, then twice as wide). Written by `scripts/gen-*-ladder.mjs` — **edit the
generators, never the JSON** — and published to sb3-creator as pc90..pc118 by
`scripts/gen-logic-examples.mjs --out <checkout>`. `docs/LADDERS.md` is the
document; the README's ranges are now asserted against the gallery.

**Adding a part is FIVE registrations**, learned over four CI rounds: bw-board
device, bw-parts sidecar **and** art, `src/parts-data` (generated — run
`scripts/sync-parts-data.mjs`), the importer's `LOGIC_74*` family set, and
palette coverage. Terminal names come from the ENGINE, and a sidecar's
`terminals` must match its own `footprint.leads`.

**`sync-parts-data.mjs` is ADD-ONLY** (`--overwrite` to force). Bulk vendoring
imports bw-parts' datasheet-name drift and un-passes the parity gate. It also
carries a `NOT_OFFERED` list (sidecars for parts the engine cannot simulate —
they would become palette entries that empty the board) and `LOCAL_ONLY`
(designer-only sidecars the stale sweep must not delete; it nearly ate
stm32f030).

**Cross-check is three populations**, each ratcheted per kind and mutation-
proven. From one undifferentiated 163 to: **0 unreachable**, 9 not-connected
(legs named `nc` — a package fact, classified from the name, and no model can
or should reach one), 57 extra spellings across two kinds.

**Unreachable is CLOSED, and staying empty is the claim.** An empty ratchet is
the shape that quietly stops checking, so it is mutation-proven too: dropping
a pin from the engine again fails it with `ds1302 (+1)`. A new entry means a
sidecar gained a leg the engine has no answer for.

The last ones did not close by deciding "which device the part is" — they
closed by someone writing the behaviour:

- `stepper` and `gas_sensor` WERE that decision, and it turned out to be a
  false one: both parts are genuinely two things (unipolar/bipolar,
  bare element/carrier module), so the engine learned both behind a param and
  the sidecar declares them in `variants`.
- `ds1302` was not a packaging question at all. X1/X2 and VCC1 were behaviour
  nobody had modelled — the oscillator (decided by WIRING via `ctx.netFor`,
  because quartz has no DC signature) and the coin cell (runs from whichever
  rail is higher, and LOSES the registers below 2.0 V, which is the whole
  difference the pin buys).

**Two entries in `extra spellings` were misfiled, and both were real pins.**
That population is for alternate NAMES of pins the sidecar already has. When
something lands there that is a distinct pin, the fix is the same shape as an
unreachable one, pointing the other way — and the pad must come SECOND:

- `tcs34725.int` — the model declared it, stamped it so it would not float,
  and never drove it. Drawing the pad first would have handed the user a pin
  that does nothing. The threshold interrupt went in first (and surfaced two
  silent bugs: `STATUS` returned AINT hardcoded SET, and the command byte's
  TYPE field was discarded so `0xE6` "clear interrupt" masked to `0x06` and
  overwrote the AIHTL threshold).
- `simplevga_card.bank` — bw-parts had DROPPED it, which is why the sync held
  the file back. `m6502-extract` requires it on the same net as the VIA's PB0
  and `simplevga.js` uses bit 0 to page two 32K VRAM banks.

**Sweeping for inert pins is worth doing BY HAND.** A detector for "terminals a
device declares but never consults" reported 110 kinds, then 160 after fixing
it twice — dominated by false positives, because anything driven
programmatically or backed by a CPU adapter looks inert to a probe, and
switches only stamp when their params say so. Its only real value was as a
pointer: it flagged `pcf8574.int`, which reading the code then confirmed —
and that pin turned out to be the small half. The expander **could not be read
at all**: its I2C decoder sampled SDA and never drove it, so every input use
was silently impossible while writes worked fine. Do not act on a list from
that script without checking each entry.

**TEST THE RENDERING IN WEBKIT, NOT ONLY CHROMIUM.** The owner opened a bench
in Safari and got the Arduino floating above its own pins with the wires running
into empty space. It does not reproduce in Chromium, and every check in this repo
was Chromium-only, so nothing saw it for as long as it existed.

The cause: a Wokwi face is HTML inside a `<foreignObject>`, and the scale was a
CSS `transform`. WebKit lays that out correctly and PAINTS it elsewhere. The
pins, the outline and the hit box are plain SVG and stayed put, so the art
separated from everything that refers to it.

**No measurement can catch this.** `getBoundingClientRect` returned the correct
box in WebKit for the foreignObject, the div, the custom element AND its
shadow-root svg — dx, dy, dw all 0.0 — while the screenshot plainly showed the
board somewhere else. A right layout tree with a wrong paint is invisible to
every query. Only pixels see it, which is what `npm run verify:board-face`
compares, across both engines, mutation-proven.

The two engines break in OPPOSITE directions and a fix must satisfy both:
Chromium drops a parent `<g>` translation around transformed foreignObject
content (so the face is anchored in world coordinates, no wrapping `<g>`);
WebKit mispaints a CSS-transformed child (so the scale is `zoom`, which scales
layout rather than paint). A first fix used a parent `<g>` and traded one
engine's bug for the other's.

Only the BOARD faces are affected. The component faces — LED, resistor, button,
seven-segment, LCD — are plain absolutely-positioned HTML in an overlay layer,
not inside a foreignObject, and render correctly in both.

**THE SAME CIRCUIT MUST GIVE THE SAME BOARD IN EVERY BROWSER.** Sweeping the
three circuit views across both engines flagged the Board view: the trace
COLOURS were swapped, and the colour is the copper layer, so the same circuit
produced a different board depending on the browser — and the board view feeds
the PCB exporters, so this reached something you might send to a fab.

Narrowed rather than guessed: deterministic WITHIN Chromium across three runs,
so not random; trace GEOMETRY byte-identical between engines, so the router
found the same routes and only the LAYER differed; and the router is A* with a
cost built from `Math.hypot`.

`Math.hypot` is not required by the spec to be correctly rounded, so V8 and
JavaScriptCore may differ in the last bits — enough to flip a near-tie and send
a net to the other layer. `Math.sqrt` IS correctly rounded per IEEE-754.

So **anywhere a distance becomes a VERDICT or a FILE, use `dist()` from
`model/exact-hypot.js`.** Twenty-two calls across eight modules do: the DRC
(whose four comparisons are all `hypot(...) <= TOL`, exactly the shape where one
ULP flips whether a board is reported shorted), PCB geometry, the EasyEDA PCB
exporter, the schematic projection and symbols, and the KiCad/EasyEDA importers.
Transient UI maths — hit-testing, drag feedback — deliberately stays on
`Math.hypot`, and `test/exact-hypot.test.js` asserts that exclusion rather than
leaving it accidental. The guard is a may-only-shrink list, mutation-proven.

**Blocked:** see `BLOCKED.md` — pc115/pc116 cannot publish until sb3-creator's
sibling pin moves past bw-board `b63a6ec`, and that bump belongs to the attiny88
re-seat chain.

**Workflow that worked:** push to `fable/pcb-support` first, let GitHub CI run
the suite on a clean machine, then fast-forward master with the same SHA. A
full local suite measures this box's other processes as much as the code — two
timing budgets were re-derived for exactly that reason. Budget for the queue,
not the run: the same job took 1 minute and 40 minutes on the same day, because
the runners are shared with every other repo the fleet is pushing to.

**Run the WHOLE of `npm test` before pushing, not the subset you judge
relevant.** Two gates are invisible to a targeted run and both fired here:

- `every test file is run by something` compares the test directory against
  the npm scripts and the workflow steps. A new file in `test/` that no script
  names is never executed, and a test nothing runs is indistinguishable from a
  passing one. Add it to a script in the same commit — `test:boards` for
  anything about parts, seating or geometry.
- The parity ratchets fail when an entry HEALS, so an engine improvement in a
  sibling repo breaks a test whose filename mentions neither the part nor the
  change. There are TWO lists tracking the same drift from different angles —
  `terminal-crosscheck` counts pins per kind, `hd44780-terminal-parity` names
  the kinds and why — and updating one is not updating the other. That cost
  two CI rounds.

---

npm test 2271/0/6 (CI clean). test:boards 22/0. Pendant Playwright test (test:render suite).
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

- **MediaPanel eeprom slot** (d5aaa65): accepts parts + board props, forwards
  to describeMedia({parts}) for dynamic AT24C64 slot discovery. Shows byte
  count after load. bw-board 1f7a308 adds eeprom slot to machine-media.js
  (describeMedia dynamic + applyMedia via board.setPartParam). 18 tests.
- **MediaPanel** (32d8a58): ROM/software loader. Per-slot drop targets from
  describeMedia shape (label, accept, at, hint). Bundle .zip drop unpacks
  brickwright-media.json manifest via dynamic JSZip, feeds one applyMedia
  call. Returns null for MCU kinds. Same pane family as AsmDebugPanel.
- **AsmDebugPanel wired to live service** (94062e3): verified against
  stc-compiler /assemble debug=true. Listing tab now handles raw string
  format (actual backend output). TOKEN_COLORS adds 'identifier' type.
  8051: 8 tokens, 0 passes, 3 listing lines. 6502: 11 tokens, 1 pass
  (29 symbols), 10 listing lines. Both chains verified live.
- **AsmDebugPanel** (79cdde6): glass-box assembler debug view. Three tabs:
  token stream (colour-coded, hover→source), symbol table (pass-1 vs pass-2,
  unresolved→resolved highlighted), listing (addr + bytes + source). Accepts
  {tokens, passes, listing} from stc-compiler /assemble. Exported from
  index.js. 9 structural tests. Concept ref: EightBitCPUSim (GPL, nothing
  copied). Ready to wire when coordinator lands the stages payload.
- **Cross-board wire bundling** (80ce30f): wires spanning two different
  boards grouped by (boardA, boardB) pair, routed as parallel straight
  paths through the gap (4px spacing). Adapts to vertical/horizontal
  board layout. Single cross-board wires keep default arc. User waypoints
  still override. Makes multi-board benches read like real bus harnesses.
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
