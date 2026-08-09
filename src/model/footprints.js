/**
 * Breadboard footprints — which holes a part's leads occupy.
 *
 * Each entry maps terminal names to offsets from a reference hole.
 * dRow is row offset (0 = same row), dCol is column offset.
 * For gutter-straddling parts (DIP), reference is in the top block
 * and leads span to the bottom block (row offset 5 = crosses gutter).
 *
 * Row mapping: a=0 b=1 c=2 d=3 e=4 [gutter] f=5 g=6 h=7 i=8 j=9
 */

const TOP_ROWS = ['a', 'b', 'c', 'd', 'e'];
const BOTTOM_ROWS = ['f', 'g', 'h', 'i', 'j'];

/**
 * @typedef {object} Footprint
 * @property {string} refTerminal — terminal placed at the reference hole
 * @property {Record<string, {dRow: number, dCol: number}>} leads
 * @property {boolean} [straddlesGutter]
 */

/** @type {Record<string, Footprint>} */
export const FOOTPRINTS = {
  // Single-lead power taps: one leg into a strip (or rail) is how a real
  // supply wire lands on a board.
  vcc: {
    refTerminal: 'vcc',
    leads: { vcc: { dRow: 0, dCol: 0 } },
  },
  gnd: {
    refTerminal: 'gnd',
    leads: { gnd: { dRow: 0, dCol: 0 } },
  },
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
  },
  buzzer: {
    refTerminal: 'a',
    leads: { a: { dRow: 0, dCol: 0 }, b: { dRow: 0, dCol: 2 } },
  },
  seven_segment: {
    refTerminal: 'a',
    straddlesGutter: true,
    leads: { a: { dRow: 0, dCol: 0 }, b: { dRow: 5, dCol: 0 } },
  },
  ir_receiver: {
    refTerminal: 'out',
    leads: { out: { dRow: 0, dCol: 0 }, vcc: { dRow: 0, dCol: 1 }, gnd: { dRow: 0, dCol: 2 } },
  },
  temp_sensor: {
    refTerminal: 'dq',
    leads: { dq: { dRow: 0, dCol: 0 }, vcc: { dRow: 0, dCol: 1 }, gnd: { dRow: 0, dCol: 2 } },
  },
  eeprom: {
    refTerminal: 'sda',
    straddlesGutter: true,
    leads: { sda: { dRow: 0, dCol: 0 }, scl: { dRow: 5, dCol: 0 } },
  },
  shift_register: {
    refTerminal: 'data',
    straddlesGutter: true,
    leads: { data: { dRow: 0, dCol: 0 }, clock: { dRow: 0, dCol: 1 }, latch: { dRow: 5, dCol: 0 } },
  },
  diode: {
    refTerminal: 'anode',
    leads: { anode: { dRow: 0, dCol: 0 }, cathode: { dRow: 0, dCol: 2 } },
  },
  switch: {
    refTerminal: 'a',
    leads: { a: { dRow: 0, dCol: 0 }, b: { dRow: 0, dCol: 3 } },
  },
  led_matrix: {
    refTerminal: 'a',
    straddlesGutter: true,
    leads: { a: { dRow: 0, dCol: 0 }, b: { dRow: 5, dCol: 0 } },
  },
  char_lcd: {
    refTerminal: 'rs',
    leads: {
      rs: { dRow: 0, dCol: 0 }, e: { dRow: 0, dCol: 1 },
      d4: { dRow: 0, dCol: 2 }, d5: { dRow: 0, dCol: 3 },
      d6: { dRow: 0, dCol: 4 }, d7: { dRow: 0, dCol: 5 },
    },
  },
  npn: { refTerminal: 'emitter', leads: { emitter: { dRow: 0, dCol: 0 }, base: { dRow: 0, dCol: 1 }, collector: { dRow: 0, dCol: 2 } } },
  pnp: { refTerminal: 'emitter', leads: { emitter: { dRow: 0, dCol: 0 }, base: { dRow: 0, dCol: 1 }, collector: { dRow: 0, dCol: 2 } } },
  nmos: { refTerminal: 'source', leads: { source: { dRow: 0, dCol: 0 }, gate: { dRow: 0, dCol: 1 }, drain: { dRow: 0, dCol: 2 } } },
  pmos: { refTerminal: 'source', leads: { source: { dRow: 0, dCol: 0 }, gate: { dRow: 0, dCol: 1 }, drain: { dRow: 0, dCol: 2 } } },
  opamp: {
    refTerminal: 'inn',
    straddlesGutter: true,
    leads: { inn: { dRow: 0, dCol: 0 }, inp: { dRow: 0, dCol: 1 }, out: { dRow: 5, dCol: 0 } },
  },
  '555': {
    refTerminal: 'gnd',
    straddlesGutter: true,
    leads: {
      gnd: { dRow: 0, dCol: 0 }, trig: { dRow: 0, dCol: 1 }, out: { dRow: 0, dCol: 2 }, reset: { dRow: 0, dCol: 3 },
      ctrl: { dRow: 5, dCol: 3 }, thr: { dRow: 5, dCol: 2 }, dis: { dRow: 5, dCol: 1 }, vcc: { dRow: 5, dCol: 0 },
    },
  },
  ldr: { refTerminal: 'a', leads: { a: { dRow: 0, dCol: 0 }, b: { dRow: 0, dCol: 2 } } },
  ntc: { refTerminal: 'a', leads: { a: { dRow: 0, dCol: 0 }, b: { dRow: 0, dCol: 1 } } },
  relay: { refTerminal: 'coil_a', leads: { coil_a: { dRow: 0, dCol: 0 }, coil_b: { dRow: 0, dCol: 1 }, no: { dRow: 0, dCol: 3 }, com: { dRow: 0, dCol: 4 }, nc: { dRow: 0, dCol: 5 } } },
  dc_motor: { refTerminal: 'a', leads: { a: { dRow: 0, dCol: 0 }, b: { dRow: 0, dCol: 2 } } },
  servo: { refTerminal: 'signal', leads: { signal: { dRow: 0, dCol: 0 }, vcc: { dRow: 0, dCol: 1 }, gnd: { dRow: 0, dCol: 2 } } },
  rgb_led: { refTerminal: 'r_anode', leads: { r_anode: { dRow: 0, dCol: 0 }, cathode: { dRow: 0, dCol: 1 }, g_anode: { dRow: 0, dCol: 2 }, b_anode: { dRow: 0, dCol: 3 } } },
  zener: { refTerminal: 'anode', leads: { anode: { dRow: 0, dCol: 0 }, cathode: { dRow: 0, dCol: 2 } } },
  inductor: { refTerminal: 'a', leads: { a: { dRow: 0, dCol: 0 }, b: { dRow: 0, dCol: 3 } } },
  // New tier-1 parts
  photodiode: { refTerminal: 'anode', leads: { anode: { dRow: 0, dCol: 0 }, cathode: { dRow: 0, dCol: 1 } } },
  solar_cell: { refTerminal: 'pos', leads: { pos: { dRow: 0, dCol: 0 }, neg: { dRow: 0, dCol: 3 } } },
  light_bulb: { refTerminal: 'a', leads: { a: { dRow: 0, dCol: 0 }, b: { dRow: 0, dCol: 2 } } },
  vibration_motor: { refTerminal: 'a', leads: { a: { dRow: 0, dCol: 0 }, b: { dRow: 0, dCol: 1 } } },
  gearmotor: { refTerminal: 'a', leads: { a: { dRow: 0, dCol: 0 }, b: { dRow: 0, dCol: 2 } } },
  motor_encoder: { refTerminal: 'a', leads: { a: { dRow: 0, dCol: 0 }, b: { dRow: 0, dCol: 1 }, enc_a: { dRow: 0, dCol: 3 }, enc_b: { dRow: 0, dCol: 4 } } },
  tilt_sensor: { refTerminal: 'a', leads: { a: { dRow: 0, dCol: 0 }, b: { dRow: 0, dCol: 1 } } },
  slide_switch: { refTerminal: 'a', leads: { a: { dRow: 0, dCol: 0 }, common: { dRow: 0, dCol: 1 }, b: { dRow: 0, dCol: 2 } } },
  tip120: { refTerminal: 'emitter', leads: { emitter: { dRow: 0, dCol: 0 }, base: { dRow: 0, dCol: 1 }, collector: { dRow: 0, dCol: 2 } } },
  // 3-pin sensors (TO-92 or module)
  soil_moisture: { refTerminal: 'vcc', leads: { vcc: { dRow: 0, dCol: 0 }, gnd: { dRow: 0, dCol: 1 }, sig: { dRow: 0, dCol: 2 } } },
  pir_sensor: { refTerminal: 'vcc', leads: { vcc: { dRow: 0, dCol: 0 }, out: { dRow: 0, dCol: 1 }, gnd: { dRow: 0, dCol: 2 } } },
  tmp36: { refTerminal: 'vcc', leads: { vcc: { dRow: 0, dCol: 0 }, vout: { dRow: 0, dCol: 1 }, gnd: { dRow: 0, dCol: 2 } } },
  ir_remote: { refTerminal: 'vcc', leads: { vcc: { dRow: 0, dCol: 0 }, gnd: { dRow: 0, dCol: 1 }, signal: { dRow: 0, dCol: 2 } } },
  clock_display: { refTerminal: 'clk', leads: { clk: { dRow: 0, dCol: 0 }, dio: { dRow: 0, dCol: 1 }, vcc: { dRow: 0, dCol: 2 }, gnd: { dRow: 0, dCol: 3 } } },
  neopixel: { refTerminal: 'din', leads: { din: { dRow: 0, dCol: 0 }, vcc: { dRow: 0, dCol: 1 }, gnd: { dRow: 0, dCol: 2 }, dout: { dRow: 0, dCol: 3 } } },
  char_lcd_i2c: { refTerminal: 'gnd', leads: { gnd: { dRow: 0, dCol: 0 }, vcc: { dRow: 0, dCol: 1 }, sda: { dRow: 0, dCol: 2 }, scl: { dRow: 0, dCol: 3 } } },
  // 4-pin sensors/modules
  ultrasonic: { refTerminal: 'vcc', leads: { vcc: { dRow: 0, dCol: 0 }, trig: { dRow: 0, dCol: 1 }, echo: { dRow: 0, dCol: 2 }, gnd: { dRow: 0, dCol: 3 } } },
  gas_sensor: { refTerminal: 'vcc', leads: { vcc: { dRow: 0, dCol: 0 }, gnd: { dRow: 0, dCol: 1 }, dout: { dRow: 0, dCol: 2 }, aout: { dRow: 0, dCol: 3 } } },
  // DIP ICs (straddle gutter)
  l293d: {
    refTerminal: 'en1', straddlesGutter: true,
    leads: { en1: { dRow: 0, dCol: 0 }, in1: { dRow: 0, dCol: 1 }, out1: { dRow: 0, dCol: 2 }, gnd1: { dRow: 0, dCol: 3 }, gnd2: { dRow: 0, dCol: 4 }, out2: { dRow: 0, dCol: 5 }, in2: { dRow: 0, dCol: 6 }, en2: { dRow: 0, dCol: 7 },
      vs: { dRow: 5, dCol: 7 }, vcc: { dRow: 5, dCol: 0 } },
  },
  relay_dpdt: { refTerminal: 'coil_a', leads: { coil_a: { dRow: 0, dCol: 0 }, coil_b: { dRow: 0, dCol: 1 }, no1: { dRow: 0, dCol: 3 }, com1: { dRow: 0, dCol: 4 }, nc1: { dRow: 0, dCol: 5 }, no2: { dRow: 0, dCol: 7 }, com2: { dRow: 0, dCol: 8 }, nc2: { dRow: 0, dCol: 9 } } },
  pcf8574: {
    refTerminal: 'p0', straddlesGutter: true,
    leads: { p0: { dRow: 0, dCol: 0 }, p1: { dRow: 0, dCol: 1 }, p2: { dRow: 0, dCol: 2 }, p3: { dRow: 0, dCol: 3 }, gnd: { dRow: 0, dCol: 4 }, vcc: { dRow: 0, dCol: 5 }, sda: { dRow: 0, dCol: 6 }, scl: { dRow: 0, dCol: 7 },
      p4: { dRow: 5, dCol: 7 }, p5: { dRow: 5, dCol: 6 }, p6: { dRow: 5, dCol: 5 }, p7: { dRow: 5, dCol: 4 } },
  },
  header: { refTerminal: 'p1', leads: { p1: { dRow: 0, dCol: 0 }, p2: { dRow: 0, dCol: 1 }, p3: { dRow: 0, dCol: 2 }, p4: { dRow: 0, dCol: 3 }, p5: { dRow: 0, dCol: 4 }, p6: { dRow: 0, dCol: 5 }, p7: { dRow: 0, dCol: 6 }, p8: { dRow: 0, dCol: 7 } } },
  usb_a: { refTerminal: 'vcc', leads: { vcc: { dRow: 0, dCol: 0 }, d_minus: { dRow: 0, dCol: 1 }, d_plus: { dRow: 0, dCol: 2 }, gnd: { dRow: 0, dCol: 3 } } },
  keypad: {
    refTerminal: 'r1', straddlesGutter: true,
    leads: { r1: { dRow: 0, dCol: 0 }, r2: { dRow: 0, dCol: 1 }, r3: { dRow: 0, dCol: 2 }, r4: { dRow: 0, dCol: 3 },
      c1: { dRow: 5, dCol: 0 }, c2: { dRow: 5, dCol: 1 }, c3: { dRow: 5, dCol: 2 }, c4: { dRow: 5, dCol: 3 } },
  },
  dip_switch: { refTerminal: 's1_a', leads: { s1_a: { dRow: 0, dCol: 0 }, s1_b: { dRow: 0, dCol: 1 } } },
};

