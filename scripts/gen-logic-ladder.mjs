/**
 * Generate the LOGIC ladder — gallery/l0..l8, 74-series gates on a
 * breadboard, no CPU and no MCU anywhere.
 *
 * The gallery had fifteen CPU builds, three MCU boards and one 555. Every
 * 74-series chip in it was GLUE inside a bus — address-decode NANDs, an
 * output latch — so a learner could not meet a gate as the subject. This
 * ladder is that missing rung, and it ends somewhere worth arriving:
 * a machine that adds two numbers and shows the answer as a decimal
 * digit, built from a switch bank, an adder and a decoder. No firmware
 * exists to be wrong.
 *
 * Authoring rules, each one load-bearing:
 *
 *   - TERMINAL NAMES ARE THE ENGINE'S. `terminalsForKind` asks bw-board
 *     first, so a wire naming the datasheet's `S1` on a 74HC283 lands on
 *     nothing — the engine spells the bit slices `s0..s3`. Same for the
 *     CD4511, whose segment outputs are `qa..qg` and whose blanking pin
 *     is `bl`.
 *   - NO INPUT FLOATS. A CMOS input left open reads whatever the air
 *     says; the engine quietly reports 0 V and the lesson silently turns
 *     into a different lesson. Every spare gate input is tied, and every
 *     switch node has a pull-down so "open" means a real LOW.
 *   - THE FILE PREFIX IS `l`. gallery/e*.json and z*.json are claimed by
 *     extractor-ladder.test.js, which feeds them to the 6502/Z80 machine
 *     extractors; a CPU-free circuit under those prefixes would be a
 *     failure report rather than an example.
 *
 * Every circuit here is simulated and its truth table asserted in
 * test/logic-ladder.test.js — the examples are proven, not drawn.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'gallery');
mkdirSync(outDir, { recursive: true });

// ── tiny authoring helpers (same shape as gen-6502-ladder.mjs) ──────

const part = (id, kind, params = {}) => ({ id, kind, params, x: 0, y: 0 });
const wire = (from, fromTerminal, to, toTerminal) => ({ from, fromTerminal, to, toTerminal });

/** Pull-down resistor: node reads a real LOW when its switch is open. */
const PULLDOWN_OHMS = 10000;
/** LED series resistor at 5 V — the value a beginner is told to use. */
const LED_OHMS = 330;

/**
 * A logic input driven by one position of a 4-way DIP switch:
 * VCC → switch → node, and node → 10k → GND so open reads LOW.
 * @returns {{parts: object[], wires: object[], node: {part: string, terminal: string}}}
 */
function switchInput(sw, position, rid) {
  const parts = [part(rid, 'resistor', { ohms: PULLDOWN_OHMS })];
  const wires = [
    wire('vcc1', 'vcc', sw, `${position}a`),
    wire(sw, `${position}b`, rid, 'a'),
    wire(rid, 'b', 'gnd1', 'gnd'),
  ];
  return { parts, wires, node: { part: sw, terminal: `${position}b` } };
}

/** An LED to ground on a logic output: output → LED → 330R → GND. */
function outputLed(driver, terminal, lid, rid, color = 'red') {
  return {
    parts: [part(lid, 'led', { vf: 2.0, color }), part(rid, 'resistor', { ohms: LED_OHMS })],
    wires: [
      wire(driver, terminal, lid, 'anode'),
      wire(lid, 'cathode', rid, 'a'),
      wire(rid, 'b', 'gnd1', 'gnd'),
    ],
  };
}

/** Rails for a DIP logic chip — every chip gets both, always. */
const powerChip = (id) => [wire('vcc1', 'vcc', id, 'vcc'), wire('gnd1', 'gnd', id, 'gnd')];

/** Base parts every circuit in this ladder starts from. */
const rails = () => [part('vcc1', 'vcc'), part('gnd1', 'gnd')];

function emit(name, circuit) {
  const ids = circuit.parts.map((p) => p.id);
  if (new Set(ids).size !== ids.length) throw new Error(`${name}: duplicate part id`);
  const known = new Set(ids);
  for (const w of circuit.wires) {
    if (!known.has(w.from)) throw new Error(`${name}: wire from unknown part ${w.from}`);
    if (!known.has(w.to)) throw new Error(`${name}: wire to unknown part ${w.to}`);
  }
  writeFileSync(join(outDir, `${name}.json`), `${JSON.stringify(circuit, null, 2)}\n`);
  return `${name}: ${circuit.parts.length} parts, ${circuit.wires.length} wires`;
}

