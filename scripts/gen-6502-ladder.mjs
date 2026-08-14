#!/usr/bin/env node
/**
 * Generate the 6502 pedagogy ladder — E0 through E6.
 *
 * Merged order from the 16-source breadboard survey:
 *   E0   clock module: 555 astable + single-step button
 *   E1   CPU-alive: strapped pins, status LEDs (CLK/RWB/SYNC/VPB),
 *        address LEDs A0-A7, NOP free-run
 *   E2   ROM-only + data-bus LEDs (write-to-unmapped teachable moment)
 *   E4   +W65C22 VIA blink (port B LEDs)
 *   E5   +HD44780 LCD hello
 *   E6   full EATER6502: RAM + ACIA + complete decode (extractor-verified)
 *
 * E1.5 (static-clock), E2.5 (6507SBC), E3 (74HC374 latch) are future rungs.
 *
 * Clean-room: wiring facts and addresses only; no text or code from source blogs.
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
function busA(cpuId, chipId, bits) {
  return bits.map(b => wire(cpuId, `a${b}`, chipId, `a${b}`));
}
function busD(cpuId, chipId) {
  return Array.from({ length: 8 }, (_, i) => wire(cpuId, `d${i}`, chipId, `d${i}`));
}
function controlWires(cpuId, chipId, { rwb = true, phi2 = true } = {}) {
  const w = [];
  if (rwb) w.push(wire(cpuId, 'rwb', chipId, 'rwb'));
  if (phi2) w.push(wire(cpuId, 'phi2', chipId, 'phi2'));
  return w;
}
function tieHigh(vccId, chipId, terminal) { return wire(vccId, 'vcc', chipId, terminal); }
function tieLow(gndId, chipId, terminal) { return wire(gndId, 'gnd', chipId, terminal); }
function powerChip(vccId, gndId, chipId, { vdd = 'vdd', vss = 'vss' } = {}) {
  return [wire(vccId, 'vcc', chipId, vdd), wire(gndId, 'gnd', chipId, vss)];
}
function powerChipStd(vccId, gndId, chipId) {
  return [wire(vccId, 'vcc', chipId, 'vcc'), wire(gndId, 'gnd', chipId, 'gnd')];
}

/** Status LED: signal → resistor → LED → GND. */
function statusLed(signalPart, signalTerminal, rId, ledId, gndId, color = 'yellow') {
  return {
    parts: [
      part(rId, 'resistor', { ohms: 220 }),
      part(ledId, 'led', { color }),
    ],
    wires: [
      wire(signalPart, signalTerminal, rId, 'a'),
      wire(rId, 'b', ledId, 'anode'),
      wire(ledId, 'cathode', gndId, 'gnd'),
    ],
  };
}

// ── E0: clock module ─────────────────────────────────────────────────
// 555 in astable mode + a button for single-step.
// The clock output drives a status LED — this is the very first thing
// a builder assembles before the CPU is even on the board.

