# Breadboard UI requirements — what the renderer needs from the model

Filed 2026-08-09 by bw-circuit-ui, per campaign brief Phase 2.

## What the renderer needs

1. **Hole pitch in px** — the spacing between adjacent holes. Standard breadboards use 2.54mm
   (0.1") pitch. The renderer needs a numeric constant to position parts and wires.

2. **Board dimensions** — number of rows and columns for the terminal strips, and the number/
   position of power rails. Full board (830 holes) vs half board (400 holes) as a constructor
   parameter.

3. **Rail grouping** — which holes are electrically connected. The model should expose
   `getNet(row, col)` → net ID, so the renderer can highlight connected holes on hover and
   derive the netlist for the engine.

4. **Part footprint metadata** — for each part kind, which holes its leads occupy relative to
   an anchor hole. Shape: `{ kind, leads: [{dRow, dCol, terminal}] }`. The renderer needs this
   to show a "ghost" preview during placement (green = free, red = occupied).

5. **Occupied holes** — `isOccupied(row, col)` → part ID or null. The renderer needs this to
   prevent overlapping placements and to show hole state (empty/occupied/highlighted).

6. **Wire routing between holes** — hole-to-hole wires (jumper wires) need start/end hole
   coordinates. The model should store these as `{fromRow, fromCol, toRow, toCol, color}`.

7. **Schematic ↔ breadboard toggle** — the model should be the same underneath both views.
   The renderer needs a way to compute schematic-view positions from breadboard positions
   (or vice versa), so toggling between views preserves the circuit.

## What the renderer provides

- Photorealistic breadboard SVG (holes, rails, channel, labels)
- Part placement with snap-to-hole and live ghost preview
- Hole-to-hole wire drawing
- Hover-highlight of connected holes (same rail/strip)
- The existing abstract (schematic) view as a toggle
