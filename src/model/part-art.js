/**
 * Part art faces: kinds the canvas draws with their vendored bw-parts art
 * (`src/parts-data/<kind>.svg`) instead of the generic labelled module box.
 *
 * The sidecar's terminal x/y ARE the art's leg ends (both come from bw-parts,
 * in the art's viewBox). terminalOffsetsForPart places these kinds' pins at
 * the sidecar geometry relative to the body centre (sidecarCenterOffsets, or
 * the generic module layout's 'sidecar' source, which is the same points), so
 * drawing the art with its top-left at (-w/2, -h/2) puts every leg end
 * exactly on its pin. A kind belongs in ART_FACE_KINDS only when that holds:
 * its viewBox is the sidecar's w x h, its pins come from the sidecar, and
 * seated every leg ends in its hole without a lead crossing the body or
 * another lead (test/art-coverage.test.js checks all three).
 *
 * The art itself is loaded lazily by src/components/part-art-loader.js (a
 * dynamic import per kind, so neither Vite nor Lite's Webpack puts any of it
 * in the first-load bundle); this module stays importable from Node.
 *
 * @module
 */

/**
 * Kinds whose canvas face is their vendored art: the instruments, the crystal
 * set and the electrolytic first (2026-11-23), then every kind whose pins
 * already sat on its art's leg ends (sensor and breakout modules, regulators,
 * meters, batteries, motors, displays on a carrier) and the two-lead parts
 * whose pins moved onto their art's legs (terminalOffsetsForPart).
 */
export const ART_FACE_KINDS = Object.freeze([
  '74ls193', 'adxl335', 'ambient_light', 'ammeter', 'analog_meter', 'antenna', 'battery',
  'battery_9v', 'battery_coin', 'breadboard_psu', 'clock_display', 'dc_motor_encoder',
  'dfplayer_mini', 'dht11', 'dht22', 'dip_switch_dpst', 'ds3231', 'earphone', 'earth',
  'ferrite_coil', 'flame_sensor', 'flex_sensor', 'force_sensor', 'function_gen', 'fuse',
  'gearmotor', 'hall_analog', 'hall_digital', 'hc05', 'header', 'heartbeat', 'hx711',
  'ir_reflect', 'ir_transmitter', 'isd1820', 'isource', 'ky002', 'ky040', 'ld1117v33',
  'led_7color', 'lemon_battery', 'light_bulb', 'light_sensor', 'lm7805', 'logic_probe',
  'memsic2125', 'microbit', 'microbit_breakout', 'mpu6050', 'msgeq7', 'multimeter',
  'neopixel_jewel', 'neopixel_ring', 'neopixel_strip', 'nmos_power', 'nrf24l01',
  'oscilloscope', 'photo_interrupter', 'photodiode', 'pir', 'pmos_power', 'polarized_cap',
  'pololu_motor_ctrl', 'potato_battery', 'reed_switch', 'relay_dpdt', 'rf433_rx', 'rf433_tx',
  'sgp30', 'soil_moisture', 'solenoid', 'sound_module', 'speaker', 'spectrum_display',
  'st7920', 'tilevga', 'tilt_switch', 'tilt_switch_v2', 'tm1637', 'tmp36', 'touch_ttp223',
  'ultrasonic', 'ultrasonic_3pin', 'um66t', 'veml7700', 'vga_prop_card', 'vibration_motor',
  'voltmeter', 'vreg', 'xpt2046', 'ze08_ch2o', 'pir_sensor', 'motor_encoder',
]);

const DIP_ART = 'DIP art (pins on two side columns of a chip body): seated, the package straddles the gutter on the 14-unit pitch, so its legs would run across the chip into the holes; the chip box with a notch is the honest face';
const TWO_EDGES = 'pins on two edges of the art go into ONE row of holes: seated, the legs from the far edge would run back across the body';

/**
 * Kinds with vendored art that deliberately do NOT draw it, and why. Each
 * entry is a decision, not an oversight; removing one means drawing its art
 * (and test/art-coverage.test.js then holds it to the same checks). Kinds
 * drawn by DIP_CHIP_LABELS' DIP body or CHIP_FACES' chip box (BoardCanvas)
 * are excepted as a group in that test, for the DIP_ART reason.
 */
