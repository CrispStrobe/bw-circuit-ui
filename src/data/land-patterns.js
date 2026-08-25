/**
 * Land patterns: the physical pad geometry of a KIND, hand-authored.
 *
 * NOT `src/model/footprints.js` — that file is breadboard hole-spans. A land
 * pattern is what the fab drills and plates: pad positions, sizes, drills,
 * courtyard, silk, and the TERMINAL MAP.
 *
 * The terminal map is the reason this layer exists (plan §5 Phase 1): it
 * states which pads are one electrical terminal. `button` maps a → pads
 * 1,3 and b → pads 2,4 — pads 4.5 mm apart on one side of a 6x6 tact
 * switch are one node inside the part, and that fact is what lets the DRC
 * catch two nets landing on one terminal. It is stated by the PART, never
 * guessed from geometry.
 *
 * Provenance discipline (THIRD-PARTY.md "format knowledge, not code"): every
 * dimension below is either a datasheet/IPC fact (pitch, body size, drill)
 * or was MEASURED on a real EasyEDA board this session (the 6x6 tact:
 * pads at (±3.25, ±2.25) mm, 1.0 mm drill, measured on a 17-switch board,
 * TS-6645 series). No third-party footprint library was copied or
 * converted — KiCad's libraries are CC-BY-SA and stay out (plan §8).
 *
 * Geometry conventions: mm, Y up, origin at the pattern centre. `terminal`
 * on each pad is a name from `terminalsForKind(kind)`. Every terminal must
 * be covered by at least one pad and every pad must name a real terminal —
 * `validateLandPattern` enforces both as HARD errors (plan §6 Phase 1).
 *
 * @module
 */

/** Round through-hole pad. */
const tht = (num, terminal, x, y, { pad = 1.7, drill = 1.0 } = {}) =>
  ({ num: String(num), terminal, x, y, shape: 'circle', w: pad, h: pad, drill });

/** SMD rect pad. */
const smd = (num, terminal, x, y, w, h) =>
  ({ num: String(num), terminal, x, y, shape: 'rect', w, h, drill: 0 });

/** 1xN pin header on 2.54 mm pitch, terminals p1..pN, pad 1 leftmost. */
function header1xN(n) {
  const pads = [];
  for (let i = 0; i < n; i++) {
    pads.push(tht(i + 1, `p${i + 1}`, (i - (n - 1) / 2) * 2.54, 0));
  }
  return {
    description: `1x${n} pin header, 2.54 mm pitch`,
    // The engine's header model has eight terminals; a shorter header
    // covers a prefix of them on purpose (partial relaxes coverage only).
    partial: n < 8,
    pads,
    courtyard: { w: n * 2.54 + 0.5, h: 3.0 },
    silk: [{ kind: 'rect', x: -(n * 2.54) / 2, y: -1.27, w: n * 2.54, h: 2.54 }],
    // Pin 1 is legend-worthy: the no-legend DRC rule wants connectors to
    // say which end is which (plan §1: reversed rails kill the module).
    pin1: { x: -((n - 1) / 2) * 2.54, y: 0 },
  };
}

/**
 * kind -> variant -> pattern. The FIRST variant listed is the default.
 */
const PAD_TERMINALS_PICO = [
  'gp0', 'gp1', 'gnd_1', 'gp2', 'gp3', 'gp4', 'gp5', 'gnd_2', 'gp6', 'gp7',
  'gp8', 'gp9', 'gnd_3', 'gp10', 'gp11', 'gp12', 'gp13', 'gnd_4', 'gp14', 'gp15',
  'gp16', 'gp17', 'gnd_7', 'gp18', 'gp19', 'gp20', 'gp21', 'gnd_6', 'gp22', 'run',
  'gp26', 'gp27', 'agnd', 'gp28', 'adc_vref', '3v3', '3v3_en', 'gnd_5', 'vsys', 'vbus',
];

