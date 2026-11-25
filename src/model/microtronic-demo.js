// SPDX-License-Identifier: MIT
// Original teaching programs and wiring, authored from the documented instruction set.
export const MICROTRONIC_EXAMPLES = Object.freeze([
  {id: 'counter', name: 'Binary counter', nameDe: 'Binärzähler',
    source: '; R0 counts from 0 to F. OUT1 is the least significant bit.\n00: 100\n01: FE0\n02: 510\n03: C01\n'},
  {id: 'echo', name: 'Input to output', nameDe: 'Eingabe zu Ausgabe',
    source: '; Read IN1..4 into R0, write OUT1..4, and repeat.\n00: FD0\n01: FE0\n02: C00\n'},
]);

/** A complete wire-editable experiment. CLOCK reaches IN4 only through its wire. */
export function microtronicDemoCircuit() {
  const terminals = ['IN1', 'IN2', 'IN3', 'IN4', 'OUT1', 'OUT2', 'OUT3', 'OUT4', 'CLOCK', '5v', 'gnd'];
  const parts = [{id: 'microtronic', kind: 'busch-microtronic', x: 410, y: 270,
    params: {program: MICROTRONIC_EXAMPLES[1].source, instructionHz: 20}, terminals}];
  const wires = [];
  const wire = (from, terminal, to, target, color) => wires.push({id: `wire${wires.length + 1}`,
    from: {part: from, terminal}, to: {part: to, terminal: target}, ...(color ? {color} : {})});
  for (let n = 1; n <= 3; n++) {
    parts.push({id: `input${n}`, kind: 'switch', declName: `IN${n}`, x: 120, y: 150 + (n - 1) * 80,
      params: {closed: false}, terminals: ['a', 'b']});
    parts.push({id: `bias${n}`, kind: 'resistor', x: 215, y: 180 + (n - 1) * 80,
      params: {ohms: 33000}, terminals: ['a', 'b']});
    wire('microtronic', '5v', `input${n}`, 'a', '#ef4444');
    wire(`input${n}`, 'b', 'microtronic', `IN${n}`, '#38bdf8');
    wire(`input${n}`, 'b', `bias${n}`, 'a');
    wire(`bias${n}`, 'b', 'microtronic', 'gnd', '#64748b');
  }
  for (let n = 1; n <= 4; n++) {
    const y = 170 + (n - 1) * 60;
    parts.push({id: `limit${n}`, kind: 'resistor', x: 625, y, params: {ohms: 1000}, terminals: ['a', 'b']});
    parts.push({id: `lamp${n}`, kind: 'led', declName: `OUT${n}`, x: 735, y,
      params: {color: ['red', 'yellow', 'green', 'blue'][n - 1]}, terminals: ['anode', 'cathode']});
    wire('microtronic', `OUT${n}`, `limit${n}`, 'a', '#f59e0b');
    wire(`limit${n}`, 'b', `lamp${n}`, 'anode');
    wire(`lamp${n}`, 'cathode', 'microtronic', 'gnd', '#64748b');
  }
  wire('microtronic', 'CLOCK', 'microtronic', 'IN4', '#a78bfa');
  return {vcc: 5, fileOnly: true, parts, wires, holeWires: []};
}
