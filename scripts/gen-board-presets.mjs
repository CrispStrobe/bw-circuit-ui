#!/usr/bin/env node
/**
 * Generate board-preset circuits — saved circuits representing specific
 * development boards with all peripherals wired.
 *
 * These are explicit parts+wires like the pedagogy ladder, NOT inferCircuit
 * presets. They represent the fixed PCB wiring of a physical board.
 *
 * Boards:
 *   YL-39   minimum-system STC89C52: 74HC595→4-digit 7-seg, 8 LEDs,
 *           4 buttons, buzzer, pot
 *   (PRECHIN A2 — future)
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'gallery');
mkdirSync(outDir, { recursive: true });

// ── helpers ──────────────────────────────────────────────────────────

function wire(from, fromTerminal, to, toTerminal) {
  return { from, fromTerminal, to, toTerminal };
}
function part(id, kind, params = {}, x = 0, y = 0) {
  return { id, kind, params, x, y };
}
function tieHigh(vccId, chipId, terminal) { return wire(vccId, 'vcc', chipId, terminal); }
function tieLow(gndId, chipId, terminal) { return wire(gndId, 'gnd', chipId, terminal); }

// stc_mcu uses uppercase VCC/GND terminal names
function powerMcu(vccId, gndId, mcuId) {
  return [wire(vccId, 'vcc', mcuId, 'VCC'), wire(gndId, 'gnd', mcuId, 'GND')];
}
// Standard ICs use lowercase vcc/gnd
function powerChipStd(vccId, gndId, chipId) {
  return [wire(vccId, 'vcc', chipId, 'vcc'), wire(gndId, 'gnd', chipId, 'gnd')];
}

// ── YL-39 minimum-system board ──────────────────────────────────────
//
// Physical board: STC89C52RC DIP-40, on-board 11.0592 MHz crystal,
// MAX232 for serial, ISP header. Peripherals:
//
//   8 LEDs:       P1.0-P1.7 (active low, each through 1kΩ to VCC)
//   4 buttons:    P3.2-P3.5 (active low to GND, internal pull-ups)
//   Buzzer:       P2.3 (active low, through NPN transistor)
//   Potentiometer: wiper → P1.0 (ADC0 on STC12 upgrade path)
//   4-digit 7-seg: 74HC595 drives segments (SER=P3.4, SRCLK=P3.6,
//                  RCLK=P3.5). Digit select: P2.4-P2.7 (active low,
//                  common-cathode via NPN)
//
// The STC89C52 and STC12C5A60S2 share the DIP-40 pinout, so this
// circuit works for either MCU. The pot is useful only with STC12
// (which has ADC); on STC89 it reads as digital GPIO.

function genYL39() {
  const parts = [
    part('vcc1', 'vcc'),
    part('gnd1', 'gnd'),
    part('mcu', 'stc_mcu'),

    // 74HC595 shift register — drives 7-segment segment lines
    part('sr1', '74hc595'),

    // 4-digit 7-segment display (common cathode)
    part('disp', 'seven_segment', { digits: 4 }),

    // 8 status LEDs on P1 (active low)
    ...Array.from({ length: 8 }, (_, i) =>
      part(`rl${i}`, 'resistor', { ohms: 1000 })),
    ...Array.from({ length: 8 }, (_, i) =>
      part(`led${i}`, 'led', { color: i < 4 ? 'green' : 'red' })),

    // 4 buttons (active low, momentary)
    ...Array.from({ length: 4 }, (_, i) =>
      part(`btn${i}`, 'button')),

    // Buzzer (active, driven low)
    part('buz', 'buzzer'),

    // Potentiometer (voltage divider for ADC)
    part('pot1', 'potentiometer', { ohms: 10000 }),
  ];

  const wires = [
    // ── Power ───────────────────────────────────────────────────────
    ...powerMcu('vcc1', 'gnd1', 'mcu'),
    ...powerChipStd('vcc1', 'gnd1', 'sr1'),

    // ── 74HC595 control lines ───────────────────────────────────────
    // SER (serial data in)  = P3.4 (T0)
    // SRCLK (shift clock)   = P3.6
    // RCLK (storage clock)  = P3.5 (T1)
    // OE tied low (outputs always enabled)
    // SRCLR tied high (never cleared)
    wire('mcu', 'P3.4', 'sr1', 'ser'),
    wire('mcu', 'P3.6', 'sr1', 'srclk'),
    wire('mcu', 'P3.5', 'sr1', 'rclk'),
    tieLow('gnd1', 'sr1', 'oe'),
    tieHigh('vcc1', 'sr1', 'srclr'),

    // ── 595 → 7-segment display ─────────────────────────────────────
    // QA output drives segment bus → display terminal "a"
    // (the seven_segment component has 2 terminals; this is the
    //  abstract data connection; rendering knows how to display digits)
    wire('sr1', 'qa', 'disp', 'a'),
    wire('gnd1', 'gnd', 'disp', 'b'),

    // ── Digit select (common cathode, active low via NPN) ───────────
    // P2.4-P2.7 select which digit is active. On the real board these
    // go through NPN transistors; in the circuit model the connection
    // is direct (the simulation layer handles drive capability).
    // (seven_segment only has 2 terminals, so digit select wires run
    //  to the MCU pins but the display renders all 4 digits)

    // ── 8 LEDs on P1.0-P1.7 (active low) ───────────────────────────
    // P1.x → resistor → LED anode; LED cathode → GND
    // Active low: MCU sinks current; LED lights when port pin = 0.
    // Wiring: P1.x → resistor.a; resistor.b → LED.anode; LED.cathode → VCC
    // (active low = current flows from VCC through LED through resistor into pin)
    ...Array.from({ length: 8 }, (_, i) => [
      wire('mcu', `P1.${i}`, `rl${i}`, 'a'),
      wire(`rl${i}`, 'b', `led${i}`, 'anode'),
      wire(`led${i}`, 'cathode', 'vcc1', 'vcc'),
    ]).flat(),

    // ── 4 buttons on P3.2-P3.5 (active low) ────────────────────────
    // Button press pulls pin to GND; internal pull-ups hold high.
    // P3.2 = INT0, P3.3 = INT1, P3.4 = T0, P3.5 = T1
    // (P3.4 and P3.5 are shared with 595 SER/RCLK on real board —
    //  jumper-selectable; here both are wired for schematic completeness)
    ...Array.from({ length: 4 }, (_, i) => [
      wire('mcu', `P3.${i + 2}`, `btn${i}`, 'a'),
      wire(`btn${i}`, 'b', 'gnd1', 'gnd'),
    ]).flat(),

    // ── Buzzer on P2.3 (active low) ─────────────────────────────────
    // On the real board: P2.3 → NPN base → buzzer between VCC and
    // collector. Simplified: MCU drives buzzer directly.
    wire('mcu', 'P2.3', 'buz', 'a'),
    wire('buz', 'b', 'gnd1', 'gnd'),

    // ── Potentiometer (voltage divider) ─────────────────────────────
    // VCC → pot terminal a; GND → pot terminal b; wiper → P1.0
    // On STC12: P1.0 has ADC0 function for reading the pot voltage.
    // On STC89: reads as digital (high/low at ~2.5 V threshold).
    wire('vcc1', 'vcc', 'pot1', 'a'),
    wire('gnd1', 'gnd', 'pot1', 'b'),
    wire('pot1', 'wiper', 'mcu', 'P1.0'),
  ];

  return {
    vcc: 5, parts, wires,
    _board: 'YL-39',
    _title: 'YL-39 minimum system',
    _device: 'stc89c52rc',
    _description: 'YL-39 minimum-system board: STC89C52RC with 8 LEDs (P1, active low), 4 buttons (P3.2-P3.5), buzzer (P2.3), potentiometer (P1.0), and 4-digit 7-segment display driven by 74HC595 shift register.',
  };
}

// ── PRECHIN A2 learning board ────────────────────────────────────────
//
// Full learning board: every peripheral a student encounters in a
// typical 8051 curriculum. STC89C52RC DIP-40 with:
//
//   8×8 LED matrix:   2× 74HC595 daisy-chained (SER=P3.4, SRCLK=P3.6,
//                     RCLK=P3.5). SR1 drives rows, SR2 columns.
//   4×4 keypad:       via 74C922 encoder (rows Y1-Y4, columns X1-X4).
//                     Encoded output A-D → P1.0-P1.3, DA → P3.2 (INT0).
//   DS1302 RTC:       3-wire: CE=P1.4, IO=P1.5, SCLK=P1.6
//   DS18B20 temp:     1-wire: DQ=P1.7 (4.7kΩ pull-up)
//   AT24C02 EEPROM:   I2C: SDA=P2.0, SCL=P2.1 (4.7kΩ pull-ups)
//   LCD1602:          8-bit data on P0, RS=P2.6, RW=P2.5, E=P2.7
//   IR receiver:      OUT=P3.3 (INT1)
//   Buzzer:           P2.2 (active low)
//
// XPT2046 touch controller is an optional header-connected module on
// these boards — omitted here to avoid pin conflicts on a 40-pin MCU.

function genPrechinA2() {
  const parts = [
    part('vcc1', 'vcc'),
    part('gnd1', 'gnd'),
    part('mcu', 'stc_mcu'),

    // 8×8 LED matrix: 2× 74HC595 daisy-chained
    part('sr1', '74hc595'),   // row driver
    part('sr2', '74hc595'),   // column driver (cascaded)
    part('matrix', 'led_matrix', { size: '8x8' }),

    // 4×4 keypad + 74C922 encoder
    part('keypad', 'keypad_4x4'),
    part('kpenc', '74c922'),

    // Peripherals
    part('rtc', 'ds1302'),
    part('temp', 'ds18b20'),
    part('eeprom', 'at24c02'),
    part('lcd', 'char_lcd'),
    part('ir', 'ir_receiver'),
    part('buz', 'buzzer'),

    // Pull-up resistors
    part('r_dq', 'resistor', { ohms: 4700 }),    // DS18B20 pull-up
    part('r_sda', 'resistor', { ohms: 4700 }),   // I2C SDA pull-up
    part('r_scl', 'resistor', { ohms: 4700 }),   // I2C SCL pull-up
    part('r_bl', 'resistor', { ohms: 100 }),      // LCD backlight
  ];

  const wires = [
    // ── Power ───────────────────────────────────────────────────────
    ...powerMcu('vcc1', 'gnd1', 'mcu'),
    ...powerChipStd('vcc1', 'gnd1', 'sr1'),
    ...powerChipStd('vcc1', 'gnd1', 'sr2'),
    // 74C922: vcc/vss
    wire('vcc1', 'vcc', 'kpenc', 'vcc'),
    wire('gnd1', 'gnd', 'kpenc', 'vss'),
    // DS1302: vcc/gnd + battery backup
    wire('vcc1', 'vcc', 'rtc', 'vcc'),
    wire('gnd1', 'gnd', 'rtc', 'gnd'),
    wire('vcc1', 'vcc', 'rtc', 'vcc1'),  // backup battery (tied to VCC)
    // DS18B20
    wire('vcc1', 'vcc', 'temp', 'vcc'),
    wire('gnd1', 'gnd', 'temp', 'gnd'),
    // AT24C02
    wire('vcc1', 'vcc', 'eeprom', 'vcc'),
    wire('gnd1', 'gnd', 'eeprom', 'gnd'),
    // LCD1602
    wire('vcc1', 'vcc', 'lcd', 'vdd'),
    wire('gnd1', 'gnd', 'lcd', 'vss'),
    // IR receiver
    wire('vcc1', 'vcc', 'ir', 'vcc'),
    wire('gnd1', 'gnd', 'ir', 'gnd'),

    // ── 8×8 LED matrix (2× 74HC595 daisy-chain) ────────────────────
    // SR1 (rows): SER=P3.4, SRCLK=P3.6, RCLK=P3.5
    wire('mcu', 'P3.4', 'sr1', 'ser'),
    wire('mcu', 'P3.6', 'sr1', 'srclk'),
    wire('mcu', 'P3.5', 'sr1', 'rclk'),
    tieLow('gnd1', 'sr1', 'oe'),
    tieHigh('vcc1', 'sr1', 'srclr'),
    // SR2 (columns): cascaded from SR1's serial out, shared clocks
    wire('sr1', 'qh_s', 'sr2', 'ser'),
    wire('mcu', 'P3.6', 'sr2', 'srclk'),
    wire('mcu', 'P3.5', 'sr2', 'rclk'),
    tieLow('gnd1', 'sr2', 'oe'),
    tieHigh('vcc1', 'sr2', 'srclr'),
    // SR1/SR2 outputs → LED matrix (abstract: 2-terminal display)
    wire('sr1', 'qa', 'matrix', 'a'),
    wire('gnd1', 'gnd', 'matrix', 'b'),

    // ── 4×4 keypad → 74C922 encoder ────────────────────────────────
    // Keypad rows → 74C922 row inputs
    wire('keypad', 'r0', 'kpenc', 'y1'),
    wire('keypad', 'r1', 'kpenc', 'y2'),
    wire('keypad', 'r2', 'kpenc', 'y3'),
    wire('keypad', 'r3', 'kpenc', 'y4'),
    // Keypad columns → 74C922 column inputs
    wire('keypad', 'c0', 'kpenc', 'x1'),
    wire('keypad', 'c1', 'kpenc', 'x2'),
    wire('keypad', 'c2', 'kpenc', 'x3'),
    // X4 unused (keypad_4x4 has only 3 columns); tie to VCC
    tieHigh('vcc1', 'kpenc', 'x4'),
    // 74C922 encoded output → MCU P1.0-P1.3
    wire('kpenc', 'a', 'mcu', 'P1.0'),
    wire('kpenc', 'b', 'mcu', 'P1.1'),
    wire('kpenc', 'c', 'mcu', 'P1.2'),
    wire('kpenc', 'd', 'mcu', 'P1.3'),
    // DA (data available) → P3.2 (INT0)
    wire('kpenc', 'da', 'mcu', 'P3.2'),
    // OEB tied low (outputs always enabled)
    tieLow('gnd1', 'kpenc', 'oeb'),
    // OSC and KBM: timing caps (simplified: tie to GND)
    tieLow('gnd1', 'kpenc', 'osc'),
    tieLow('gnd1', 'kpenc', 'kbm'),

    // ── DS1302 RTC (3-wire) ─────────────────────────────────────────
    wire('mcu', 'P1.4', 'rtc', 'ce'),
    wire('mcu', 'P1.5', 'rtc', 'io'),
    wire('mcu', 'P1.6', 'rtc', 'sclk'),
    // X1, X2: crystal oscillator (artwork-only, no wire needed)

    // ── DS18B20 temperature sensor (1-wire) ─────────────────────────
    wire('mcu', 'P1.7', 'temp', 'dq'),
    // 4.7kΩ pull-up on DQ line
    wire('temp', 'dq', 'r_dq', 'a'),
    wire('r_dq', 'b', 'vcc1', 'vcc'),

    // ── AT24C02 I2C EEPROM ──────────────────────────────────────────
    wire('mcu', 'P2.0', 'eeprom', 'sda'),
    wire('mcu', 'P2.1', 'eeprom', 'scl'),
    // Address lines tied low (device address 0x50)
    tieLow('gnd1', 'eeprom', 'a0'),
    tieLow('gnd1', 'eeprom', 'a1'),
    tieLow('gnd1', 'eeprom', 'a2'),
    // WP tied low (write enabled)
    tieLow('gnd1', 'eeprom', 'wp'),
    // I2C pull-ups (4.7kΩ each)
    wire('mcu', 'P2.0', 'r_sda', 'a'),
    wire('r_sda', 'b', 'vcc1', 'vcc'),
    wire('mcu', 'P2.1', 'r_scl', 'a'),
    wire('r_scl', 'b', 'vcc1', 'vcc'),

    // ── LCD1602 (8-bit mode) ────────────────────────────────────────
    // Data bus: P0.0-P0.7 → D0-D7
    ...Array.from({ length: 8 }, (_, i) =>
      wire('mcu', `P0.${i}`, 'lcd', `d${i}`)),
    // Control: RS=P2.6, RW=P2.5, E=P2.7
    wire('mcu', 'P2.6', 'lcd', 'rs'),
    wire('mcu', 'P2.5', 'lcd', 'rw'),
    wire('mcu', 'P2.7', 'lcd', 'e'),
    // V0 (contrast) tied to GND (max contrast)
    wire('gnd1', 'gnd', 'lcd', 'v0'),
    // Backlight: A → resistor → VCC; K → GND
    wire('lcd', 'a', 'r_bl', 'a'),
    wire('r_bl', 'b', 'vcc1', 'vcc'),
    wire('gnd1', 'gnd', 'lcd', 'k'),

    // ── IR receiver ─────────────────────────────────────────────────
    wire('ir', 'out', 'mcu', 'P3.3'),

    // ── Buzzer on P2.2 (active low) ─────────────────────────────────
    wire('mcu', 'P2.2', 'buz', 'a'),
    wire('gnd1', 'gnd', 'buz', 'b'),
  ];

  return {
    vcc: 5, parts, wires,
    _board: 'PRECHIN-A2',
    _title: 'PRECHIN A2 learning board',
    _device: 'stc89c52rc',
    _description: 'PRECHIN A2 full learning board: STC89C52RC with 8×8 LED matrix (2× 74HC595), 4×4 keypad (74C922 encoder), DS1302 RTC, DS18B20 temp sensor, AT24C02 I2C EEPROM, LCD1602, IR receiver, and buzzer. Every peripheral a student encounters in a typical 8051 curriculum.',
  };
}

// ── Write all boards ────────────────────────────────────────────────

const boards = [genYL39, genPrechinA2];
for (const gen of boards) {
  const circuit = gen();
  const slug = circuit._board.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-$/, '');
  const path = join(outDir, `board-${slug}.json`);
  writeFileSync(path, JSON.stringify(circuit, null, 2) + '\n');
  console.log(`${circuit._board}: ${circuit.parts.length} parts, ${circuit.wires.length} wires → ${path}`);
}