export const LAND_PATTERNS = {
  resistor: {
    'axial-0.4': {
      description: 'axial THT, DIN 0207 body, 10.16 mm pitch',
      pads: [tht(1, 'a', -5.08, 0, { pad: 1.6, drill: 0.8 }), tht(2, 'b', 5.08, 0, { pad: 1.6, drill: 0.8 })],
      courtyard: { w: 11.5, h: 2.8 },
      silk: [{ kind: 'rect', x: -3.15, y: -1.25, w: 6.3, h: 2.5 }],
    },
    '0603': {
      description: 'SMD 0603 (1608 metric)',
      pads: [smd(1, 'a', -0.775, 0, 0.9, 0.95), smd(2, 'b', 0.775, 0, 0.9, 0.95)],
      courtyard: { w: 2.8, h: 1.4 },
      silk: [],
    },
  },
  capacitor: {
    'radial-2.5': {
      description: 'radial THT, 2.5 mm pitch',
      pads: [tht(1, 'a', -1.25, 0, { pad: 1.6, drill: 0.8 }), tht(2, 'b', 1.25, 0, { pad: 1.6, drill: 0.8 })],
      courtyard: { w: 5.5, h: 5.5 },
      silk: [{ kind: 'circle', x: 0, y: 0, r: 2.5 }],
    },
    '0603': {
      description: 'SMD 0603 (1608 metric)',
      pads: [smd(1, 'a', -0.775, 0, 0.9, 0.95), smd(2, 'b', 0.775, 0, 0.9, 0.95)],
      courtyard: { w: 2.8, h: 1.4 },
      silk: [],
    },
  },
  led: {
    'tht-5mm': {
      description: '5 mm radial LED, 2.54 mm pitch, pad 1 = anode (long leg)',
      pads: [tht(1, 'anode', -1.27, 0, { pad: 1.8, drill: 0.9 }), tht(2, 'cathode', 1.27, 0, { pad: 1.8, drill: 0.9 })],
      courtyard: { w: 6.5, h: 6.5 },
      silk: [{ kind: 'circle', x: 0, y: 0, r: 2.75 }],
    },
  },
  diode: {
    'do-41': {
      // KiCad and EasyEDA both put the band (cathode) on pad 1 for DO-41;
      // getting this backwards flips every rectifier on the board.
      description: 'axial THT DO-41, 10.16 mm pitch, pad 1 = cathode (band)',
      pads: [tht(1, 'cathode', -5.08, 0, { pad: 1.8, drill: 1.0 }), tht(2, 'anode', 5.08, 0, { pad: 1.8, drill: 1.0 })],
      courtyard: { w: 11.5, h: 3.2 },
      silk: [{ kind: 'rect', x: -2.6, y: -1.35, w: 5.2, h: 2.7 }],
    },
  },
  button: {
    'tact-6x6': {
      // MEASURED on a real board (TS-6645DD6X6X6.0, 2026-08-25): pads at
      // (±3.25, ±2.25), 1.7 mm pad, 1.0 mm drill. Pads 4.5 mm apart on one
      // SIDE (1&3 left, 2&4 right) are one internal node; the switch closes
      // left to right. THE terminal map of plan §1.
      description: '6x6 mm THT tact switch (TS-6645 class)',
      pads: [
        tht(1, 'a', -3.25, 2.25), tht(2, 'b', 3.25, 2.25),
        tht(3, 'a', -3.25, -2.25), tht(4, 'b', 3.25, -2.25),
      ],
      courtyard: { w: 7.5, h: 7.5 },
      silk: [{ kind: 'rect', x: -3, y: -3, w: 6, h: 6 }, { kind: 'circle', x: 0, y: 0, r: 1.75 }],
    },
    'tact-6x6-lcsc': {
      // MEASURED on a published board (OpenCore0, SW-TH_4P-L6.0-W6.0-
      // P4.50-LS6.5, 2026-08-25): same 6x6 body, but the LCSC numbering
      // pairs ACROSS the 6.5 mm lead span — pads 1&2 (top row) are one
      // internal node, 3&4 the other; its own netting proves it (GND on
      // 1,2 / signal on 3,4 across sixteen switches). Both mechanical
      // classes exist; the terminal map belongs to the FOOTPRINT NAME,
      // never to "6 mm tact" in general.
      description: '6x6 mm THT tact switch, LCSC SW-TH_4P numbering',
      pads: [
        tht(1, 'a', -3.25, 2.25), tht(2, 'a', 3.25, 2.25),
        tht(3, 'b', -3.25, -2.25), tht(4, 'b', 3.25, -2.25),
      ],
      courtyard: { w: 7.5, h: 7.5 },
      silk: [{ kind: 'rect', x: -3, y: -3, w: 6, h: 6 }, { kind: 'circle', x: 0, y: 0, r: 1.75 }],
    },
  },
  slide_switch: {
    'ss-12d10': {
      // MEASURED on the same live board (SW-TH_SS-12D10L9, 2026-08-25):
      // three pads in a row, 4.7 mm pitch, 2.5 mm pad, 1.7 mm drill.
      // Pin 2 is the centre pole; 1 and 3 are the throws.
      description: 'SS-12D10 SPDT slide switch, THT, 4.7 mm pitch',
      pads: [
        tht(1, 'a', -4.7, 0, { pad: 2.5, drill: 1.7 }),
        tht(2, 'com', 0, 0, { pad: 2.5, drill: 1.7 }),
        tht(3, 'b', 4.7, 0, { pad: 2.5, drill: 1.7 }),
      ],
      courtyard: { w: 13.0, h: 7.0 },
      silk: [{ kind: 'rect', x: -6.35, y: -3, w: 12.7, h: 6 }],
    },
  },
  battery_aa: {
    'bh-aa': {
      // MEASURED on the live board (BAT-TH_BH-AA-A1AJ029, 2026-08-25):
      // two pads on the long axis, 15 mm apart, 1.6 mm pad, 1.0 mm drill.
      // Pad 1 carried GND there — the spring end is the negative pole.
      description: 'BH-AA single AA battery holder, THT, 15 mm pin span',
      pads: [
        tht(1, 'neg', 0, 7.5, { pad: 1.6, drill: 1.0 }),
        tht(2, 'pos', 0, -7.5, { pad: 1.6, drill: 1.0 }),
      ],
      courtyard: { w: 18, h: 58 },
      silk: [{ kind: 'rect', x: -8.5, y: -28.5, w: 17, h: 57 }],
    },
  },
  ssd1306: {
    'module-4p': {
      // The 0.96" OLED module on its 1x4 2.54 mm header. Pin ORDER was
      // measured on the live pair (the pairing diff matched pad 1 to the
      // schematic's sda, 2 to scl, 3 to gnd, 4 to vcc), not assumed —
      // module vendors ship both GND-first and VCC-first pinouts.
      description: '0.96 inch OLED module header, 1x4, 2.54 mm pitch',
      pads: [
        tht(1, 'sda', -3.81, 0), tht(2, 'scl', -1.27, 0),
        tht(3, 'gnd', 1.27, 0), tht(4, 'vcc', 3.81, 0),
      ],
      partial: true, // the kind models the panel too; the header is 4 pins
      courtyard: { w: 28, h: 28 },
      silk: [{ kind: 'rect', x: -13.5, y: -13, w: 27, h: 26 }],
      pin1: { x: -3.81, y: 0 },
    },
  },
  pi_pico: {
    'module-dip40': (() => {
      // The Pico as a through-hole module: two 1x20 rows, 2.54 mm pitch,
      // rows 17.78 mm apart (7 x 2.54 — the official carrier footprint).
      // Pin 1 top-left, 1..20 down the left, 21..40 up the right, matching
      // PAD_TERMINALS.pi_pico. Board datasheet facts, no library copied.
      const T = PAD_TERMINALS_PICO;
      const pads = [];
      for (let i = 0; i < 20; i++) {
        pads.push(tht(i + 1, T[i], -8.89, 24.13 - i * 2.54, { pad: 1.7, drill: 1.0 }));
      }
      for (let i = 20; i < 40; i++) {
        pads.push(tht(i + 1, T[i], 8.89, -24.13 + (i - 20) * 2.54, { pad: 1.7, drill: 1.0 }));
      }
      return {
        description: 'Raspberry Pi Pico module, 2x20 THT, 2.54 mm pitch',
        pads,
        courtyard: { w: 22, h: 52 },
        silk: [{ kind: 'rect', x: -10.5, y: -25.5, w: 21, h: 51 }],
        pin1: { x: -8.89, y: 24.13 },
      };
    })(),
  },
  stm32f030: {
    'tssop-20': (() => {
      // TSSOP-20: 0.65 mm pitch, 6.4 mm lead span (IPC-7351 nominal lands
      // 0.45 x 1.35 at x = ±2.85). Terminal names in physical pin order
      // from the engine's STM32F030_TERMINALS (bw-board 7de7f8a; ST DS9773
      // Table 11): vss/vdd spelled gnd/vcc per the bare-chip convention,
      // vcc2 = VDDA. Pins 1-10 down the left, 20-11 down the right.
      const T = ['boot0', 'pf0', 'pf1', 'nrst', 'vcc2', 'pa0', 'pa1', 'pa2', 'pa3', 'pa4',
        'pa5', 'pa6', 'pa7', 'pb1', 'gnd', 'vcc', 'pa9', 'pa10', 'pa13', 'pa14'];
      const pads = [];
      for (let i = 0; i < 10; i++) {
        pads.push(smd(i + 1, T[i], -2.85, 2.925 - i * 0.65, 1.35, 0.45));
      }
      for (let i = 10; i < 20; i++) {
        pads.push(smd(i + 1, T[i], 2.85, -2.925 + (i - 10) * 0.65, 1.35, 0.45));
      }
      return {
        description: 'TSSOP-20, 0.65 mm pitch (STM32F030F4P6)',
        pads,
        courtyard: { w: 7.8, h: 7.0 },
        silk: [{ kind: 'rect', x: -2.2, y: -3.25, w: 4.4, h: 6.5 }],
        pin1: { x: -2.85, y: 2.925 },
      };
    })(),
  },
  header: {
    '1x2': header1xN(2),
    '1x3': header1xN(3),
    '1x4': header1xN(4),
    '1x5': header1xN(5),
    '1x6': header1xN(6),
    '1x8': header1xN(8),
  },
};

