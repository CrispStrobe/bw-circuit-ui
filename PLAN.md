# bw-circuit-ui — plan

## What this is

The circuit designer panel for Brickwright: drag parts onto a board, wire them,
turn a potentiometer and watch an LED dim, probe nodes with a virtual multimeter.

**UI only.** Every electrical value comes from `bw-board` (sibling repo, boundary B).
No fabricated numbers, no placeholders that survive past the commit they appear in.

**Next campaign is scoped: see `ROADMAP.md` (2026-08-23)** — export-path defect fixes
(X0, do first: unsimulatable SPICE decks, mega/milli suffix, three dead exporters,
silent menu no-op), new interchange formats (X1), and instrument post-processing in
workers (X2). Engine prerequisites are cross-referenced to `../bw-board/ROADMAP.md`.

## Architecture

```
┌──────────────────────────────────────────────────┐
│  circuit-designer (React 18, function components) │
│                                                    │
│  ┌─────────────┐  ┌────────────┐  ┌────────────┐ │
│  │ BoardCanvas  │  │ PartPalette│  │ Multimeter │ │
│  │ (SVG)        │  │            │  │            │ │
│  └──────┬───────┘  └────────────┘  └────────────┘ │
│         │                                          │
│  ┌──────┴───────┐                                  │
│  │ circuit-model│  (netlist ↔ layout mapping)      │
│  └──────┬───────┘                                  │
│         │ boundary B                               │
│  ┌──────┴───────┐                                  │
│  │  bw-board    │  (imported directly, ESM)        │
│  │  BoardImpl   │                                  │
│  └──────────────┘                                  │
└──────────────────────────────────────────────────┘
```

## Part visuals: wokwi-elements

**Decision:** use `wokwi/wokwi-elements` (MIT) for component visuals.

- Provides LED, resistor, potentiometer, buzzer, 7-segment, pushbutton — exactly what
  we need.
- Tree-shakeable via per-element ESM imports. ~30–40 KB gzipped for our subset + Lit.
- React 18 passes props as string attributes; Lit elements read JS properties. Use
  `@lit/react` (MIT, ~1 KB) to wrap each element cleanly.
- If too heavy for the final brickwright-lite bundle, individual elements can be replaced
  with hand-drawn SVGs — the wrapper layer makes that a local swap.

## Phases (in order — each committed before the next starts)

