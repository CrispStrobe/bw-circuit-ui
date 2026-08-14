#!/usr/bin/env node
/**
 * Generate the 6502 pedagogy ladder — E1 through E6.
 *
 * Each stage is a circuit.json that the designer can load. The wiring
 * matches Ben Eater's breadboard build (Eater / Couch-To-64k pedagogy).
 *
 * The extractor in bw-board/src/m6502-extract.js must ACCEPT E6 and
 * produce a config equal to the EATER6502 preset.
 *
 * Stage summary:
 *   E1  free-run: NOP on data bus, LEDs on address lines
 *   E2  +ROM blink: 28C256 wired, code in ROM
 *   E3  +W65C22 blink: VIA drives an LED port
 *   E4  +HD44780 hello: LCD on VIA port B (display-only until LCD model)
 *   E5  +W65C51 serial: ACIA wired for UART
 *   E6  full EATER6502: RAM + complete decode (extractor-verified)
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'gallery');
mkdirSync(outDir, { recursive: true });

// ── helpers ──────────────────────────────────────────────────────────

let wireId = 0;
function wire(from, fromTerminal, to, toTerminal) {
  return { from, fromTerminal, to, toTerminal };
}

function part(id, kind, params = {}, x = 0, y = 0) {
  return { id, kind, params, x, y };
}

/** Connect CPU address lines A0-A15 straight to a chip's a0-a15. */
function busA(cpuId, chipId, bits) {
  return bits.map(b => wire(cpuId, `a${b}`, chipId, `a${b}`));
}

/** Connect CPU data lines D0-D7 straight to a chip's d0-d7. */
function busD(cpuId, chipId) {
  return Array.from({ length: 8 }, (_, i) => wire(cpuId, `d${i}`, chipId, `d${i}`));
}

/** Common control wiring: RWB, PHI2. */
function controlWires(cpuId, chipId, { rwb = true, phi2 = true } = {}) {
  const w = [];
  if (rwb) w.push(wire(cpuId, 'rwb', chipId, 'rwb'));
  if (phi2) w.push(wire(cpuId, 'phi2', chipId, 'phi2'));
  return w;
}

/** Tie a terminal to VCC or GND. */
function tieHigh(vccId, chipId, terminal) { return wire(vccId, 'vcc', chipId, terminal); }
function tieLow(gndId, chipId, terminal) { return wire(gndId, 'gnd', chipId, terminal); }

/** Power a chip: VDD to VCC, VSS to GND. */
function powerChip(vccId, gndId, chipId, { vdd = 'vdd', vss = 'vss' } = {}) {
  return [wire(vccId, 'vcc', chipId, vdd), wire(gndId, 'gnd', chipId, vss)];
}
function powerChipStd(vccId, gndId, chipId) {
  return [wire(vccId, 'vcc', chipId, 'vcc'), wire(gndId, 'gnd', chipId, 'gnd')];
}

// ── E1: free-run ─────────────────────────────────────────────────────
// NOP ($EA = 11101010) tied to data bus via resistors, LEDs on A0-A7.
// The CPU free-runs: every address is a NOP, so A0-A15 count up.

function genE1() {
  const parts = [
    part('vcc1', 'vcc'),
    part('gnd1', 'gnd'),
    part('cpu', 'w65c02'),
    // 8 resistors tying data bus to NOP pattern
    ...Array.from({ length: 8 }, (_, i) =>
      part(`rd${i}`, 'resistor', { ohms: 1000 })),
    // 8 LED+resistor pairs on address lines A0-A7
    ...Array.from({ length: 8 }, (_, i) =>
      part(`ra${i}`, 'resistor', { ohms: 220 })),
    ...Array.from({ length: 8 }, (_, i) =>
      part(`la${i}`, 'led', { color: i < 4 ? 'green' : 'yellow' })),
  ];

  // NOP = $EA = 11101010 — d1=0, d2=0, d4=0, rest=1
  const nopBits = [0, 1, 0, 1, 0, 1, 1, 1]; // d0..d7
  const wires = [
    ...powerChip('vcc1', 'gnd1', 'cpu'),
    // Tie RESB high (not in reset), IRQB/NMIB high (no interrupts)
    tieHigh('vcc1', 'cpu', 'resb'),
    tieHigh('vcc1', 'cpu', 'irqb'),
    tieHigh('vcc1', 'cpu', 'nmib'),
    tieHigh('vcc1', 'cpu', 'be'),
    tieHigh('vcc1', 'cpu', 'rdy'),
    // Data bus: NOP pattern via resistors
    ...Array.from({ length: 8 }, (_, i) => {
      const src = nopBits[i] ? 'vcc1' : 'gnd1';
      const srcTerm = nopBits[i] ? 'vcc' : 'gnd';
      return [
        wire(src, srcTerm, `rd${i}`, 'a'),
        wire(`rd${i}`, 'b', 'cpu', `d${i}`),
      ];
    }).flat(),
    // Address LEDs: A0-A7 → resistor → LED → GND
    ...Array.from({ length: 8 }, (_, i) => [
      wire('cpu', `a${i}`, `ra${i}`, 'a'),
      wire(`ra${i}`, 'b', `la${i}`, 'anode'),
      wire(`la${i}`, 'cathode', 'gnd1', 'gnd'),
    ]).flat(),
  ];

  return {
    vcc: 5, parts, wires,
    _stage: 'E1', _title: 'Free-run: NOP counter',
    _description: 'The CPU has no ROM — every address reads NOP ($EA) from tied resistors. Watch the address LEDs count up.',
  };
}