export const ART_FACE_EXCEPTIONS = Object.freeze({
  // A knob control (position 0..1 sets the capacitance). The Wokwi
  // potentiometer face turns under the pointer and its pointer angle shows the
  // live position (controlValues read-back); tuning_cap.svg's knob is painted
  // at one fixed angle and would show the wrong setting the moment it turns.
  tuning_cap: 'knob control: the turnable potentiometer face shows its live position; the art knob is static',
  // An 8-pin DIP whose art has its pins on two 10-unit side columns, while
  // seated it straddles the gutter on the 14-unit breadboard pitch in two
  // rows: the art's legs cannot meet the holes without redrawing the package.
  lm386: DIP_ART,
  cd4017: DIP_ART,
  darlington_driver: DIP_ART,
  dff: DIP_ART,
  jkff: DIP_ART,
  h_bridge: DIP_ART,
  l293d: DIP_ART,
  kd9561: DIP_ART,
  level_shifter4: DIP_ART,
  lm3915: DIP_ART,
  mcp3008: DIP_ART,
  timer_555: DIP_ART,
  timer_556: DIP_ART,
  // Breakouts with a header on each of two edges, seated in one row.
  as5600: TWO_EDGES,
  bmp280: TWO_EDGES,
  ina219: TWO_EDGES,
  tcs34725: TWO_EDGES,
  vl53l0x: TWO_EDGES,
  neopixel: 'one leg at each corner of the art, seated in one row: the legs from the top corners would cross the pixel',
  phototransistor: 'collector and emitter leave the top and bottom of the art, seated in one row: the top lead would cross the body',
  pmos: 'gate, drain and source leave three sides of the art, seated in one row: the drain lead would cross the package',
  dip_switch: 'the footprint seats two of the eight legs (s1_a/s1_b); the other six would hang off the art over no hole',
  // The art is not drawn in the sidecar's coordinates.
  usb_a: 'viewBox 24x16 is not the sidecar\'s 40x30 and the pads sit 4 apart where the pins are 8: no rescale puts the pads on the pins',
  solar_cell: 'viewBox 56x48 is not the sidecar\'s 50x40 and the leads end 20 apart where the pins are 30: no rescale puts the leads on the pins',
  // The pins are not the art's legs.
  gas_sensor: 'the engine\'s terminals (a, b, heater_a, heater_b: the bare element) are not the art\'s module legs (vcc, gnd, aout, dout)',
  stepper: 'the engine\'s terminals (coil1..coil4, com) are not the art\'s legs (coil_a1, coil_b1, coil_a2, coil_b2)',
  ir_remote: 'the sidecar has no legs while the engine models the IR LED (anode, cathode): there is no point on the art to put a pin',
  eater6502: 'the sidecar gives several pins one point, so they get a breakout row of their own, not the art\'s legs',
  tcs3200: 'oe and out share one point in the sidecar, so the pins get a breakout row of their own, not the art\'s legs',
  tang_nano_20k: 'a dev board: its pins come from its board geometry (boardTerminalOffsets), not the sidecar art',
  breadboard_full: 'the breadboard is the substrate BreadboardView draws, not a part face',
  breadboard_half: 'the breadboard is the substrate BreadboardView draws, not a part face',
  breadboard_mini: 'the breadboard is the substrate BreadboardView draws, not a part face',
});

/** The reason for kinds drawn as a DIP or chip box (DIP_CHIP_LABELS, CHIP_FACES). */
export const ART_FACE_CHIP_REASON = DIP_ART;

const finite = v => typeof v === 'number' && Number.isFinite(v);

/** Sidecar terminal positions relative to the art centre. */
export function artTerminalOffsets(sidecar) {
  if (!sidecar?.terminals?.length || !finite(sidecar.w) || !finite(sidecar.h)) return null;
  const out = {};
  for (const t of sidecar.terminals) {
    if (!finite(t.x) || !finite(t.y)) return null;
    out[t.name] = { dx: t.x - sidecar.w / 2, dy: t.y - sidecar.h / 2 };
  }
  return out;
}

/** How far seated art with leads stands off its holes (half a breadboard pitch). */
export const SEATED_LEAD_LIFT = 7;

/** Seated art is scaled onto its holes only within this range (see artFaceLayout). */
export const SEATED_ART_SCALE = Object.freeze({ min: 1, max: 2 });

/**
 * The uniform scale (about the leg centroid) that puts every art leg exactly
 * on its hole, or null when no such scale exists: the legs are not the holes'
 * shape (two edges of pins into one row, a different order or spacing) or
 * there is only one leg.
 */
