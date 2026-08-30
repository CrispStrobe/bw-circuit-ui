/**
 * Wokwi diagram.json importer and exporter.
 *
 * Wokwi's format is very close to ours — the parts are "wokwi-style"
 * and our kind slugs are designed to map near-1:1.
 *
 * Wokwi diagram.json structure (version 1):
 *   { version: 1,
 *     parts: [{ type: "wokwi-arduino-uno", id: "uno1", attrs: {...}, top, left }],
 *     connections: [["uno1:5V", "led1:A", "red", ["v0"]]] }
 *
 * Version 2 uses object-style connections:
 *   connections: [{ id: "conn-0", from: "uno:13", to: "r1:2", color: "green" }]
 *
 * Terminal references are "partId:pinName".
 * Wokwi uses suffixed pins like "GND.1" (instance), "1.l"/"2.r" (button
 * sides), and breadboard hole coordinates like "50b.j", "tn.30".
 *
 * @module
 */

import { wireEndpoint, isBoardEndpoint } from '../model/wire-endpoints.js';

// ── Wokwi type → engine kind mapping ────────────────────────────

const WOKWI_TO_KIND = {
  'wokwi-arduino-uno':    'arduino_uno',
  'wokwi-arduino-nano':   'arduino_nano',
  'wokwi-arduino-mega':   'arduino_mega',
  'wokwi-pi-pico':        'pi_pico',
  'wokwi-attiny85':       'attiny85',
  'wokwi-resistor':       'resistor',
  'wokwi-potentiometer':  'potentiometer',
  'wokwi-led':            'led',
  'wokwi-rgb-led':        'rgb_led',
  'wokwi-buzzer':         'buzzer',
  'wokwi-pushbutton':     'button',
  'wokwi-slide-switch':   'slide_switch',
  'wokwi-dip-switch-8':   'dip_switch',
  'wokwi-servo':          'servo',
  'wokwi-lcd1602':        'char_lcd',
  'wokwi-neopixel':       'neopixel',
  'wokwi-7segment':       'seven_segment',
  'wokwi-ir-receiver':    'ir_receiver',
  'wokwi-pir-motion-sensor': 'pir',
  'wokwi-hc-sr04':        'ultrasonic',
  'wokwi-photoresistor':  'ldr',
  'wokwi-ntc-temperature-sensor': 'ntc',
  'wokwi-ds1307':         'ds1302',
  'wokwi-membrane-keypad':'keypad_4x4',
  'wokwi-stepper-motor':  'stepper',
  'wokwi-relay-module':   'relay',
  'wokwi-dht22':          'dht11',
  'wokwi-ssd1306':        'ssd1306',
  'wokwi-analog-joystick':'joystick',
  'wokwi-slide-potentiometer': 'potentiometer',
  'wokwi-biaxial-stepper':'stepper',
  'wokwi-led-bar-graph':  'bargraph',
  'wokwi-ili9341':        'ili9341',
  'wokwi-max7219-matrix': 'max7219',
  'wokwi-555':            '555',
  'wokwi-74hc595':        '74hc595',
  'wokwi-74hc165':        '74hc165',
  'wokwi-breadboard':     'breadboard',
};

/**
 * The entries above that are APPROXIMATIONS, not translations.
 *
 * Every other importer in this repo states what it could not do faithfully;
 * this one did the substitutions silently, which is the worse failure. A
 * diagram naming a DS1307 came back as a DS1302 with no trace, and a
 * humidity reading taken from a DHT22 came back as a DHT11's — a different
 * resolution and a different range, presented as the user's own file.
 *
 * A substitution here is not a refusal: the part IS placed and the circuit
 * IS usable. It is a NAMED substitution, so the person who imported the file
 * knows which of their parts is now standing in for another.
 */
const APPROXIMATIONS = {
  'wokwi-ds1307': {
    note: 'DS1307 real-time clock imported as a DS1302: the engine models the '
      + 'DS1302 and the two are not pin- or protocol-compatible (I2C vs 3-wire).',
  },
  'wokwi-dht22': {
    note: 'DHT22 imported as a DHT11: same one-wire interface, different '
      + 'resolution and range (DHT22 reads -40..80 C at 0.1 C, DHT11 0..50 C at 1 C).',
  },
  'wokwi-slide-potentiometer': {
    note: 'Slide potentiometer imported as a rotary potentiometer: electrically '
      + 'the same three-terminal divider, drawn and operated differently.',
  },
  'wokwi-biaxial-stepper': {
    note: 'Biaxial stepper imported as a single-shaft stepper: the second axis '
      + 'has no model here, so only one is simulated.',
  },
};