function genE0() {
  const parts = [
    part('vcc1', 'vcc'),
    part('gnd1', 'gnd'),
    // 555 astable oscillator
    part('timer', '555'),
    // Timing components: R1 (VCC→DIS), R2 (DIS→THR/TRIG), C1 (THR/TRIG→GND)
    part('r1', 'resistor', { ohms: 1000 }),   // 1kΩ
    part('r2', 'resistor', { ohms: 470000 }), // 470kΩ (slow ~1 Hz blink)
    part('c1', 'capacitor', { farads: 1e-6 }), // 1µF
    // Decoupling cap on control pin
    part('c2', 'capacitor', { farads: 10e-9 }), // 10nF
    // Single-step button (active-low clock pulse)
    part('btn', 'button'),
    part('r_debounce', 'resistor', { ohms: 1000 }),
    // Output LED
    part('r_clk', 'resistor', { ohms: 220 }),
    part('led_clk', 'led', { color: 'green' }),
  ];

  const wires = [
    // 555 power
    wire('vcc1', 'vcc', 'timer', 'vcc'),
    wire('gnd1', 'gnd', 'timer', 'gnd'),
    // Reset tied high (not in reset)
    tieHigh('vcc1', 'timer', 'reset'),
    // Astable wiring: VCC → R1 → DISCHARGE, R1-DIS junction also → R2 → THR/TRIG
    wire('vcc1', 'vcc', 'r1', 'a'),
    wire('r1', 'b', 'timer', 'discharge'),
    wire('r1', 'b', 'r2', 'a'),
    wire('r2', 'b', 'timer', 'threshold'),
    wire('r2', 'b', 'timer', 'trigger'),
    // Timing capacitor: THR/TRIG → C1 → GND
    wire('r2', 'b', 'c1', 'a'),
    wire('c1', 'b', 'gnd1', 'gnd'),
    // Control pin decoupling: CONTROL → C2 → GND
    wire('timer', 'control', 'c2', 'a'),
    wire('c2', 'b', 'gnd1', 'gnd'),
    // Output LED: OUTPUT → R → LED → GND
    wire('timer', 'output', 'r_clk', 'a'),
    wire('r_clk', 'b', 'led_clk', 'anode'),
    wire('led_clk', 'cathode', 'gnd1', 'gnd'),
    // Single-step button: VCC → R_debounce → button → GND
    // (button press pulls trigger low for manual stepping)
    wire('vcc1', 'vcc', 'r_debounce', 'a'),
    wire('r_debounce', 'b', 'btn', 'a'),
    wire('btn', 'b', 'gnd1', 'gnd'),
  ];

  return {
    vcc: 5, parts, wires,
    _stage: 'E0', _title: 'Clock module',
    _description: 'A 555 timer in astable mode generates the system clock (~1 Hz). The green LED blinks with each tick. A button provides single-step capability.',
  };
}

// ── E1: CPU-alive ────────────────────────────────────────────────────
// W65C02 with all pins properly strapped. Status LEDs on CLK (phi2o),
// RWB, SYNC, VPB. Address LEDs on A0-A7. NOP ($EA) on the data bus
// via resistors. The CPU free-runs: the address LEDs count up.

function genE1() {
  const parts = [
    part('vcc1', 'vcc'),
    part('gnd1', 'gnd'),
    part('cpu', 'w65c02'),
    // NOP resistors ($EA = 11101010)
    ...Array.from({ length: 8 }, (_, i) =>
      part(`rd${i}`, 'resistor', { ohms: 1000 })),
    // Address LEDs A0-A7
    ...Array.from({ length: 8 }, (_, i) =>
      part(`ra${i}`, 'resistor', { ohms: 220 })),
    ...Array.from({ length: 8 }, (_, i) =>
      part(`la${i}`, 'led', { color: 'green' })),
  ];

  const nopBits = [0, 1, 0, 1, 0, 1, 1, 1]; // d0..d7 for $EA

  const wires = [
    ...powerChip('vcc1', 'gnd1', 'cpu'),
    // Strap pins: hold the CPU in a known-good state
    tieHigh('vcc1', 'cpu', 'resb'),  // not in reset
    tieHigh('vcc1', 'cpu', 'irqb'),  // no interrupts
    tieHigh('vcc1', 'cpu', 'nmib'),  // no NMI
    tieHigh('vcc1', 'cpu', 'be'),    // bus enabled
    tieHigh('vcc1', 'cpu', 'rdy'),   // not stalled
    tieHigh('vcc1', 'cpu', 'sob'),   // set overflow clear
    // NOP pattern on data bus via resistors
    ...Array.from({ length: 8 }, (_, i) => {
      const src = nopBits[i] ? 'vcc1' : 'gnd1';
      const srcTerm = nopBits[i] ? 'vcc' : 'gnd';
      return [
        wire(src, srcTerm, `rd${i}`, 'a'),
        wire(`rd${i}`, 'b', 'cpu', `d${i}`),
      ];
    }).flat(),
    // Address LEDs A0-A7
    ...Array.from({ length: 8 }, (_, i) => [
      wire('cpu', `a${i}`, `ra${i}`, 'a'),
      wire(`ra${i}`, 'b', `la${i}`, 'anode'),
      wire(`la${i}`, 'cathode', 'gnd1', 'gnd'),
    ]).flat(),
  ];

  // Status LEDs: PHI2O (clock), RWB (read/write), SYNC (opcode fetch), VPB (vector pull)
  const statusSignals = [
    { part: 'cpu', terminal: 'phi2o', prefix: 'clk', color: 'yellow' },
    { part: 'cpu', terminal: 'rwb',   prefix: 'rw',  color: 'red' },
    { part: 'cpu', terminal: 'sync',  prefix: 'syn', color: 'blue' },
    { part: 'cpu', terminal: 'vpb',   prefix: 'vpb', color: 'white' },
  ];
  for (const s of statusSignals) {
    const sl = statusLed(s.part, s.terminal, `r_${s.prefix}`, `led_${s.prefix}`, 'gnd1', s.color);
    parts.push(...sl.parts);
    wires.push(...sl.wires);
  }

  return {
    vcc: 5, parts, wires,
    _stage: 'E1', _title: 'CPU alive',
    _description: 'The W65C02 free-runs NOP ($EA). Address LEDs count up. Status LEDs show clock (PHI2O), read/write (RWB), opcode fetch (SYNC), and vector pull (VPB).',
  };
}