function scaleOntoHoles(art, holes, names) {
  if (names.length < 2) return null;
  let ax = 0, ay = 0, hx = 0, hy = 0;
  for (const n of names) { ax += art[n].dx; ay += art[n].dy; hx += holes[n].dx; hy += holes[n].dy; }
  ax /= names.length; ay /= names.length; hx /= names.length; hy /= names.length;
  let num = 0, den = 0;
  for (const n of names) {
    const px = art[n].dx - ax, py = art[n].dy - ay;
    num += px * (holes[n].dx - hx) + py * (holes[n].dy - hy);
    den += px * px + py * py;
  }
  if (!(den > 0)) return null;
  const s = num / den;
  for (const n of names) {
    const ex = hx + (art[n].dx - ax) * s - holes[n].dx, ey = hy + (art[n].dy - ay) * s - holes[n].dy;
    if (Math.hypot(ex, ey) > 0.5) return null;
  }
  return { s, ax, ay, hx, hy };
}

/**
 * Where to draw a kind's art, in the part's unrotated frame (origin = the
 * part's x/y), and the leads to draw from the art's leg ends to the pins.
 *
 * Free part: the art is centred on the origin, exactly where the canvas
 * already puts the pins (sidecarCenterOffsets), so there are no extra leads.
 *
 * Seated part: the origin is the centroid of its holes. bw-parts draws a
 * header at an 8-unit pin pitch where the breadboard's holes are 14 apart,
 * so a module's row of legs is the row of holes at a smaller scale. When one
 * uniform scale in SEATED_ART_SCALE puts every leg exactly on its hole, the
 * art is drawn at that scale and needs no leads (a module sits over the
 * holes it is plugged into, which is how it looks on a real board).
 * Otherwise the art is moved so the centroid of its leg ends lands on the
 * centroid of the holes, then lifted SEATED_LEAD_LIFT away from its legs, and
 * every leg end that misses its hole (an electrolytic whose leads are closer
 * than its footprint's hole spacing) gets a straight lead down into the hole.
 *
 * @param {{w:number,h:number,terminals:Array<{name:string,x:number,y:number}>}} sidecar
 * @param {Record<string,{dx:number,dy:number}>|null} [holes] seated hole
 *   positions per terminal, relative to the part origin in its unrotated frame
 * @returns {{x:number,y:number,w:number,h:number,scale:number,legs:Record<string,{dx:number,dy:number}>,
 *   leads:Array<{name:string,from:{dx:number,dy:number},to:{dx:number,dy:number}}>}|null}
 */
export function artFaceLayout(sidecar, holes = null) {
  const art = artTerminalOffsets(sidecar);
  if (!art) return null;
  const { w, h } = sidecar;
  const seated = holes ? Object.keys(art).filter(n => holes[n] && finite(holes[n].dx) && finite(holes[n].dy)) : [];
  // A point of the free art (centre-relative) -> the drawn frame.
  let map = p => ({ dx: p.dx, dy: p.dy });
  let scale = 1;
  const fit = seated.length ? scaleOntoHoles(art, holes, seated) : null;
  if (fit && fit.s >= SEATED_ART_SCALE.min - 1e-9 && fit.s <= SEATED_ART_SCALE.max + 1e-9) {
    scale = fit.s;
    map = p => ({ dx: fit.hx + (p.dx - fit.ax) * scale, dy: fit.hy + (p.dy - fit.ay) * scale });
  } else if (seated.length) {
    let ax = 0, ay = 0, hx = 0, hy = 0;
    for (const n of seated) { ax += art[n].dx; ay += art[n].dy; hx += holes[n].dx; hy += holes[n].dy; }
    ax /= seated.length; ay /= seated.length; hx /= seated.length; hy /= seated.length;
    // Lift the body off the holes, away from its legs (the art centre is the
    // body side of the leg centroid), so the leads splay down into the holes
    // instead of lying along the hole row.
    let lx = 0, ly = 0;
    if (seated.some(n => Math.hypot(holes[n].dx - hx - (art[n].dx - ax), holes[n].dy - hy - (art[n].dy - ay)) > 0.5)) {
      const len = Math.hypot(ax, ay);
      if (len > 1e-9) { lx = (-ax / len) * SEATED_LEAD_LIFT; ly = (-ay / len) * SEATED_LEAD_LIFT; }
    }
    const sx = hx - ax + lx, sy = hy - ay + ly;
    map = p => ({ dx: p.dx + sx, dy: p.dy + sy });
  }
  const legs = {};
  const leads = [];
  for (const [name, p] of Object.entries(art)) {
    legs[name] = map(p);
    const hole = seated.includes(name) ? holes[name] : null;
    if (hole && Math.hypot(hole.dx - legs[name].dx, hole.dy - legs[name].dy) > 0.5) {
      leads.push({ name, from: legs[name], to: { dx: hole.dx, dy: hole.dy } });
    }
  }
  const corner = map({ dx: -w / 2, dy: -h / 2 });
  return { x: corner.dx, y: corner.dy, w: w * scale, h: h * scale, scale, legs, leads };
}
