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

  // ── Retro bench DIPs ─────────────────────────────────────────
  // Generated from the datasheet-audited sidecars (left column
  // top→bottom = pins 1..N/2 on row e; right column = pins
  // N..N/2+1 on row e; pin 1 bottom-left like the physical chip.
  // These are what lets seat-examples.mjs seat the 6502/Z80
  // benches the way the real machines are built.
  '62256': {refTerminal: 'vcc', straddlesGutter: true, leads: {'a14': {dRow: 5, dCol: 0}, 'a12': {dRow: 5, dCol: 1}, 'a7': {dRow: 5, dCol: 2}, 'a6': {dRow: 5, dCol: 3}, 'a5': {dRow: 5, dCol: 4}, 'a4': {dRow: 5, dCol: 5}, 'a3': {dRow: 5, dCol: 6}, 'a2': {dRow: 5, dCol: 7}, 'a1': {dRow: 5, dCol: 8}, 'a0': {dRow: 5, dCol: 9}, 'd0': {dRow: 5, dCol: 10}, 'd1': {dRow: 5, dCol: 11}, 'd2': {dRow: 5, dCol: 12}, 'gnd': {dRow: 5, dCol: 13}, 'vcc': {dRow: 0, dCol: 0}, 'web': {dRow: 0, dCol: 1}, 'a13': {dRow: 0, dCol: 2}, 'a8': {dRow: 0, dCol: 3}, 'a9': {dRow: 0, dCol: 4}, 'a11': {dRow: 0, dCol: 5}, 'oeb': {dRow: 0, dCol: 6}, 'a10': {dRow: 0, dCol: 7}, 'csb': {dRow: 0, dCol: 8}, 'd7': {dRow: 0, dCol: 9}, 'd6': {dRow: 0, dCol: 10}, 'd5': {dRow: 0, dCol: 11}, 'd4': {dRow: 0, dCol: 12}, 'd3': {dRow: 0, dCol: 13}}},
  w65c02: {refTerminal: 'resb', straddlesGutter: true, leads: {'vpb': {dRow: 5, dCol: 0}, 'rdy': {dRow: 5, dCol: 1}, 'phi1o': {dRow: 5, dCol: 2}, 'irqb': {dRow: 5, dCol: 3}, 'mlb': {dRow: 5, dCol: 4}, 'nmib': {dRow: 5, dCol: 5}, 'sync': {dRow: 5, dCol: 6}, 'vdd': {dRow: 5, dCol: 7}, 'a0': {dRow: 5, dCol: 8}, 'a1': {dRow: 5, dCol: 9}, 'a2': {dRow: 5, dCol: 10}, 'a3': {dRow: 5, dCol: 11}, 'a4': {dRow: 5, dCol: 12}, 'a5': {dRow: 5, dCol: 13}, 'a6': {dRow: 5, dCol: 14}, 'a7': {dRow: 5, dCol: 15}, 'a8': {dRow: 5, dCol: 16}, 'a9': {dRow: 5, dCol: 17}, 'a10': {dRow: 5, dCol: 18}, 'a11': {dRow: 5, dCol: 19}, 'resb': {dRow: 0, dCol: 0}, 'phi2o': {dRow: 0, dCol: 1}, 'sob': {dRow: 0, dCol: 2}, 'phi2': {dRow: 0, dCol: 3}, 'be': {dRow: 0, dCol: 4}, 'rwb': {dRow: 0, dCol: 6}, 'd0': {dRow: 0, dCol: 7}, 'd1': {dRow: 0, dCol: 8}, 'd2': {dRow: 0, dCol: 9}, 'd3': {dRow: 0, dCol: 10}, 'd4': {dRow: 0, dCol: 11}, 'd5': {dRow: 0, dCol: 12}, 'd6': {dRow: 0, dCol: 13}, 'd7': {dRow: 0, dCol: 14}, 'a15': {dRow: 0, dCol: 15}, 'a14': {dRow: 0, dCol: 16}, 'a13': {dRow: 0, dCol: 17}, 'a12': {dRow: 0, dCol: 18}, 'vss': {dRow: 0, dCol: 19}}},
  z80: {refTerminal: 'a10', straddlesGutter: true, leads: {'a11': {dRow: 5, dCol: 0}, 'a12': {dRow: 5, dCol: 1}, 'a13': {dRow: 5, dCol: 2}, 'a14': {dRow: 5, dCol: 3}, 'a15': {dRow: 5, dCol: 4}, 'clk': {dRow: 5, dCol: 5}, 'd4': {dRow: 5, dCol: 6}, 'd3': {dRow: 5, dCol: 7}, 'd5': {dRow: 5, dCol: 8}, 'd6': {dRow: 5, dCol: 9}, 'vcc': {dRow: 5, dCol: 10}, 'd2': {dRow: 5, dCol: 11}, 'd7': {dRow: 5, dCol: 12}, 'd0': {dRow: 5, dCol: 13}, 'd1': {dRow: 5, dCol: 14}, 'intb': {dRow: 5, dCol: 15}, 'nmib': {dRow: 5, dCol: 16}, 'haltb': {dRow: 5, dCol: 17}, 'mreqb': {dRow: 5, dCol: 18}, 'iorqb': {dRow: 5, dCol: 19}, 'a10': {dRow: 0, dCol: 0}, 'a9': {dRow: 0, dCol: 1}, 'a8': {dRow: 0, dCol: 2}, 'a7': {dRow: 0, dCol: 3}, 'a6': {dRow: 0, dCol: 4}, 'a5': {dRow: 0, dCol: 5}, 'a4': {dRow: 0, dCol: 6}, 'a3': {dRow: 0, dCol: 7}, 'a2': {dRow: 0, dCol: 8}, 'a1': {dRow: 0, dCol: 9}, 'a0': {dRow: 0, dCol: 10}, 'gnd': {dRow: 0, dCol: 11}, 'rfshb': {dRow: 0, dCol: 12}, 'm1b': {dRow: 0, dCol: 13}, 'resetb': {dRow: 0, dCol: 14}, 'busrqb': {dRow: 0, dCol: 15}, 'waitb': {dRow: 0, dCol: 16}, 'busakb': {dRow: 0, dCol: 17}, 'wrb': {dRow: 0, dCol: 18}, 'rdb': {dRow: 0, dCol: 19}}},
  '28c256': {refTerminal: 'vcc', straddlesGutter: true, leads: {'a14': {dRow: 5, dCol: 0}, 'a12': {dRow: 5, dCol: 1}, 'a7': {dRow: 5, dCol: 2}, 'a6': {dRow: 5, dCol: 3}, 'a5': {dRow: 5, dCol: 4}, 'a4': {dRow: 5, dCol: 5}, 'a3': {dRow: 5, dCol: 6}, 'a2': {dRow: 5, dCol: 7}, 'a1': {dRow: 5, dCol: 8}, 'a0': {dRow: 5, dCol: 9}, 'd0': {dRow: 5, dCol: 10}, 'd1': {dRow: 5, dCol: 11}, 'd2': {dRow: 5, dCol: 12}, 'gnd': {dRow: 5, dCol: 13}, 'vcc': {dRow: 0, dCol: 0}, 'web': {dRow: 0, dCol: 1}, 'a13': {dRow: 0, dCol: 2}, 'a8': {dRow: 0, dCol: 3}, 'a9': {dRow: 0, dCol: 4}, 'a11': {dRow: 0, dCol: 5}, 'oeb': {dRow: 0, dCol: 6}, 'a10': {dRow: 0, dCol: 7}, 'ceb': {dRow: 0, dCol: 8}, 'd7': {dRow: 0, dCol: 9}, 'd6': {dRow: 0, dCol: 10}, 'd5': {dRow: 0, dCol: 11}, 'd4': {dRow: 0, dCol: 12}, 'd3': {dRow: 0, dCol: 13}}},
  w65c22: {refTerminal: 'ca1', straddlesGutter: true, leads: {'vss': {dRow: 5, dCol: 0}, 'pa0': {dRow: 5, dCol: 1}, 'pa1': {dRow: 5, dCol: 2}, 'pa2': {dRow: 5, dCol: 3}, 'pa3': {dRow: 5, dCol: 4}, 'pa4': {dRow: 5, dCol: 5}, 'pa5': {dRow: 5, dCol: 6}, 'pa6': {dRow: 5, dCol: 7}, 'pa7': {dRow: 5, dCol: 8}, 'pb0': {dRow: 5, dCol: 9}, 'pb1': {dRow: 5, dCol: 10}, 'pb2': {dRow: 5, dCol: 11}, 'pb3': {dRow: 5, dCol: 12}, 'pb4': {dRow: 5, dCol: 13}, 'pb5': {dRow: 5, dCol: 14}, 'pb6': {dRow: 5, dCol: 15}, 'pb7': {dRow: 5, dCol: 16}, 'cb1': {dRow: 5, dCol: 17}, 'cb2': {dRow: 5, dCol: 18}, 'vdd': {dRow: 5, dCol: 19}, 'ca1': {dRow: 0, dCol: 0}, 'ca2': {dRow: 0, dCol: 1}, 'rs0': {dRow: 0, dCol: 2}, 'rs1': {dRow: 0, dCol: 3}, 'rs2': {dRow: 0, dCol: 4}, 'rs3': {dRow: 0, dCol: 5}, 'resb': {dRow: 0, dCol: 6}, 'd0': {dRow: 0, dCol: 7}, 'd1': {dRow: 0, dCol: 8}, 'd2': {dRow: 0, dCol: 9}, 'd3': {dRow: 0, dCol: 10}, 'd4': {dRow: 0, dCol: 11}, 'd5': {dRow: 0, dCol: 12}, 'd6': {dRow: 0, dCol: 13}, 'd7': {dRow: 0, dCol: 14}, 'phi2': {dRow: 0, dCol: 15}, 'cs1': {dRow: 0, dCol: 16}, 'cs2b': {dRow: 0, dCol: 17}, 'rwb': {dRow: 0, dCol: 18}, 'irqb': {dRow: 0, dCol: 19}}},
  w65c51: {refTerminal: 'vdd', straddlesGutter: true, leads: {'vss': {dRow: 5, dCol: 0}, 'cs0': {dRow: 5, dCol: 1}, 'cs1b': {dRow: 5, dCol: 2}, 'resb': {dRow: 5, dCol: 3}, 'rwb': {dRow: 5, dCol: 4}, 'irqb': {dRow: 5, dCol: 5}, 'phi2': {dRow: 5, dCol: 6}, 'd0': {dRow: 5, dCol: 7}, 'd1': {dRow: 5, dCol: 8}, 'd2': {dRow: 5, dCol: 9}, 'd3': {dRow: 5, dCol: 10}, 'd4': {dRow: 5, dCol: 11}, 'd5': {dRow: 5, dCol: 12}, 'd6': {dRow: 5, dCol: 13}, 'vdd': {dRow: 0, dCol: 0}, 'xtli': {dRow: 0, dCol: 1}, 'xtlo': {dRow: 0, dCol: 2}, 'dcdb': {dRow: 0, dCol: 3}, 'dsrb': {dRow: 0, dCol: 4}, 'rxd': {dRow: 0, dCol: 5}, 'dtrb': {dRow: 0, dCol: 6}, 'ctsb': {dRow: 0, dCol: 7}, 'rtsb': {dRow: 0, dCol: 8}, 'txd': {dRow: 0, dCol: 10}, 'rs1': {dRow: 0, dCol: 11}, 'rs0': {dRow: 0, dCol: 12}, 'd7': {dRow: 0, dCol: 13}}},
  mc6850: {refTerminal: 'ctsb', straddlesGutter: true, leads: {'vss': {dRow: 5, dCol: 0}, 'rxd': {dRow: 5, dCol: 1}, 'rxclk': {dRow: 5, dCol: 2}, 'txclk': {dRow: 5, dCol: 3}, 'rtsb': {dRow: 5, dCol: 4}, 'txd': {dRow: 5, dCol: 5}, 'irqb': {dRow: 5, dCol: 6}, 'cs0': {dRow: 5, dCol: 7}, 'cs2b': {dRow: 5, dCol: 8}, 'cs1': {dRow: 5, dCol: 9}, 'rs': {dRow: 5, dCol: 10}, 'vcc': {dRow: 5, dCol: 11}, 'ctsb': {dRow: 0, dCol: 0}, 'dcdb': {dRow: 0, dCol: 1}, 'd0': {dRow: 0, dCol: 2}, 'd1': {dRow: 0, dCol: 3}, 'd2': {dRow: 0, dCol: 4}, 'd3': {dRow: 0, dCol: 5}, 'd4': {dRow: 0, dCol: 6}, 'd5': {dRow: 0, dCol: 7}, 'd6': {dRow: 0, dCol: 8}, 'd7': {dRow: 0, dCol: 9}, 'e': {dRow: 0, dCol: 10}, 'rw': {dRow: 0, dCol: 11}}},
  '74hc00': {refTerminal: 'vcc', straddlesGutter: true, leads: {'1a': {dRow: 5, dCol: 0}, '1b': {dRow: 5, dCol: 1}, '1y': {dRow: 5, dCol: 2}, '2a': {dRow: 5, dCol: 3}, '2b': {dRow: 5, dCol: 4}, '2y': {dRow: 5, dCol: 5}, 'gnd': {dRow: 5, dCol: 6}, 'vcc': {dRow: 0, dCol: 0}, '4b': {dRow: 0, dCol: 1}, '4a': {dRow: 0, dCol: 2}, '4y': {dRow: 0, dCol: 3}, '3b': {dRow: 0, dCol: 4}, '3a': {dRow: 0, dCol: 5}, '3y': {dRow: 0, dCol: 6}}},
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
      gnd: { dRow: 0, dCol: 0 }, trigger: { dRow: 0, dCol: 1 }, output: { dRow: 0, dCol: 2 }, reset: { dRow: 0, dCol: 3 },
      control: { dRow: 5, dCol: 3 }, threshold: { dRow: 5, dCol: 2 }, discharge: { dRow: 5, dCol: 1 }, vcc: { dRow: 5, dCol: 0 },
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
  // MERGED after the 930000d vendor sync: upstream's gate footprints
  // arrived, but the sync also deleted lite's mcu/dev-board entries and
  // the gutter-straddle mapping — both restored below. Upstream owes
  // itself these entries; until then this file intentionally diverges.
  // Pin 1 (P1.0) sits BOTTOM-left, as on the physical DIP-40 with the
  // notch to the left: pins 1..20 run left→right along the bottom row,
  // 40..21 along the top. The rows were swapped until 2026-08-15 — the
  // owner saw every seated STC12 render "as if one turned the chip
  // upside down". refTerminal is the top-left pin (VCC, pin 40) so the
  // reference stays at offset (0,0) per the footprint contract.
  mcu: {
    refTerminal: 'VCC', straddlesGutter: true,
    leads: {
      ...Object.fromEntries(['P1.0','P1.1','P1.2','P1.3','P1.4','P1.5','P1.6','P1.7','RST','P3.0','P3.1','P3.2','P3.3','P3.4','P3.5','P3.6','P3.7','XTAL2','XTAL1','GND'].map((name, i) => [name, { dRow: 5, dCol: i }])),
      ...Object.fromEntries(['P2.0','P2.1','P2.2','P2.3','P2.4','P2.5','P2.6','P2.7','P4.4','P4.5','P4.6','P0.7','P0.6','P0.5','P0.4','P0.3','P0.2','P0.1','P0.0','VCC'].map((name, i) => [name, { dRow: 0, dCol: 19 - i }])),
    },
  },
  // Development boards expose headers on a fixed 2.54 mm raster. Their
  // bodies are not DIP footprints, but seating still uses real breadboard
  // holes so a cable on the same strip is electrically connected.
  arduino_uno: {refTerminal: 'D0', leads: Object.fromEntries(Array.from({length: 14}, (_, i) => [`D${i}`, {dRow: 0, dCol: i}]))},
  arduino_nano: {refTerminal: 'D0', leads: Object.fromEntries(Array.from({length: 14}, (_, i) => [`D${i}`, {dRow: 0, dCol: i}]))},
  pi_pico: {refTerminal: 'GP0', leads: Object.fromEntries(Array.from({length: 20}, (_, i) => [`GP${i}`, {dRow: 0, dCol: i}]))},
  // Logic gates: 3-pin inline (2-input gates) or 2-pin inline (NOT)
  gate_and:  { refTerminal: 'in0', leads: { in0: { dRow: 0, dCol: 0 }, in1: { dRow: 0, dCol: 1 }, out: { dRow: 0, dCol: 3 } } },
  gate_or:   { refTerminal: 'in0', leads: { in0: { dRow: 0, dCol: 0 }, in1: { dRow: 0, dCol: 1 }, out: { dRow: 0, dCol: 3 } } },
  gate_nand: { refTerminal: 'in0', leads: { in0: { dRow: 0, dCol: 0 }, in1: { dRow: 0, dCol: 1 }, out: { dRow: 0, dCol: 3 } } },
  gate_nor:  { refTerminal: 'in0', leads: { in0: { dRow: 0, dCol: 0 }, in1: { dRow: 0, dCol: 1 }, out: { dRow: 0, dCol: 3 } } },
  gate_xor:  { refTerminal: 'in0', leads: { in0: { dRow: 0, dCol: 0 }, in1: { dRow: 0, dCol: 1 }, out: { dRow: 0, dCol: 3 } } },
  gate_not:  { refTerminal: 'in0', leads: { in0: { dRow: 0, dCol: 0 }, out: { dRow: 0, dCol: 2 } } },
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
      // A DIP straddles the breadboard gutter. Its second pin row is the
      // first row below the gutter (f), not five rows farther down. The old
      // generic mapping put the MCU legs in e and j, so the art could never
      // line up with the holes and a cable on the adjacent strip was not the
      // pin's electrical neighbour.
      if (footprint.straddlesGutter && offset.dRow >= 5) {
        rowIdx = 5 + (offset.dRow - 5);
      } else {
        rowIdx = topIdx + offset.dRow;
      }
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
