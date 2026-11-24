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
 * whose pins moved onto their art's legs.
 */
const FIRST_ART_FACES = [
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
  // The field probe's art is its body; its distance knob sits beside it
  // (BoardCanvas WokwiParts), so the art never has to show a setting.
  'field_probe',
  // Sensing transducers: their art is the part itself.
  'thermocouple',
  'air_coil',
  'electrolysis_cell',
  // Optics: the laser module's brass barrel and beam, and the phototransistor
  // (bw-parts 2026-11-24: its leads splay out to the footprint's columns).
  'laser_diode',
  'phototransistor',
  // Radio: the VHF tank coil and the varicap.
  'vhf_coil',
  'varicap',
];

/**
 * 2026-11-24: the DIPs, re-laid by bw-parts on the breadboard pitch (`dip` in
 * the sidecar: legs 14 apart, rows 38 apart across the gutter, pin 1
 * bottom-left), so seated their legs ARE the holes; the breakouts redrawn with
 * one header row; and the parts whose sidecars put several pins on one point,
 * or had no legs where the engine has terminals.
 */
const BREADBOARD_ART_FACES = [
  '28c256', '555', '556', '62256', '74c922', '74hc00', '74hc02', '74hc04', '74hc08', '74hc10',
  '74hc11', '74hc125', '74hc132', '74hc138', '74hc14', '74hc165', '74hc20', '74hc21',
  '74hc244', '74hc245', '74hc27', '74hc283', '74hc32', '74hc34', '74hc373', '74hc374',
  '74hc4050', '74hc595', '74hc688', '74hc73', '74hc74', '74hc75', '74hc86', '74hc93', '74hc95',
  '74ls04', '74ls107', '74ls157', '74ls161', '74ls173', '74ls189', '74ls32', '74ls373',
  'ad711', 'at24c02', 'at24c64', 'at89c2051', 'attiny13', 'attiny2313', 'attiny85', 'attiny88',
  'ay8912', 'cd4017', 'cd4093', 'cd4511', 'cd74hc4067', 'darlington_driver', 'decade_counter',
  'dff', 'dip_switch', 'ds1302', 'h_bridge', 'i8086', 'i8088', 'i8251', 'i8254', 'i8255',
  'i8259', 'i8284', 'jkff', 'kd9561', 'l293d', 'level_shifter4', 'lm324', 'lm339', 'lm358',
  'lm386', 'lm3915', 'lm393', 'lm741', 'lt1001', 'lt1007', 'lt1014', 'm6532', 'max232',
  'mc6845', 'mc6850', 'mcp3008', 'mos6532', 'ns16c550', 'op07', 'op27', 'osc_can', 'pcf8574',
  'r6507', 'stc15_mcu', 'stc_mcu', 'stm32f030', 'tang_nano_20k', 'timer_555', 'timer_556',
  'transformer', 'um245r', 'w65c02', 'w65c22', 'w65c51', 'z80', 'as5600', 'bmp280', 'ina219',
  'tcs34725', 'vl53l0x', 'neopixel', 'pmos', 'usb_a', 'solar_cell', 'tcs3200', 'eater6502',
  'ir_remote', 'gas_sensor', 'stepper', 'mcp4725', 'rnet_sip',
];

/** Kinds whose canvas face is their vendored art. */
export const ART_FACE_KINDS = Object.freeze([...FIRST_ART_FACES, ...BREADBOARD_ART_FACES]);

const SMD = 'surface-mount package (SOIC/TSOT): it reaches a breadboard only on a DIP carrier adapter (carriers.js), drawn as the carrier\'s DIP body; its own art is the bare package, which has no breadboard legs';

/**
 * Kinds with vendored art that deliberately do NOT draw it, and why. Each
 * entry is a decision, not an oversight; removing one means drawing its art
 * (and test/art-coverage.test.js then holds it to the same checks).
 */
export const ART_FACE_EXCEPTIONS = Object.freeze({
  // A knob control (position 0..1 sets the capacitance). The Wokwi
  // potentiometer face turns under the pointer and its pointer angle shows the
  // live position (controlValues read-back); tuning_cap.svg's knob is painted
  // at one fixed angle and would show the wrong setting the moment it turns.
  tuning_cap: 'knob control: the turnable potentiometer face shows its live position; the art knob is static',
  breadboard_full: 'the breadboard is the substrate BreadboardView draws, not a part face',
  breadboard_half: 'the breadboard is the substrate BreadboardView draws, not a part face',
  breadboard_mini: 'the breadboard is the substrate BreadboardView draws, not a part face',
  ad8541: SMD, ad8602: SMD, ada4522_1: SMD, adtl082: SMD, lt1006: SMD, lt1678: SMD, op747: SMD, adp151: SMD,
});