### Phase 1: dev harness + static render ✓
- `npm init`, install wokwi-elements + @lit/react + react 18 + a dev bundler (vite)
- Hand-written netlist (the active-low LED circuit from bw-board's tests)
- Render parts on an SVG canvas with wokwi-elements, draw wires between terminals
- No interaction, no engine — just a picture
- **Commit checkpoint**

### Phase 2: wire to real Board ✓
- Import `BoardImpl` from `../bw-board/src/index.js` (relative path, no npm publish)
- Drive with the scripted-MCU fixture (same trace as bw-board's led-active-low test)
- LED brightness on screen comes from `board.ledBrightness()` — not invented
- Node voltages shown as labels, updated from `board.nodeVoltage()`
- **Commit checkpoint**

### Phase 3: interaction ✓
- Drag parts from palette onto canvas
- Draw wires by clicking terminals
- Delete parts/wires
- Turn potentiometer → `board.setControl()`
- Press button → `board.setControl()`
- LED brightness rendered from engine (opacity/glow keyed to 0…1 value)
- Buzzer tone → Web Audio oscillator from `board.buzzerTone()`
- **Commit checkpoint**

### Phase 4: inferNetlist (boundary C) ✓
- Import `inferNetlist` from bw-board
- Board starts populated from `project.stc.pins`
- Reverse warnings shown in UI as teaching ("pin P1.2 is driven but nothing is wired to it")
- User can redraw/override the inferred circuit
- **Commit checkpoint**

### Phase 5: multimeter ✓
- Two probes, placed on nodes
- V / A / Ω modes
- Resistance returns `'requires-power-off'` on a live board → UI prompts user to
  switch power off (not an error toast — the meter is behaving correctly)
- **Commit checkpoint**

## Dev harness

Vite dev server + a single `index.html`. No test framework beyond `node --test` for
logic modules. The iteration loop must stay under 2 seconds hot-reload.

## Dependencies (all permissive)

| Package | Licence | Why |
|---|---|---|
| react, react-dom | MIT | target runtime |
| @anthropic-ai/sdk | — | NOT used |
| wokwi-elements | MIT | part visuals |
| @lit/react | BSD-3-Clause | React 18 ↔ web-component bridge |
| lit | BSD-3-Clause | wokwi-elements runtime dependency |
| vite | MIT | dev bundler only |
| @vitejs/plugin-react | MIT | JSX transform |

bw-board is imported by path, not installed — it is dependency-free ESM.

## What I will NOT do

- Fabricate any electrical value
- Edit anything outside this repo's working directory
- Create a GitHub repo (will ask)
- Add AI attribution to commits

---

## Schematic audit — open items (2026-08-23)

*Re-verified at bw-circuit-ui `0a3ec00e…`, bw-board `a7338cdcdd5d54122bdc5be44c02908bdb6a4fd6`,
sb3-creator `3c4973b08034a25f1e1e7edda64e600282459804` (2,098 circuit files).
All eleven classes still measure as `docs/SCHEMATIC-AUDIT.md` records; the
corpus lost nine files upstream, none of them among the ten worst.*

The end-to-end audit is in `docs/SCHEMATIC-AUDIT.md`. Class I (a conductor
drawn through a pin on another net, 799 of 2,107 circuits) is FIXED here. Three
things it turned up are NOT fixed here, each with what blocks it:

**1. `pico01-blink` ships an unwired circuit.** `circuit.json` has three parts
and zero wires; `circuit-flat.json` has two and zero. The schematic draws two
symbols and no connections, which is the honest rendering of an empty netlist —
the defect is upstream in the corpus, not in the viewer. **Blocked on
sb3-creator**: authoring the wiring is a content decision (which Pico pin, which
resistor), not a mechanical repair, and inventing it would be fabricating a
circuit. Recorded in `KNOWN_UNCONNECTED_PINS` so it cannot grow quietly.

**2. `eater6502-full-build` seats `kbd` d0/d1 and `bargraph` a0/k0 on empty
breadboard columns.** Six dangling pins across two variants. Same disposition:
the drawing is faithful, the circuit is incomplete. **Blocked on sb3-creator**
for the same reason — someone has to decide where those data lines go.

**3. brickwright-lite's vendored copy is behind.** Lite renders its schematic
baselines from `overlay/scratch-gui/src/lib/bw-circuit-ui/`, a vendored copy of
this repo, and holds four reviewed SVGs in `docs/schematic-baselines/`. Its
copy still has the pre-fix router, so its four baselines still show conductors
running through foreign pins. **Blocked on a vendor sync** from this repo at the
sha carrying the fix; the four baselines must then be re-rendered and LOOKED at,
not accepted blind. Lite's own `test/schematic-projection.test.mjs` and
`test/schematic-visual-baselines.test.mjs` should also take the corpus-discovery
widening, or lite will keep measuring half the gallery.

**Not a defect, worth knowing:** the projection falls back to net labels for
dense drawings (`>18 nets` or `>52 pins`) and for any route it cannot draw
without crossing a symbol. After the class-I fix, 33 more label stubs and 15
fewer trunk routes across the corpus. That is a legitimate schematic convention
and the rendered-netlist gate treats repeated labels as connectivity, but it
does mean a denser drawing shows fewer wires. If the owner would rather see
copper there, the lever is the routing band (`COL_W` / `PIN_HALF`), not the
pin-clearance rule.

---

## Schematic audit, second pass — open items (2026-08-24)

*Rig: bw-circuit-ui branch point `1b854032a7c38159bea3b919e5341e233b6d1e6f`,
bw-board `a7338cdcdd5d54122bdc5be44c02908bdb6a4fd6`, sb3-creator
`4a0826ae492d4b6b4f00d90528074e31c510c16d` (2,098 circuit files).*

The second pass audited the DETECTORS rather than the drawing, on the grounds
that ten classes reporting zero from detectors written by the same hand is an
untested claim. Five more real classes came out of it (L, M, N, O, P in
`docs/SCHEMATIC-AUDIT.md`), all fixed here and all mutation-proved. What is NOT
fixed here:

**1. The engine pin in this repo's local rig is older than the palette.**
`test/palette-engine-coverage.test.js` fails at bw-board
`a7338cdcdd5d54122bdc5be44c02908bdb6a4fd6` because `ay8912` — added to the
designer in bw-circuit-ui `410f8ce` — has no engine device at that sha. CI is
unaffected: it clones bw-board's main, which has it. This is a rig-pinning
artefact and not a defect, but it means **a local `npm test` is only meaningful
against a bw-board new enough for the palette**. Worth a `vendor-pins.json`-style
floor so the mismatch fails loudly instead of looking like a viewer defect.

**2. Label text can overlap a conductor.** The leader LINE is now gated
(class P), but the label's rendered TEXT is not: in
`arduino-05-arrays/circuit.pico.json` a `GND` glyph sits across a wire. This is
a legibility defect, not a correctness one — the text is anchored to the right
pin and the leader touches nothing — so it is deliberately not gated as a false
connection. **Blocked on a text-metrics decision**: measuring glyph boxes needs
a font metric the projection does not currently carry, and guessing one would
produce a gate that fires on the wrong things. Fix is either a label-placement
pass that tries the other side, or accepting it.

**3. The label fallback grew.** Refusing to let two nets touch costs 1,385 more
label stubs and 551 fewer drawn segments corpus-wide (§8 of the audit). That is
standard schematic practice and the rendered-netlist gate treats repeated labels
as connectivity, but a denser drawing now shows fewer wires than before. If the
owner would rather see copper, the lever is the routing band (`COL_W`,
`PIN_HALF`, the `>18 nets` / `>52 pins` label threshold) — **not** the contact
rule, because loosening that buys wires by drawing shorts.

**4. brickwright-lite's vendored copy is now two fixes behind**, not one. It
still has the pre-class-I router AND the pre-L/M/N/O/P projection, so its four
reviewed baselines show both defect families. **Blocked on a vendor sync** from
this repo at the sha carrying these commits; the baselines must then be
re-rendered and LOOKED at.

**5. Items 1 and 2 from the first pass still stand** — `pico01-blink` ships a
circuit with zero wires and `eater6502-full-build` seats four leads on empty
columns. Both blocked on sb3-creator; both are corpus facts the viewer renders
honestly, and both are held by the class-C ratchet.

---

## attiny88 footprint — fixed, and what is NOT fixed (2026-08-24)

*Rig: bw-circuit-ui `9461c7f7caa2390f40ecab8df814170c9af481d4` (branch point),
bw-board `1dac64c7ac38ea030b2760a8b221ef4cce4f5bd5`, sb3-creator
`4a0826ae492d4b6b4f00d90528074e31c510c16d`.*

### Fixed here

The ATtiny88 PDIP-28 top row ran in the wrong order. At column c the bottom row
is pin c+1 and the top row is pin 28-c, so the top row must read

```
PC5 PC4 PC3 PC2 PC1 PC0 [pin 22] PC7 AVCC PB5 PB4 PB3 PB2 PB1
```

Corrected in BOTH places that carry it, which is the first finding worth
recording: **there were two.** `src/model/footprints.js`'s `BUILTIN_FOOTPRINTS`
(14 of 14 columns wrong — it ran the row backwards) and
`src/parts-data/attiny88.json` (8 of 14 wrong, and mirrored relative to the
built-in). They now agree, and `refTerminal` moved to `pc5` because
`test/footprints.test.js` requires the reference lead to sit at offset (0,0) and
the old `pb1` only sat there because the row was backwards.

**`FOOTPRINTS` is a Proxy that returns the BUILT-IN whenever a kind is built in,
and consults the sidecar only as a fallback.** So for attiny88 — and for 53
other kinds — the sidecar footprint was never read by seating. Fixing only the
JSON, which is what this task originally described, would have changed nothing.

### NOT fixed: pin 22 is still called `pa0`, and that is a real defect

The PDIP-28 does not bond out port A; pin 22 is a SECOND GND. It keeps the wrong
name because **bw-board is the authority for terminal names** — `circuit.js`'s
`terminalsForKind` calls `engineTerminals(kind)` first, and the canvas then looks
terminal POSITIONS up by name out of the sidecar. Renaming here alone would leave
the engine's `pa0` with no position and render it at the part origin.

Ordering, which cannot be shortened:

1. **bw-board** — `src/devices/board-kinds.js`, `ATTINY88_TERMINALS`: `'pa0'` →
   `'gnd2'`. Its own comment already says the spellings must match the sidecar.
   **Blocked on bw-board** (sibling; a sibling agent is active there).
2. **bw-circuit-ui** — this repo: rename in `src/parts-data/attiny88.json` and
   `src/model/footprints.js`. One line each, already located.
3. **bw-parts** — `parts/attiny88.json`, same rename. **Blocked on bw-parts.**
4. **sb3-creator** — re-seat, see below.

`gnd2` is the name to use: `arduino_uno`, `arduino_nano` and `arduino_mega`
already spell a primary `gnd` plus numbered extras exactly that way. (`l293d`
uses `gnd1..gnd4` with no bare `gnd`; `pi_pico` uses `gnd_1..gnd_7`. The arduino
form is the one that fits "one primary, one extra".)

### NOT done: the corpus re-seat

135 shipped circuits seat an attiny88. Correcting the column order moves **13 of
28 legs** — the whole top row — into different breadboard columns, which changes
which strips they join and therefore the netlist. Measured on
`01-blink/circuit.attiny88.json`, holding pin 1 at its current hole (refHole e3):

```
pc5  e15 -> e3     pc0  e10 -> e8      pb4  e6 -> e13
pc4  e14 -> e4     pc7  e16 -> e10     pb3  e5 -> e14
pc3  e13 -> e5     avcc e8  -> e11     pb2  e4 -> e15
pc2  e12 -> e6     pb5  e7  -> e12     pb1  e3 -> e16
pc1  e11 -> e7
```

`node scripts/gen-device-benches.mjs batch --only <id>` then `seat` then `index`,
**in sb3-creator**. Not run here: this repo's standing rule is that everything
under `/mnt/volume1/code/` outside bw-circuit-ui is a read-only reference mirror,
and re-seating rewrites 135 files in a sibling that has several active branches.
**Wants an explicit go-ahead**, and it should happen AFTER the rename above so
the corpus is regenerated once rather than twice. `assert-physics` and
`kcl-residual` must be measured either side of it; a move in either is a finding,
not something to absorb.

Until it runs, the shipped circuits keep their old leg positions (their saved
`leadMap` is authoritative for an already-seated part) and only NEWLY seated
attiny88s get the corrected geometry. That is a knowingly inconsistent state and
it is why this entry exists.

### The survey, with denominators

`test/footprint-chirality.test.js` is the gate. Chirality is the invariant the
three withdrawn designs were reaching for: a DIP may legitimately be seated
rotated 180°, but never MIRRORED, and the sign of the cross product spanned by
any three non-collinear leads is invariant under rotation and flips under
reflection.

| | count |
|---|---|
| built-in footprints | 78 |
| of those, multi-row (have a handedness at all) | 25 |
| single-row (no handedness — 2-pin passives) | 53 |
| kinds with BOTH a built-in and a sidecar footprint | 54 |
| of those, chirality-comparable | 17 |
| **MIRRORED between the two** | **14** |

The 14: `62256 w65c02 z80 28c256 w65c22 w65c51 mc6850 74hc00 74hc595 attiny85
attiny2313 attiny13 at24c64 mcu`. They are latent, not active — the sidecar is
inert for a built-in kind — so they are a ratchet that may only shrink, not a
build break. attiny88 was the 15th until this commit.

**Second-supply candidates for datasheet review** (mechanical criterion: a
multi-row footprint with exactly ONE ground-ish lead — 17 of the 25). This is a
candidate list, not a defect list: most of these genuinely have one ground.
`w65c02` is the one worth checking first, since the 65C02 DIP-40 is commonly
documented with VSS on two pins. **Not asserted here** — no datasheet was
available on this machine, and the attiny88 case is exactly what guessing from
memory produces.