const done = [];

// ── L0: one gate, two switches, one LED ────────────────────────────

{
  const parts = [...rails(), part('sw1', 'dip_switch_spst', { switches: 0b0011 }), part('u1', '74hc08')];
  const wires = [...powerChip('u1')];
  const A = switchInput('sw1', 1, 'ra');
  const B = switchInput('sw1', 2, 'rb');
  parts.push(...A.parts, ...B.parts);
  wires.push(...A.wires, ...B.wires);
  wires.push(wire('sw1', '1b', 'u1', '1a'), wire('sw1', '2b', 'u1', '1b'));
  const led = outputLed('u1', '1y', 'led1', 'rl1');
  parts.push(...led.parts); wires.push(...led.wires);
  // The other three AND gates are unused: tie their inputs low rather
  // than leave eight CMOS inputs floating.
  for (const g of [2, 3, 4]) wires.push(wire('gnd1', 'gnd', 'u1', `${g}a`), wire('gnd1', 'gnd', 'u1', `${g}b`));
  done.push(emit('l0-and-gate', {
    vcc: 5, parts, wires,
    _title: 'AND: the gate you can press',
    _description: 'Two DIP switches into one 74HC08 AND gate, one LED on the output. '
      + 'The LED lights only when BOTH switches are closed — the truth table, in your hand. '
      + 'Note the 10k pull-downs: an open switch must be pulled to a real LOW, or a CMOS input just floats.',
    _category: 'logic', _difficulty: 1, _stage: 'L0',
  }));
}

// ── L1: the inverter ───────────────────────────────────────────────

{
  const parts = [...rails(), part('sw1', 'dip_switch_spst', { switches: 0b0000 }), part('u1', '74hc04')];
  const wires = [...powerChip('u1')];
  const A = switchInput('sw1', 1, 'ra');
  parts.push(...A.parts); wires.push(...A.wires);
  wires.push(wire('sw1', '1b', 'u1', '1a'));
  const led = outputLed('u1', '1y', 'led1', 'rl1', 'green');
  parts.push(...led.parts); wires.push(...led.wires);
  for (const g of [2, 3, 4, 5, 6]) wires.push(wire('gnd1', 'gnd', 'u1', `${g}a`));
  done.push(emit('l1-not-gate', {
    vcc: 5, parts, wires,
    _title: 'NOT: the gate that disagrees',
    _description: 'One 74HC04 inverter. Switch open, LED on; switch closed, LED off. '
      + 'The first gate that does something a wire cannot.',
    _category: 'logic', _difficulty: 1, _stage: 'L1',
  }));
}

// ── L2: AND / OR / XOR, same inputs, three answers ─────────────────

{
  const parts = [...rails(), part('sw1', 'dip_switch_spst', { switches: 0b0001 }),
    part('u1', '74hc08'), part('u2', '74hc32'), part('u3', '74hc86')];
  const wires = [...powerChip('u1'), ...powerChip('u2'), ...powerChip('u3')];
  const A = switchInput('sw1', 1, 'ra');
  const B = switchInput('sw1', 2, 'rb');
  parts.push(...A.parts, ...B.parts); wires.push(...A.wires, ...B.wires);
  for (const u of ['u1', 'u2', 'u3']) {
    wires.push(wire('sw1', '1b', u, '1a'), wire('sw1', '2b', u, '1b'));
    for (const g of [2, 3, 4]) wires.push(wire('gnd1', 'gnd', u, `${g}a`), wire('gnd1', 'gnd', u, `${g}b`));
  }
  for (const [u, lid, rid, color] of [['u1', 'led_and', 'r_and', 'red'],
    ['u2', 'led_or', 'r_or', 'yellow'], ['u3', 'led_xor', 'r_xor', 'green']]) {
    const led = outputLed(u, '1y', lid, rid, color);
    parts.push(...led.parts); wires.push(...led.wires);
  }
  done.push(emit('l2-and-or-xor', {
    vcc: 5, parts, wires,
    _title: 'AND, OR, XOR: one question, three answers',
    _description: 'The same two switches drive an AND (74HC08), an OR (74HC32) and an XOR (74HC86) at once, '
      + 'each with its own LED. Walk the four input combinations and read three truth tables side by side. '
      + 'XOR is the odd one out — it means "exactly one of you" — and that is the gate that adds.',
    _category: 'logic', _difficulty: 2, _stage: 'L2',
  }));
}