/**
 * Package-string recognition for the board→circuit lift (plan Phase 0.5b).
 * Matched in order; first hit wins. `variant: null` means "recognised the
 * kind but no land pattern yet" — the lift may still name it.
 */
/**
 * Pad-number → terminal tables for kinds that are MODULES rather than
 * land-pattern parts: their wiring map is pin-order knowledge, not pad
 * geometry. The pi_pico array is the header order of the official pinout
 * (pin 1 = GP0 … pin 40 = VBUS side), matching src/parts-data/pi_pico.json,
 * whose terminals are listed in exactly this order. battery_aa follows the
 * BH-AA holder measured on the live board: pad 1 carried GND.
 */

export const PAD_TERMINALS = {
  pi_pico: PAD_TERMINALS_PICO,
  battery_aa: { 1: 'neg', 2: 'pos' },
};

export const PACKAGE_KIND_RULES = [
  // Order matters: the live board's TS-6645 carries the LCSC prefix TOO
  // (SW-TH_4P-L6.0-W6.0-TS-6645DD6X6X6.0) — the vendor suffix names the
  // measured same-side class, so it must win over the generic prefix.
  { match: /TS-66|SW_PUSH_6mm|SW_Push_6mm/i, kind: 'button', variant: 'tact-6x6' },
  { match: /^SW-TH_4P.*6\.0/i, kind: 'button', variant: 'tact-6x6-lcsc' },
  { match: /^SW-TH_SS-12D|SS-12D10/i, kind: 'slide_switch', variant: 'ss-12d10' },
  // KiCad library spellings recognise too: the lift reads KiCad boards now.
  { match: /^R_AXIAL|^RES-TH|:R_Axial_DIN/i, kind: 'resistor', variant: 'axial-0.4' },
  { match: /^R0603|^RES.*0603|^C0603R/i, kind: 'resistor', variant: '0603' },
  { match: /^C0603|^CAP.*0603/i, kind: 'capacitor', variant: '0603' },
  { match: /^CAP-TH|^C_Disc|RAD-2\.5/i, kind: 'capacitor', variant: 'radial-2.5' },
  { match: /^LED-TH-5|^LED5|^LED_TH|:LED_D5\.0mm/i, kind: 'led', variant: 'tht-5mm' },
  { match: /^DO-41|^DIODE-TH/i, kind: 'diode', variant: 'do-41' },
  { match: /OLED_4P/i, kind: 'ssd1306', variant: 'module-4p' },
  { match: /^HDR-1X4$|PinHeader_1x0?4(?!\d)/i, kind: 'header', variant: '1x4', params: { pins: 4 } },
  { match: /^HDR-1X(\d+)|PinHeader_1x0?(\d+)/i, kind: 'header', variantFromMatch: (m) => `1x${Number(m[1] || m[2])}`, paramsFromMatch: (m) => ({ pins: Number(m[1] || m[2]) }) },
  { match: /STM32F030|TSSOP-?20_L6\.5-W4\.4|^TSSOP-?20$/i, kind: 'stm32f030', variant: 'tssop-20' },
  { match: /RASPBERRY PI PICO/i, kind: 'pi_pico', variant: 'module-dip40' },
  { match: /^BAT-TH/i, kind: 'battery_aa', variant: 'bh-aa' },
];
