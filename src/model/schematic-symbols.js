/**
 * Schematic symbol geometry, as DATA.
 *
 * SchematicPanel.jsx draws these as JSX; the headless renderer in
 * schematic-svg.js draws the same shapes as an SVG string for the CLI. Two
 * renderers over one description -- the alternative is two hand-drawn symbol
 * sets that drift, which is the failure mode this codebase keeps finding.
 *
 * Coordinates are symbol-local; the projection supplies the translate. Pin
 * stubs reach +/-30 on x, matching PIN_HALF in schematic-projection.js.
 *
 * WHAT IS DELIBERATELY *NOT* HERE. Rendering the whole gallery headless (1034
 * circuits, 8387 parts) ranked every kind that falls back to the generic box,
 * and the ranking splits three ways:
 *
 *   1. ICs, MCUs and memories -- arduino_uno, mcu, pi_pico, stc15_mcu,
 *      attiny85/88, 74hc00/74hc595, timer_555, 62256, w65c02, z80 ... For
 *      these a pin-labelled rectangle IS the conventional schematic symbol.
 *      They are not a gap and they are not getting bespoke artwork.
 *   2. Display and sensor MODULES -- ssd1306, char_lcd_i2c, matrix8x8,
 *      seven_seg_3, keypad_4x4, ultrasonic. A labelled box is also how these
 *      are normally drawn; a picture of the module would be a pictorial, not
 *      a schematic. Deferred on purpose.
 *   3. Discretes and electromechanical parts, which DO have standard symbols
 *      every reader expects -- relay, slide_switch, dc_motor, battery,
 *      inductor, zener, mosfet, piezo, fuse. Those are the real gap, and they
 *      are what this file gained.
 *
 * Re-ranked over the KiCad corpus once those importers landed (88 more
 * schematics), and it moved almost nothing: of the ten kinds still falling
 * back there, nine are group 1 or 2 -- lm7805, at24c02, h_bridge, usb_a,
 * vreg, ams1117_33, dht11, 74hc125 -- and one, `fuse`, was group 3 and is now
 * drawn. `optocoupler` is the one deliberate omission: it has a standard
 * symbol, but its four terminals are laid out first-half-left by
 * schematic-projection, which would put the emitter above the collector and
 * draw the phototransistor upside down. It needs per-terminal placement
 * first, which is a bigger change than one shape.
 *
 * So "the viewer is incomplete" is much narrower than the raw count of undrawn
 * kinds suggests. See docs/schematic-viewer-resources.md for symbol sources.
 *
 * @module
 */

/**
 * @typedef {object} Shape
 * @property {Array<string|{d:string,w?:number,fill?:string}>} paths
 * @property {Array<{cx:number,cy:number,r:number,fill?:string}>} [circles]
 * @property {Array<{x:number,y:number,s:string,size?:number}>} [texts] static glyphs
 * @property {'ohms'|'farads'|'volts'} [value] which param renders as a value label
 */

const ZIGZAG = 'M -30 0 L -18 0 L -14 -7 L -6 7 L 2 -7 L 10 7 L 14 0 L 30 0';
const SPDT = {
  paths: ['M -30 0 L -10 0', 'M 10 -8 L 30 -8 M 10 6 L 30 6', 'M -10 0 L 9 -8'],
  circles: [{ cx: -10, cy: 0, r: 2 }, { cx: 10, cy: -8, r: 2 }, { cx: 10, cy: 6, r: 2 }],
};

/**
 * A seven-segment digit outline, drawn as the figure-8 every datasheet uses.
 * Built rather than typed out because the 3- and 4-digit parts are the same
 * glyph repeated -- writing them by hand would be three chances to get one
 * segment wrong.
 *
 * @param {number} n how many digits
 * @returns {Shape}
 */
function sevenSeg(n) {
  const W = 16, GAP = 5, total = n * W + (n - 1) * GAP;
  const x0 = -total / 2;
  const paths = [];
  for (let i = 0; i < n; i++) {
    const l = x0 + i * (W + GAP), r = l + W;
    paths.push(
      `M ${l} -14 L ${r} -14`,            // a
      `M ${r} -14 L ${r} 0`,              // b
      `M ${r} 0 L ${r} 14`,               // c
      `M ${l} 14 L ${r} 14`,              // d
      `M ${l} 0 L ${l} 14`,               // e
      `M ${l} -14 L ${l} 0`,              // f
      `M ${l} 0 L ${r} 0`,                // g
    );
  }
  // Pin stubs stay at the symbol edge so wires meet the outline, not the air.
  paths.push(`M -30 0 L ${x0} 0`, `M ${x0 + total} 0 L 30 0`);
  return { paths: paths.map((d) => ({ d, w: 2.2 })) };
}