// ── L3: NAND is universal ──────────────────────────────────────────

{
  // One 74HC00 becomes NOT, AND and OR:
  //   gate1: NOT A        (both inputs = A)
  //   gate2: A NAND B
  //   gate3: NOT(A NAND B) = A AND B   (gate2's output into both inputs)
  //   gate4: NOT A NAND NOT B = A OR B (De Morgan) — needs NOT B, so a
  //          second package supplies it; a single '00 has only four gates.
  const parts = [...rails(), part('sw1', 'dip_switch_spst', { switches: 0b0010 }),
    part('u1', '74hc00'), part('u2', '74hc00')];
  const wires = [...powerChip('u1'), ...powerChip('u2')];
  const A = switchInput('sw1', 1, 'ra');
  const B = switchInput('sw1', 2, 'rb');
  parts.push(...A.parts, ...B.parts); wires.push(...A.wires, ...B.wires);
  // u1 gate1 = NOT A, u1 gate2 = NOT B
  wires.push(wire('sw1', '1b', 'u1', '1a'), wire('sw1', '1b', 'u1', '1b'));
  wires.push(wire('sw1', '2b', 'u1', '2a'), wire('sw1', '2b', 'u1', '2b'));
  // u1 gate3 = A NAND B ; u1 gate4 = NOT(that) = A AND B
  wires.push(wire('sw1', '1b', 'u1', '3a'), wire('sw1', '2b', 'u1', '3b'));
  wires.push(wire('u1', '3y', 'u1', '4a'), wire('u1', '3y', 'u1', '4b'));
  // u2 gate1 = (NOT A) NAND (NOT B) = A OR B
  wires.push(wire('u1', '1y', 'u2', '1a'), wire('u1', '2y', 'u2', '1b'));
  for (const g of [2, 3, 4]) wires.push(wire('gnd1', 'gnd', 'u2', `${g}a`), wire('gnd1', 'gnd', 'u2', `${g}b`));
  for (const [drv, term, lid, rid, color] of [['u1', '1y', 'led_not', 'r_not', 'green'],
    ['u1', '4y', 'led_and', 'r_and', 'red'], ['u2', '1y', 'led_or', 'r_or', 'yellow']]) {
    const led = outputLed(drv, term, lid, rid, color);
    parts.push(...led.parts); wires.push(...led.wires);
  }
  done.push(emit('l3-nand-is-universal', {
    vcc: 5, parts, wires,
    _title: 'NAND is enough',
    _description: 'NOT, AND and OR built from nothing but 74HC00 NAND gates. '
      + 'Tie a NAND\'s two inputs together and it inverts; invert a NAND and it ANDs; '
      + 'NAND two inverted inputs and De Morgan hands you OR. '
      + 'One gate type can build every other — which is why a chip fab only needs to be good at one thing.',
    _category: 'logic', _difficulty: 3, _stage: 'L3',
  }));
}

// ── L4: the half adder ─────────────────────────────────────────────

{
  const parts = [...rails(), part('sw1', 'dip_switch_spst', { switches: 0b0011 }),
    part('u1', '74hc86'), part('u2', '74hc08')];
  const wires = [...powerChip('u1'), ...powerChip('u2')];
  const A = switchInput('sw1', 1, 'ra');
  const B = switchInput('sw1', 2, 'rb');
  parts.push(...A.parts, ...B.parts); wires.push(...A.wires, ...B.wires);
  wires.push(wire('sw1', '1b', 'u1', '1a'), wire('sw1', '2b', 'u1', '1b'));   // XOR → SUM
  wires.push(wire('sw1', '1b', 'u2', '1a'), wire('sw1', '2b', 'u2', '1b'));   // AND → CARRY
  for (const u of ['u1', 'u2']) {
    for (const g of [2, 3, 4]) wires.push(wire('gnd1', 'gnd', u, `${g}a`), wire('gnd1', 'gnd', u, `${g}b`));
  }
  const s = outputLed('u1', '1y', 'led_sum', 'r_sum', 'green');
  const c = outputLed('u2', '1y', 'led_carry', 'r_carry', 'red');
  parts.push(...s.parts, ...c.parts); wires.push(...s.wires, ...c.wires);
  done.push(emit('l4-half-adder', {
    vcc: 5, parts, wires,
    _title: 'The half adder — your first calculation',
    _description: 'One XOR and one AND, and the machine can add one bit to one bit. '
      + 'SUM is the XOR (1+0 = 1, and 1+1 = 0 because it carried), CARRY is the AND. '
      + 'Set both switches: SUM goes dark and CARRY lights — that is binary 1+1 = 10, read across two LEDs. '
      + 'It is called HALF because it has nowhere to put a carry coming IN.',
    _category: 'logic', _difficulty: 3, _stage: 'L4',
  }));
}