/**
 * Compute a leadMap (terminal → hole id) from a reference hole and footprint.
 *
 * @param {Footprint} footprint
 * @param {string} refHole — the hole the reference terminal sits on (e.g. "e5")
 * @returns {Record<string, string>} terminal → hole id
 */
/**
 * Rotate a footprint's lead offsets by quarter turns on the hole lattice.
 * 90° clockwise maps (dRow, dCol) → (dCol, −dRow) — a horizontal resistor
 * stands up along its column. Pure; computeLeadMap decides whether the
 * rotated holes actually exist from a given reference.
 * @param {object} footprint @param {number} quarterTurns 0..3
 */
export function rotateFootprint(footprint, quarterTurns) {
  const q = ((quarterTurns % 4) + 4) % 4;
  const rot = (r, c) => {
    for (let i = 0; i < q; i++) { const t = r; r = c; c = -t; }
    return { dRow: r, dCol: c };
  };
  const leads = {};
  for (const [terminal, o] of Object.entries(footprint.leads)) {
    leads[terminal] = rot(o.dRow, o.dCol);
  }
  return { ...footprint, leads };
}

export function computeLeadMap(footprint, refHole) {
  const refRow = refHole[0];
  const refCol = Number(refHole.slice(1));

  // Determine the row block for offset mapping
  const topIdx = TOP_ROWS.indexOf(refRow);
  const botIdx = BOTTOM_ROWS.indexOf(refRow);
  if (topIdx < 0 && botIdx < 0) {
    throw new Error(`Reference hole "${refHole}" is on a rail — parts go on terminal rows only`);
  }

  const leadMap = {};
  for (const [terminal, offset] of Object.entries(footprint.leads)) {
    let rowIdx, col;
    if (topIdx >= 0) {
      rowIdx = topIdx + offset.dRow;
    } else {
      rowIdx = botIdx + 5 + offset.dRow; // 5 = gutter offset in unified index
    }
    col = refCol + offset.dCol;

    let row;
    if (rowIdx < 5) row = TOP_ROWS[rowIdx];
    else row = BOTTOM_ROWS[rowIdx - 5];

    if (!row) throw new Error(`Footprint offset dRow=${offset.dRow} goes off the board from "${refHole}"`);
    leadMap[terminal] = `${row}${col}`;
  }
  return leadMap;
}
