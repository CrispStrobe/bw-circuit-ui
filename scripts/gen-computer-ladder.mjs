/**
 * Generate the COMPUTER ladder — gallery/c0..c3, the four pieces a
 * stored-program machine is made of, each one running on its own.
 *
 * The logic ladder (l0..l9) ends at arithmetic that is entirely
 * combinational: change the switches and the answer changes, with no
 * before and no after. A computer is the other thing — it has STATE, and
 * a clock that decides when state moves. These four rungs introduce that
 * one idea at a time, on the chips a real SAP-1 is built from:
 *
 *   c0  the clock          a 555 astable, the heartbeat everything else obeys
 *   c1  the program counter 74LS161 counting addresses under that clock
 *   c2  memory             74LS189 16x4 RAM addressed BY the counter
 *   c3  the accumulator    74LS173 register + 74HC283 adder, wired back on
 *                          itself: the first circuit here that computes
 *                          over time rather than all at once
 *
 * What this ladder deliberately stops short of is the CONTROL UNIT — the
 * ring counter and instruction decoder that turn c1..c3 into a machine
 * that runs a program. That needs its own design pass and its own
 * verification; half of a sequencer is worse than none, because it looks
 * like a computer and is not one.
 *
 * One real-hardware fact this ladder cannot avoid and should not hide:
 * THE 74LS189'S OUTPUTS ARE INVERTED. Write 5 and read back 10. That is
 * the chip, not the model — real SAP-1 builds put a hex inverter after
 * the RAM for exactly this reason — and c2 shows it rather than papering
 * over it.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'gallery');
mkdirSync(outDir, { recursive: true });

const part = (id, kind, params = {}) => ({ id, kind, params, x: 0, y: 0 });
const wire = (from, fromTerminal, to, toTerminal) => ({ from, fromTerminal, to, toTerminal });
const rails = () => [part('vcc1', 'vcc'), part('gnd1', 'gnd')];
const powerChip = (id) => [wire('vcc1', 'vcc', id, 'vcc'), wire('gnd1', 'gnd', id, 'gnd')];
const PULLDOWN = 10000;
const LED_R = 330;

/** One DIP-switch position, pulled down so "open" is a real LOW. */
function switchInput(sw, position, rid) {
  return {
    parts: [part(rid, 'resistor', { ohms: PULLDOWN })],
    wires: [wire('vcc1', 'vcc', sw, `${position}a`),
      wire(sw, `${position}b`, rid, 'a'), wire(rid, 'b', 'gnd1', 'gnd')],
  };
}

function outputLed(driver, terminal, lid, rid, color = 'green') {
  return {
    parts: [part(lid, 'led', { vf: 2.0, color }), part(rid, 'resistor', { ohms: LED_R })],
    wires: [wire(driver, terminal, lid, 'anode'), wire(lid, 'cathode', rid, 'a'),
      wire(rid, 'b', 'gnd1', 'gnd')],
  };
}

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

// ── C0: the clock ──────────────────────────────────────────────────

{
  // 555 astable, ~1 Hz: slow enough to watch a machine think.
  // f = 1.44 / ((R1 + 2*R2) * C), so 6.8k + 2*68k = 143k with 10uF gives
  // about 1 Hz.
  const parts = [...rails(),
    part('u1', '555'),
    part('r1', 'resistor', { ohms: 6800 }),
    part('r2', 'resistor', { ohms: 68000 }),
    part('c1', 'capacitor', { farads: 10e-6 }),
    // Pin 5 (control) sets the comparators' reference. The datasheet says
    // to decouple it with 10 nF and it is not optional here: left
    // floating, the reference is undefined and the timer never trips —
    // the capacitor just sits at a hundredth of a volt forever.
    part('c2', 'capacitor', { farads: 10e-9 })];
  const wires = [
    wire('vcc1', 'vcc', 'u1', 'vcc'), wire('gnd1', 'gnd', 'u1', 'gnd'),
    wire('vcc1', 'vcc', 'u1', 'reset'),
    wire('vcc1', 'vcc', 'r1', 'a'),
    wire('r1', 'b', 'u1', 'discharge'), wire('r1', 'b', 'r2', 'a'),
    wire('r2', 'b', 'u1', 'threshold'), wire('r2', 'b', 'u1', 'trigger'),
    wire('r2', 'b', 'c1', 'a'), wire('c1', 'b', 'gnd1', 'gnd'),
    wire('u1', 'control', 'c2', 'a'), wire('c2', 'b', 'gnd1', 'gnd'),
  ];
  const led = outputLed('u1', 'output', 'led_clk', 'r_led', 'yellow');
  parts.push(...led.parts); wires.push(...led.wires);
  done.push(emit('c0-clock', {
    vcc: 5, parts, wires,
    _title: 'The clock — a machine needs a heartbeat',
    _description: 'A 555 wired as an astable, running at about 1 Hz, with an LED so you can see it. '
      + 'Everything after this rung moves only when this pin changes. Slow it down or speed it up by '
      + 'changing the capacitor: f = 1.44 / ((R1 + 2·R2)·C). Watching a computer at one step per second '
      + 'is the whole reason to build one out of chips.',
    _category: 'computer', _difficulty: 2, _stage: 'C0',
  }));
}