/**
 * The reason for kinds still drawn as a DIP body or chip box: the DIP_CHIP_LABELS
 * and CHIP_FACES kinds that have no re-laid art (none with vendored art today
 * except the surface-mount parts above).
 */
export const ART_FACE_CHIP_REASON = 'DIP body: no breadboard-pitch art for this package yet';

const finite = v => typeof v === 'number' && Number.isFinite(v);

/** Sidecar terminal positions relative to the art centre (physical pins only). */
export function artTerminalOffsets(sidecar) {
  if (!sidecar?.terminals?.length || !finite(sidecar.w) || !finite(sidecar.h)) return null;
  const out = {};
  for (const t of sidecar.terminals) {
    if (!finite(t.x) || !finite(t.y)) return null;
    out[t.name] = { dx: t.x - sidecar.w / 2, dy: t.y - sidecar.h / 2 };
  }
  return out;
}

/**
 * The canvas pins of an art face: every terminal at its art leg, and every
 * alias (a second name bw-board accepts for the same leg) at its twin's.
 */
export function artPinOffsets(sidecar) {
  const out = artTerminalOffsets(sidecar);
  if (!out) return null;
  for (const t of sidecar.terminals) {
    for (const a of Array.isArray(t.aliases) ? t.aliases : []) {
      if (!out[a]) out[a] = { ...out[t.name] };
    }
  }
  return out;
}

/**
 * The geometry a part's art face is drawn with: the sidecar itself, or the
 * `variantArt` entry its params select. bw-board models some parts in two
 * forms behind a param (the MQ gas sensor as a bare element or a module, the
 * stepper unipolar or bipolar); each form has its own legs and its own art.
 * An entry marked `default` is the engine's form when the param is unset.
 *
 * @returns {{sc: {kind:string,w:number,h:number,terminals:Array}, slug: string}|null}
 *   slug is the art file's name without `.svg`
 */
export function artSidecarFor(sidecar, params = {}) {
  if (!sidecar) return null;
  for (const v of Array.isArray(sidecar.variantArt) ? sidecar.variantArt : []) {
    const set = params?.[v.param];
    if (set === v.value || (set == null && v.default)) {
      return { sc: { kind: sidecar.kind, w: v.w, h: v.h, terminals: v.terminals }, slug: String(v.art).replace(/\.svg$/, '') };
    }
  }
  return { sc: sidecar, slug: sidecar.kind };
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
  let s = num / den;
  if (Math.abs(s - 1) < 1e-9) s = 1; // on pitch: exactly the art's own size
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

/** True when segments p1-p2 and q1-q2 properly cross. */
function segmentsCross(p1, p2, q1, q2) {
  const o = (a, b, c) => Math.sign((b.dx - a.dx) * (c.dy - a.dy) - (b.dy - a.dy) * (c.dx - a.dx));
  return o(p1, p2, q1) * o(p1, p2, q2) < 0 && o(q1, q2, p1) * o(q1, q2, p2) < 0;
}

/**
 * Whether a seated layout is honest to draw: every lead leaves the art
 * outward (never back across its body) and no two leads cross. A saved
 * circuit can seat a part in holes its art cannot reach that way (a DIP seated
 * mirror-image by an old footprint); the canvas then keeps the part's box.
 */
export function seatedArtClean(art) {
  if (!art) return false;
  const c = { dx: art.x + art.w / 2, dy: art.y + art.h / 2 };
  for (const l of art.leads) {
    if ((l.to.dx - l.from.dx) * (l.from.dx - c.dx) + (l.to.dy - l.from.dy) * (l.from.dy - c.dy) <= 0) return false;
  }
  for (let i = 0; i < art.leads.length; i++) {
    for (let j = i + 1; j < art.leads.length; j++) {
      const [a, b] = [art.leads[i], art.leads[j]];
      if (segmentsCross(a.from, a.to, b.from, b.to)) return false;
    }
  }
  return true;
}