// ── E2: ROM-only + data-bus LEDs ─────────────────────────────────────
// 28C256 ROM wired to the CPU with CSB tied low (full address space).
// Data-bus LEDs added — in single-step mode, you can see each byte
// the CPU reads. The teachable moment: a store to unmapped RAM shows
// the written value on the bus, then it vanishes on the next cycle.

function genE2() {
  const parts = [
    part('vcc1', 'vcc'),
    part('gnd1', 'gnd'),
    part('cpu', 'w65c02'),
    part('rom', '28c256'),
    // Address LEDs A0-A7
    ...Array.from({ length: 8 }, (_, i) =>
      part(`ra${i}`, 'resistor', { ohms: 220 })),
    ...Array.from({ length: 8 }, (_, i) =>
      part(`la${i}`, 'led', { color: 'green' })),
    // Data-bus LEDs D0-D7
    ...Array.from({ length: 8 }, (_, i) =>
      part(`rd${i}`, 'resistor', { ohms: 220 })),
    ...Array.from({ length: 8 }, (_, i) =>
      part(`ld${i}`, 'led', { color: 'yellow' })),
  ];

  // Status LEDs (same as E1)
  const statusSignals = [
    { part: 'cpu', terminal: 'phi2o', prefix: 'clk', color: 'yellow' },
    { part: 'cpu', terminal: 'rwb',   prefix: 'rw',  color: 'red' },
    { part: 'cpu', terminal: 'sync',  prefix: 'syn', color: 'blue' },
  ];
  for (const s of statusSignals) {
    const sl = statusLed(s.part, s.terminal, `rs_${s.prefix}`, `ls_${s.prefix}`, 'gnd1', s.color);
    parts.push(...sl.parts);
  }

  const wires = [
    ...powerChip('vcc1', 'gnd1', 'cpu'),
    ...powerChipStd('vcc1', 'gnd1', 'rom'),
    tieHigh('vcc1', 'cpu', 'resb'),
    tieHigh('vcc1', 'cpu', 'irqb'),
    tieHigh('vcc1', 'cpu', 'nmib'),
    tieHigh('vcc1', 'cpu', 'be'),
    tieHigh('vcc1', 'cpu', 'rdy'),
    tieHigh('vcc1', 'cpu', 'sob'),
    // ROM: always selected, read-only
    tieLow('gnd1', 'rom', 'csb'),
    tieLow('gnd1', 'rom', 'oeb'),
    tieHigh('vcc1', 'rom', 'web'),
    ...busA('cpu', 'rom', Array.from({ length: 15 }, (_, i) => i)),
    ...busD('cpu', 'rom'),
    // Address LEDs
    ...Array.from({ length: 8 }, (_, i) => [
      wire('cpu', `a${i}`, `ra${i}`, 'a'),
      wire(`ra${i}`, 'b', `la${i}`, 'anode'),
      wire(`la${i}`, 'cathode', 'gnd1', 'gnd'),
    ]).flat(),
    // Data-bus LEDs (high-impedance tap — the bus drives them)
    ...Array.from({ length: 8 }, (_, i) => [
      wire('cpu', `d${i}`, `rd${i}`, 'a'),
      wire(`rd${i}`, 'b', `ld${i}`, 'anode'),
      wire(`ld${i}`, 'cathode', 'gnd1', 'gnd'),
    ]).flat(),
  ];

  // Wire status LED wires
  for (const s of statusSignals) {
    const sl = statusLed(s.part, s.terminal, `rs_${s.prefix}`, `ls_${s.prefix}`, 'gnd1', s.color);
    wires.push(...sl.wires);
  }

  return {
    vcc: 5, parts, wires,
    _stage: 'E2', _title: 'ROM only',
    _description: 'A 28C256 EEPROM covers the full address space. Data-bus LEDs show each byte. In single-step: a write to unmapped RAM shows the value on the bus, then it vanishes — the first lesson in memory mapping.',
  };
}

