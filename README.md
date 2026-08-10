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
- **Examples browser** — 53 gallery circuits loadable via `circuitData` prop.
- **Multimeter** — voltage, current (with burden-voltage teaching note),
  resistance (refuses on powered board — `requires-power-off` is a feature).

## Verification

621 tests, 0 failures. Gate: `npm run verify:interaction` (12 scenarios).

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
npm run verify:interaction  # 12 Playwright interaction scenarios
npm run test:render      # rendering tests (needs dev server)
npm run sync:parts       # re-vendor bw-parts sidecars into src/parts-data/
```

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

Measured by `vite build` at commit `5d7d79a`.

## Dependencies

| Package | Licence | Role |
|---------|---------|------|
| react, react-dom | MIT | peer (host provides) |
| @wokwi/elements | MIT | runtime — LED, resistor, pot, buzzer, button, 7-seg, LCD, IR |
| lit, @lit/react | BSD-3-Clause | runtime — React wrappers for wokwi web components |
| vite | MIT | dev only |
| playwright | Apache-2.0 | dev only — interaction gate |

Part art in `src/parts-data/` is vendored from
[bw-parts](https://github.com/CrispStrobe/bw-parts) —
see `src/parts-data/ART-PROVENANCE.md` and `src/parts-data/THIRD-PARTY.md`
for drawing methodology and licensing.