// ── C1: the program counter ────────────────────────────────────────

{
  const parts = [...rails(),
    part('pc', '74ls161'),
    part('swc', 'dip_switch_spst', { switches: 0 })];
  const wires = [...powerChip('pc')];
  const CK = switchInput('swc', 1, 'rck');
  parts.push(...CK.parts); wires.push(...CK.wires);
  wires.push(wire('swc', '1b', 'pc', 'clk'));
  // Count freely: clear and load off (both active LOW, so tied HIGH),
  // both enables on. The parallel inputs are tied low so an accidental
  // load reads as zero rather than as noise.
  for (const t of ['clrb', 'loadb', 'enp', 'ent']) wires.push(wire('vcc1', 'vcc', 'pc', t));
  for (const t of ['d0', 'd1', 'd2', 'd3']) wires.push(wire('gnd1', 'gnd', 'pc', t));
  ['q0', 'q1', 'q2', 'q3'].forEach((q, i) => {
    const led = outputLed('pc', q, `led${i}`, `rl${i}`);
    parts.push(...led.parts); wires.push(...led.wires);
  });
  const rco = outputLed('pc', 'rco', 'led_rco', 'rl_rco', 'red');
  parts.push(...rco.parts); wires.push(...rco.wires);
  done.push(emit('c1-program-counter', {
    vcc: 5, parts, wires,
    _title: 'The program counter — where the machine is looking',
    _description: 'A 74LS161 counting 0 to 15 in binary, one step per clock. This is the register that says '
      + 'which instruction comes next; a program is just this number walking upward. The red LED is the ripple '
      + 'carry, which lights on 15 and is how counters are chained into wider ones. '
      + 'Clear and load are ACTIVE LOW, so they are tied high to leave the counter free-running.',
    _category: 'computer', _difficulty: 3, _stage: 'C1',
  }));
}

// ── C2: memory ─────────────────────────────────────────────────────