// Two export maps, because a substitution is not a translation and the
// difference has to survive the trip back out. EXACT wins: `potentiometer`
// exports as `wokwi-potentiometer`, never as the slide variant that also
// imports to it. A kind that has ONLY an approximate spelling (dht11 — the
// element library has no wokwi-dht11, only the DHT22 part both resolutions
// are drawn with) still exports, and says so in the report.
const KIND_TO_WOKWI = {};
const KIND_TO_WOKWI_APPROX = {};
for (const [wk, kind] of Object.entries(WOKWI_TO_KIND)) {
  const target = APPROXIMATIONS[wk] ? KIND_TO_WOKWI_APPROX : KIND_TO_WOKWI;
  if (!target[kind]) target[kind] = wk;
}

// ── Wokwi pin name → engine terminal name ────────────────────────
// Most map 1:1 (wokwi uses the same lowercase convention). Only
// list exceptions and aliases.
const WOKWI_PIN_ALIASES = {
  // Power / ground
  'VCC': 'vcc', 'GND': 'gnd', 'VDD': 'vdd', 'VSS': 'vss',
  '5V':  'vcc', '3V3': '3v3',
  // LED polarity
  'A':   'anode', 'K': 'cathode', 'C': 'cathode',
  // Generic signal pins
  'SIG': 'sig', 'TRIG': 'trig', 'ECHO': 'echo',
  'SDA': 'sda', 'SCL': 'scl',
  // 74HC595 shift register
  'DS':   'ser',   'SHCP': 'srclk', 'STCP': 'rclk',
  'MR':   'srclr', 'OE':   'oe',    'Q7S':  'qh_s',
  'Q0': 'qa', 'Q1': 'qb', 'Q2': 'qc', 'Q3': 'qd',
  'Q4': 'qe', 'Q5': 'qf', 'Q6': 'qg', 'Q7': 'qh',
  // 7-segment display
  'COM': 'com',
};

/**
 * Map a Wokwi pin name to an engine terminal name.
 *
 * Handles suffixed pins:
 *   "GND.1" → strip instance suffix → "gnd"
 *   "1.l" / "2.r" → strip side suffix → "1" / "2"
 *   "50b.j" (breadboard hole) → pass through as-is (lowercase)
 *   "COM.1" → strip instance suffix → "com"
 */
function mapWokwiPin(pin) {
  // Strip instance suffix (.N where N is digits) for multi-instance pins
  // e.g. "GND.1" → "GND", "COM.1" → "COM"
  // But NOT breadboard coords like "50b.j" — those have alpha after dot
  const instanceSuffix = pin.match(/^(.+)\.(\d+)$/);
  if (instanceSuffix) {
    pin = instanceSuffix[1];
  }

  // Strip button side suffixes: "1.l" → "1", "2.r" → "2"
  const sideSuffix = pin.match(/^(\d+)\.[lr]$/);
  if (sideSuffix) {
    pin = sideSuffix[1];
  }

  // Check alias table first
  if (WOKWI_PIN_ALIASES[pin]) return WOKWI_PIN_ALIASES[pin];

  // Breadboard hole coordinates (e.g. "50b.j", "tn.30") — pass through lowercase
  return pin.toLowerCase();
}

/**
 * Import a Wokwi diagram.json.
 *
 * @param {string} text  Raw JSON string
 * @returns {{ parts: Array, wires: Array, warnings: string[], unmapped: Array }}
 */
