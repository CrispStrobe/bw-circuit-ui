/**
 * BOM (Bill of Materials) export — parts list with values.
 *
 * Reads from the circuit model's parts array. Groups identical parts
 * (same kind + params) and counts them. Output is plain data; the UI
 * renders it as a table or exports as CSV/text.
 *
 * @module
 */

import { formatSi } from './si.js';

/**
 * @typedef {object} BomLine
 * @property {string} kind — part kind slug
 * @property {string} label — human-readable description
 * @property {number} qty — count of identical parts
 * @property {string[]} ids — part ids
 * @property {Record<string, *>} params — shared parameters
 */

const PARAM_LABELS = {
  ohms: { unit: 'Ω', format: formatSi },
  farads: { unit: 'F', format: formatSi },
  henrys: { unit: 'H', format: formatSi },
  vf: { unit: 'V', format: v => `${v}` },
  vz: { unit: 'V', format: v => `${v}` },
  beta: { unit: '', format: v => `β=${v}` },
  vbe: { unit: 'V', format: v => `${v}` },
  vth: { unit: 'V', format: v => `${v}` },
  color: { unit: '', format: v => v },
};

const KIND_LABELS = {
  vcc: 'VCC Supply',
  gnd: 'Ground',
  resistor: 'Resistor',
  capacitor: 'Capacitor',
  inductor: 'Inductor',
  diode: 'Diode',
  zener: 'Zener Diode',
  led: 'LED',
  rgb_led: 'RGB LED',
  potentiometer: 'Potentiometer',
  button: 'Push Button',
  switch: 'Toggle Switch',
  buzzer: 'Buzzer',
  npn: 'NPN Transistor',
  pnp: 'PNP Transistor',
  nmos: 'N-MOSFET',
  pmos: 'P-MOSFET',
  opamp: 'Op-Amp',
  '555': '555 Timer',
  relay: 'Relay',
  servo: 'Micro Servo',
  dc_motor: 'DC Motor',
  ldr: 'Photoresistor (LDR)',
  ntc: 'NTC Thermistor',
  seven_segment: '7-Segment Display',
  char_lcd: 'LCD 16×2',
  led_matrix: 'LED Matrix 8×8',
  shift_register: '74HC595',
  ir_receiver: 'IR Receiver',
  temp_sensor: 'Temperature Sensor',
  eeprom: 'EEPROM',
  meter: 'Multimeter',
  mcu: 'MCU (STC12)',
  // Part-matrix burn-down: palette parts without BOM labels
  vsource: 'DC Supply',
  neopixel: 'NeoPixel (WS2812B)',
  tip120: 'TIP120 Darlington',
  relay_dpdt: 'Relay DPDT',
  slide_switch: 'Slide Switch',
  dip_switch: 'DIP Switch',
  photodiode: 'Photodiode',
  solar_cell: 'Solar Cell',
  light_bulb: 'Light Bulb',
  gearmotor: 'Gearmotor',
  vibration_motor: 'Vibration Motor',
  l293d: 'L293D H-Bridge',
  header: 'Pin Header',
  usb_a: 'USB-A Connector',
  ir_remote: 'IR Remote',
  pir_sensor: 'PIR Motion Sensor',
  ultrasonic: 'Ultrasonic (HC-SR04)',
  soil_moisture: 'Soil Moisture Sensor',
  gas_sensor: 'Gas Sensor (MQ)',
  tilt_sensor: 'Tilt Sensor',
  dht22: 'DHT22 Temp/Humidity',
  tmp36: 'TMP36 Temperature',
  ky002: 'KY-002 Vibration',
  char_lcd_i2c: 'LCD I²C',
  clock_display: 'Clock Display (TM1637)',
  ssd1306: 'OLED 128×64 (SSD1306)',
  seven_seg_3: '3-Digit 7-Segment',
  matrix8x8: 'LED Matrix 8×8',
  matrix16x8: 'LED Matrix 16×8',
  matrix9x9: 'LED Matrix 9×9',
  max7219: 'MAX7219 LED Driver',
  led_cube: 'LED Cube 4³',
  keypad: '4×4 Keypad',
  '74hc00': '74HC00 Quad NAND',
  '74hc02': '74HC02 Quad NOR',
  '74hc04': '74HC04 Hex NOT',
  '74hc08': '74HC08 Quad AND',
  '74hc32': '74HC32 Quad OR',
  '74hc86': '74HC86 Quad XOR',
  cd4093: 'CD4093 Quad NAND',
  at24c64: '24C64 EEPROM',
  pcf8574: 'PCF8574 I/O Expander',
  mcp4725: 'MCP4725 DAC',
  at89c2051: 'AT89C2051',
  attiny2313: 'ATtiny2313',
  attiny13: 'ATtiny13',
  arduino_uno: 'Arduino Uno',
  arduino_nano: 'Arduino Nano',
  pi_pico: 'Raspberry Pi Pico',
};

function paramKey(params) {
  return Object.entries(params || {})
    .filter(([k]) => k !== 'pins') // MCU pins vary, don't group by them
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join(',');
}

function describeParams(params) {
  if (!params || Object.keys(params).length === 0) return '';
  return Object.entries(params)
    .filter(([k]) => k !== 'pins')
    .map(([k, v]) => {
      const info = PARAM_LABELS[k];
      if (info) return `${info.format(v)}${info.unit}`;
      return `${k}=${v}`;
    })
    .join(', ');
}

/**
 * Generate a bill of materials from a circuit's parts.
 * @param {Array<{id: string, kind: string, params: Record<string,*>}>} parts
 * @returns {BomLine[]}
 */
export function generateBom(parts) {
  // Filter out UI-only and infrastructure parts
  const exclude = new Set(['vcc', 'gnd', 'meter', 'breadboard']);
  const eligible = parts.filter(p => !exclude.has(p.kind));

  // Group by kind + params
  const groups = new Map();
  for (const p of eligible) {
    const key = `${p.kind}|${paramKey(p.params)}`;
    if (!groups.has(key)) {
      groups.set(key, { kind: p.kind, params: { ...p.params }, ids: [] });
    }
    groups.get(key).ids.push(p.id);
  }

  return [...groups.values()].map(g => ({
    kind: g.kind,
    label: `${KIND_LABELS[g.kind] || g.kind}${describeParams(g.params) ? ' ' + describeParams(g.params) : ''}`,
    qty: g.ids.length,
    ids: g.ids,
    params: g.params,
  })).sort((a, b) => a.kind.localeCompare(b.kind) || a.label.localeCompare(b.label));
}

/**
 * Export BOM as CSV text.
 * @param {BomLine[]} bom
 * @returns {string}
 */
export function bomToCsv(bom) {
  const lines = ['Qty,Part,Value'];
  for (const line of bom) {
    lines.push(`${line.qty},"${line.label}","${describeParams(line.params)}"`);
  }
  return lines.join('\n');
}