// ── E2: +ROM blink ───────────────────────────────────────────────────
// 28C256 ROM wired to the CPU. ROM is always selected (CSB tied low).
// A15 not decoded — ROM mirrors through the entire address space.

function genE2() {
  const parts = [
    part('vcc1', 'vcc'),
    part('gnd1', 'gnd'),
    part('cpu', 'w65c02'),
    part('rom', '28c256'),
    // Address LEDs on A0-A7
    ...Array.from({ length: 8 }, (_, i) =>
      part(`ra${i}`, 'resistor', { ohms: 220 })),
    ...Array.from({ length: 8 }, (_, i) =>
      part(`la${i}`, 'led', { color: 'green' })),
  ];

  const wires = [
    ...powerChip('vcc1', 'gnd1', 'cpu'),
    ...powerChipStd('vcc1', 'gnd1', 'rom'),
    tieHigh('vcc1', 'cpu', 'resb'),
    tieHigh('vcc1', 'cpu', 'irqb'),
    tieHigh('vcc1', 'cpu', 'nmib'),
    tieHigh('vcc1', 'cpu', 'be'),
    tieHigh('vcc1', 'cpu', 'rdy'),
    // ROM select: always on (CSB/CEB low, OEB low)
    tieLow('gnd1', 'rom', 'csb'),
    tieLow('gnd1', 'rom', 'oeb'),
    tieHigh('vcc1', 'rom', 'web'), // write-protect
    // Address bus: A0-A14 to ROM
    ...busA('cpu', 'rom', Array.from({ length: 15 }, (_, i) => i)),
    // Data bus
    ...busD('cpu', 'rom'),
    // Address LEDs
    ...Array.from({ length: 8 }, (_, i) => [
      wire('cpu', `a${i}`, `ra${i}`, 'a'),
      wire(`ra${i}`, 'b', `la${i}`, 'anode'),
      wire(`la${i}`, 'cathode', 'gnd1', 'gnd'),
    ]).flat(),
  ];

  return {
    vcc: 5, parts, wires,
    _stage: 'E2', _title: 'ROM blink',
    _description: 'A 28C256 EEPROM wired to the full address space. The CPU runs code from ROM.',
  };
}

// ── E3: +W65C22 VIA blink ────────────────────────────────────────────
// VIA added at $6000. Address decode: A15 selects ROM, A14+A13 for VIA.
// Uses a single NAND gate for ROM select (A15 inverted).

