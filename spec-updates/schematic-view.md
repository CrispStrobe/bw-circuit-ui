# Schematic view — read-projection of the single circuit model

Filed 2026-08-09 from bw-circuit-ui per target inventory.

## Concept

A schematic view that auto-generates a conventional circuit diagram from the
same parts + nets the breadboard holds. NOT a second interaction world — a
read-only projection with standardized symbol placement.

## Design constraints (from coordinator)

1. **One model, one truth.** The schematic reads from `circuit.parts` and
   `circuit.wires` / breadboard-derived nets. Editing happens on the canvas;
   the schematic follows.
2. **Never a second interaction world.** No drag/place/wire in schematic mode.
   It's a rendering transformation, not a parallel editor.
3. **The reference simulator has one too.** This validates the approach — auto
   layout from netlist, conventional symbols, read-only.

## Proposed architecture

```
SchematicView({ parts, nets })
  → auto-layout engine (force-directed or hierarchical)
  → SVG renderer with IEEE/IEC standard symbols
  → Optional: export as SVG/PNG
```

### Auto-layout

Parts placed by a simple hierarchical algorithm:
- VCC at top, GND at bottom
- Signal flow left-to-right
- MCU centered, peripherals around it
- Nets drawn as orthogonal wires with junction dots

### Symbols

Each part kind maps to a standard schematic symbol (resistor zigzag,
capacitor parallel plates, LED triangle+bar, transistor with arrow, etc.).
These are DIFFERENT from the breadboard/palette thumbnails — schematic symbols
follow IEEE 315 / IEC 60617 conventions.

## Timeline

After breadboard continuity is solid and tested. This is a rendering exercise
with no model changes required — the data is already there.