/**
 * A pin header / connector: one square pad per pin with a lead out to the
 * right, inside the shroud outline. Built from the pin count because a 2-pin
 * JST and a 40-pin GPIO strip are the same symbol at different heights --
 * 955 of the corpus's parts are one of these.
 *
 * @param {number} n
 * @returns {Shape}
 */
function headerSym(n) {
  const pitch = 12, h = Math.max(n * pitch, pitch);
  const y0 = -h / 2 + pitch / 2;
  const paths = [{ d: `M -14 ${-h / 2} L 4 ${-h / 2} L 4 ${h / 2} L -14 ${h / 2} Z`, w: 1.4 }];
  for (let i = 0; i < n; i++) {
    const y = y0 + i * pitch;
    paths.push({ d: `M -8 ${y - 3} L -2 ${y - 3} L -2 ${y + 3} L -8 ${y + 3} Z`, w: 1.2 });
    paths.push(`M 4 ${y} L 30 ${y}`);
  }
  return { paths };
}

/** @type {Record<string, Shape>} */
export const SYMBOLS = {
  resistor:      { paths: [ZIGZAG], value: 'ohms' },
  ldr:           { paths: [ZIGZAG], value: 'ohms' },
  ntc:           { paths: [ZIGZAG], value: 'ohms' },
  potentiometer: { paths: [ZIGZAG, 'M 0 -16 L 0 -6 M -4 -10 L 0 -6 L 4 -10'] },
  capacitor:     { paths: ['M -30 0 L -4 0 M 4 0 L 30 0', 'M -4 -10 L -4 10 M 4 -10 L 4 10'], value: 'farads' },
  // Electrolytic: one straight plate, one curved, and a + by the anode.
  polarized_cap: { paths: ['M -30 0 L -4 0 M 6 0 L 30 0', 'M -4 -10 L -4 10', 'M 10 -10 Q 4 0 10 10'],
    texts: [{ x: -12, y: -10, s: '+', size: 9 }], value: 'farads' },
  inductor:      { paths: ['M -30 0 L -18 0 M 18 0 L 30 0',
    'M -18 0 A 6 6 0 0 1 -6 0 A 6 6 0 0 1 6 0 A 6 6 0 0 1 18 0'] },
  // Fuse, IEC 60617: the element drawn straight through a plain body. Two
  // terminals and a symbol every reader knows, so a labelled box is a real
  // loss here in a way it is not for an IC. Four of them in the KiCad corpus
  // and none in the EAGLE one, which is why it only surfaced now.
  fuse:          { paths: ['M -30 0 L -16 0 M 16 0 L 30 0',
    'M -16 -7 L 16 -7 L 16 7 L -16 7 Z', 'M -16 0 L 16 0'] },
  diode:         { paths: ['M -30 0 L -8 0 M 8 0 L 30 0', 'M -8 -8 L -8 8 L 8 0 Z', 'M 8 -8 L 8 8'] },
  // Zener: the cathode bar gains its characteristic bent ends.
  zener:         { paths: ['M -30 0 L -8 0 M 8 0 L 30 0', 'M -8 -8 L -8 8 L 8 0 Z',
    'M 14 -12 L 8 -8 L 8 8 L 2 12'] },
  led:           { paths: ['M -30 0 L -8 0 M 8 0 L 30 0', 'M -8 -8 L -8 8 L 8 0 Z', 'M 8 -8 L 8 8',
    { d: 'M 2 -10 L 8 -16 M 8 -16 L 5 -15 M 8 -16 L 7 -13 M 8 -8 L 14 -14 M 14 -14 L 11 -13 M 14 -14 L 13 -11', w: 1.1 }] },
  // Three emitters in one package: the LED body plus an RGB tag, since three
  // separate diode symbols would misrepresent it as three parts.
  rgb_led:       { paths: ['M -30 0 L -8 0 M 8 0 L 30 0', 'M -8 -8 L -8 8 L 8 0 Z', 'M 8 -8 L 8 8',
    { d: 'M 2 -10 L 8 -16 M 8 -16 L 5 -15 M 8 -16 L 7 -13 M 8 -8 L 14 -14 M 14 -14 L 11 -13 M 14 -14 L 13 -11', w: 1.1 }],
    texts: [{ x: 0, y: 20, s: 'RGB', size: 7 }] },
  vsource:       { paths: ['M -30 0 L -6 0 M 6 0 L 30 0', { d: 'M -6 -12 L -6 12 M 6 -6 L 6 6', w: 2 }], value: 'volts' },
  // A battery is a stack of cells: long plate / short plate, twice.
  battery:       { paths: ['M -30 0 L -12 0 M 12 0 L 30 0',
    { d: 'M -12 -12 L -12 12 M -4 -6 L -4 6 M 4 -12 L 4 12 M 12 -6 L 12 6', w: 2 }], value: 'volts' },
  vcc:           { paths: ['M -30 0 L 0 0 L 0 -10 M -6 -10 L 6 -10'] },
  gnd:           { paths: ['M -30 0 L 0 0 L 0 8 M -9 8 L 9 8 M -6 12 L 6 12 M -3 16 L 3 16'] },
  button:        { paths: ['M -30 0 L -10 0 M 10 0 L 30 0', 'M -10 0 L 8 -10'],
    circles: [{ cx: -10, cy: 0, r: 2 }, { cx: 10, cy: 0, r: 2 }] },
  switch:        { paths: ['M -30 0 L -10 0 M 10 0 L 30 0', 'M -10 0 L 8 -10'],
    circles: [{ cx: -10, cy: 0, r: 2 }, { cx: 10, cy: 0, r: 2 }] },
  // Changeover parts: one common, two throws. Drawn as SPDT so the common
  // terminal is visibly the one the blade pivots on.
  slide_switch:  SPDT,
  dip_switch:    SPDT,
  tilt_sensor:   SPDT,
  buzzer:        { paths: ['M -30 0 L -11 0 M 11 0 L 30 0'], circles: [{ cx: 0, cy: 0, r: 11 }],
    texts: [{ x: 0, y: 4, s: '♪', size: 9 }] },
  piezo:         { paths: ['M -30 0 L -11 0 M 11 0 L 30 0'], circles: [{ cx: 0, cy: 0, r: 11 }],
    texts: [{ x: 0, y: 4, s: '♪', size: 9 }] },
  // Motor: the classic circled M, stubs entering left and right.
  dc_motor:      { paths: ['M -30 0 L -13 0 M 13 0 L 30 0'], circles: [{ cx: 0, cy: 0, r: 13 }],
    texts: [{ x: 0, y: 4, s: 'M', size: 11 }] },
  // Relay: coil on the left, contact set on the right, dashed line for the
  // mechanical (not electrical) link between them.
  relay:         { paths: ['M -30 -8 L -18 -8 M -30 8 L -18 8', 'M -18 -14 L -2 -14 L -2 14 L -18 14 Z',
    { d: 'M -2 0 L 12 0', w: 0.9 }, 'M 12 -10 L 30 -10 M 12 8 L 30 8', 'M 12 -10 L 28 4'],
    circles: [{ cx: 12, cy: -10, r: 2 }, { cx: 12, cy: 8, r: 2 }] },
  // Enhancement MOSFET: gate bar, a THREE-SEGMENT broken channel (that break
  // is what says "enhancement", i.e. off with no gate drive), drain and source
  // rails, and a body lead tied to the SOURCE -- not the drain, which is how
  // this was first drawn. The body arrow points into the channel for N and out
  // of it for P, and is the only difference between the two.
  nmos:          { paths: ['M -30 0 L -16 0', 'M -16 -11 L -16 11',
    { d: 'M -9 -12 L -9 -5 M -9 -3 L -9 3 M -9 5 L -9 12', w: 1.8 },
    'M -9 -9 L 10 -9 L 10 -20', 'M -9 9 L 10 9 L 10 20', 'M -1 0 L 10 0 L 10 9',
    { d: 'M -9 0 L -1 -4 L -1 4 Z', fill: 'currentColor' }],
    circles: [{ cx: 0, cy: 0, r: 16 }] },
  pmos:          { paths: ['M -30 0 L -16 0', 'M -16 -11 L -16 11',
    { d: 'M -9 -12 L -9 -5 M -9 -3 L -9 3 M -9 5 L -9 12', w: 1.8 },
    'M -9 -9 L 10 -9 L 10 -20', 'M -9 9 L 10 9 L 10 20', 'M -1 0 L 10 0 L 10 9',
    { d: 'M -1 0 L -9 -4 L -9 4 Z', fill: 'currentColor' }],
    circles: [{ cx: 0, cy: 0, r: 16 }] },
  // Bipolars. Base bar, collector up, emitter down -- and an ARROWHEAD on the
  // emitter, which is the only thing distinguishing the two. Both kinds drew
  // the identical shape until it was added, so a schematic could not say
  // whether it held an NPN or a PNP.
  npn:           { paths: ['M -30 0 L -6 0 M -6 -9 L -6 9', 'M -6 -3 L 8 -10 L 8 -18 M -6 3 L 8 10 L 8 18',
    { d: 'M 3 5 L 8 10 L 2 11 Z', fill: 'currentColor' }],
    circles: [{ cx: 0, cy: 0, r: 13 }] },
  pnp:           { paths: ['M -30 0 L -6 0 M -6 -9 L -6 9', 'M -6 -3 L 8 -10 L 8 -18 M -6 3 L 8 10 L 8 18',
    { d: 'M -1 2 L -6 3 L 0 8 Z', fill: 'currentColor' }],
    circles: [{ cx: 0, cy: 0, r: 13 }] },
  seven_segment: sevenSeg(1),
  seven_seg_3:   sevenSeg(3),
  seven_seg_4:   sevenSeg(4),
  // Crystal: the piezo element between two plates. Iconic enough that a box
  // would be a real loss of legibility.
  crystal:       { paths: ['M -30 0 L -10 0 M 10 0 L 30 0',
    'M -10 -10 L -10 10 M 10 -10 L 10 10', 'M -4 -12 L -4 12 L 4 12 L 4 -12 Z'] },
  // header has no fixed geometry -- shapeFor builds it from params.pins.
  header:        headerSym(2),
  opamp:         { paths: ['M -14 -14 L -14 14 L 16 0 Z', 'M -30 -7 L -14 -7 M -30 7 L -14 7 M 16 0 L 30 0'],
    texts: [{ x: -10, y: -3, s: '−', size: 8 }, { x: -10, y: 10, s: '+', size: 8 }] },
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

/**
 * Kinds that are the SAME symbol under another catalog name.
 *
 * Kept separate from SYMBOLS so the alias is visible as an alias: a reader can
 * see that a tip120 is drawn as an NPN because it IS one (a darlington pair in
 * one package), rather than finding a second copy of the transistor artwork
 * and wondering which is authoritative.
 */
export const ALIASES = {
  battery_aa: 'battery',
  battery_9v: 'battery',
  coin_cell: 'battery',
  mosfet: 'nmos',
  tip120: 'npn',       // darlington NPN
  transistor: 'npn',
  lm358: 'opamp',      // dual op-amp; one triangle per used section
  lm324: 'opamp',
  speaker: 'buzzer',
  electrolytic: 'polarized_cap',
  cap_pol: 'polarized_cap',
  capacitor_pol: 'polarized_cap',
  pot: 'potentiometer',
  trimpot: 'potentiometer',
  photoresistor: 'ldr',
  thermistor: 'ntc',
  toggle_switch: 'slide_switch',
  seven_seg: 'seven_segment',
  pin_header: 'header',
  connector: 'header',
  jst: 'header',
  resonator: 'crystal',
  xtal: 'crystal',
  seven_seg_1: 'seven_segment',
  spdt_switch: 'slide_switch',
};

/**
 * The shape to draw for a kind, or null to fall back to the generic IC box.
 *
 * Both renderers go through here so neither can quietly acquire artwork the
 * other lacks.
 *
 * @param {string} kind
 * @param {Record<string, any>} [params]
 * @returns {Shape|null}
 */
export function shapeFor(kind, params = {}) {
  const resolved = ALIASES[kind] || kind;
  const s = SYMBOLS[resolved];
  if (!s) return null;
  // An AC source is a circle with a sine, not a cell stack -- same kind, and
  // the only place a param changes which symbol is correct.
  // A header's height is its pin count, so it is the one symbol built per
  // instance rather than looked up.
  if (resolved === 'header') {
    const n = Number(params.pins) || (Array.isArray(params.terminals) ? params.terminals.length : 2);
    return headerSym(Math.max(1, Math.min(n, 40)));
  }
  if (resolved === 'vsource' && params.wave && params.wave !== 'dc') {
    return {
      paths: ['M -30 0 L -12 0 M 12 0 L 30 0', { d: 'M -6 0 Q -3 -6 0 0 T 6 0', w: 1.2 }],
      circles: [{ cx: 0, cy: 0, r: 12 }],
      value: 'volts',
    };
  }
  return s;
}

/** Kinds with dedicated artwork; everything else gets the generic IC box. */
export const DRAWN_KINDS = [...Object.keys(SYMBOLS), ...Object.keys(ALIASES)];
