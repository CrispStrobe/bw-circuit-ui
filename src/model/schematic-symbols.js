/**
 * Schematic symbol geometry, as DATA.
 *
 * SchematicPanel.jsx draws these as JSX; the headless renderer in
 * schematic-svg.js draws the same paths as an SVG string for the CLI. Two
 * renderers over one description — the alternative is two hand-drawn symbol
 * sets that drift, which is the failure mode this codebase keeps finding.
 *
 * Coordinates are symbol-local; the projection supplies the translate. Pin
 * stubs reach +/-30 on x, matching PIN_HALF in schematic-projection.js.
 *
 * Anything NOT here falls back to the generic pin-labelled IC box, which is
 * why the box exists: 22 kinds are drawn here against 62 in circuit.js's
 * terminal table, so most parts are boxes today. Adding a symbol is now a
 * data edit rather than JSX surgery — see docs/schematic-viewer-resources.md
 * for symbol sources worth learning from.
 *
 * @module
 */

/** @type {Record<string, {paths: string[], circles?: Array<{cx:number,cy:number,r:number}>, value?: 'ohms'|'farads'|'volts'}>} */
export const SYMBOLS = {
  resistor:      { paths: ['M -30 0 L -18 0 L -14 -7 L -6 7 L 2 -7 L 10 7 L 14 0 L 30 0'], value: 'ohms' },
  ldr:           { paths: ['M -30 0 L -18 0 L -14 -7 L -6 7 L 2 -7 L 10 7 L 14 0 L 30 0'], value: 'ohms' },
  ntc:           { paths: ['M -30 0 L -18 0 L -14 -7 L -6 7 L 2 -7 L 10 7 L 14 0 L 30 0'], value: 'ohms' },
  potentiometer: { paths: ['M -30 0 L -18 0 L -14 -7 L -6 7 L 2 -7 L 10 7 L 14 0 L 30 0',
    'M 0 -16 L 0 -6 M -4 -10 L 0 -6 L 4 -10'] },
  capacitor:     { paths: ['M -30 0 L -4 0 M 4 0 L 30 0', 'M -4 -10 L -4 10 M 4 -10 L 4 10'], value: 'farads' },
  diode:         { paths: ['M -30 0 L -8 0 M 8 0 L 30 0', 'M -8 -8 L -8 8 L 8 0 Z', 'M 8 -8 L 8 8'] },
  led:           { paths: ['M -30 0 L -8 0 M 8 0 L 30 0', 'M -8 -8 L -8 8 L 8 0 Z', 'M 8 -8 L 8 8',
    'M 2 -10 L 8 -16 M 8 -16 L 5 -15 M 8 -16 L 7 -13 M 8 -8 L 14 -14 M 14 -14 L 11 -13 M 14 -14 L 13 -11'] },
  vsource:       { paths: ['M -30 0 L -6 0 M 6 0 L 30 0', 'M -6 -12 L -6 12 M 6 -6 L 6 6'], value: 'volts' },
  vcc:           { paths: ['M -30 0 L 0 0 L 0 -10 M -6 -10 L 6 -10'] },
  gnd:           { paths: ['M -30 0 L 0 0 L 0 8 M -9 8 L 9 8 M -6 12 L 6 12 M -3 16 L 3 16'] },
  button:        { paths: ['M -30 0 L -10 0 M 10 0 L 30 0', 'M -10 0 L 8 -10'],
    circles: [{ cx: -10, cy: 0, r: 2 }, { cx: 10, cy: 0, r: 2 }] },
  switch:        { paths: ['M -30 0 L -10 0 M 10 0 L 30 0', 'M -10 0 L 8 -10'],
    circles: [{ cx: -10, cy: 0, r: 2 }, { cx: 10, cy: 0, r: 2 }] },
  buzzer:        { paths: ['M -30 0 L -11 0 M 11 0 L 30 0'], circles: [{ cx: 0, cy: 0, r: 11 }] },
  npn:           { paths: ['M -30 0 L -6 0 M -6 -9 L -6 9', 'M -6 -3 L 8 -10 L 8 -18 M -6 3 L 8 10 L 8 18'],
    circles: [{ cx: 0, cy: 0, r: 13 }] },
  pnp:           { paths: ['M -30 0 L -6 0 M -6 -9 L -6 9', 'M -6 -3 L 8 -10 L 8 -18 M -6 3 L 8 10 L 8 18'],
    circles: [{ cx: 0, cy: 0, r: 13 }] },
  opamp:         { paths: ['M -14 -14 L -14 14 L 16 0 Z', 'M -30 -7 L -14 -7 M -30 7 L -14 7 M 16 0 L 30 0'] },
  gate_and:      { paths: ['M -12 -16 L -12 16 L 0 16 A 16 16 0 0 0 0 -16 Z', 'M -30 -8 L -12 -8 M -30 8 L -12 8 M 16 0 L 30 0'] },
  gate_nand:     { paths: ['M -12 -16 L -12 16 L 0 16 A 16 16 0 0 0 0 -16 Z', 'M -30 -8 L -12 -8 M -30 8 L -12 8 M 16 0 L 30 0'],
    circles: [{ cx: 19, cy: 0, r: 3 }] },
  gate_or:       { paths: ['M -12 -16 Q -4 0 -12 16 Q 6 16 16 0 Q 6 -16 -12 -16 Z', 'M -30 -8 L -8 -8 M -30 8 L -8 8 M 16 0 L 30 0'] },
  gate_nor:      { paths: ['M -12 -16 Q -4 0 -12 16 Q 6 16 16 0 Q 6 -16 -12 -16 Z', 'M -30 -8 L -8 -8 M -30 8 L -8 8 M 16 0 L 30 0'],
    circles: [{ cx: 19, cy: 0, r: 3 }] },
  gate_xor:      { paths: ['M -16 -16 Q -8 0 -16 16', 'M -12 -16 Q -4 0 -12 16 Q 6 16 16 0 Q 6 -16 -12 -16 Z',
    'M -30 -8 L -8 -8 M -30 8 L -8 8 M 16 0 L 30 0'] },
  gate_not:      { paths: ['M -14 -14 L -14 14 L 12 0 Z', 'M -30 0 L -14 0 M 18 0 L 30 0'],
    circles: [{ cx: 15, cy: 0, r: 3 }] },
};

/** Kinds with dedicated artwork; everything else gets the generic IC box. */
export const DRAWN_KINDS = Object.keys(SYMBOLS);
