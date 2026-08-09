# Breadboard footprint metadata shape — proposal

Filed 2026-08-09 from bw-circuit-ui before building the placement UI.

## What the renderer needs from footprint data

Each part kind that can sit on a breadboard needs a **footprint**: which holes
its leads occupy relative to a reference hole, so the renderer can show a ghost
preview during drag, validate placement, and call `BreadboardModel.occupy()`.

## Proposed shape

```js
/**
 * @typedef {object} BreadboardFootprint
 * @property {Record<string, {dRow: number, dCol: number}>} leads
 *   terminal name → offset from the reference hole.
 *   dRow: offset in rows (0 = same row, 1 = next row down, etc.)
 *   dCol: offset in columns (0 = same column, 1 = next column, etc.)
 * @property {string} refTerminal
 *   Which terminal sits on the reference hole (the one under the cursor).
 * @property {boolean} [straddlesGutter]
 *   True for DIP packages: reference hole in rows a–e, leads span to f–j.
 * @property {number} [minCols]
 *   Minimum board columns needed (e.g. DIP-40 needs 20 columns of span).
 */
```

## Example footprints

```js
const FOOTPRINTS = {
  resistor: {
    refTerminal: 'a',
    leads: { a: { dRow: 0, dCol: 0 }, b: { dRow: 0, dCol: 4 } },
  },
  led: {
    refTerminal: 'anode',
    leads: { anode: { dRow: 0, dCol: 0 }, cathode: { dRow: 0, dCol: 1 } },
  },
  capacitor: {
    refTerminal: 'a',
    leads: { a: { dRow: 0, dCol: 0 }, b: { dRow: 0, dCol: 1 } },
  },
  potentiometer: {
    refTerminal: 'a',
    leads: { a: { dRow: 0, dCol: 0 }, wiper: { dRow: 0, dCol: 2 }, b: { dRow: 0, dCol: 4 } },
  },
  button: {
    refTerminal: 'a',
    straddlesGutter: true,
    leads: { a: { dRow: 0, dCol: 0 }, b: { dRow: 5, dCol: 0 } },
    // row 0 = e, row 5 = f (across the gutter) — standard tactile switch
  },
  buzzer: {
    refTerminal: 'a',
    leads: { a: { dRow: 0, dCol: 0 }, b: { dRow: 0, dCol: 2 } },
  },
  seven_segment: {
    refTerminal: 'a',
    straddlesGutter: true,
    leads: { a: { dRow: 0, dCol: 0 }, b: { dRow: 5, dCol: 0 } },
    // Real 7-seg has more pins; placeholder until pin model is defined
  },
};
```

## Coordinate system

The renderer maps `(row, col)` to pixel positions:
- `row` is a letter index (a=0, b=1, ..., e=4, then gutter gap, f=5, ..., j=9)
- `col` is 1-based (matching BreadboardModel hole ids)
- Pixel position: `x = MARGIN + (col - 1) * HOLE_PITCH`, `y = MARGIN + rowIndex * HOLE_PITCH + gutterGap`

`HOLE_PITCH` should be ~12–14px at default zoom to match real board proportions
(2.54mm pitch ≈ 0.1" on a standard solderless board).

## Questions for the coordinator

1. Should DIP IC footprints (shift_register, eeprom) use a generic DIP-N shape
   parameterized by pin count, or individual footprint defs per part kind?
2. For MCU (STC12 DIP-40): the pin-name → hole map lives with device metadata
   per BREADBOARD-MODEL.md. Should this file define the DIP-40 footprint shape
   only, with pin names supplied at runtime by the device descriptor?
3. Rotation on a breadboard is restricted (0° or 180° for inline parts, no 90°
   without leaving the strip). Should the footprint declare allowed rotations?
