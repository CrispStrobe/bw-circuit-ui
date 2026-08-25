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
 *   PRECHIN A2 learning board (bench-verified 2026-08-25)
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
// This wiring was measured on the physical board, rather than copied from
// the differently-routed schematic revision found on the vendor DVD:
//
//   8×8 LED matrix:   one 74HC595 drives rows (SER=P3.4, SRCLK=P3.6,
//                     RCLK=P3.5); P0 drives active-low columns. J24 selects
//                     OE→GND (matrix) or OE→VCC (LCD/no matrix).
//   4×4 keypad:       direct matrix on P1.7..P1.0, no 74C922.
//   DS1302 RTC:       3-wire: IO=P3.4, CE=P3.5, SCLK=P3.6
//   DS18B20 temp:     1-wire: DQ=P3.7 (J12 fitted)
//   AT24C02 EEPROM:   I2C: SDA=P2.0, SCL=P2.1 (4.7kΩ pull-ups)
//   LCD1602:          4-bit D4-D7=P0.4-P0.7, RS=P2.6, RW=P2.5, E=P2.7
//   IR receiver:      OUT=P3.2 (INT0)
//   Buzzer:           P2.5 (shared with LCD RW and LED D6)
//   ET/XPT2046 ADC:   DIN/CS/DCLK/DOUT=P3.4/P3.5/P3.6/P3.7
//   independent keys: K1..K4=P3.1/P3.0/P3.2/P3.3 (active-low)
//
// Several nets deliberately have more than one function. That conflict is
// the board's central lesson, not a modelling error.

