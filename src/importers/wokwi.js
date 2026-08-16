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

const KIND_TO_WOKWI = {};
for (const [wk, kind] of Object.entries(WOKWI_TO_KIND)) {
  if (!KIND_TO_WOKWI[kind]) KIND_TO_WOKWI[kind] = wk;
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
 * @param {{ parts: Array, wires: Array }} circuit
 * @returns {string} JSON string
 */
export function exportWokwi(circuit) {
  const parts = (circuit.parts || []).map(p => {
    const wokwiType = KIND_TO_WOKWI[p.kind] || `wokwi-${p.kind.replace(/_/g, '-')}`;
    return {
      type: wokwiType,
      id: p.id,
      top: p.y || 0,
      left: p.x || 0,
      attrs: p.params && Object.keys(p.params).length ? p.params : {},
    };
  });

  const connections = (circuit.wires || []).map(w => [
    `${w.from}:${w.fromTerminal}`,
    `${w.to}:${w.toTerminal}`,
    '',   // color (empty = auto)
    [],   // path hints
  ]);

  return JSON.stringify({ version: 1, parts, connections }, null, 2);
}
