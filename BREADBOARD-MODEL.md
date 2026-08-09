# The breadboard model — handoff to the UI

`src/model/breadboard.js` (coordinator, 2026-08-09). Pure data, no React, no engine
imports, tested in `test/breadboard.test.js` (in `npm test`). It owns bench-style
topology: legs in holes, strips conduct, the netlist falls out.

## What the UI builds on top

1. **Render** a full (63-col) or half (30-col) board: rows a–e / gutter / f–j, four
   rails. `holesOfStrip(stripId)` gives you the hole group to highlight on hover —
   showing a learner "these five holes are one conductor" IS the lesson.
2. **Placement**: choose a leadMap (terminal → hole) from the part's drag position,
   ghost the target holes, call `occupy(partId, leadMap)`. It is all-or-nothing and
   its error message names every conflicting hole — surface it verbatim.
3. **Jumpers**: `addWire(id, holeA, holeB, color)` — hole-to-hole, user-colored.
4. **Netlist**: `deriveNets()` → boundary-B `Net[]` shape. Feed the engine's
   `setNetlist` with your parts array + these nets, exactly as the abstract mode
   does today. `stripToNet` maps strips to nets for voltage coloring.
5. **Teaching**: `notes[]` from `deriveNets()` — same-strip shorts, no-op wires,
   floating leads, and (with `splitRails: true`) the missing-rail-jumper bug.
   Render them as teaching, not lint, like the existing wiring warnings.

## Decisions you should not re-make

- **Conduction is strips + wires only.** Parts join nets; they never merge them.
- **Net ids are deterministic**: rail-anchored groups are named for the rail
  (`rail-t+`), others `n-<first strip>`. Do not rename them per render.
- **The engine stays breadboard-blind.** No breadboard concept crosses boundary B.
- **Keep the abstract schematic mode** as a toggle; the model is additive.

## What is deliberately NOT here (yours or later)

- Footprint metadata (which leadMaps a given part kind allows, DIP pin ordering,
  lead-span limits) — propose the shape in spec-updates/ before building it.
- Pin-name → hole maps for MCU packages (the DIP-40 STC12 map lives with your
  device metadata, not in the topology model).
- Rendering geometry (hole pitch in px, board art). The model speaks hole ids only.
