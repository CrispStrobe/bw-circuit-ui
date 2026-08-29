# bw-circuit-ui

Circuit designer and simulator UI for Brickwright. A learner builds circuits
on a breadboard, wires them, and measures with a multimeter — with or without
a microcontroller program. Every electrical value comes from
[bw-board](https://github.com/CrispStrobe/bw-board)'s MNA solver. Nothing
is fabricated.

**Live:** [brickwright-lite.vercel.app](https://brickwright-lite.vercel.app/) → Circuit tab.

## What is in it

- **Circuit model** — parts, wires, breadboard seating, netlist derivation,
  undo/redo, serialisation (toJSON/fromJSON with legacy-format support).
- **Breadboard** — full/half/mini boards with strip conduction, hole
  occupancy, tap wires, seated placement. No drawn wires needed — the
  strips conduct, matching the real object.
- **60+ part kinds** across 14 palette categories, from passives through
  74HC logic ICs to sensors, motors, and instruments. Terminal definitions
  from bw-parts sidecars (115 vendored JSON + 115 SVG art files).
- **Design-rule check** — 8 rules (source-current, missing-resistor,
  missing-flyback, floating-input, supply-short, polarity, I2C pull-up,
  aggregate current). Explains and offers fixes; never blocks. Current
  ratings imported from bw-board (one owner for the numbers).
- **Schematic projection** — auto-generated read-only schematic view as a
  mode toggle beside the realistic view. Pure function of (parts, nets).
- **Servo angle rendering** — decoded from the board model's pin-edge
  analysis, not from block arguments. Undriven shows "no signal".
- **BOM export** — bill of materials with CSV download.
- **Examples browser** — gallery circuits loadable via `circuitData` prop.
- **Teaching ladders** — `gallery/l0..l10` (a single AND gate to a keypad you can
  type into) and `gallery/c0..c17` (a 555 ticking to an eight-bit computer under
  microcode: a control ROM, conditional jumps, an 8-bit ALU that derives its own
  flags, a stack, CALL/RET, the whole machine again with a ROM where its control
  matrix was, and then that machine twice as wide). All 74-series, no CPU and no
  firmware, every rung simulated and asserted. See [`docs/LADDERS.md`](docs/LADDERS.md).
- **Multimeter** — voltage, current (with burden-voltage teaching note),
  resistance (refuses on powered board — `requires-power-off` is a feature).

## Verification

2,226 tests, 0 failures on CI (2026-08-27). The ladder RANGES above are
asserted against the gallery by `test/computer-ladder.test.js` — they had
drifted to `l0..l9`/`c0..c10` before anything checked them.

### The real-browser interaction gate

`npm run verify:interaction` drives a real Chromium through **31 scenarios**
with real pointer sequences against real WOKWI parts — click-select, part
drag, terminal-to-terminal wiring, breadboard placement and seating,
hole-to-hole jumpers, wheel pan (and that a plain wheel does NOT zoom),
opening the instruments column, the scope panel and a live channel, a
function generator's waveform on that scope, the simulation transport
(pause freezes board time, step advances exactly one 50 ms tick, resume
flows), schematic projection, the no-MCU starter entering Sim, body-beats-hole
on a seated part, the pin chooser completing a tap wire, the selectors column
collapsing and restoring, a multimeter that does not empty the board it
measures, per-channel V/div, the spectrum view's 1 kHz peak, a sweep that
reports per-point progress while the canvas still drags, and zero page errors.

**It runs in CI** (`.github/workflows/ci.yml`, job `interaction-gate`), which
it did not for most of its life — and three of its scenarios had been red the
whole time with nobody watching. It installs Chromium, clones the sibling
`bw-board` the dev harness imports, and fails the build on any scenario
failure.

The **count is asserted, not printed**. Every scenario reports exactly one
outcome under its own id and the script holds the full `EXPECTED` list: a
missing id, an unexpected id, or a pass arriving after a fail fails the run
and names it. "It was green" is not a result if it silently ran fewer than
last time. The last line of the run is:

```
31 scenarios · 31 passed · 0 failed
roll-call: 31/31 expected scenarios reported an outcome
```

Two DOM hooks exist for it and are asserted by it: `data-canvas-svg` (the one
svg whose viewBox is the camera — the container also holds a button icon's
svg, and reading that ornament's constant viewBox is how "wheel did not pan"
was reported for months) and `data-wokwi-layer` (the world→screen matrix —
found by "the first div with scale() in its transform" until palette
thumbnails started scaling and the pin-chooser gesture was drawn inside the
parts palette). Remove either and the gate fails by name.

**Nothing in this campaign has run on real silicon.** All cross-model claims
are category 2b (same-source agreement) at best. Categories per
`stc/docs/EVIDENCE-CATEGORIES.md`.

| What | Evidence | Category |
|------|----------|----------|
| Serialiser round-trip (52 gallery files) | 0 losses, 5 negative controls | 2c |
| Legacy file round-trip | Stable derivation, battery→vsource upgrade idempotent | 2c |
| Terminal cross-check vs bw-parts | 109/115 kinds, 0 coverage gaps | 2b |
| Cube scan accumulator | 64 voxels, 32 lit at 12.5% duty | 2b |
| Wire resolution (53+ gallery files) | Every terminal resolves (both wire formats) | 2c |
| Breadboard strip conduction | LED lights through strips alone, no drawn wires | 2b |
| DRC (8 rules) | 22 tests including safety-lesson canary | 2c |

The terminal cross-check is **2b, not independent**: both bw-parts and
bw-circuit-ui were written by agents in this campaign reading the same
datasheets. It catches transcription errors, not shared misreadings.

See `CLOSE-OUT.md` for the full ledger, defects found, and bench-blocked items.

## How to run

```bash
npm install
npm run dev              # Vite dev server on port 3100
npm test                 # 621 unit/integration tests
npm run verify:interaction  # 31 real-browser scenarios (also runs in CI)
npm run test:render      # rendering tests (needs dev server)
npm run sync:parts       # re-vendor bw-parts sidecars into src/parts-data/
npm run verify:deployed  # deployed-page probes against GH Pages (see below)
```

### Deployed-page probes

Playwright probes that run against the live GitHub Pages deployment (no local
server). They verify rendering invariants that unit tests cannot reach:

1. **Single-renderer guard** — no two stroked SVG elements share endpoints
   for one jumper; `addHoleWire` adds exactly one `[data-jumper]` element.
2. **Z spot-check** — jumper `<path>` elements appear after chip bodies in
   SVG document order (later = painted on top).
3. **Blinkenrocket pendant** — ATtiny88 chip label, matrix brightness > 0,
   button press reads correctly via `setControl`/`readPin('PC3')`.
4. **Blink an LED** — exactly 3 tagged jumpers, zero untagged twins.

```bash
# Default: probes against GH Pages
npm run verify:deployed

# Custom URL (preview deploy, local dev server, etc.)
PROOF_URL=https://my-preview.vercel.app/ npm run verify:deployed

# Or as a positional arg
node scripts/deployed-probes.mjs https://crispstrobe.github.io/brickwright-lite/
```

Requires `playwright` (`npm install`). The probes navigate to the Circuit tab,
load examples from the gallery, and exercise the circuit model via
`window.__circuit` and `window.__board`.

## Importing as a component

```jsx
import { setEngine, CircuitDesigner } from 'bw-circuit-ui';
import { BoardImpl, inferNetlist, checkWiring } from './lib/bw-board/index.js';
import { getMaxCurrent, PORT_LIMITS } from './lib/bw-board/current-ratings.js';

setEngine({ BoardImpl, inferNetlist, checkWiring, getMaxCurrent, PORT_LIMITS });

<CircuitDesigner
  project={{ device: 'STC12C5A60S2', clock: 11059200, pins: [...] }}
  circuitData={pendingExample}       // load a gallery example
  onDeclarationChange={(decls) => {}} // parts → blocks
  onCircuitReady={(circuit) => {}}    // once, on mount
/>
```

Exported panels (for host integration):
`DrcPanel`, `BomPanel`, `ExamplesBrowser`, `runDrc`, `generateBom`, `bomToCsv`.

## What is NOT done

- **Pane slots (slice 4)** — state modelled in `pane-layout.js`, not
  rendered. Moved to bw-bundle. Specified, not built.
- **Circuit block greying on hardware** — `PARTS-TO-BLOCKS.md` describes
  greying as existing; it is not implemented. Blocks return NaN (stopgap).
  Assigned to bw-blocks. Specified, not built.
- **Full sidecar-art canvas rendering** — palette thumbnails use bw-parts
  SVGs; the canvas still uses wokwi elements and hand-drawn SVG parts.
- **LED ghost vs placed size mismatch** — FOOTPRINTS dimensions and
  wokwi-led natural size disagree. Owner-reported, not yet fixed.
- **Seated part legibility** — hover/select should highlight occupied
  holes and strips. Owner-reported, not yet built.
- **Schematic projection quality** — visible for the first time after
  the height fix. Rendering is unverified at full width.

## Bundle

~480 KB / ~138 KB gzip (with React, 115 sidecar JSONs, 115 SVGs).

Measured by `vite build` at commit `2d6f617`.

## Dependencies

| Package | Licence | Role |
|---------|---------|------|
| react, react-dom | MIT | peer (host provides) |
| @wokwi/elements | MIT | runtime — Arduino Uno/Nano/Mega faces, LED, resistor, pot, buzzer, button, 7-seg, LCD, IR |
| lit, @lit/react | BSD-3-Clause | runtime — React wrappers for wokwi web components |
| vite | MIT | dev only |
| playwright | Apache-2.0 | dev only — interaction gate |

Part art in `src/parts-data/` is vendored from
[bw-parts](https://github.com/CrispStrobe/bw-parts) —
see `src/parts-data/ART-PROVENANCE.md` and `src/parts-data/THIRD-PARTY.md`
for drawing methodology and licensing.
