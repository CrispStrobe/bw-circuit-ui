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
  h_bridge: 'l293d',
  pot: 'potentiometer',
};

/** @type {Record<string, Record<string, string>>} */
export const TERMINAL_ALIASES = {
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
 * Resolve a kind name, applying aliases.
 * @param {string} kind
 * @returns {string}
 */
export function resolveKind(kind) {
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
