// SPDX-License-Identifier: MIT
import {flatWire} from './wire-endpoints.js';

/** Match the two HD44780 connectors used by the gallery and old Eater benches. */
export function find6502LcdWiring(parts, wires, chips) {
  const endpoints = wires.map(flatWire);
  const lcds = parts.filter(part => part.kind === 'hd44780');
  for (const via of chips.filter(chip => chip.kind === 'via')) {
    for (const lcd of lcds) {
      const linked = (pin, terminal) => endpoints.some(w =>
        (w.from === via.name && w.fromTerminal?.toLowerCase() === pin &&
          w.to === lcd.id && w.toTerminal?.toLowerCase() === terminal) ||
        (w.to === via.name && w.toTerminal?.toLowerCase() === pin &&
          w.from === lcd.id && w.fromTerminal?.toLowerCase() === terminal));
      if (linked('pb0', 'rs') && linked('pb1', 'rw') && linked('pb2', 'e') &&
          [4, 5, 6, 7].every(bit => linked('pb'+bit, 'd'+bit))) return {bits: 4, at: via.at};
      if (via.at === 0x6000 && linked('pa5', 'rs') && linked('pa6', 'rw') && linked('pa7', 'e') &&
          [0, 1, 2, 3, 4, 5, 6, 7].every(bit => linked('pb'+bit, 'd'+bit))) return {bits: 8, at: via.at};
    }
  }
  return null;
}

/** A $8000 ROM for the four-bit VIA/HD44780 connector on a 1 MHz bench. */
export function make6502LcdHelloRom(via) {
  const rom = new Uint8Array(0x8000).fill(0xff);
  const code = [];
  const emit = (...bytes) => code.push(...bytes);
  const store = (value, address) => emit(0xa9, value, 0x8d, address & 0xff, address >> 8); // LDA #value, STA address
  const wait = count => emit(0xa2, count, 0xca, 0xd0, 0xfd); // LDX #count, DEX, BNE loop
  const pulse = nibble => {
    store(nibble, via);
    store(nibble | 4, via);
    store(nibble, via);
  };
  const write = (value, flags = 0) => {
    pulse((value & 0xf0) | flags);
    pulse(((value & 0x0f) << 4) | flags);
    wait(12);
  };

  emit(0x78); // SEI
  store(0xf7, via + 2); // DDRB. PB3 remains an input.
  for (let i = 0; i < 16; i++) wait(250);
  // Start in 8-bit mode, as the display does after power-up, then switch to 4 bits.
  for (let i = 0; i < 3; i++) {
    pulse(0x30);
    for (let n = 0; n < 4; n++) wait(250);
  }
  pulse(0x20);
  wait(12);
  write(0x28);
  write(0x0c);
  write(0x01);
  wait(250);
  wait(250);
  write(0x06);
  for (const character of 'HI BRICKWRIGHT') write(character.charCodeAt(0), 1);
  const idle = 0x8000 + code.length;
  emit(0x4c, idle & 0xff, idle >> 8); // JMP idle
  rom.set(code);
  rom.set([idle & 0xff, idle >> 8, 0x00, 0x80, idle & 0xff, idle >> 8], 0x7ffa);
  return rom;
}