function genE3() {
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
    // CPU control
    tieHigh('vcc1', 'cpu', 'resb'),
    tieHigh('vcc1', 'cpu', 'irqb'),
    tieHigh('vcc1', 'cpu', 'nmib'),
    tieHigh('vcc1', 'cpu', 'be'),
    tieHigh('vcc1', 'cpu', 'rdy'),
    // VIA reset
    tieHigh('vcc1', 'via1', 'resb'),
    // ROM: A15 → NAND gate 1 (inverted) → CSB (ROM selected when A15=1)
    // NAND(A15, A15) = NOT(A15)
    wire('cpu', 'a15', 'nand1', '1a'),
    wire('cpu', 'a15', 'nand1', '1b'),
    wire('nand1', '1y', 'rom', 'csb'),
    tieLow('gnd1', 'rom', 'oeb'),
    tieHigh('vcc1', 'rom', 'web'),
    // ROM address + data
    ...busA('cpu', 'rom', Array.from({ length: 15 }, (_, i) => i)),
    ...busD('cpu', 'rom'),
    // VIA: CS2B = A15 inverted (same NAND output), CS1 = A14 inverted via gate 2
    // Actually for Eater build: VIA at $6000 means A15=0, A14=1, A13=1
    // CS1 = A13, CS2B = NOT(A14) — wait, let me use the real Eater decode:
    // VIA: CS1 tied high, CS2B = A15 (so VIA selected when A15=0)
    // But that puts VIA at $0000-$7FFF which overlaps with RAM later.
    // Eater's actual E3 decode: simple, A15 high = ROM, A15 low = VIA+RAM.
    // At E3 there's no RAM, so VIA gets CS2B = A15 (selected when A15=0).
    // This is intentionally coarse — E6 adds proper decode.
    wire('cpu', 'a15', 'via1', 'cs2b'),  // selected when A15=0
    tieHigh('vcc1', 'via1', 'cs1'),
    // VIA register select: RS0-RS3 = A0-A3
    wire('cpu', 'a0', 'via1', 'rs0'),
    wire('cpu', 'a1', 'via1', 'rs1'),
    wire('cpu', 'a2', 'via1', 'rs2'),
    wire('cpu', 'a3', 'via1', 'rs3'),
    // VIA data bus + control
    ...busD('cpu', 'via1'),
    ...controlWires('cpu', 'via1'),
    // VIA port B → LEDs
    ...Array.from({ length: 8 }, (_, i) => [
      wire('via1', `pb${i}`, `rl${i}`, 'a'),
      wire(`rl${i}`, 'b', `led${i}`, 'anode'),
      wire(`led${i}`, 'cathode', 'gnd1', 'gnd'),
    ]).flat(),
    // Unused NAND gates: tie inputs high
    tieHigh('vcc1', 'nand1', '2a'), tieHigh('vcc1', 'nand1', '2b'),
    tieHigh('vcc1', 'nand1', '3a'), tieHigh('vcc1', 'nand1', '3b'),
    tieHigh('vcc1', 'nand1', '4a'), tieHigh('vcc1', 'nand1', '4b'),
  ];

  return {
    vcc: 5, parts, wires,
    _stage: 'E3', _title: 'VIA blink',
    _description: 'W65C22 VIA added. Port B drives 8 LEDs. Coarse decode: A15 splits ROM/VIA.',
  };
}

// ── E4: +LCD hello ───────────────────────────────────────────────────
// HD44780 LCD on VIA port A (accent is display-only until LCD model).
// Same decode as E3.

function genE4() {
  const base = genE3();
  // Add LCD connected to VIA port A
  base.parts.push(part('lcd1', 'char_lcd'));
  // PA0-PA7 → LCD D0-D7, VIA CA1 → LCD E, CA2 → LCD RS
  base.wires.push(
    ...Array.from({ length: 8 }, (_, i) =>
      wire('via1', `pa${i}`, 'lcd1', `d${i}`)),
    // For now the LCD is wired but display-only
    wire('via1', 'cb1', 'lcd1', 'e'),
    wire('via1', 'cb2', 'lcd1', 'rs'),
    tieLow('gnd1', 'lcd1', 'rw'),
    ...powerChipStd('vcc1', 'gnd1', 'lcd1'),
  );
  base._stage = 'E4';
  base._title = 'LCD hello';
  base._description = 'HD44780 LCD on VIA port A. Display-only until the LCD device model lands.';
  return base;
}

// ── E5: +W65C51 serial ──────────────────────────────────────────────
// ACIA at $5000. Decode uses NAND gates.

