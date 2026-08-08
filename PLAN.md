# bw-circuit-ui — plan

## What this is

The circuit designer panel for Brickwright: drag parts onto a board, wire them,
turn a potentiometer and watch an LED dim, probe nodes with a virtual multimeter.

**UI only.** Every electrical value comes from `bw-board` (sibling repo, boundary B).
No fabricated numbers, no placeholders that survive past the commit they appear in.

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
- Edit anything outside `/mnt/volume1/code/bw-circuit-ui`
- Create a GitHub repo (will ask)
- Add AI attribution to commits