{
  const parts = [...rails(),
    part('pc', '74ls161'),
    part('ram', '74ls189'),
    part('swc', 'dip_switch_spst', { switches: 0 }),        // 1 = clock, 2 = write
    part('swd', 'dip_switch_spst', { switches: 0b0101 })];   // the nibble to store
  const wires = [...powerChip('pc'), ...powerChip('ram')];
  for (const [pos, rid, target, pin] of [[1, 'rck', 'pc', 'clk'], [2, 'rwe', 'ram', 'web']]) {
    const s = switchInput('swc', pos, rid);
    parts.push(...s.parts); wires.push(...s.wires);
    wires.push(wire('swc', `${pos}b`, target, pin));
  }
  for (const t of ['clrb', 'loadb', 'enp', 'ent']) wires.push(wire('vcc1', 'vcc', 'pc', t));
  for (const t of ['d0', 'd1', 'd2', 'd3']) wires.push(wire('gnd1', 'gnd', 'pc', t));
  wires.push(wire('gnd1', 'gnd', 'ram', 'csb'));            // chip select, active LOW
  // The counter IS the address bus.
  for (let i = 0; i < 4; i++) wires.push(wire('pc', `q${i}`, 'ram', `a${i}`));
  for (let i = 0; i < 4; i++) {
    const s = switchInput('swd', i + 1, `rd${i}`);
    parts.push(...s.parts); wires.push(...s.wires);
    wires.push(wire('swd', `${i + 1}b`, 'ram', `d${i}`));
  }
  ['a0', 'a1', 'a2', 'a3'].forEach((a, i) => {
    const led = outputLed('pc', `q${i}`, `led_addr${i}`, `rla${i}`, 'yellow');
    parts.push(...led.parts); wires.push(...led.wires);
  });
  ['o0', 'o1', 'o2', 'o3'].forEach((o, i) => {
    const led = outputLed('ram', o, `led_data${i}`, `rld${i}`);
    parts.push(...led.parts); wires.push(...led.wires);
  });
  done.push(emit('c2-memory', {
    vcc: 5, parts, wires,
    _title: 'Memory — sixteen places to put a number',
    _description: 'The counter from C1 now drives the ADDRESS pins of a 74LS189, a 16-by-4-bit RAM. '
      + 'Yellow LEDs show which address the machine is looking at; green ones show what is stored there. '
      + 'Set the data switches, pulse WRITE, then clock to the next address and do it again — you are '
      + 'loading a program by hand, which is exactly how the first machines were programmed. '
      + 'WATCH OUT: the 74LS189 has INVERTED outputs. Store 5 and the LEDs read 10. That is the real chip, '
      + 'not a mistake, and it is why SAP-1 builds put a hex inverter after the RAM.',
    _category: 'computer', _difficulty: 4, _stage: 'C2',
  }));
}

// ── C3: the accumulator ────────────────────────────────────────────

{
  // Register + adder, output wired back to one adder input: each clock
  // adds the switch value to the running total. The first circuit in
  // this repo whose answer depends on its own past.
  const parts = [...rails(),
    part('acc', '74ls173'),
    part('add', '74hc283'),
    part('swc', 'dip_switch_spst', { switches: 0 }),        // 1 = clock, 2 = clear
    part('swv', 'dip_switch_spst', { switches: 0b0001 })];   // the value added each tick
  const wires = [...powerChip('acc'), ...powerChip('add'), wire('gnd1', 'gnd', 'add', 'cin')];
  // 74LS173: both output enables and both gated inputs active LOW.
  for (const t of ['oe1b', 'oe2b', 'g1b', 'g2b']) wires.push(wire('gnd1', 'gnd', 'acc', t));
  for (const [pos, rid, pin] of [[1, 'rck', 'clk'], [2, 'rmr', 'mr']]) {
    const s = switchInput('swc', pos, rid);
    parts.push(...s.parts); wires.push(...s.wires);
    wires.push(wire('swc', `${pos}b`, 'acc', pin));
  }
  for (let i = 0; i < 4; i++) {
    const s = switchInput('swv', i + 1, `rv${i}`);
    parts.push(...s.parts); wires.push(...s.wires);
    wires.push(wire('swv', `${i + 1}b`, 'add', `b${i}`));    // the addend
    wires.push(wire('acc', `q${i}`, 'add', `a${i}`));        // the running total
    wires.push(wire('add', `s${i}`, 'acc', `d${i}`));        // sum back into the register
  }
  ['q0', 'q1', 'q2', 'q3'].forEach((q, i) => {
    const led = outputLed('acc', q, `led${i}`, `rl${i}`);
    parts.push(...led.parts); wires.push(...led.wires);
  });
  const co = outputLed('add', 'cout', 'led_cout', 'rl_cout', 'red');
  parts.push(...co.parts); wires.push(...co.wires);
  done.push(emit('c3-accumulator', {
    vcc: 5, parts, wires,
    _title: 'The accumulator — a circuit with a past',
    _description: 'A 74LS173 register holds a running total; a 74HC283 adds the switch value to it; the sum goes '
      + 'straight back into the register. Every clock pulse adds again, so the display climbs by whatever you '
      + 'set on the switches — set 1 and it counts, set 3 and it goes 3, 6, 9. '
      + 'This is the first circuit here whose answer depends on what happened before, and that feedback loop — '
      + 'register out, through logic, back into register in — is the shape of every processor ever built. '
      + 'MR clears it back to zero.',
    _category: 'computer', _difficulty: 5, _stage: 'C3',
  }));
}

for (const line of done) console.log(line);
console.log(`\n${done.length} computer examples written to gallery/`);
