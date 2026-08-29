/**
 * Terminal and kind alias maps — old names that saved circuits may reference.
 *
 * Every rename is a data migration. Old circuit.json files reference
 * terminals and kinds by name. Without aliases, a rename silently
 * produces a wire attached to nothing or a part the model doesn't know.
 *
 * @module
 */

/**
 * Kind aliases: gallery/old files may use different kind names.
 * @type {Record<string, string>}
 */
export const KIND_ALIASES = {
  battery: 'vsource',
  timer_555: '555',
  '74hc595': 'shift_register',
  l293d: 'h_bridge',
  pot: 'potentiometer',
  // KNOWN_GAPS burn-down: alias electrically equivalent kinds
  tilt_switch: 'tilt_sensor',
  tilt_switch_v2: 'tilt_sensor',
  cd4017: 'decade_counter',
  tm1637: 'clock_display',
  function_gen: 'vsource',
  nmos_power: 'nmos',
  pmos_power: 'pmos',
  lemon_battery: 'vsource',
  potato_battery: 'vsource',
  neopixel_jewel: 'neopixel',
  neopixel_ring: 'neopixel',
  neopixel_strip: 'neopixel',
  ky002: 'tilt_sensor',
  light_sensor: 'ldr',
  multimeter: 'meter',
  oscilloscope: 'meter',
  ultrasonic_3pin: 'ultrasonic',
  // Breadboard size variants → structural breadboard
  breadboard_full: 'breadboard',
  breadboard_half: 'breadboard',
  breadboard_mini: 'breadboard',
  breadboard_psu: 'breadboard',
};

/** @type {Record<string, Record<string, string>>} */
export const TERMINAL_ALIASES = {
  // attiny88 pin 22: the PDIP-28 does not bond out port A (PA0-PA3 reach a pad
  // only on the 32-pin QFN), so pin 22 is a SECOND GND that somebody needed a
  // name for. Renamed `pa0` -> `gnd2` in bw-board e1bda3f, which owns terminal
  // names. 135 shipped circuits carry `pa0` in seat.leadMap and migrate here.
  // PA0-PA3 still exist in bw-board's ATTINY88_PINS — those are the DIE's
  // registers, which the package simply cannot reach.
  attiny88: { pa0: 'gnd2' },
  // A single-digit display's common pin is `common` in the engine, and `com`
  // on every schematic and datasheet that abbreviates it. 77-keypad-keyshow
  // ships the short spelling, so its display-to-ground wire landed on nothing
  // and was dropped at load — invisible until a corpus round-trip that had not
  // run in months started counting.
  seven_segment: { com: 'common' },
  '555': {
    trig: 'trigger',
    out: 'output',
    ctrl: 'control',
    thr: 'threshold',
    dis: 'discharge',
  },
  // 74HC595 / shift_register: gallery uses uppercase Q outputs
  shift_register: {
    Q0: 'q0', Q1: 'q1', Q2: 'q2', Q3: 'q3',
    Q4: 'q4', Q5: 'q5', Q6: 'q6', Q7: 'q7',
  },
  // hd44780: the model list moved to the datasheet names the engine device
  // and the sidecar always used; old saves carry the friendly spellings.
  hd44780: {
    vcc: 'vdd', gnd: 'vss', vo: 'v0', bl_a: 'a', bl_k: 'k',
  },
  // battery → vsource: terminals are already pos/neg, no rename needed.
  // h_bridge/l293d: gallery uses simplified names, sidecar has DIP-16 pins
  l293d: {
    vcc: 'vcc1', gnd: 'gnd1', vs: 'vcc2',
  },
  // pot / potentiometer: gallery uses cw/ccw or lead1/lead2 for outer legs
  potentiometer: {
    cw: 'a',
    ccw: 'b',
    lead1: 'a',
    lead2: 'b',
  },
  // resistor / button: gallery uses lead1/lead2 for the terminals
  resistor: {
    lead1: 'a',
    lead2: 'b',
  },
  button: {
    lead1: 'a',
    lead2: 'b',
  },
  buzzer: {
    pos: 'a',
    neg: 'b',
    lead1: 'a',
    lead2: 'b',
  },
  piezo: {
    pos: 'a',
    neg: 'b',
  },
  rgb_led: {
    r: 'r_anode',
    g: 'g_anode',
    b: 'b_anode',
  },
  // 28C256 EEPROM: extractor uses csb, sidecar names the pin ceb
  '28c256': {
    csb: 'ceb',
  },
  // Future renames go here. Never remove an entry — old files may exist.
};