function genPrechinA2() {
  const parts = [
    part('vcc1', 'vcc'),
    part('gnd1', 'gnd'),
    part('mcu', 'stc_mcu'),

    // 8×8 LED matrix: one 74HC595 for rows, P0 for columns
    part('sr1', '74hc595'),   // row driver
    part('matrix', 'matrix8x8', { colActiveHigh: false, rowActiveHigh: true }),
    part('j24', 'slide_switch', { position: 'b' }), // B=OE high: LCD position

    // Direct-wired 4×4 keypad
    part('keypad', 'keypad_4x4'),

    // Peripherals
    part('rtc', 'ds1302'),
    part('temp', 'ds18b20'),
    part('eeprom', 'at24c02'),
    part('lcd', 'char_lcd'),
    part('ir', 'ir_receiver'),
    part('buz', 'buzzer'),
    part('adc', 'xpt2046', { vbatDivider: false }),
    part('pot_a0', 'potentiometer', { ohms: 5000, position: 0.5 }),
    part('ntc_a1', 'ntc', { ohms: 10000 }),
    part('ldr_a2', 'ldr', { ohms: 10000 }),
  part('sevenseg', 'sevenseg8'),
    part('leds', 'ledbank8', { activeLow: true }),
    ...Array.from({ length: 4 }, (_, i) => part(`key${i + 1}`, 'button')),

    // Pull-up resistors
    part('r_dq', 'resistor', { ohms: 4700 }),    // DS18B20 pull-up
    part('r_sda', 'resistor', { ohms: 4700 }),   // I2C SDA pull-up
    part('r_scl', 'resistor', { ohms: 4700 }),   // I2C SCL pull-up
    part('r_ntc', 'resistor', { ohms: 10000 }),  // A1 divider
    part('r_ldr', 'resistor', { ohms: 10000 }),  // A2 divider
    part('r_bl', 'resistor', { ohms: 100 }),      // LCD backlight
  ];

  const wires = [
    // ── Power ───────────────────────────────────────────────────────
    ...powerMcu('vcc1', 'gnd1', 'mcu'),
    ...powerChipStd('vcc1', 'gnd1', 'sr1'),
    // J24: OE is switchable between GND (matrix enabled) and VCC (disabled).
    // The generated preset starts in the LCD-safe OE→VCC position.
    wire('gnd1', 'gnd', 'j24', 'a'),
    wire('vcc1', 'vcc', 'j24', 'b'),
    wire('j24', 'com', 'sr1', 'oe'),
    // DS1302: vcc/gnd. VCC1 is intentionally left unpowered: the tested
    // board did not retain valid/counting registers after main power loss.
    wire('vcc1', 'vcc', 'rtc', 'vcc'),
    wire('gnd1', 'gnd', 'rtc', 'gnd'),
    // DS18B20
    wire('vcc1', 'vcc', 'temp', 'vcc'),
    wire('gnd1', 'gnd', 'temp', 'gnd'),
    // AT24C02
    wire('vcc1', 'vcc', 'eeprom', 'vcc'),
    wire('gnd1', 'gnd', 'eeprom', 'gnd'),
    // LCD1602
    wire('vcc1', 'vcc', 'lcd', 'vcc'),
    wire('gnd1', 'gnd', 'lcd', 'gnd'),
    // IR receiver
    wire('vcc1', 'vcc', 'ir', 'vcc'),
    wire('gnd1', 'gnd', 'ir', 'gnd'),

    // ── 8×8 LED matrix ─────────────────────────────────────────────
    wire('mcu', 'P3.4', 'sr1', 'ser'),
    wire('mcu', 'P3.6', 'sr1', 'srclk'),
    wire('mcu', 'P3.5', 'sr1', 'rclk'),
    tieHigh('vcc1', 'sr1', 'srclr'),
    ...Array.from({ length: 8 }, (_, i) =>
      wire('mcu', `P0.${7 - i}`, 'matrix', `col${i}`)),
    ...Array.from({ length: 8 }, (_, i) =>
      wire('sr1', ['qh', 'qg', 'qf', 'qe', 'qd', 'qc', 'qb', 'qa'][i], 'matrix', `row${i}`)),

    // ── Direct 4×4 keypad ──────────────────────────────────────────
    ...Array.from({ length: 4 }, (_, i) =>
      wire('mcu', `P1.${7 - i}`, 'keypad', `r${i}`)),
    ...Array.from({ length: 4 }, (_, i) =>
      wire('mcu', `P1.${3 - i}`, 'keypad', `c${i}`)),

    // ── DS1302 RTC (3-wire) ─────────────────────────────────────────
    wire('mcu', 'P3.4', 'rtc', 'io'),
    wire('mcu', 'P3.5', 'rtc', 'ce'),
    wire('mcu', 'P3.6', 'rtc', 'sclk'),
    // X1, X2: crystal oscillator (artwork-only, no wire needed)

    // ── DS18B20 temperature sensor (1-wire) ─────────────────────────
    wire('mcu', 'P3.7', 'temp', 'dq'),
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

    // ── LCD1602 (vendor example 18: 4-bit mode) ─────────────────────
    ...Array.from({ length: 4 }, (_, i) =>
      wire('mcu', `P0.${i + 4}`, 'lcd', `d${i + 4}`)),
    // Control: RS=P2.6, RW=P2.5, E=P2.7
    wire('mcu', 'P2.6', 'lcd', 'rs'),
    wire('mcu', 'P2.5', 'lcd', 'rw'),
    wire('mcu', 'P2.7', 'lcd', 'e'),
    // V0 (contrast) tied to GND (max contrast)
    wire('gnd1', 'gnd', 'lcd', 'vo'),
    // Backlight: A → resistor → VCC; K → GND
    wire('lcd', 'bl_a', 'r_bl', 'a'),
    wire('r_bl', 'b', 'vcc1', 'vcc'),
    wire('gnd1', 'gnd', 'lcd', 'bl_k'),

    // ── IR receiver ─────────────────────────────────────────────────
    wire('ir', 'out', 'mcu', 'P3.2'),

    // ── Buzzer on P2.5 (shared with LCD RW and LED D6) ──────────────
    wire('mcu', 'P2.5', 'buz', 'a'),
    wire('gnd1', 'gnd', 'buz', 'b'),

    // ── ET/XPT2046 ADC and its three onboard sources ────────────────
    ...powerChipStd('vcc1', 'gnd1', 'adc'),
    wire('mcu', 'P3.4', 'adc', 'din'),
    wire('mcu', 'P3.5', 'adc', 'csb'),
    wire('mcu', 'P3.6', 'adc', 'dclk'),
    wire('adc', 'dout', 'mcu', 'P3.7'),
    wire('vcc1', 'vcc', 'pot_a0', 'a'), wire('gnd1', 'gnd', 'pot_a0', 'b'),
    wire('pot_a0', 'wiper', 'adc', 'yp'),
    wire('vcc1', 'vcc', 'ntc_a1', 'a'), wire('ntc_a1', 'b', 'adc', 'vbat'),
    wire('adc', 'vbat', 'r_ntc', 'a'), wire('r_ntc', 'b', 'gnd1', 'gnd'),
    wire('vcc1', 'vcc', 'ldr_a2', 'a'), wire('ldr_a2', 'b', 'adc', 'xp'),
    wire('adc', 'xp', 'r_ldr', 'a'), wire('r_ldr', 'b', 'gnd1', 'gnd'),

    // ── Two 4-digit displays and the active-low D1-D8 row ───────────
    wire('vcc1', 'vcc', 'sevenseg', 'vcc'), wire('gnd1', 'gnd', 'sevenseg', 'gnd'),
    ...['seg_a', 'seg_b', 'seg_c', 'seg_d', 'seg_e', 'seg_f', 'seg_g', 'seg_dp']
      .map((terminal, i) => wire('mcu', `P0.${i}`, 'sevenseg', terminal)),
    wire('mcu', 'P2.2', 'sevenseg', 'sel_a'),
    wire('mcu', 'P2.3', 'sevenseg', 'sel_b'),
    wire('mcu', 'P2.4', 'sevenseg', 'sel_c'),
    wire('vcc1', 'vcc', 'leds', 'vcc'), wire('gnd1', 'gnd', 'leds', 'gnd'),
    ...Array.from({ length: 8 }, (_, i) => wire('mcu', `P2.${i}`, 'leds', `d${i}`)),

    // ── Independent keys (P5 UART shunts must be removed for K1/K2) ─
    ...[[1, 1], [2, 0], [3, 2], [4, 3]].map(([key, bit]) => [
      wire('mcu', `P3.${bit}`, `key${key}`, 'a'),
      wire(`key${key}`, 'b', 'gnd1', 'gnd'),
    ]).flat(),
  ];

  return {
    vcc: 5, parts, wires,
    _board: 'PRECHIN-A2',
    _title: 'PRECHIN A2 learning board',
    _device: 'stc89c52rc',
    _description: 'Bench-verified PRECHIN A2: STC89C52RC, one-74HC595 8×8 matrix, direct P1 keypad, 8-digit 7-segment display, active-low LED row, ET/XPT2046 ADC, DS1302, DS18B20, AT24C02, 4-bit LCD1602, IR, keys, and P2.5 buzzer. Shared nets and jumper-dependent conflicts are represented deliberately.',
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
