# bw-circuit-ui — blocked items

## 1. `placingGhost` mode in the interaction machine

**Blocked on: campaign coordinator** (the agent rewriting src/interaction/)

BreadboardView.jsx needs a placement gesture: drag a part from the palette,
hover over the breadboard to see a ghost preview of which holes would be
occupied, click to commit. The interaction machine (`src/interaction/machine.js`)
currently handles select/drag/marquee/wiring but has no `placing` state.

**What I need:** a `placingGhost` state in `InteractionMachine` that:
- Enters when a palette part is selected for breadboard placement
- Tracks the cursor in world coordinates
- Calls a `ghostPreview(wx, wy)` callback on move (I compute the leadMap)
- Commits on click, cancels on Escape

**What I will do the moment it lands:**
- Wire BreadboardView's `onHoverHole` / `onClickHole` to the machine's callbacks
- Connect breadboard `deriveNets()` → `circuit.syncWithExternalNets()` for
  engine integration
- The footprint model (`src/model/footprints.js`), placement logic, and
  BreadboardView renderer are ready

## 2. `hittest.js:32` — `ledcube` → `led_cube`

**Blocked on: campaign coordinator** (owns src/interaction/, frozen for me)

One-line fix: `ledcube: { w: 90, h: 90 }` → `led_cube: { w: 90, h: 90 }`.
Filed as `spec-updates/led-cube-kind-rename.md` with cross-repo scope.
