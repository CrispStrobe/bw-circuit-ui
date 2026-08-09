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
