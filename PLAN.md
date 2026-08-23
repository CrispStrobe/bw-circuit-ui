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