function genE5() {
  const base = genE4();
  base.parts.push(part('acia1', 'w65c51'));

  // ACIA at $5000: A15=0, A14=1, A13=0, A12=1
  // CS0 must be high when selected, CS1B must be low.
  // Simple decode: CS0 = A12, CS1B = A15 (so selected when A15=0, A12=1)
  // This puts ACIA at $1000, $3000, $5000, $7000 (mirrors).
  // For E5 without RAM, this is fine.
  base.wires.push(
    ...powerChip('vcc1', 'gnd1', 'acia1'),
    tieHigh('vcc1', 'acia1', 'resb'),
    wire('cpu', 'a12', 'acia1', 'cs0'),   // selected when A12=1
    wire('cpu', 'a15', 'acia1', 'cs1b'),  // selected when A15=0
    wire('cpu', 'a0', 'acia1', 'rs0'),
    wire('cpu', 'a1', 'acia1', 'rs1'),
    ...busD('cpu', 'acia1'),
    ...controlWires('cpu', 'acia1'),
    // Tie unused ACIA pins
    tieHigh('vcc1', 'acia1', 'ctsb'),
    tieHigh('vcc1', 'acia1', 'dcdb'),
    tieHigh('vcc1', 'acia1', 'dsrb'),
  );

  base._stage = 'E5';
  base._title = 'Serial output';
  base._description = 'W65C51 ACIA at $5000. The CPU can send bytes over serial.';
  return base;
}