// ── L5: the full adder ─────────────────────────────────────────────

{
  // SUM  = (A XOR B) XOR Cin
  // Cout = (A AND B) OR ((A XOR B) AND Cin)
  const parts = [...rails(), part('sw1', 'dip_switch_spst', { switches: 0b0111 }),
    part('u1', '74hc86'), part('u2', '74hc08'), part('u3', '74hc32')];
  const wires = [...powerChip('u1'), ...powerChip('u2'), ...powerChip('u3')];
  const A = switchInput('sw1', 1, 'ra');
  const B = switchInput('sw1', 2, 'rb');
  const C = switchInput('sw1', 3, 'rc');
  parts.push(...A.parts, ...B.parts, ...C.parts);
  wires.push(...A.wires, ...B.wires, ...C.wires);
  wires.push(wire('sw1', '1b', 'u1', '1a'), wire('sw1', '2b', 'u1', '1b'));   // X1 = A XOR B
  wires.push(wire('u1', '1y', 'u1', '2a'), wire('sw1', '3b', 'u1', '2b'));    // SUM = X1 XOR Cin
  wires.push(wire('sw1', '1b', 'u2', '1a'), wire('sw1', '2b', 'u2', '1b'));   // A AND B
  wires.push(wire('u1', '1y', 'u2', '2a'), wire('sw1', '3b', 'u2', '2b'));    // X1 AND Cin
  wires.push(wire('u2', '1y', 'u3', '1a'), wire('u2', '2y', 'u3', '1b'));     // Cout = OR
  for (const g of [3, 4]) {
    wires.push(wire('gnd1', 'gnd', 'u1', `${g}a`), wire('gnd1', 'gnd', 'u1', `${g}b`));
    wires.push(wire('gnd1', 'gnd', 'u2', `${g}a`), wire('gnd1', 'gnd', 'u2', `${g}b`));
  }
  for (const g of [2, 3, 4]) wires.push(wire('gnd1', 'gnd', 'u3', `${g}a`), wire('gnd1', 'gnd', 'u3', `${g}b`));
  const s = outputLed('u1', '2y', 'led_sum', 'r_sum', 'green');
  const c = outputLed('u3', '1y', 'led_carry', 'r_carry', 'red');
  parts.push(...s.parts, ...c.parts); wires.push(...s.wires, ...c.wires);
  done.push(emit('l5-full-adder', {
    vcc: 5, parts, wires,
    _title: 'The full adder — three in, two out',
    _description: 'Two XORs, two ANDs and an OR: A + B + a carry coming IN. '
      + 'That third input is the whole point — it is what lets adders be chained, '
      + 'each one handing its carry to the next. Close all three switches: 1+1+1 = 11 in binary, '
      + 'so SUM lights AND CARRY lights.',
    _category: 'logic', _difficulty: 4, _stage: 'L5',
  }));
}

// ── L6: four bits at once ──────────────────────────────────────────

