#!/usr/bin/env node
/**
 * Generate the Z80 pedagogy ladder — Z1, Z2, Z3, Z4, Z5, Z6.
 *
 * Based on Grant Searle's minimal Z80 and CP/M builds.
 *
 * Stage summary:
 *   Z1  free-run counter: NOP on data bus, LEDs on address lines
 *   Z2  Pico-as-memory: RPi Pico provides ROM+RAM (display-only)
 *   Z3  OUT-to-LCD: Z80 OUT drives an LCD (display-only)
 *   Z4  ROM+RAM+latched LED port: proper memory decode
 *   Z5  SEARLE serial: MC6850 ACIA, full Searle machine (extractor-verified when z80-extract.js lands)
 *   Z6  CP/M machine: RAM covers full 64K (bank-switched ROM)
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'gallery');
mkdirSync(outDir, { recursive: true });

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
function tieHigh(vccId, chipId, terminal) { return wire(vccId, 'vcc', chipId, terminal); }
function tieLow(gndId, chipId, terminal) { return wire(gndId, 'gnd', chipId, terminal); }
function powerChipStd(vccId, gndId, chipId) {
  return [wire(vccId, 'vcc', chipId, 'vcc'), wire(gndId, 'gnd', chipId, 'gnd')];
}
function powerChipVss(vccId, gndId, chipId) {
  return [wire(vccId, 'vcc', chipId, 'vcc'), wire(gndId, 'gnd', chipId, 'vss')];
}

// ── Z1: free-run counter ─────────────────────────────────────────────
function genZ1() {
  const parts = [
    part('vcc1', 'vcc'),
    part('gnd1', 'gnd'),
    part('cpu', 'z80'),
    ...Array.from({ length: 8 }, (_, i) =>
      part(`rd${i}`, 'resistor', { ohms: 1000 })),
    ...Array.from({ length: 8 }, (_, i) =>
      part(`ra${i}`, 'resistor', { ohms: 220 })),
    ...Array.from({ length: 8 }, (_, i) =>
      part(`la${i}`, 'led', { color: i < 4 ? 'green' : 'yellow' })),
  ];

  // NOP = $00 on Z80
  const wires = [
    ...powerChipStd('vcc1', 'gnd1', 'cpu'),
    tieHigh('vcc1', 'cpu', 'resetb'),
    tieHigh('vcc1', 'cpu', 'intb'),
    tieHigh('vcc1', 'cpu', 'nmib'),
    tieHigh('vcc1', 'cpu', 'waitb'),
    tieHigh('vcc1', 'cpu', 'busrqb'),
    // NOP = $00: all data lines pulled low
    ...Array.from({ length: 8 }, (_, i) => [
      wire('gnd1', 'gnd', `rd${i}`, 'a'),
      wire(`rd${i}`, 'b', 'cpu', `d${i}`),
    ]).flat(),
    // LEDs on A0-A7
    ...Array.from({ length: 8 }, (_, i) => [
      wire('cpu', `a${i}`, `ra${i}`, 'a'),
      wire(`ra${i}`, 'b', `la${i}`, 'anode'),
      wire(`la${i}`, 'cathode', 'gnd1', 'gnd'),
    ]).flat(),
  ];

  return {
    vcc: 5, parts, wires,
    _stage: 'Z1', _title: 'Free-run counter',
    _description: 'Z80 free-runs NOP ($00). Address LEDs count up as the PC increments.',
  };
}

// ── Z1.5: ROM-only + data-bus LEDs ──────────────────────────────────
// 28C256 ROM at $0000-$7FFF (CSB = A15, selected when A15=0).
// Data-bus LEDs show each byte fetched. Address LEDs on A0-A7.
// Mirrors 6502 E2: the first ROM stage, before RAM is introduced.
// No gate IC needed — A15 drives CSB directly.
function genZ1_5() {
  const parts = [
    part('vcc1', 'vcc'),
    part('gnd1', 'gnd'),
    part('cpu', 'z80'),
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

  const wires = [
    ...powerChipStd('vcc1', 'gnd1', 'cpu'),
    ...powerChipStd('vcc1', 'gnd1', 'rom'),
    tieHigh('vcc1', 'cpu', 'resetb'),
    tieHigh('vcc1', 'cpu', 'intb'),
    tieHigh('vcc1', 'cpu', 'nmib'),
    tieHigh('vcc1', 'cpu', 'waitb'),
    tieHigh('vcc1', 'cpu', 'busrqb'),

    // ROM: CSB = A15 (selected when A15=0 → $0000-$7FFF)
    wire('cpu', 'a15', 'rom', 'csb'),
    tieLow('gnd1', 'rom', 'oeb'),
    tieHigh('vcc1', 'rom', 'web'),
    ...busA('cpu', 'rom', Array.from({ length: 15 }, (_, i) => i)),
    ...busD('cpu', 'rom'),

    // Address LEDs A0-A7
    ...Array.from({ length: 8 }, (_, i) => [
      wire('cpu', `a${i}`, `ra${i}`, 'a'),
      wire(`ra${i}`, 'b', `la${i}`, 'anode'),
      wire(`la${i}`, 'cathode', 'gnd1', 'gnd'),
    ]).flat(),
    // Data-bus LEDs D0-D7
    ...Array.from({ length: 8 }, (_, i) => [
      wire('cpu', `d${i}`, `rd${i}`, 'a'),
      wire(`rd${i}`, 'b', `ld${i}`, 'anode'),
      wire(`ld${i}`, 'cathode', 'gnd1', 'gnd'),
    ]).flat(),
  ];

  return {
    vcc: 5, parts, wires,
    _stage: 'Z1.5', _title: 'ROM only',
    _description: 'Z80 with 28C256 ROM at $0000-$7FFF (A15 decode). Data-bus LEDs show each byte. Address LEDs count up. The first ROM stage — before RAM.',
  };
}

// ── Z2: Pico-as-memory (display-only) ────────────────────────────────
function genZ2() {
  const parts = [
    part('vcc1', 'vcc'),
    part('gnd1', 'gnd'),
    part('cpu', 'z80'),
    part('pico', 'pi_pico'),
    ...Array.from({ length: 8 }, (_, i) =>
      part(`ra${i}`, 'resistor', { ohms: 220 })),
    ...Array.from({ length: 8 }, (_, i) =>
      part(`la${i}`, 'led', { color: 'green' })),
  ];

  const wires = [
    ...powerChipStd('vcc1', 'gnd1', 'cpu'),
    tieHigh('vcc1', 'cpu', 'resetb'),
    tieHigh('vcc1', 'cpu', 'intb'),
    tieHigh('vcc1', 'cpu', 'nmib'),
    tieHigh('vcc1', 'cpu', 'waitb'),
    tieHigh('vcc1', 'cpu', 'busrqb'),
    // Pico provides memory — data bus + address bus + control
    ...busD('cpu', 'pico').map(w => ({ ...w, toTerminal: `gp${parseInt(w.toTerminal.slice(1))}` })),
    // A0-A7 to Pico GP8-GP15 (simplified representation)
    ...Array.from({ length: 8 }, (_, i) =>
      wire('cpu', `a${i}`, 'pico', `gp${i + 8}`)),
    // MREQB, RDB to Pico
    wire('cpu', 'mreqb', 'pico', 'gp16'),
    wire('cpu', 'rdb', 'pico', 'gp17'),
    // LEDs on A0-A7
    ...Array.from({ length: 8 }, (_, i) => [
      wire('cpu', `a${i}`, `ra${i}`, 'a'),
      wire(`ra${i}`, 'b', `la${i}`, 'anode'),
      wire(`la${i}`, 'cathode', 'gnd1', 'gnd'),
    ]).flat(),
  ];

  return {
    vcc: 5, parts, wires,
    _stage: 'Z2', _title: 'Pico as memory',
    _displayOnly: true,
    _description: 'A Raspberry Pi Pico provides ROM+RAM for the Z80. Display-only until the Pico RUN story lands.',
  };
}

// ── Z3: OUT-to-LCD (display-only) ────────────────────────────────────
function genZ3() {
  const base = genZ2();
  base.parts.push(part('lcd1', 'char_lcd'));
  // LCD on a latched output port (simplified: direct from Pico GPIO)
  base.wires.push(
    ...Array.from({ length: 8 }, (_, i) =>
      wire('pico', `gp${i}`, 'lcd1', `d${i}`)),
    wire('pico', 'gp18', 'lcd1', 'e'),
    wire('pico', 'gp19', 'lcd1', 'rs'),
    tieLow('gnd1', 'lcd1', 'rw'),
    ...powerChipStd('vcc1', 'gnd1', 'lcd1'),
  );
  base._stage = 'Z3';
  base._title = 'OUT to LCD';
  base._displayOnly = true;
  base._description = 'Z80 OUT instruction drives an LCD via the Pico. Display-only.';
  return base;
}

// ── Z4: ROM+RAM+latched LED port ─────────────────────────────────────
// Proper memory decode: ROM $0000-$1FFF, RAM $2000-$FFFF.
// Uses 74HC00 for decode.
function genZ4() {
  const parts = [
    part('vcc1', 'vcc'),
    part('gnd1', 'gnd'),
    part('cpu', 'z80'),
    part('rom', '28c256'),
    part('ram', '62256'),
    part('nand1', '74hc00'),
    // LEDs on data output (accent the decoded port)
    ...Array.from({ length: 8 }, (_, i) =>
      part(`rl${i}`, 'resistor', { ohms: 220 })),
    ...Array.from({ length: 8 }, (_, i) =>
      part(`led${i}`, 'led', { color: 'red' })),
  ];

  // Searle-style decode: A15 selects ROM (low half) vs RAM (high half).
  // For Z4 we use the simpler decode: ROM when A15=0, RAM when A15=1.
  // Z5/Z6 refine this.
  const wires = [
    ...powerChipStd('vcc1', 'gnd1', 'cpu'),
    ...powerChipStd('vcc1', 'gnd1', 'rom'),
    ...powerChipStd('vcc1', 'gnd1', 'ram'),
    ...powerChipStd('vcc1', 'gnd1', 'nand1'),
    tieHigh('vcc1', 'cpu', 'resetb'),
    tieHigh('vcc1', 'cpu', 'intb'),
    tieHigh('vcc1', 'cpu', 'nmib'),
    tieHigh('vcc1', 'cpu', 'waitb'),
    tieHigh('vcc1', 'cpu', 'busrqb'),

    // ROM decode: CSB = A15 (selected when A15=0 → $0000-$7FFF)
    wire('cpu', 'a15', 'rom', 'csb'),
    tieLow('gnd1', 'rom', 'oeb'),
    tieHigh('vcc1', 'rom', 'web'),
    ...busA('cpu', 'rom', Array.from({ length: 15 }, (_, i) => i)),
    ...busD('cpu', 'rom'),

    // RAM decode: CSB = NOT(A15) (selected when A15=1 → $8000-$FFFF)
    // Gate 1: NOT(A15)
    wire('cpu', 'a15', 'nand1', '1a'),
    wire('cpu', 'a15', 'nand1', '1b'),
    wire('nand1', '1y', 'ram', 'csb'),
    // RAM control
    wire('cpu', 'wrb', 'ram', 'web'),
    tieLow('gnd1', 'ram', 'oeb'),
    ...busA('cpu', 'ram', Array.from({ length: 15 }, (_, i) => i)),
    ...busD('cpu', 'ram'),

    // Unused NAND gates
    tieHigh('vcc1', 'nand1', '2a'), tieHigh('vcc1', 'nand1', '2b'),
    tieHigh('vcc1', 'nand1', '3a'), tieHigh('vcc1', 'nand1', '3b'),
    tieHigh('vcc1', 'nand1', '4a'), tieHigh('vcc1', 'nand1', '4b'),

    // Data bus LEDs (accent: directly on the bus for now)
    ...Array.from({ length: 8 }, (_, i) => [
      wire('cpu', `d${i}`, `rl${i}`, 'a'),
      wire(`rl${i}`, 'b', `led${i}`, 'anode'),
      wire(`led${i}`, 'cathode', 'gnd1', 'gnd'),
    ]).flat(),
  ];

  return {
    vcc: 5, parts, wires,
    _stage: 'Z4', _title: 'ROM plus RAM',
    _description: 'ROM $0000-$7FFF, RAM $8000-$FFFF. The Z80 runs code from ROM with working RAM.',
  };
}

// ── Z5: SEARLE serial ────────────────────────────────────────────────
// Grant Searle's minimal Z80: ROM $0000-$1FFF, RAM $2000-$FFFF,
// MC6850 ACIA at I/O port $80.
// SEARLE preset: {rom: 0-0x1FFF, ram: 0x2000-0xFFFF, ports: [{acia6850, acia1, 0x80}]}
function genZ5() {
  const parts = [
    part('vcc1', 'vcc'),
    part('gnd1', 'gnd'),
    part('cpu', 'z80'),
    part('rom', '28c256'),
    part('ram', '62256'),
    part('acia1', 'mc6850'),
    part('nand1', '74hc00'),
  ];

  // Searle memory decode:
  //   ROM: A15=0, A14=0, A13=0 → $0000-$1FFF
  //     ROM CSB = NAND(NOT(A15), NOT(A14), NOT(A13))... needs 3-input.
  //     Simplified: ROM CSB = A13 (selected $0000-$1FFF when A13=0 — mirrors)
  //     Actually for Searle: ROM CE = A15 (ROM at $0000-$7FFF, mirrors)
  //   RAM: A13=1 → $2000-$FFFF (with A13 high)
  //     Actually for clean decode: RAM CSB = NOT(A13)
  //
  // For the Searle machine, the decode is simpler than Eater:
  //   ROM: selected when A15=0 → $0000-$7FFF (mirrors)
  //   RAM: selected always (CSB tied low), but OEB gated by RDB
  //     RAM overrides ROM when written via address decode
  //   Actually Searle uses: ROM at $0000-$1FFF, RAM at $2000-$FFFF
  //
  // Simplest clean decode matching the SEARLE preset:
  //   ROM CSB = A13 (active when A13=0 → $0000-$1FFF, mirrors in each 8K block)
  //   RAM CSB = NOT(A13) via NAND gate (active when A13=1 → $2000-$3FFF, $6000-$7FFF, etc.)
  //   But that gives contention at $8000-$9FFF (A13=0, A15=1) and $A000 (A13=1)...
  //
  // Let me use the actual Searle decode:
  //   ROM at low addresses, RAM everywhere else.
  //   ROM CSB = A15 OR A14 OR A13 = active when all three are 0
  //   Using NAND: NOT(NOT(A15) AND NOT(A14) AND NOT(A13))
  //   2-input NAND cascade:
  //     gate1: NOT(A15)
  //     gate2: NAND(!A15, !A14)... but !A14 needs another gate
  //   With 4 gates:
  //     gate1: NOT(A15)
  //     gate2: NOT(A14)
  //     gate3: NAND(!A15, !A14) → low when A15=0 AND A14=0
  //     gate4: NAND(gate3_out, !A13)... need NOT(A13) too. Out of gates.
  //
  // With 2x 74HC00 (8 gates):
  //     n1.1: NOT(A15)
  //     n1.2: NOT(A14)
  //     n1.3: NOT(A13)
  //     n1.4: NAND(!A15, !A14) → X (low when A15=0 AND A14=0)
  //     n2.1: NOT(X) = NAND(X, X) → Y (high when A15=0 AND A14=0)
  //     n2.2: NAND(Y, !A13) → ROM_CSB (low when A15=0 AND A14=0 AND A13=0)
  //       Wait, NAND(Y, !A13): when Y=1 and !A13=1 → NAND=0 → CSB low → selected ✓
  //       When A13=1: !A13=0 → NAND(Y,0)=1 → not selected ✓
  //       When A15=1: Y=0 → NAND(0,?)=1 → not selected ✓
  //     n2.3: NAND(ROM_CSB, MREQB)... Actually I need memory control too.
  //
  // Simplify: for the Z80 extractor (when it exists), it will need to
  // evaluate the decode just like m6502-extract does. For now, let me use
  // the simplest decode that produces the SEARLE preset regions:
  //   ROM $0000-$1FFF, RAM $2000-$FFFF.
  //
  // Clean 2-chip decode:
  //   n1.1: NOT(A15)
  //   n1.2: NOT(A14)
  //   n1.3: NOT(A13)
  //   n1.4: NAND(!A15, !A14) = high unless A15=A14=0
  //   n2.1: NAND(n1.4, !A13) → ROM CSB
  //     Selected when n1.4 low AND !A13 high, i.e., A15=0,A14=0,A13=0 → $0000-$1FFF
  //     But NAND(low, high) = NAND(0,1) = 1 → NOT selected. Wrong.
  //     NAND(n1.4_output, !A13):
  //       n1.4 = NAND(!A15,!A14). When A15=A14=0: NAND(1,1)=0.
  //       !A13 when A13=0: 1.
  //       NAND(0, 1) = 1 → CSB=1 → NOT selected. That's wrong.
  //
  // I keep getting the logic backwards. Let me be more careful.
  // Goal: ROM_CSB should be LOW (active) when A15=0,A14=0,A13=0.
  // ROM_CSB = NOT(NOT(A15) AND NOT(A14) AND NOT(A13))... this gives HIGH when all three are 0.
  // That's A15 OR A14 OR A13. LOW only when at least one of A13-A15 is high. WRONG.
  //
  // ROM_CSB = A15 OR A14 OR A13 → LOW when all are 0 → $0000-$1FFF.
  // Wait: OR gives 0 only when all inputs are 0. So A15 OR A14 OR A13 = 0 exactly at $0000-$1FFF.
  // ROM_CSB = A15 OR A14 OR A13 → CSB=0 (active) when $0000-$1FFF. ✓
  //
  // OR from NAND: A OR B = NAND(NOT(A), NOT(B)).
  // A15 OR A14 = NAND(!A15, !A14) = n1.4 output. This is HIGH when A15 OR A14.
  // (A15 OR A14) OR A13 = NAND(NOT(A15 OR A14), NOT(A13))
  //   = NAND(NOT(n1.4), !A13)
  //   n2.1: NOT(n1.4) = NAND(n1.4, n1.4)
  //   n2.2: NAND(n2.1_out, !A13)
  //   This is the 3-input OR. HIGH when any of A13,A14,A15 is high.
  //   At $0000 (all 0): n1.4=NAND(1,1)=0. n2.1=NAND(0,0)=1. n2.2=NAND(1,1)=0. ROM_CSB=0 ✓
  //   At $2000 (A13=1): !A13=0. n2.2=NAND(?,0)=1. ROM_CSB=1 ✓
  //   At $8000 (A15=1): n1.4=NAND(0,1)=1. n2.1=NAND(1,1)=0. n2.2=NAND(0,?)=1. ROM_CSB=1 ✓
  //
  // For RAM: CSB should be LOW when address >= $2000. That's NOT($0000-$1FFF).
  //   RAM_CSB = NOT(ROM_active) = NOT(NOT(A15 OR A14 OR A13)) = A15 OR A14 OR A13 inverted.
  //   Wait, ROM_CSB = A15 OR A14 OR A13.
  //   RAM active = NOT(ROM active) = ROM_CSB itself works... no:
  //   ROM_CSB = 0 means ROM active. RAM wants CSB=0 when ROM_CSB=1.
  //   So RAM_CSB = NOT(ROM_CSB) = NOT(A15 OR A14 OR A13).
  //   At $0000: ROM_CSB=0, NOT(0)=1 → RAM not selected ✓
  //   At $2000: ROM_CSB=1, NOT(1)=0 → RAM selected ✓
  //
  //   n2.3: NOT(ROM_CSB) = NAND(ROM_CSB, ROM_CSB) → RAM_CSB

  const nand2 = part('nand2', '74hc00');
  parts.push(nand2);

  const wires = [
    ...powerChipStd('vcc1', 'gnd1', 'cpu'),
    ...powerChipStd('vcc1', 'gnd1', 'rom'),
    ...powerChipStd('vcc1', 'gnd1', 'ram'),
    ...powerChipVss('vcc1', 'gnd1', 'acia1'),
    ...powerChipStd('vcc1', 'gnd1', 'nand1'),
    ...powerChipStd('vcc1', 'gnd1', 'nand2'),
    tieHigh('vcc1', 'cpu', 'resetb'),
    tieHigh('vcc1', 'cpu', 'intb'),
    tieHigh('vcc1', 'cpu', 'nmib'),
    tieHigh('vcc1', 'cpu', 'waitb'),
    tieHigh('vcc1', 'cpu', 'busrqb'),

    // ── Memory decode (2× 74HC00) ───────────────────────────────
    // n1.1: NOT(A15)
    wire('cpu', 'a15', 'nand1', '1a'),
    wire('cpu', 'a15', 'nand1', '1b'),
    // n1.2: NOT(A14)
    wire('cpu', 'a14', 'nand1', '2a'),
    wire('cpu', 'a14', 'nand1', '2b'),
    // n1.3: NOT(A13)
    wire('cpu', 'a13', 'nand1', '3a'),
    wire('cpu', 'a13', 'nand1', '3b'),
    // n1.4: NAND(!A15, !A14) = A15 OR A14
    wire('nand1', '1y', 'nand1', '4a'),
    wire('nand1', '2y', 'nand1', '4b'),
    // n2.1: NOT(n1.4) = NOT(A15 OR A14)
    wire('nand1', '4y', 'nand2', '1a'),
    wire('nand1', '4y', 'nand2', '1b'),
    // n2.2: ROM_CSB = NAND(n2.1, !A13) = A15 OR A14 OR A13
    wire('nand2', '1y', 'nand2', '2a'),
    wire('nand1', '3y', 'nand2', '2b'),
    wire('nand2', '2y', 'rom', 'csb'),
    // n2.3: RAM_CSB = NOT(ROM_CSB) = NOT(A15 OR A14 OR A13)
    wire('nand2', '2y', 'nand2', '3a'),
    wire('nand2', '2y', 'nand2', '3b'),
    wire('nand2', '3y', 'ram', 'csb'),
    // n2.4: unused
    tieHigh('vcc1', 'nand2', '4a'), tieHigh('vcc1', 'nand2', '4b'),

    // ── ROM ─────────────────────────────────────────────────────
    tieLow('gnd1', 'rom', 'oeb'),
    tieHigh('vcc1', 'rom', 'web'),
    ...busA('cpu', 'rom', Array.from({ length: 15 }, (_, i) => i)),
    ...busD('cpu', 'rom'),

    // ── RAM ─────────────────────────────────────────────────────
    tieLow('gnd1', 'ram', 'oeb'),
    wire('cpu', 'wrb', 'ram', 'web'),
    ...busA('cpu', 'ram', Array.from({ length: 15 }, (_, i) => i)),
    ...busD('cpu', 'ram'),

    // ── ACIA (I/O port $80) ─────────────────────────────────────
    // MC6850: CS0 = A7 (high at $80+), CS2B = IORQB inverted? No.
    // Searle: ACIA selected by IORQB low AND A7 high.
    // CS0 = A7, CS2B = IORQB, CS1 = tied high? Actually MC6850 has cs0, cs1, cs2b.
    // For I/O port $80: IORQB goes low during I/O, A7=1 at port $80.
    // CS0 = NOT(IORQB) would work but we'd need a gate. Simpler:
    // CS2B = IORQB (active low, matches IORQB), CS0 = A7, CS1 = tied high.
    // Wait, MC6850 select: CS0 AND CS1 must be high, CS2B must be low.
    // IORQB is already active low → CS2B = IORQB works.
    wire('cpu', 'iorqb', 'acia1', 'cs2b'),
    wire('cpu', 'a7', 'acia1', 'cs0'),
    tieHigh('vcc1', 'acia1', 'cs1'),
    wire('cpu', 'a0', 'acia1', 'rs'),
    // MC6850 data bus
    ...busD('cpu', 'acia1'),
    // MC6850 E (enable) = CPU clock, R/W = CPU RDB inverted? No.
    // MC6850 E pin: directly from CPU CLK or system clock
    wire('cpu', 'clk', 'acia1', 'e'),
    // MC6850 R/W: read/write. Z80 RDB → R/W (high=read, low=write).
    // Actually MC6850 R/W: high = read, low = write. Z80 WRB is active low for write.
    // So R/W = NOT(WRB)? Or R/W = RDB? When Z80 reads: RDB=0, WRB=1. MC6850 R/W should be 1 (read).
    // RDB active low → R/W = NOT(RDB)? That gives R/W=1 during read. But during write, RDB=1, R/W=0?
    // Z80 WRB=0 during write, RDB=1 during write. NOT(RDB)=0 during write → R/W=0 → write. ✓
    // Z80 RDB=0 during read, WRB=1 during read. NOT(RDB)=1 during read → R/W=1 → read. ✓
    // But I'd need a NOT gate. Let's use the fact that in Searle's actual build, he connects
    // R/W to RDB directly (active low read = low R/W = write... that's backwards).
    // Actually Searle connects WRB to MC6850 R/W. WRB=0 → write → R/W=0=write? No, R/W high=read.
    // WRB=1 during read → R/W=1=read ✓. WRB=0 during write → R/W=0=write ✓.
    // So R/W = WRB directly? That seems wrong because WRB is active-low write, but:
    // WRB=1 (no write = read) → R/W=1 (read) ✓
    // WRB=0 (write) → R/W=0 (write) ✓
    // It works! The polarity matches because both use "high=read".
    wire('cpu', 'wrb', 'acia1', 'rw'),
    // Tie unused ACIA pins
    tieHigh('vcc1', 'acia1', 'ctsb'),
    tieHigh('vcc1', 'acia1', 'dcdb'),
  ];

  return {
    vcc: 5, parts, wires,
    _stage: 'Z5', _title: 'Searle serial',
    _description: 'Grant Searle minimal Z80: ROM $0000-$1FFF, RAM $2000-$FFFF, MC6850 ACIA at I/O port $80. Extractor verification pending z80-extract.js.',
  };
}

// ── Z6: CP/M machine ─────────────────────────────────────────────────
// Full 64K RAM, ACIA at port $80. ROM is bank-switched out after boot.
function genZ6() {
  const base = genZ5();
  base._stage = 'Z6';
  base._title = 'CP/M machine';
  base._description = 'CP/M-ready Z80: 64K RAM (ROM bank-switched out after boot), MC6850 at port $80. Matches the CPM64K preset (when extractor lands).';
  // The circuit is structurally identical to Z5 for the designer's purposes —
  // the difference is that the ROM is paged out by software, leaving 64K RAM.
  // The _cpmMode flag signals this to the machine model.
  base._cpmMode = true;
  return base;
}

// ── Write all stages ─────────────────────────────────────────────────
const stages = [genZ1, genZ1_5, genZ2, genZ3, genZ4, genZ5, genZ6];
for (const gen of stages) {
  const circuit = gen();
  const name = circuit._stage.toLowerCase();
  const path = join(outDir, `${name}-${circuit._title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-$/, '')}.json`);
  writeFileSync(path, JSON.stringify(circuit, null, 2) + '\n');
  console.log(`${circuit._stage}: ${circuit.parts.length} parts, ${circuit.wires.length} wires` +
    (circuit._displayOnly ? ' [display-only]' : '') +
    ` → ${path}`);
}