export function importWokwi(text) {
  let json;
  try { json = JSON.parse(text); }
  catch (e) { return { parts: [], wires: [], warnings: [`Invalid JSON: ${e.message}`], unmapped: [] }; }

  const warnings = [];
  const unmapped = [];
  const parts = [];
  const idMap = new Map(); // wokwi id → our partId

  for (const wp of (json.parts || [])) {
    const kind = WOKWI_TO_KIND[wp.type];
    if (!kind) {
      unmapped.push({ ref: wp.id, value: wp.type, libsource: wp.type });
      warnings.push(`Unmapped Wokwi part type: ${wp.type} (id: ${wp.id})`);
      continue;
    }

    const partId = wp.id;
    const params = {};
    if (wp.attrs) {
      if (wp.attrs.value) params._value = wp.attrs.value;
      if (wp.attrs.color) params.color = wp.attrs.color;
    }

    // A deliberate approximation travels WITH the part (so it survives into
    // the saved circuit and can be shown next to the part) and is announced
    // in the import report (so it is seen once, at the moment it happens).
    const approx = APPROXIMATIONS[wp.type];
    if (approx) {
      params._note = approx.note;
      params._substituted = wp.type;
      warnings.push(`${wp.id}: ${approx.note}`);
    }

    parts.push({
      id: partId,
      kind,
      params: Object.keys(params).length ? params : {},
      x: wp.left || 0,
      y: wp.top || 0,
    });
    idMap.set(wp.id, partId);
  }

  const wires = [];
  for (const conn of (json.connections || [])) {
    // Version 1: array [from, to, color, hints]
    // Version 2: object { id, from, to, color }
    let fromStr, toStr;
    if (Array.isArray(conn)) {
      if (conn.length < 2) continue;
      [fromStr, toStr] = conn;
    } else if (conn && typeof conn === 'object') {
      fromStr = conn.from;
      toStr = conn.to;
    } else {
      continue;
    }

    if (!fromStr || !toStr) continue;

    const [fromId, fromPin] = splitWokwiRef(fromStr);
    const [toId, toPin] = splitWokwiRef(toStr);

    if (!idMap.has(fromId) || !idMap.has(toId)) continue;

    wires.push({
      from: idMap.get(fromId),
      fromTerminal: mapWokwiPin(fromPin),
      to: idMap.get(toId),
      toTerminal: mapWokwiPin(toPin),
    });
  }

  return { parts, wires, warnings, unmapped };
}

function splitWokwiRef(ref) {
  const colon = ref.indexOf(':');
  if (colon < 0) return [ref, ''];
  return [ref.substring(0, colon), ref.substring(colon + 1)];
}

/**
 * Export a circuit to Wokwi diagram.json format.
 *
 * A kind with no mapping is SKIPPED and named, never invented. The old
 * exporter wrote `wokwi-${kind.replace(/_/g,'-')}` for anything unmapped,
 * which produced plausible-looking type names — `wokwi-max232`,
 * `wokwi-tilevga-card` — that no reader has ever heard of. The import side
 * of this same file refuses unmapped types loudly; a producer that invents
 * where its consumer refuses is the asymmetry, and it made the export look
 * complete when it was not.
 *
 * @param {{ parts: Array, wires: Array }} circuit
 * @returns {{ text: string, skipped: Array<{id: string, kind: string}>,
 *             substituted: Array<{id: string, kind: string, type: string, note: string}> }}
 */
export function exportWokwi(circuit) {
  const skipped = [];
  const substituted = [];
  const kept = new Set();
  const parts = [];
  for (const p of (circuit.parts || [])) {
    const wokwiType = KIND_TO_WOKWI[p.kind] || KIND_TO_WOKWI_APPROX[p.kind];
    if (!wokwiType) {
      skipped.push({ id: p.id, kind: p.kind });
      continue;
    }
    if (!KIND_TO_WOKWI[p.kind]) {
      substituted.push({
        id: p.id, kind: p.kind, type: wokwiType,
        note: APPROXIMATIONS[wokwiType].note,
      });
    }
    kept.add(p.id);
    parts.push({
      type: wokwiType,
      id: p.id,
      top: p.y || 0,
      left: p.x || 0,
      attrs: p.params && Object.keys(p.params).length ? p.params : {},
    });
  }

  // Endpoints through the canonical accessor: the live app holds NESTED
  // wires (Circuit.fromJSON normalizes them), and reading `w.from` raw
  // wrote "[object Object]:undefined" into every Wokwi connection.
  // A breadboard hole is not a Wokwi part pin, so those are dropped.
  const connections = (circuit.wires || []).flatMap(w => {
    const f = wireEndpoint(w, 'from');
    const t = wireEndpoint(w, 'to');
    if (!f || !t || isBoardEndpoint(f) || isBoardEndpoint(t)) return [];
    // A wire onto a part that was skipped would name a part the file does
    // not contain — a diagram that refuses to load rather than one that is
    // merely incomplete.
    if (!kept.has(f.part) || !kept.has(t.part)) return [];
    return [[
      `${f.part}:${f.terminal}`,
      `${t.part}:${t.terminal}`,
      '',   // color (empty = auto)
      [],   // path hints
    ]];
  });

  return {
    text: JSON.stringify({ version: 1, parts, connections }, null, 2),
    skipped,
    substituted,
  };
}