/**
 * Aliases that exist only because the ENGINE once had no model for the source
 * kind. When the engine DOES have one, the alias is a downgrade and must not
 * fire — the same discrimination `engineKindFor` makes for passthrough kinds,
 * for the same reason: a registered model is strictly more truthful than the
 * generic surface it would collapse to.
 *
 * `74hc595` is the case that motivated this. bw-board registers a full 74HC595
 * (src/devices/tier3-parts.js) declaring `vcc`, `gnd`, `srclr`, the `qh_s`
 * cascade output and BOTH q-namespaces; the built-in `shift_register` it was
 * aliased to declares twelve abstract terminals and NO POWER PINS AT ALL. Nine
 * seated variants of 08-led-chaser-595 wire the chip's vcc and gnd into real
 * nets — eighteen wires that landed on terminals the collapsed part does not
 * have and were dropped at load, silently, because a dropped wire renders as a
 * gap rather than an error. TERMINAL_ALIASES could not rescue them either:
 * there is nothing on the target to map `vcc` and `gnd` TO.
 *
 * The alias itself is NOT removed. A file saved before bw-board registered the
 * 74hc595 model, loaded against an engine that still lacks it, must keep
 * collapsing exactly as it did — that is what an alias map is for. This set
 * only says "ask the engine first".
 *
 * @type {Set<string>}
 */
export const ENGINE_MODEL_WINS = new Set(['74hc595']);

/**
 * Resolve a kind name, applying aliases.
 *
 * @param {string} kind
 * @param {(kind: string) => boolean} [engineHasModel] — asked only for kinds in
 *   ENGINE_MODEL_WINS. Omitted (or throwing) means "no engine opinion", and the
 *   alias applies as it always did, so every existing caller is unchanged.
 * @returns {string}
 */
export function resolveKind(kind, engineHasModel) {
  if (ENGINE_MODEL_WINS.has(kind) && typeof engineHasModel === 'function') {
    try {
      if (engineHasModel(kind)) return kind;
    } catch { /* engine not injected — fall through to the alias */ }
  }
  return KIND_ALIASES[kind] || kind;
}

/**
 * Resolve a terminal name, applying aliases if the current name doesn't
 * match but an old one does.
 *
 * @param {string} kind — part kind
 * @param {string} terminalName — the name from the wire endpoint
 * @param {string[]} currentTerminals — the part's current terminal list
 * @returns {string} — the resolved name (may be the same or an alias)
 */
export function resolveTerminal(kind, terminalName, currentTerminals) {
  // Current name matches — no alias needed
  if (currentTerminals.includes(terminalName)) return terminalName;

  // Check alias map
  const aliases = TERMINAL_ALIASES[kind];
  if (aliases && aliases[terminalName]) {
    const resolved = aliases[terminalName];
    if (currentTerminals.includes(resolved)) return resolved;
  }

  // Case-insensitive fallback, unique match only: authors and programs
  // write PB0 the way the datasheet does, sidecars name the terminal
  // pb0. Swapping the blinkenrocket pendant's controller from the
  // generic mcu to the device-true attiny88 kind silently killed every
  // wire over exactly this (2026-08-16). Unique-match-only keeps the
  // "wrong terminal" guarantee: an ambiguous casing still refuses.
  const lower = String(terminalName).toLowerCase();
  const ciMatches = currentTerminals.filter(t => String(t).toLowerCase() === lower);
  if (ciMatches.length === 1) return ciMatches[0];

  // No resolution — return as-is (the wire won't connect, which is
  // better than silently connecting to the wrong terminal)
  return terminalName;
}