// ── E4: VIA blink ────────────────────────────────────────────────────
// W65C22 VIA at $6000 (coarse decode: CS2B=A15, CS1=A14).
// Port B drives 8 LEDs. ROM decode: NOT(A15) via NAND.

function genE4() {
  const parts = [
    part('vcc1', 'vcc'),
    part('gnd1', 'gnd'),
    part('cpu', 'w65c02'),
    part('rom', '28c256'),
    part('via1', 'w65c22'),
    part('nand1', '74hc00'),
    // 8 LEDs on VIA port B
    ...Array.from({ length: 8 }, (_, i) =>
      part(`rl${i}`, 'resistor', { ohms: 220 })),
    ...Array.from({ length: 8 }, (_, i) =>
      part(`led${i}`, 'led', { color: 'red' })),
  ];

  const wires = [
    ...powerChip('vcc1', 'gnd1', 'cpu'),
    ...powerChipStd('vcc1', 'gnd1', 'rom'),
    ...powerChip('vcc1', 'gnd1', 'via1'),
    ...powerChipStd('vcc1', 'gnd1', 'nand1'),
    tieHigh('vcc1', 'cpu', 'resb'),
    tieHigh('vcc1', 'cpu', 'irqb'),
    tieHigh('vcc1', 'cpu', 'nmib'),
    tieHigh('vcc1', 'cpu', 'be'),
    tieHigh('vcc1', 'cpu', 'rdy'),
    tieHigh('vcc1', 'cpu', 'sob'),
    tieHigh('vcc1', 'via1', 'resb'),
    // ROM: NOT(A15) → CSB via NAND gate
    wire('cpu', 'a15', 'nand1', '1a'),
    wire('cpu', 'a15', 'nand1', '1b'),
    wire('nand1', '1y', 'rom', 'csb'),
    tieLow('gnd1', 'rom', 'oeb'),
    tieHigh('vcc1', 'rom', 'web'),
    ...busA('cpu', 'rom', Array.from({ length: 15 }, (_, i) => i)),
    ...busD('cpu', 'rom'),
    // VIA: CS2B=A15, CS1=A14 (coarse decode: $4000-$7FFF)
    wire('cpu', 'a15', 'via1', 'cs2b'),
    wire('cpu', 'a14', 'via1', 'cs1'),
    wire('cpu', 'a0', 'via1', 'rs0'),
    wire('cpu', 'a1', 'via1', 'rs1'),
    wire('cpu', 'a2', 'via1', 'rs2'),
    wire('cpu', 'a3', 'via1', 'rs3'),
    ...busD('cpu', 'via1'),
    ...controlWires('cpu', 'via1'),
    // VIA port B → LEDs
    ...Array.from({ length: 8 }, (_, i) => [
      wire('via1', `pb${i}`, `rl${i}`, 'a'),
      wire(`rl${i}`, 'b', `led${i}`, 'anode'),
      wire(`led${i}`, 'cathode', 'gnd1', 'gnd'),
    ]).flat(),
    // Unused NAND gates
    tieHigh('vcc1', 'nand1', '2a'), tieHigh('vcc1', 'nand1', '2b'),
    tieHigh('vcc1', 'nand1', '3a'), tieHigh('vcc1', 'nand1', '3b'),
    tieHigh('vcc1', 'nand1', '4a'), tieHigh('vcc1', 'nand1', '4b'),
  ];

  return {
    vcc: 5, parts, wires,
    _stage: 'E4', _title: 'VIA blink',
    _description: 'W65C22 VIA at $4000-$7FFF (coarse decode). Port B drives 8 LEDs. The first I/O chip on the bus.',
  };
}