{
  const parts = [...rails(),
    part('swa', 'dip_switch_spst', { switches: 0b0101 }),
    part('swb', 'dip_switch_spst', { switches: 0b0011 }),
    part('u1', '74hc283')];
  const wires = [...powerChip('u1'), wire('gnd1', 'gnd', 'u1', 'cin')];
  ['a0', 'a1', 'a2', 'a3'].forEach((pin, i) => {
    const inp = switchInput('swa', i + 1, `ra${i}`);
    parts.push(...inp.parts); wires.push(...inp.wires);
    wires.push(wire('swa', `${i + 1}b`, 'u1', pin));
  });
  ['b0', 'b1', 'b2', 'b3'].forEach((pin, i) => {
    const inp = switchInput('swb', i + 1, `rb${i}`);
    parts.push(...inp.parts); wires.push(...inp.wires);
    wires.push(wire('swb', `${i + 1}b`, 'u1', pin));
  });
  ['s0', 's1', 's2', 's3', 'cout'].forEach((out, i) => {
    const led = outputLed('u1', out, `led${i}`, `rl${i}`, out === 'cout' ? 'red' : 'green');
    parts.push(...led.parts); wires.push(...led.wires);
  });
  done.push(emit('l6-four-bit-adder', {
    vcc: 5, parts, wires,
    _title: 'Four bits at once — the 74HC283',
    _description: 'Eight switches in, five LEDs out: a whole 4-bit adder in one 16-pin package. '
      + 'Inside it is four of the full adder you just built, chained carry to carry. '
      + 'Read A on the left bank, B on the right, and the answer across the LEDs (the red one is the carry, worth 16). '
      + 'Note the engine spells the bit slices a0..a3 — a0 is the ONES bit.',
    _category: 'logic', _difficulty: 4, _stage: 'L6',
  }));
}

// ── L7: the calculator ─────────────────────────────────────────────

{
  const parts = [...rails(),
    part('swa', 'dip_switch_spst', { switches: 0b0101 }),
    part('swb', 'dip_switch_spst', { switches: 0b0010 }),
    part('u1', '74hc283'), part('u2', 'cd4511'), part('disp', 'seven_segment')];
  const wires = [...powerChip('u1'), ...powerChip('u2'), wire('gnd1', 'gnd', 'u1', 'cin')];
  // CD4511 control pins: LT and BL are active LOW (idle HIGH), LE low = transparent.
  wires.push(wire('vcc1', 'vcc', 'u2', 'lt'), wire('vcc1', 'vcc', 'u2', 'bl'), wire('gnd1', 'gnd', 'u2', 'le'));
  ['a0', 'a1', 'a2', 'a3'].forEach((pin, i) => {
    const inp = switchInput('swa', i + 1, `ra${i}`);
    parts.push(...inp.parts); wires.push(...inp.wires);
    wires.push(wire('swa', `${i + 1}b`, 'u1', pin));
  });
  ['b0', 'b1', 'b2', 'b3'].forEach((pin, i) => {
    const inp = switchInput('swb', i + 1, `rb${i}`);
    parts.push(...inp.parts); wires.push(...inp.wires);
    wires.push(wire('swb', `${i + 1}b`, 'u1', pin));
  });
  // Sum → BCD decoder inputs (a = ones, d = eights).
  [['s0', 'a'], ['s1', 'b'], ['s2', 'c'], ['s3', 'd']].forEach(([s, d]) => wires.push(wire('u1', s, 'u2', d)));
  // Decoder → display, one series resistor per segment.
  for (const seg of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) {
    const rid = `rs_${seg}`;
    parts.push(part(rid, 'resistor', { ohms: LED_OHMS }));
    wires.push(wire('u2', `q${seg}`, rid, 'a'), wire(rid, 'b', 'disp', seg));
  }
  wires.push(wire('disp', 'common', 'gnd1', 'gnd'));
  // The carry still deserves an LED: it is the sixteen the digit cannot show.
  const cled = outputLed('u1', 'cout', 'led_carry', 'r_carry', 'red');
  parts.push(...cled.parts); wires.push(...cled.wires);
  done.push(emit('l7-calculator', {
    vcc: 5, parts, wires,
    _title: 'A calculator with no computer in it',
    _description: 'Set A on one switch bank and B on the other; the 74HC283 adds them and the CD4511 '
      + 'turns the 4-bit answer into a decimal digit on the display. There is no CPU, no firmware and '
      + 'nothing to program — the answer is the wiring. '
      + 'Sums of 10 to 15 blank the display: a BCD decoder only knows 0-9, and that honest limit is the '
      + 'reason real adders carry a "decimal adjust" stage.',
    _category: 'logic', _difficulty: 5, _stage: 'L7',
  }));
}

for (const line of done) console.log(line);
console.log(`\n${done.length} logic examples written to gallery/`);
