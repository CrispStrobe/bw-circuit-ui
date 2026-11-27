// SPDX-License-Identifier: MIT
// Original programs and wiring. Circuit I/O belongs to the Brickwright adapter.
// Numeric images match sb3-creator's cardiac-echo, cardiac-add and cardiac-night-light.
const program = (entry, cells) => ({entry, words: Object.entries(cells)
  .map(([address, value]) => ({address: Number(address), value})).sort((a, b) => a.address - b.address)});

export const CARDIAC_EXAMPLES = Object.freeze([
  {id: 'echo', name: 'Echo a card', nameDe: 'Eine Karte ausgeben',
    description: 'Read one card into cell 80, output it, and halt.',
    program: program(1, {1: 80, 2: 580, 3: 900, 80: 0})},
  {id: 'night-light', name: 'Night light', nameDe: 'Nachtlicht',
    description: 'Output 001 below 500; output 000 at or above 500.',
    program: program(1, {1: 80, 2: 180, 3: 781, 4: 309, 5: 183, 6: 684, 7: 584,
      8: 801, 9: 182, 10: 684, 11: 584, 12: 801, 80: 0, 81: 500, 82: 1, 83: 0, 84: 0})},
  {id: 'addition', name: 'Add two cards', nameDe: 'Zwei Karten addieren',
    description: 'Read two numbers, add them, store the sum, output, and halt.',
    program: program(1, {1: 80, 2: 81, 3: 180, 4: 281, 5: 682, 6: 582, 7: 900, 80: 0, 81: 0, 82: 0})},
]);

/** A sampled light-level stand-in plus a resistor-limited LED on real solver nets. */
export function cardiacDemoCircuit() {
  const parts = [
    {id: 'cardiac', kind: 'cardiac', declName: 'CARDIAC', x: 430, y: 255,
      params: {program: CARDIAC_EXAMPLES[1].program, instructionHz: 20, inputSource: 'circuit'},
      terminals: ['IN', 'OUT', '5v', 'gnd']},
    {id: 'light-level', kind: 'potentiometer', declName: 'Light level', x: 145, y: 230,
      params: {ohms: 10000, position: 0.2}, terminals: ['a', 'wiper', 'b']},
    {id: 'limit', kind: 'resistor', x: 675, y: 225,
      params: {ohms: 1000}, terminals: ['a', 'b']},
    {id: 'lamp', kind: 'led', declName: 'Night light', x: 780, y: 225,
      params: {color: 'yellow'}, terminals: ['anode', 'cathode']},
  ];
  const wires = [];
  const wire = (from, terminal, to, target, color) => wires.push({id: `cardiac-wire-${wires.length + 1}`,
    from: {part: from, terminal}, to: {part: to, terminal: target}, color});
  wire('cardiac', '5v', 'light-level', 'a', '#dc6b42');
  wire('light-level', 'wiper', 'cardiac', 'IN', '#218a88');
  wire('light-level', 'b', 'cardiac', 'gnd', '#718096');
  wire('cardiac', 'OUT', 'limit', 'a', '#dc6b42');
  wire('limit', 'b', 'lamp', 'anode', '#dc6b42');
  wire('lamp', 'cathode', 'cardiac', 'gnd', '#718096');
  return {vcc: 5, fileOnly: true, parts, wires, holeWires: []};
}
