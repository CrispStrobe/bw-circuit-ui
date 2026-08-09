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
};

/**
 * Compute a leadMap (terminal → hole id) from a reference hole and footprint.
 *
 * @param {Footprint} footprint
 * @param {string} refHole — the hole the reference terminal sits on (e.g. "e5")
 * @returns {Record<string, string>} terminal → hole id
 */
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