// ── E6: full EATER6502 ──────────────────────────────────────────────
// RAM at $0000-$3FFF, ROM at $8000-$FFFF, VIA at $6000, ACIA at $5000.
// Full address decode with 2× 74HC00 NAND gates (8 gates total).
//
// EATER6502 preset:
//   regions: [{ram, 0x0000, 0x3FFF}, {rom, 0x8000, 0xFFFF}]
//   chips: [{via, via1, 0x6000}, {acia, acia1, 0x5000}]
//
// Decode (no contention at any of the 65536 addresses):
//   nand1 gate 1: NOT(A15) → ROM CSB
//   nand1 gate 2: NOT(A14)
//   nand1 gate 3: NAND(!A14, !A15) → RAM CSB  ($0000-$3FFF)
//   nand1 gate 4: NOT(A13)
//   nand2 gate 1: NAND(A14, !A15) → VIA CS2B  (active in $4000-$7FFF)
//   nand2 gate 2: NAND(!A15, !A13) → intermediate X
//   nand2 gate 3: NOT(X) = NAND(X,X) → Y (high when A15=0 AND A13=0)
//   nand2 gate 4: NAND(A14, Y) → ACIA CS1B (active in $4000-$5FFF only)
//   VIA: CS1 = A13, CS2B = nand2.1y → selected $6000-$7FFF
//   ACIA: CS0 = A12, CS1B = nand2.4y → selected $5000-$5FFF

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
    // 8 LEDs on VIA port B
    ...Array.from({ length: 8 }, (_, i) =>
      part(`rl${i}`, 'resistor', { ohms: 220 })),
    ...Array.from({ length: 8 }, (_, i) =>
      part(`led${i}`, 'led', { color: 'red' })),
    // LCD on VIA port A
    part('lcd1', 'char_lcd'),
  ];

  const wires = [
    // Power
    ...powerChip('vcc1', 'gnd1', 'cpu'),
    ...powerChipStd('vcc1', 'gnd1', 'rom'),
    ...powerChipStd('vcc1', 'gnd1', 'ram'),
    ...powerChip('vcc1', 'gnd1', 'via1'),
    ...powerChip('vcc1', 'gnd1', 'acia1'),
    ...powerChipStd('vcc1', 'gnd1', 'nand1'),
    ...powerChipStd('vcc1', 'gnd1', 'nand2'),
    ...powerChipStd('vcc1', 'gnd1', 'lcd1'),
    // CPU control
    tieHigh('vcc1', 'cpu', 'resb'),
    tieHigh('vcc1', 'cpu', 'irqb'),
    tieHigh('vcc1', 'cpu', 'nmib'),
    tieHigh('vcc1', 'cpu', 'be'),
    tieHigh('vcc1', 'cpu', 'rdy'),
    // VIA/ACIA reset
    tieHigh('vcc1', 'via1', 'resb'),
    tieHigh('vcc1', 'acia1', 'resb'),

    // ── Address decode (2× 74HC00) ──────────────────────────────
    // nand1 gate 1: NOT(A15) → ROM CSB
    wire('cpu', 'a15', 'nand1', '1a'),
    wire('cpu', 'a15', 'nand1', '1b'),
    wire('nand1', '1y', 'rom', 'csb'),

    // nand1 gate 2: NOT(A14)
    wire('cpu', 'a14', 'nand1', '2a'),
    wire('cpu', 'a14', 'nand1', '2b'),

    // nand1 gate 3: NAND(!A14, !A15) → RAM CSB ($0000-$3FFF)
    wire('nand1', '2y', 'nand1', '3a'),
    wire('nand1', '1y', 'nand1', '3b'),
    wire('nand1', '3y', 'ram', 'csb'),

    // nand1 gate 4: NOT(A13)
    wire('cpu', 'a13', 'nand1', '4a'),
    wire('cpu', 'a13', 'nand1', '4b'),

    // nand2 gate 1: NAND(A14, !A15) → VIA CS2B ($4000-$7FFF active)
    wire('cpu', 'a14', 'nand2', '1a'),
    wire('nand1', '1y', 'nand2', '1b'),  // NOT(A15)
    wire('nand2', '1y', 'via1', 'cs2b'),

    // nand2 gate 2: NAND(!A15, !A13) → intermediate X
    wire('nand1', '1y', 'nand2', '2a'),  // NOT(A15)
    wire('nand1', '4y', 'nand2', '2b'),  // NOT(A13)

    // nand2 gate 3: NOT(X) = NAND(X, X) → Y (high when A15=0 AND A13=0)
    wire('nand2', '2y', 'nand2', '3a'),
    wire('nand2', '2y', 'nand2', '3b'),

    // nand2 gate 4: NAND(A14, Y) → ACIA CS1B
    // Selected when A14=1 AND A15=0 AND A13=0 → $4000-$5FFF
    wire('cpu', 'a14', 'nand2', '4a'),
    wire('nand2', '3y', 'nand2', '4b'),
    wire('nand2', '4y', 'acia1', 'cs1b'),

    // ── ROM ─────────────────────────────────────────────────────
    tieLow('gnd1', 'rom', 'oeb'),
    tieHigh('vcc1', 'rom', 'web'),
    ...busA('cpu', 'rom', Array.from({ length: 15 }, (_, i) => i)),
    ...busD('cpu', 'rom'),

    // ── RAM ─────────────────────────────────────────────────────
    tieLow('gnd1', 'ram', 'oeb'),
    wire('cpu', 'rwb', 'ram', 'web'),
    ...busA('cpu', 'ram', Array.from({ length: 15 }, (_, i) => i)),
    ...busD('cpu', 'ram'),

    // ── VIA ─────────────────────────────────────────────────────
    // CS1 = A13: VIA at $6000-$7FFF (A14=1, A15=0, A13=1)
    wire('cpu', 'a13', 'via1', 'cs1'),
    wire('cpu', 'a0', 'via1', 'rs0'),
    wire('cpu', 'a1', 'via1', 'rs1'),
    wire('cpu', 'a2', 'via1', 'rs2'),
    wire('cpu', 'a3', 'via1', 'rs3'),
    ...busD('cpu', 'via1'),
    ...controlWires('cpu', 'via1'),

    // ── ACIA ────────────────────────────────────────────────────
    // CS0 = A12: ACIA at $5000-$5FFF (A14=1, A13=0, A12=1)
    wire('cpu', 'a12', 'acia1', 'cs0'),
    wire('cpu', 'a0', 'acia1', 'rs0'),
    wire('cpu', 'a1', 'acia1', 'rs1'),
    ...busD('cpu', 'acia1'),
    ...controlWires('cpu', 'acia1'),
    tieHigh('vcc1', 'acia1', 'ctsb'),
    tieHigh('vcc1', 'acia1', 'dcdb'),
    tieHigh('vcc1', 'acia1', 'dsrb'),

    // ── VIA port B → LEDs ───────────────────────────────────────
    ...Array.from({ length: 8 }, (_, i) => [
      wire('via1', `pb${i}`, `rl${i}`, 'a'),
      wire(`rl${i}`, 'b', `led${i}`, 'anode'),
      wire(`led${i}`, 'cathode', 'gnd1', 'gnd'),
    ]).flat(),

    // ── LCD on VIA port A ───────────────────────────────────────
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

const stages = [genE1, genE2, genE3, genE4, genE5, genE6];
for (const gen of stages) {
  const circuit = gen();
  const name = circuit._stage.toLowerCase();
  const path = join(outDir, `${name}-${circuit._title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-$/, '')}.json`);
  writeFileSync(path, JSON.stringify(circuit, null, 2) + '\n');
  console.log(`${circuit._stage}: ${circuit.parts.length} parts, ${circuit.wires.length} wires → ${path}`);
}
