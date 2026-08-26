/**
 * Generate the LOGIC ladder — gallery/l0..l10, 74-series gates on a
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

// ── L8: subtraction, from the adder you already have ───────────────

{
  // A + (B XOR mode) + mode. With mode LOW that is A + B; with mode HIGH
  // every B bit inverts and the carry-in arrives as 1, which is two's
  // complement — so the SAME adder subtracts. Nothing else changes.
  const parts = [...rails(),
    part('swa', 'dip_switch_spst', { switches: 0b0111 }),
    part('swb', 'dip_switch_spst', { switches: 0b0010 }),
    part('swm', 'dip_switch_spst', { switches: 0b0000 }),
    part('u1', '74hc283'), part('u2', '74hc86')];
  const wires = [...powerChip('u1'), ...powerChip('u2')];
  const M = switchInput('swm', 1, 'rm');
  parts.push(...M.parts); wires.push(...M.wires);
  // The mode line goes to BOTH the XOR bank and the carry-in. That single
  // shared wire is the whole trick.
  wires.push(wire('swm', '1b', 'u1', 'cin'));
  for (let g = 1; g <= 4; g++) wires.push(wire('swm', '1b', 'u2', `${g}b`));
  ['a0', 'a1', 'a2', 'a3'].forEach((pin, i) => {
    const inp = switchInput('swa', i + 1, `ra${i}`);
    parts.push(...inp.parts); wires.push(...inp.wires);
    wires.push(wire('swa', `${i + 1}b`, 'u1', pin));
  });
  [0, 1, 2, 3].forEach((i) => {
    const inp = switchInput('swb', i + 1, `rb${i}`);
    parts.push(...inp.parts); wires.push(...inp.wires);
    wires.push(wire('swb', `${i + 1}b`, 'u2', `${i + 1}a`));
    wires.push(wire('u2', `${i + 1}y`, 'u1', `b${i}`));
  });
  ['s0', 's1', 's2', 's3', 'cout'].forEach((o, i) => {
    const led = outputLed('u1', o, `led${i}`, `rl${i}`, o === 'cout' ? 'red' : 'green');
    parts.push(...led.parts); wires.push(...led.wires);
  });
  done.push(emit('l8-add-subtract', {
    vcc: 5, parts, wires,
    _title: 'Subtraction is the same circuit',
    _description: 'One extra 74HC86 turns the adder into an adder-subtractor. The mode switch feeds the XOR bank '
      + 'AND the carry-in at once: with it open you get A + B, with it closed every B bit flips and a 1 enters '
      + 'the bottom, which is two’s complement — so the machine subtracts without a single new adder. '
      + 'The red LED now means "no borrow": it lights when A is greater than or equal to B.',
    _category: 'logic', _difficulty: 4, _stage: 'L8',
  }));
}

// ── L9: two decimal digits, the honest fix for L7 ──────────────────

{
  // The BCD adder. A second '283 adds six whenever the first sum leaves
  // the decimal range, and the detector that decides is three gates:
  //   carry = Cout + S3.S2 + S3.S1
  // Inputs are decimal digits 0..9, which is what makes ONE correction
  // stage exactly right (0..9 + 0..9 = 0..18).
  const parts = [...rails(),
    part('swa', 'dip_switch_spst', { switches: 0b0111 }),
    part('swb', 'dip_switch_spst', { switches: 0b0110 }),
    part('u1', '74hc283'), part('u2', '74hc283'),
    part('u3', '74hc08'), part('u4', '74hc32'),
    part('d1', 'cd4511'), part('d2', 'cd4511'),
    part('disp_ones', 'seven_segment'), part('disp_tens', 'seven_segment')];
  const wires = [...powerChip('u1'), ...powerChip('u2'), ...powerChip('u3'), ...powerChip('u4'),
    ...powerChip('d1'), ...powerChip('d2'),
    wire('gnd1', 'gnd', 'u1', 'cin'), wire('gnd1', 'gnd', 'u2', 'cin')];
  for (const d of ['d1', 'd2']) {
    wires.push(wire('vcc1', 'vcc', d, 'lt'), wire('vcc1', 'vcc', d, 'bl'), wire('gnd1', 'gnd', d, 'le'));
  }
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
  // greater-than-nine detector, and the raw sum forwarded to the corrector
  wires.push(wire('u1', 's3', 'u3', '1a'), wire('u1', 's3', 'u3', '2a'), wire('u1', 's3', 'u2', 'a3'));
  wires.push(wire('u1', 's2', 'u3', '1b'), wire('u1', 's2', 'u2', 'a2'));
  wires.push(wire('u1', 's1', 'u3', '2b'), wire('u1', 's1', 'u2', 'a1'));
  wires.push(wire('u1', 's0', 'u2', 'a0'));
  wires.push(wire('u3', '1y', 'u4', '1a'), wire('u3', '2y', 'u4', '1b'));
  wires.push(wire('u4', '1y', 'u4', '2a'), wire('u1', 'cout', 'u4', '2b'));
  // that carry IS the tens digit, and it also gates the +6 (binary 0110)
  wires.push(wire('u4', '2y', 'u2', 'b1'), wire('u4', '2y', 'u2', 'b2'));
  wires.push(wire('gnd1', 'gnd', 'u2', 'b0'), wire('gnd1', 'gnd', 'u2', 'b3'));
  wires.push(wire('u4', '2y', 'd2', 'a'));
  for (const p of ['b', 'c', 'd']) wires.push(wire('gnd1', 'gnd', 'd2', p));
  for (const g of [3, 4]) {
    wires.push(wire('gnd1', 'gnd', 'u3', `${g}a`), wire('gnd1', 'gnd', 'u3', `${g}b`));
    wires.push(wire('gnd1', 'gnd', 'u4', `${g}a`), wire('gnd1', 'gnd', 'u4', `${g}b`));
  }
  [['s0', 'a'], ['s1', 'b'], ['s2', 'c'], ['s3', 'd']].forEach(([s, d]) => wires.push(wire('u2', s, 'd1', d)));
  for (const [dec, disp, tag] of [['d1', 'disp_ones', 'o'], ['d2', 'disp_tens', 't']]) {
    for (const seg of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) {
      const rid = `rs_${tag}_${seg}`;
      parts.push(part(rid, 'resistor', { ohms: LED_OHMS }));
      wires.push(wire(dec, `q${seg}`, rid, 'a'), wire(rid, 'b', disp, seg));
    }
    wires.push(wire(disp, 'common', 'gnd1', 'gnd'));
  }
  done.push(emit('l9-bcd-calculator', {
    vcc: 5, parts, wires,
    _title: 'Two digits: the calculator that does not give up at nine',
    _description: 'L7 blanked above 9 because a BCD decoder only knows ten digits. This is the real fix, and it is '
      + 'what every decimal adder does: if the sum leaves the decimal range, ADD SIX to it and carry a ten. '
      + 'Three gates spot the overflow (Cout, or S3 with S2, or S3 with S1), a second 74HC283 adds the six, and '
      + 'that same carry lights the tens digit. Set each bank to a decimal digit 0-9 and read the answer, 0 to 18.',
    _category: 'logic', _difficulty: 5, _stage: 'L9',
  }));
}

// ── L10: a decimal keypad, out of diodes ───────────────────────────

{
  // Ten keys, four wires, fifteen diodes and no chip at all. Each key
  // is diode-OR'd onto the bit lines its number names: key 5 drives the
  // ones line and the fours line, because 5 is 0101.
  //
  // This is the piece that makes a calculator DECIMAL IN as well as
  // decimal out, and it is worth building from diodes rather than
  // dropping in an encoder chip precisely because you can trace it: put
  // a finger on key 7 and follow three diodes to three lines.
  const parts = [...rails()];
  const wires = [];
  const banks = ['k03', 'k47', 'k89'];
  banks.forEach((b, i) => {
    // keys 0-3, 4-7, 8-9 (the last bank uses two of its four positions)
    parts.push(part(b, 'dip_switch_spst', { switches: i === 0 ? 0b0010 : 0 }));
    for (let pos = 1; pos <= 4; pos++) wires.push(wire('vcc1', 'vcc', b, `${pos}a`));
  });
  // four bit lines, each held down so "no key" reads as a real zero
  for (let bit = 0; bit < 4; bit++) {
    const r = `rb${bit}`;
    parts.push(part(r, 'resistor', { ohms: PULLDOWN_OHMS }));
    wires.push(wire(r, 'b', 'gnd1', 'gnd'));
    const led = outputLed(r, 'a', `led_b${bit}`, `rl${bit}`, bit === 3 ? 'red' : 'green');
    parts.push(...led.parts); wires.push(...led.wires);
  }
  // one diode per set bit: 15 of them for the digits 0..9
  let diodes = 0;
  for (let key = 0; key <= 9; key++) {
    const bank = banks[Math.floor(key / 4)];
    const pos = (key % 4) + 1;
    for (let bit = 0; bit < 4; bit++) {
      if (!((key >> bit) & 1)) continue;
      const d = `d${key}_${bit}`;
      parts.push(part(d, 'diode'));
      wires.push(wire(bank, `${pos}b`, d, 'anode'));
      wires.push(wire(d, 'cathode', `rb${bit}`, 'a'));
      diodes += 1;
    }
  }
  if (diodes !== 15) throw new Error(`expected 15 diodes for 0..9, built ${diodes}`);
  done.push(emit('l10-diode-keypad', {
    vcc: 5, parts, wires,
    _title: 'A decimal keypad made of diodes',
    _description: 'Ten keys, four wires, fifteen diodes, no chip. Each key is diode-OR-ed onto the bit lines '
      + 'its number names — press 5 and it drives the ones line and the fours line, because 5 is 0101. This is '
      + 'what turns a binary machine into one you can type decimal into. '
      + 'Two things to notice, both real. A lit line reads about 4.3 V rather than 5, because every signal here '
      + 'passes through a diode and a diode costs you 0.7 V — you are seeing the forward drop in the LEDs. '
      + 'And pressing two keys at once gives you the OR of their codes rather than either number: 1 and 2 '
      + 'together read as 3. A diode matrix has no opinion about which key came first, which is exactly why '
      + 'real keypads put a PRIORITY encoder after one. '
      + 'Key 0 has no diodes at all, so "zero pressed" and "nothing pressed" look identical — the reason real '
      + 'encoders also carry a separate "a key is down" line.',
    _category: 'logic', _difficulty: 4, _stage: 'L10',
  }));
}

for (const line of done) console.log(line);
console.log(`\n${done.length} logic examples written to gallery/`);
