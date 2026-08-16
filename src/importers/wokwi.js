/**
 * Wokwi diagram.json importer and exporter.
 *
 * Wokwi's format is very close to ours — the parts are "wokwi-style"
 * and our kind slugs are designed to map near-1:1.
 *
 * Wokwi diagram.json structure:
 *   { version: 1,
 *     parts: [{ type: "wokwi-arduino-uno", id: "uno1", attrs: {...}, top, left }],
 *     connections: [["uno1:5V", "led1:A", "red", ["v0"]]] }
 *
 * Connections are [from, to, color, [path-hints]].
 * Terminal references are "partId:pinName".
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
};

const KIND_TO_WOKWI = {};
for (const [wk, kind] of Object.entries(WOKWI_TO_KIND)) {
  if (!KIND_TO_WOKWI[kind]) KIND_TO_WOKWI[kind] = wk;
}

// ── Wokwi pin name → engine terminal name ────────────────────────
// Most map 1:1 (wokwi uses the same lowercase convention). Only
// list exceptions.
const WOKWI_PIN_ALIASES = {
  'VCC': 'vcc', 'GND': 'gnd', 'VDD': 'vdd', 'VSS': 'vss',
  '5V':  'vcc', '3V3': '3v3', 'A':   'anode', 'K': 'cathode',
  'SIG': 'sig', 'TRIG': 'trig', 'ECHO': 'echo',
  'SDA': 'sda', 'SCL': 'scl',
};

function mapWokwiPin(pin) {
  return WOKWI_PIN_ALIASES[pin] || pin.toLowerCase();
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
      // Map common wokwi attrs to params
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
    if (!Array.isArray(conn) || conn.length < 2) continue;
    const [fromStr, toStr] = conn;
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