// ── E5: +HD44780 LCD ─────────────────────────────────────────────────

function genE5() {
  const base = genE4();
  base.parts.push(part('lcd1', 'char_lcd'));
  base.wires.push(
    ...Array.from({ length: 8 }, (_, i) =>
      wire('via1', `pa${i}`, 'lcd1', `d${i}`)),
    wire('via1', 'cb1', 'lcd1', 'e'),
    wire('via1', 'cb2', 'lcd1', 'rs'),
    tieLow('gnd1', 'lcd1', 'rw'),
    ...powerChipStd('vcc1', 'gnd1', 'lcd1'),
  );
  base._stage = 'E5';
  base._title = 'LCD hello';
  base._description = 'HD44780 LCD on VIA port A. The classic "Hello, world!" of retro computing.';
  return base;
}

// ── E6: full EATER6502 ──────────────────────────────────────────────
// RAM $0000-$3FFF, ROM $8000-$FFFF, VIA $6000, ACIA $5000.
// Full decode with 2× 74HC00. Extractor-verified = EATER6502 preset.

function genE6() {
  const parts = [
    part('vcc1', 'vcc'),
    part('gnd1', 'gnd'),
    part('cpu', 'w65c02'),
    part('rom', '28c256'),
    part('ram', '62256'),
    part('via1', 'w65c22'),
    part('acia1', 'w65c51'),
    part('nand1', '74hc00'),
    part('nand2', '74hc00'),
    // LEDs on VIA port B
    ...Array.from({ length: 8 }, (_, i) =>
      part(`rl${i}`, 'resistor', { ohms: 220 })),
    ...Array.from({ length: 8 }, (_, i) =>
      part(`led${i}`, 'led', { color: 'red' })),
    part('lcd1', 'char_lcd'),
  ];

  const wires = [
    ...powerChip('vcc1', 'gnd1', 'cpu'),
    ...powerChipStd('vcc1', 'gnd1', 'rom'),
    ...powerChipStd('vcc1', 'gnd1', 'ram'),
    ...powerChip('vcc1', 'gnd1', 'via1'),
    ...powerChip('vcc1', 'gnd1', 'acia1'),
    ...powerChipStd('vcc1', 'gnd1', 'nand1'),
    ...powerChipStd('vcc1', 'gnd1', 'nand2'),
    ...powerChipStd('vcc1', 'gnd1', 'lcd1'),
    tieHigh('vcc1', 'cpu', 'resb'),
    tieHigh('vcc1', 'cpu', 'irqb'),
    tieHigh('vcc1', 'cpu', 'nmib'),
    tieHigh('vcc1', 'cpu', 'be'),
    tieHigh('vcc1', 'cpu', 'rdy'),
    tieHigh('vcc1', 'cpu', 'sob'),
    tieHigh('vcc1', 'via1', 'resb'),
    tieHigh('vcc1', 'acia1', 'resb'),

    // Address decode (2× 74HC00):
    // n1.1: NOT(A15) → ROM CSB
    wire('cpu', 'a15', 'nand1', '1a'),
    wire('cpu', 'a15', 'nand1', '1b'),
    wire('nand1', '1y', 'rom', 'csb'),
    // n1.2: NOT(A14)
    wire('cpu', 'a14', 'nand1', '2a'),
    wire('cpu', 'a14', 'nand1', '2b'),
    // n1.3: NAND(!A14, !A15) → RAM CSB ($0000-$3FFF)
    wire('nand1', '2y', 'nand1', '3a'),
    wire('nand1', '1y', 'nand1', '3b'),
    wire('nand1', '3y', 'ram', 'csb'),
    // n1.4: NOT(A13)
    wire('cpu', 'a13', 'nand1', '4a'),
    wire('cpu', 'a13', 'nand1', '4b'),
    // n2.1: NAND(A14, !A15) → VIA CS2B ($4000-$7FFF active)
    wire('cpu', 'a14', 'nand2', '1a'),
    wire('nand1', '1y', 'nand2', '1b'),
    wire('nand2', '1y', 'via1', 'cs2b'),
    // n2.2: NAND(!A15, !A13) → intermediate
    wire('nand1', '1y', 'nand2', '2a'),
    wire('nand1', '4y', 'nand2', '2b'),
    // n2.3: NOT(n2.2) → high when A15=0 AND A13=0
    wire('nand2', '2y', 'nand2', '3a'),
    wire('nand2', '2y', 'nand2', '3b'),
    // n2.4: NAND(A14, n2.3) → ACIA CS1B ($4000-$5FFF active)
    wire('cpu', 'a14', 'nand2', '4a'),
    wire('nand2', '3y', 'nand2', '4b'),
    wire('nand2', '4y', 'acia1', 'cs1b'),

    // ROM
    tieLow('gnd1', 'rom', 'oeb'),
    tieHigh('vcc1', 'rom', 'web'),
    ...busA('cpu', 'rom', Array.from({ length: 15 }, (_, i) => i)),
    ...busD('cpu', 'rom'),
    // RAM
    tieLow('gnd1', 'ram', 'oeb'),
    wire('cpu', 'rwb', 'ram', 'web'),
    ...busA('cpu', 'ram', Array.from({ length: 15 }, (_, i) => i)),
    ...busD('cpu', 'ram'),
    // VIA: CS1 = A13 → $6000-$7FFF
    wire('cpu', 'a13', 'via1', 'cs1'),
    wire('cpu', 'a0', 'via1', 'rs0'),
    wire('cpu', 'a1', 'via1', 'rs1'),
    wire('cpu', 'a2', 'via1', 'rs2'),
    wire('cpu', 'a3', 'via1', 'rs3'),
    ...busD('cpu', 'via1'),
    ...controlWires('cpu', 'via1'),
    // ACIA: CS0 = A12 → $5000-$5FFF
    wire('cpu', 'a12', 'acia1', 'cs0'),
    wire('cpu', 'a0', 'acia1', 'rs0'),
    wire('cpu', 'a1', 'acia1', 'rs1'),
    ...busD('cpu', 'acia1'),
    ...controlWires('cpu', 'acia1'),
    tieHigh('vcc1', 'acia1', 'ctsb'),
    tieHigh('vcc1', 'acia1', 'dcdb'),
    tieHigh('vcc1', 'acia1', 'dsrb'),
    // VIA port B → LEDs
    ...Array.from({ length: 8 }, (_, i) => [
      wire('via1', `pb${i}`, `rl${i}`, 'a'),
      wire(`rl${i}`, 'b', `led${i}`, 'anode'),
      wire(`led${i}`, 'cathode', 'gnd1', 'gnd'),
    ]).flat(),
    // LCD on VIA port A
    ...Array.from({ length: 8 }, (_, i) =>
      wire('via1', `pa${i}`, 'lcd1', `d${i}`)),
    wire('via1', 'cb1', 'lcd1', 'e'),
    wire('via1', 'cb2', 'lcd1', 'rs'),
    tieLow('gnd1', 'lcd1', 'rw'),
  ];

  return {
    vcc: 5, parts, wires,
    _stage: 'E6', _title: 'Full EATER6502',
    _description: 'Complete 6502 build: RAM $0000-$3FFF, ROM $8000-$FFFF, VIA at $6000, ACIA at $5000. Two 74HC00 NAND chips decode the address bus with no contention.',
  };
}

// ── Write all stages ─────────────────────────────────────────────────

const stages = [genE0, genE1, genE2, genE4, genE5, genE6];
for (const gen of stages) {
  const circuit = gen();
  const name = circuit._stage.toLowerCase();
  const slug = circuit._title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-$/, '');
  const path = join(outDir, `${name}-${slug}.json`);
  writeFileSync(path, JSON.stringify(circuit, null, 2) + '\n');
  console.log(`${circuit._stage}: ${circuit.parts.length} parts, ${circuit.wires.length} wires → ${path}`);
}
