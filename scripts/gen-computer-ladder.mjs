/**
 * Generate the COMPUTER ladder — gallery/c0..c10, the pieces a
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

/**
 * A switch on an ACTIVE-LOW pin: pulled HIGH by a resistor, shorted to
 * ground when the switch closes. Using the ordinary pull-DOWN helper
 * here holds the pin asserted permanently — on a RAM's /WE that means it
 * never stops writing, so every cell ends up holding the last value put
 * on the data switches. (Measured: c8 gave back 12 from every address.)
 */
function switchInputActiveLow(sw, position, rid) {
  return {
    parts: [part(rid, 'resistor', { ohms: PULLDOWN })],
    wires: [wire('vcc1', 'vcc', rid, 'a'), wire(rid, 'b', sw, `${position}b`),
      wire(sw, `${position}a`, 'gnd1', 'gnd')],
  };
}

function outputLed(driver, terminal, lid, rid, color = 'green') {
  return {
    parts: [part(lid, 'led', { vf: 2.0, color }), part(rid, 'resistor', { ohms: LED_R })],
    wires: [wire(driver, terminal, lid, 'anode'), wire(lid, 'cathode', rid, 'a'),
      wire(rid, 'b', 'gnd1', 'gnd')],
  };
}

// The registry must be populated before terminalsForKind means anything:
// without _setup.js it answers ['a','b'] for every kind, and a validator built
// on that cannot fail.
import '../test/_setup.js';
import { terminalsForKind } from '../src/model/circuit.js';

/** Kinds whose engine model has real power pins. */
function hasPowerPins (kind) {
  const t = terminalsForKind(kind);
  return t.includes('vcc') && t.includes('gnd');
}

function emit(name, circuit) {
  const ids = circuit.parts.map((p) => p.id);
  if (new Set(ids).size !== ids.length) throw new Error(`${name}: duplicate part id`);
  const known = new Set(ids);
  for (const w of circuit.wires) {
    if (!known.has(w.from)) throw new Error(`${name}: wire from unknown part ${w.from}`);
    if (!known.has(w.to)) throw new Error(`${name}: wire to unknown part ${w.to}`);
  }
  // Terminals, not just parts. validateNetlist checks a part's DECLARED
  // terminal list and never the terminals nets reference, so a wire to a pin
  // the model does not have is accepted by the engine and silently ignored by
  // the solver. c10 wired vcc/gnd to a decade_counter — which models a CD4017
  // with no power pins — and it went unnoticed until a corpus round-trip that
  // had not run in months started dropping the two wires.
  const kindOf = new Map(circuit.parts.map((p) => [p.id, p.kind]));
  for (const w of circuit.wires) {
    for (const [pid, term] of [[w.from, w.fromTerminal], [w.to, w.toTerminal]]) {
      const kind = kindOf.get(pid);
      const valid = terminalsForKind(kind);
      if (!valid.includes(term)) {
        throw new Error(`${name}: ${pid} (${kind}) has no terminal "${term}" — the engine `
          + `offers ${valid.join(', ')}`);
      }
    }
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
  {
    const ck = switchInput('swc', 1, 'rck');
    parts.push(...ck.parts); wires.push(...ck.wires);
    wires.push(wire('swc', '1b', 'pc', 'clk'));
    // /WE is ACTIVE LOW: pulled high, and the switch pulls it down to write.
    const we = switchInputActiveLow('swc', 2, 'rwe');
    parts.push(...we.parts); wires.push(...we.wires);
    wires.push(wire('swc', '2b', 'ram', 'web'));
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

/** An LED on an ACTIVE-LOW output: VCC → R → LED → output, lit when LOW. */
function activeLowLed(driver, terminal, lid, rid, color = 'red') {
  return {
    parts: [part(lid, 'led', { vf: 2.0, color }), part(rid, 'resistor', { ohms: LED_R })],
    wires: [wire('vcc1', 'vcc', rid, 'a'), wire(rid, 'b', lid, 'anode'),
      wire(lid, 'cathode', driver, terminal)],
  };
}

// ── C4: the ring counter — the machine's six beats ─────────────────

{
  // A SAP-1 executes every instruction in six timing states, T1..T6, and
  // exactly one is active at a time. A CD4017 is a one-hot counter by
  // construction; feeding its SEVENTH output back into its own reset
  // makes it wrap after six, which is the whole trick.
  const parts = [...rails(),
    part('ring', 'decade_counter'),
    part('swc', 'dip_switch_spst', { switches: 0 })];
  const wires = [];
  const CK = switchInput('swc', 1, 'rck');
  parts.push(...CK.parts); wires.push(...CK.wires);
  wires.push(wire('swc', '1b', 'ring', 'clk'));
  wires.push(wire('gnd1', 'gnd', 'ring', 'en'));       // enable is active LOW on this model
  wires.push(wire('ring', 'q6', 'ring', 'rst'));       // wrap after six states
  for (let i = 0; i < 6; i++) {
    const led = outputLed('ring', `q${i}`, `led_t${i + 1}`, `rlt${i}`, i === 0 ? 'yellow' : 'green');
    parts.push(...led.parts); wires.push(...led.wires);
  }
  done.push(emit('c4-ring-counter', {
    vcc: 5, parts, wires,
    _title: 'The ring counter — six beats to every instruction',
    _description: 'A SAP-1 does not do an instruction in one go: it takes six timing states, T1 to T6, and '
      + 'exactly one is active at any moment. T1-T3 are the same for every instruction (fetch: put the address '
      + 'out, read memory, advance the counter); T4-T6 are what makes LDA different from ADD. '
      + 'A CD4017 is one-hot by construction, and wiring its seventh output back to its own RESET makes it '
      + 'wrap after six — a six-state ring counter from one chip and one wire.',
    _category: 'computer', _difficulty: 4, _stage: 'C4',
  }));
}

// ── C5: the instruction decoder ────────────────────────────────────

{
  // Opcode bits l4..l7 (l4 is the LSB) name the instruction:
  //   0000 LDA   0001 ADD   0010 SUB   1110 OUT   1111 HLT
  // Two 74HC138s split on the top bit: one decodes while l7 is low, the
  // other while it is high. Their outputs are ACTIVE LOW, which is what
  // a real decoder gives you and what the control matrix expects.
  const parts = [...rails(),
    part('u1', '74hc138'), part('u2', '74hc138'),
    part('swi', 'dip_switch_spst', { switches: 0b0000 })];
  const wires = [...powerChip('u1'), ...powerChip('u2')];
  ['a', 'b', 'c'].forEach((pin, i) => {
    const s = switchInput('swi', i + 1, `ri${i}`);
    parts.push(...s.parts); wires.push(...s.wires);
    wires.push(wire('swi', `${i + 1}b`, 'u1', pin), wire('swi', `${i + 1}b`, 'u2', pin));
  });
  const top = switchInput('swi', 4, 'ri3');               // l7, the top opcode bit
  parts.push(...top.parts); wires.push(...top.wires);
  // U1 runs when l7 is LOW: G1 tied high, G2A driven by l7 (active low).
  wires.push(wire('vcc1', 'vcc', 'u1', 'g1'), wire('swi', '4b', 'u1', 'g2ab'),
    wire('gnd1', 'gnd', 'u1', 'g2bb'));
  // U2 runs when l7 is HIGH: l7 drives G1 directly, both G2 tied low.
  wires.push(wire('swi', '4b', 'u2', 'g1'), wire('gnd1', 'gnd', 'u2', 'g2ab'),
    wire('gnd1', 'gnd', 'u2', 'g2bb'));
  for (const [chip, out, name, color] of [['u1', 'y0b', 'lda', 'green'], ['u1', 'y1b', 'add', 'green'],
    ['u1', 'y2b', 'sub', 'green'], ['u2', 'y6b', 'out', 'yellow'], ['u2', 'y7b', 'hlt', 'red']]) {
    const led = activeLowLed(chip, out, `led_${name}`, `rl_${name}`, color);
    parts.push(...led.parts); wires.push(...led.wires);
  }
  done.push(emit('c5-instruction-decoder', {
    vcc: 5, parts, wires,
    _title: 'The instruction decoder — turning a number into a meaning',
    _description: 'Four switches are the opcode; five LEDs are the instructions. 0000 is LDA, 0001 ADD, '
      + '0010 SUB, 1110 OUT, 1111 HLT. Two 74HC138 decoders split on the top bit — one is enabled while it '
      + 'is low, the other while it is high — which is what those three enable pins on a decoder are FOR. '
      + 'The outputs are ACTIVE LOW, so each LED is wired from +5 V down INTO the chip and lights when its '
      + 'line goes low. That is not a quirk to work around; it is how decoders and control lines really talk.',
    _category: 'computer', _difficulty: 5, _stage: 'C5',
  }));
}

// ── C6: the control matrix — where a machine decides what to do ────

{
  // The last piece. A ring counter says WHEN (T1..T6), a decoder says
  // WHAT (LDA/ADD/SUB/OUT), and this AND-OR array turns the pair into
  // the control lines that actually move data:
  //
  //   T1        Ep, Lm      put the program counter on the bus, into MAR
  //   T2        Cp          advance the counter
  //   T3        CE, Li      memory onto the bus, into the instruction reg
  //   T4  LDA/ADD/SUB  Ei, Lm     operand address out of the instruction
  //       OUT          Ea, Lo     accumulator to the output register
  //   T5  LDA          CE, La     memory into the accumulator
  //       ADD/SUB      CE, Lb     memory into the B register
  //   T6  ADD/SUB      Eu, La     adder result back into the accumulator
  //       SUB          + Su       and the adder subtracts
  //
  // Every line above is one term of an AND, OR'd with the others that
  // drive the same signal. That is all a hardwired control unit IS.
  const parts = [...rails(),
    part('ring', 'decade_counter'),
    part('dec_lo', '74hc138'), part('dec_hi', '74hc138'),
    part('inv', '74hc04'),
    part('and1', '74hc08'), part('and2', '74hc08'),
    part('or1', '74hc32'), part('or2', '74hc32'),
    part('swc', 'dip_switch_spst', { switches: 0 }),        // 1 = clock
    part('swi', 'dip_switch_spst', { switches: 0b0000 })];   // the opcode
  const wires = [...powerChip('dec_lo'), ...powerChip('dec_hi'), ...powerChip('inv'),
    ...powerChip('and1'), ...powerChip('and2'), ...powerChip('or1'), ...powerChip('or2')];

  // clock into the ring counter, and the six-state wrap
  const CK = switchInput('swc', 1, 'rck');
  parts.push(...CK.parts); wires.push(...CK.wires);
  wires.push(wire('swc', '1b', 'ring', 'clk'), wire('gnd1', 'gnd', 'ring', 'en'),
    wire('ring', 'q6', 'ring', 'rst'));

  // opcode into both decoders, split on the top bit
  ['a', 'b', 'c'].forEach((pin, i) => {
    const sw = switchInput('swi', i + 1, `ri${i}`);
    parts.push(...sw.parts); wires.push(...sw.wires);
    wires.push(wire('swi', `${i + 1}b`, 'dec_lo', pin), wire('swi', `${i + 1}b`, 'dec_hi', pin));
  });
  const top = switchInput('swi', 4, 'ri3');
  parts.push(...top.parts); wires.push(...top.wires);
  wires.push(wire('vcc1', 'vcc', 'dec_lo', 'g1'), wire('swi', '4b', 'dec_lo', 'g2ab'),
    wire('gnd1', 'gnd', 'dec_lo', 'g2bb'));
  wires.push(wire('swi', '4b', 'dec_hi', 'g1'), wire('gnd1', 'gnd', 'dec_hi', 'g2ab'),
    wire('gnd1', 'gnd', 'dec_hi', 'g2bb'));

  // decoder outputs are ACTIVE LOW; invert them so the matrix can AND them
  wires.push(wire('dec_lo', 'y0b', 'inv', '1a'));   // 1y = LDA
  wires.push(wire('dec_lo', 'y1b', 'inv', '2a'));   // 2y = ADD
  wires.push(wire('dec_lo', 'y2b', 'inv', '3a'));   // 3y = SUB
  wires.push(wire('dec_hi', 'y6b', 'inv', '4a'));   // 4y = OUT
  for (const g of [5, 6]) wires.push(wire('gnd1', 'gnd', 'inv', `${g}a`));

  // or1 gate1: ADD or SUB      or1 gate2: (ADD|SUB) or LDA  = any memory-reference instruction
  wires.push(wire('inv', '2y', 'or1', '1a'), wire('inv', '3y', 'or1', '1b'));
  wires.push(wire('or1', '1y', 'or1', '2a'), wire('inv', '1y', 'or1', '2b'));

  // AND terms
  const term = (chip, gate, x, xt, y, yt) => {
    wires.push(wire(x, xt, chip, `${gate}a`), wire(y, yt, chip, `${gate}b`));
    return [chip, `${gate}y`];
  };
  const mem_T4 = term('and1', 1, 'or1', '2y', 'ring', 'q3');   // any-mem-ref AND T4
  const mem_T5 = term('and1', 2, 'or1', '2y', 'ring', 'q4');   // any-mem-ref AND T5
  const lda_T5 = term('and1', 3, 'inv', '1y', 'ring', 'q4');
  const ab_T6 = term('and1', 4, 'or1', '1y', 'ring', 'q5');    // (ADD|SUB) AND T6
  const ab_T5 = term('and2', 1, 'or1', '1y', 'ring', 'q4');
  const sub_T6 = term('and2', 2, 'inv', '3y', 'ring', 'q5');
  const out_T4 = term('and2', 3, 'inv', '4y', 'ring', 'q3');
  for (const g of [4]) wires.push(wire('gnd1', 'gnd', 'and2', `${g}a`), wire('gnd1', 'gnd', 'and2', `${g}b`));

  // OR the terms that share a control line
  wires.push(wire('ring', 'q0', 'or2', '1a'), wire(mem_T4[0], mem_T4[1], 'or2', '1b'));  // Lm = T1 + memref.T4
  wires.push(wire('ring', 'q2', 'or2', '2a'), wire(mem_T5[0], mem_T5[1], 'or2', '2b'));  // CE = T3 + memref.T5
  wires.push(wire(lda_T5[0], lda_T5[1], 'or2', '3a'), wire(ab_T6[0], ab_T6[1], 'or2', '3b')); // La
  for (const g of [4]) wires.push(wire('gnd1', 'gnd', 'or2', `${g}a`), wire('gnd1', 'gnd', 'or2', `${g}b`));
  for (const g of [3, 4]) wires.push(wire('gnd1', 'gnd', 'or1', `${g}a`), wire('gnd1', 'gnd', 'or1', `${g}b`));

  // the twelve control lines, as LEDs
  for (const [drv, t, name, color] of [
    ['ring', 'q0', 'ep', 'yellow'],            // Ep  = T1
    ['or2', '1y', 'lm', 'yellow'],             // Lm  = T1 + memref.T4
    ['ring', 'q1', 'cp', 'yellow'],            // Cp  = T2
    ['or2', '2y', 'ce', 'green'],              // CE  = T3 + memref.T5
    ['ring', 'q2', 'li', 'green'],             // Li  = T3
    [mem_T4[0], mem_T4[1], 'ei', 'green'],     // Ei  = memref.T4
    ['or2', '3y', 'la', 'red'],                // La  = LDA.T5 + (ADD|SUB).T6
    [ab_T5[0], ab_T5[1], 'lb', 'red'],         // Lb  = (ADD|SUB).T5
    [ab_T6[0], ab_T6[1], 'eu', 'red'],         // Eu  = (ADD|SUB).T6
    [sub_T6[0], sub_T6[1], 'su', 'red'],       // Su  = SUB.T6
    [out_T4[0], out_T4[1], 'ea', 'yellow'],    // Ea  = OUT.T4
    [out_T4[0], out_T4[1], 'lo', 'yellow'],    // Lo  = OUT.T4 (same term)
  ]) {
    const led = outputLed(drv, t, `led_${name}`, `rl_${name}`, color);
    parts.push(...led.parts); wires.push(...led.wires);
  }
  for (let i = 0; i < 6; i++) {
    const led = outputLed('ring', `q${i}`, `led_t${i + 1}`, `rlt${i}`, 'green');
    parts.push(...led.parts); wires.push(...led.wires);
  }
  done.push(emit('c6-control-matrix', {
    vcc: 5, parts, wires,
    _title: 'The control matrix — the part that decides',
    _description: 'Set an opcode, then clock through the six timing states and watch the control lines fire in '
      + 'order. T1 puts the program counter on the bus (Ep, Lm); T2 advances it (Cp); T3 fetches the '
      + 'instruction (CE, Li) — that much is the same for every instruction. From T4 the opcode takes over: '
      + 'LDA loads the accumulator from memory, ADD routes through the B register and the adder, SUB does the '
      + 'same with Su asserted, OUT copies the accumulator to the display. '
      + 'Every lamp here is one AND term OR-ed with the others that drive the same line. '
      + 'A hardwired control unit is nothing more than that array — this is the piece that makes the '
      + 'registers, the memory and the adder into a computer.',
    _category: 'computer', _difficulty: 5, _stage: 'C6',
  }));
}

// ── C7: the bus — how one wire serves everybody ────────────────────

{
  // Every register in a computer wants to put its value somewhere, and
  // they all share ONE set of wires. What makes that possible is the
  // tri-state buffer: a gate whose output can be HIGH, LOW, or
  // disconnected entirely. Exactly one source drives at a time; the rest
  // let go.
  //
  // The rung also shows what happens when that rule is broken, because
  // it is the failure the whole control unit exists to prevent.
  const parts = [...rails(),
    part('drv_a', '74hc244'), part('drv_b', '74hc244'),
    part('inv', '74hc04'),
    part('swa', 'dip_switch_spst', { switches: 0b0101 }),
    part('swb', 'dip_switch_spst', { switches: 0b1010 }),
    part('swe', 'dip_switch_spst', { switches: 0b0001 })];
  const wires = [...powerChip('drv_a'), ...powerChip('drv_b'), ...powerChip('inv'),
    wire('gnd1', 'gnd', 'drv_a', '2oeb'), wire('gnd1', 'gnd', 'drv_b', '2oeb')];
  // the two values
  for (const [sw, drv, tag] of [['swa', 'drv_a', 'a'], ['swb', 'drv_b', 'b']]) {
    for (let i = 0; i < 4; i++) {
      const s = switchInput(sw, i + 1, `r${tag}${i}`);
      parts.push(...s.parts); wires.push(...s.wires);
      wires.push(wire(sw, `${i + 1}b`, drv, `1a${i}`));
    }
  }
  // enables: /OE is ACTIVE LOW, so an inverter makes "switch closed" mean
  // "this source drives" — the polarity a learner expects.
  for (const [pos, rid, gate, drv] of [[1, 're0', 1, 'drv_a'], [2, 're1', 2, 'drv_b']]) {
    const s = switchInput('swe', pos, rid);
    parts.push(...s.parts); wires.push(...s.wires);
    wires.push(wire('swe', `${pos}b`, 'inv', `${gate}a`), wire('inv', `${gate}y`, drv, '1oeb'));
  }
  for (const g of [3, 4, 5, 6]) wires.push(wire('gnd1', 'gnd', 'inv', `${g}a`));
  // the shared bus, with weak pull-downs so "nobody driving" reads as a
  // real LOW instead of drifting.
  for (let i = 0; i < 4; i++) {
    const rid = `rbus${i}`;
    parts.push(part(rid, 'resistor', { ohms: 100000 }));
    wires.push(wire('drv_a', `1y${i}`, rid, 'a'), wire('drv_b', `1y${i}`, rid, 'a'),
      wire(rid, 'b', 'gnd1', 'gnd'));
    const led = outputLed(rid, 'a', `led_bus${i}`, `rl${i}`, 'yellow');
    parts.push(...led.parts); wires.push(...led.wires);
  }
  done.push(emit('c7-the-bus', {
    vcc: 5, parts, wires,
    _title: 'The bus — one set of wires, many talkers',
    _description: 'Two sources, one four-bit bus. Enable A and the bus shows A; enable B and it shows B; '
      + 'enable neither and the pull-downs bring it to zero. What makes this work is the tri-state buffer '
      + 'inside the 74HC244: its outputs can be HIGH, LOW, or LET GO of the wire entirely, which is a third '
      + 'thing a plain gate cannot do. '
      + 'Now enable BOTH at once. One chip pulls a line up while the other pulls it down, the voltage lands in '
      + 'the middle where it is neither a 1 nor a 0, and both chips heat up. That is bus contention, and '
      + 'preventing it is precisely why a control unit exists: of all the things that could drive the bus, it '
      + 'guarantees exactly one does.',
    _category: 'computer', _difficulty: 4, _stage: 'C7',
  }));
}

// ── C8: the machine reads its own memory ───────────────────────────

{
  // The first rung where the pieces move data WITHOUT a hand on a
  // switch. The program counter drives the bus, the address register
  // latches what it sees, the RAM answers, and the answer appears on the
  // LEDs — then the clock ticks and it all happens again one address
  // further on.
  //
  // The timing is the part worth studying. The ring of states advances on
  // the RISING clock edge; registers latch on the FALLING edge, through
  // an inverter. That half-cycle offset is not decoration: it guarantees
  // the bus has settled and the right driver is enabled BEFORE anything
  // latches. Clock both on the same edge and you latch whatever the bus
  // happened to be doing mid-transition.
  const parts = [...rails(),
    part('pc', '74ls161'),
    part('buf_pc', '74hc244'),
    part('mar', '74ls173'),
    part('ram', '74ls189'),
    part('inv', '74hc04'),
    part('andg', '74hc08'),
    part('swc', 'dip_switch_spst', { switches: 0 }),        // 1 = clock, 2 = write, 3 = run
    part('swd', 'dip_switch_spst', { switches: 0b0101 })];   // data to write
  const wires = [...powerChip('buf_pc'), ...powerChip('mar'), ...powerChip('ram'),
    ...powerChip('inv'), ...powerChip('andg'), ...powerChip('pc')];

  // clock, and its inverse for the latches
  const CK = switchInput('swc', 1, 'rck');
  parts.push(...CK.parts); wires.push(...CK.wires);
  wires.push(wire('swc', '1b', 'pc', 'clk'), wire('swc', '1b', 'inv', '1a'));
  // andg gate 1: latch MAR on (NOT clock) — the falling edge of the clock
  wires.push(wire('inv', '1y', 'andg', '1a'), wire('vcc1', 'vcc', 'andg', '1b'));
  wires.push(wire('andg', '1y', 'mar', 'clk'));

  // program counter runs free; its outputs reach the bus through a buffer
  for (const t of ['clrb', 'loadb', 'enp', 'ent']) wires.push(wire('vcc1', 'vcc', 'pc', t));
  for (const t of ['d0', 'd1', 'd2', 'd3']) wires.push(wire('gnd1', 'gnd', 'pc', t));
  wires.push(wire('gnd1', 'gnd', 'buf_pc', '1oeb'), wire('gnd1', 'gnd', 'buf_pc', '2oeb'));
  for (let i = 0; i < 4; i++) wires.push(wire('pc', `q${i}`, 'buf_pc', `1a${i}`));

  // the bus: buffer output, weak pull-down, and on to the address register
  for (let i = 0; i < 4; i++) {
    const rid = `rbus${i}`;
    parts.push(part(rid, 'resistor', { ohms: 100000 }));
    wires.push(wire('buf_pc', `1y${i}`, rid, 'a'), wire(rid, 'b', 'gnd1', 'gnd'));
    wires.push(wire(rid, 'a', 'mar', `d${i}`));
    const led = outputLed(rid, 'a', `led_bus${i}`, `rlb${i}`, 'yellow');
    parts.push(...led.parts); wires.push(...led.wires);
  }
  for (const t of ['g1b', 'g2b', 'oe1b', 'oe2b']) wires.push(wire('gnd1', 'gnd', 'mar', t));
  wires.push(wire('gnd1', 'gnd', 'mar', 'mr'));

  // the address register drives the RAM's address pins
  for (let i = 0; i < 4; i++) wires.push(wire('mar', `q${i}`, 'ram', `a${i}`));
  wires.push(wire('gnd1', 'gnd', 'ram', 'csb'));

  // hand-loading: data switches in, WRITE on switch 2
  const WE = switchInputActiveLow('swc', 2, 'rwe');
  parts.push(...WE.parts); wires.push(...WE.wires);
  wires.push(wire('swc', '2b', 'ram', 'web'));
  for (let i = 0; i < 4; i++) {
    const s = switchInput('swd', i + 1, `rd${i}`);
    parts.push(...s.parts); wires.push(...s.wires);
    wires.push(wire('swd', `${i + 1}b`, 'ram', `d${i}`));
  }

  // the RAM's outputs are inverted, so an inverter bank puts them right
  ['2', '3', '4', '5'].forEach((g, i) => {
    wires.push(wire('ram', `o${i}`, 'inv', `${g}a`));
    const led = outputLed('inv', `${g}y`, `led_data${i}`, `rld${i}`, 'green');
    parts.push(...led.parts); wires.push(...led.wires);
  });
  wires.push(wire('gnd1', 'gnd', 'inv', '6a'));
  for (const g of [2, 3, 4]) wires.push(wire('gnd1', 'gnd', 'andg', `${g}a`), wire('gnd1', 'gnd', 'andg', `${g}b`));

  // the address the machine is currently looking at
  for (let i = 0; i < 4; i++) {
    const led = outputLed('mar', `q${i}`, `led_addr${i}`, `rla${i}`, 'red');
    parts.push(...led.parts); wires.push(...led.wires);
  }
  done.push(emit('c8-memory-walker', {
    vcc: 5, parts, wires,
    _title: 'The machine reads its own memory',
    _description: 'Nothing here is touched by hand except the clock. The program counter puts an address on the '
      + 'bus, the address register latches it, the RAM answers with what is stored there, and the green LEDs '
      + 'show the answer — then the next tick does it again, one address further along. '
      + 'Load memory first: set the data switches, pulse WRITE, clock on, repeat. Then just clock, and watch '
      + 'the machine walk through what you wrote. '
      + 'The timing is the lesson. States advance on the RISING clock edge and registers latch on the FALLING '
      + 'one, through an inverter, so the bus has settled and the right driver is enabled before anything is '
      + 'captured. Latch on the same edge that changes the state and you capture the bus mid-transition. '
      + 'The inverter bank on the RAM outputs is there because the 74LS189 gives its data back inverted.',
    _category: 'computer', _difficulty: 5, _stage: 'C8',
  }));
}

// ── C9: the fetch cycle — the machine reads AND understands ────────

{
  // Everything from C8, now sequenced properly and with an instruction
  // register on the end of it. Three timing states do the fetch:
  //
  //   T1  Ep, Lm   the counter drives the bus; MAR latches the address
  //   T2  Cp       the counter advances (the address is already safe)
  //   T3  CE, Li   the RAM drives the bus; IR latches the instruction
  //
  // The instruction is four bits: the top two are the opcode and the
  // bottom two the operand address, which is what a four-bit bus can
  // honestly carry. 00 LDA, 01 ADD, 10 SUB, 11 OUT.
  const parts = [...rails(),
    part('ring', 'decade_counter'),
    part('pc', '74ls161'), part('buf_pc', '74hc244'),
    part('mar', '74ls173'), part('ram', '74ls189'),
    part('inv_a', '74hc04'), part('inv_b', '74hc04'),
    part('buf_ram', '74hc244'),
    part('ir', '74ls173'), part('dec', '74hc138'),
    part('gate', '74hc08'),
    part('swc', 'dip_switch_spst', { switches: 0 }),        // 1 = clock, 2 = write
    part('swd', 'dip_switch_spst', { switches: 0 })];        // data to load
  const wires = [...powerChip('pc'), ...powerChip('buf_pc'), ...powerChip('mar'), ...powerChip('ram'),
    ...powerChip('inv_a'), ...powerChip('inv_b'), ...powerChip('buf_ram'), ...powerChip('ir'),
    ...powerChip('dec'), ...powerChip('gate')];

  // ── clock, its inverse, and the three-state ring ────────────────
  const CK = switchInput('swc', 1, 'rck');
  parts.push(...CK.parts); wires.push(...CK.wires);
  wires.push(wire('swc', '1b', 'ring', 'clk'), wire('swc', '1b', 'inv_a', '1a'));
  wires.push(wire('gnd1', 'gnd', 'ring', 'en'), wire('ring', 'q3', 'ring', 'rst'));
  const NOTCLK = ['inv_a', '1y'];

  // gated loads: each register latches on the falling clock DURING its state
  const gated = (gate, tState, target) => {
    wires.push(wire('ring', tState, 'gate', `${gate}a`), wire(NOTCLK[0], NOTCLK[1], 'gate', `${gate}b`));
    wires.push(wire('gate', `${gate}y`, target, 'clk'));
  };
  gated(1, 'q0', 'mar');      // T1: latch the address
  gated(2, 'q1', 'pc');       // T2: advance the counter
  gated(3, 'q2', 'ir');       // T3: latch the instruction
  wires.push(wire('gnd1', 'gnd', 'gate', '4a'), wire('gnd1', 'gnd', 'gate', '4b'));

  // ── the counter, and its tri-state path onto the bus ────────────
  for (const t of ['clrb', 'loadb', 'enp', 'ent']) wires.push(wire('vcc1', 'vcc', 'pc', t));
  for (const t of ['d0', 'd1', 'd2', 'd3']) wires.push(wire('gnd1', 'gnd', 'pc', t));
  for (let i = 0; i < 4; i++) wires.push(wire('pc', `q${i}`, 'buf_pc', `1a${i}`));
  wires.push(wire('ring', 'q0', 'inv_a', '2a'), wire('inv_a', '2y', 'buf_pc', '1oeb'));  // Ep = T1
  wires.push(wire('gnd1', 'gnd', 'buf_pc', '2oeb'));

  // ── the bus ─────────────────────────────────────────────────────
  for (let i = 0; i < 4; i++) {
    const rid = `rbus${i}`;
    parts.push(part(rid, 'resistor', { ohms: 100000 }));
    wires.push(wire('buf_pc', `1y${i}`, rid, 'a'), wire('buf_ram', `1y${i}`, rid, 'a'),
      wire(rid, 'b', 'gnd1', 'gnd'));
    wires.push(wire(rid, 'a', 'mar', `d${i}`), wire(rid, 'a', 'ir', `d${i}`));
    const led = outputLed(rid, 'a', `led_bus${i}`, `rlb${i}`, 'yellow');
    parts.push(...led.parts); wires.push(...led.wires);
  }

  // ── address register → RAM ──────────────────────────────────────
  for (const t of ['g1b', 'g2b', 'oe1b', 'oe2b']) wires.push(wire('gnd1', 'gnd', 'mar', t));
  wires.push(wire('gnd1', 'gnd', 'mar', 'mr'));
  for (let i = 0; i < 4; i++) wires.push(wire('mar', `q${i}`, 'ram', `a${i}`));
  wires.push(wire('gnd1', 'gnd', 'ram', 'csb'));

  // hand-loading the program
  const WE = switchInputActiveLow('swc', 2, 'rwe');
  parts.push(...WE.parts); wires.push(...WE.wires);
  wires.push(wire('swc', '2b', 'ram', 'web'));
  for (let i = 0; i < 4; i++) {
    const sw = switchInput('swd', i + 1, `rd${i}`);
    parts.push(...sw.parts); wires.push(...sw.wires);
    wires.push(wire('swd', `${i + 1}b`, 'ram', `d${i}`));
  }

  // ── RAM out (inverted) → inverter bank → tri-state → bus ────────
  ['2', '3', '4', '5'].forEach((g, i) => {
    wires.push(wire('ram', `o${i}`, 'inv_b', `${g}a`), wire('inv_b', `${g}y`, 'buf_ram', `1a${i}`));
  });
  wires.push(wire('ring', 'q2', 'inv_b', '1a'), wire('inv_b', '1y', 'buf_ram', '1oeb'));  // CE = T3
  wires.push(wire('gnd1', 'gnd', 'buf_ram', '2oeb'), wire('gnd1', 'gnd', 'inv_b', '6a'));
  for (const g of ['3', '4', '5', '6']) wires.push(wire('gnd1', 'gnd', 'inv_a', `${g}a`));

  // ── instruction register → decoder ──────────────────────────────
  for (const t of ['g1b', 'g2b', 'oe1b', 'oe2b']) wires.push(wire('gnd1', 'gnd', 'ir', t));
  wires.push(wire('gnd1', 'gnd', 'ir', 'mr'));
  wires.push(wire('ir', 'q2', 'dec', 'a'), wire('ir', 'q3', 'dec', 'b'), wire('gnd1', 'gnd', 'dec', 'c'));
  wires.push(wire('vcc1', 'vcc', 'dec', 'g1'), wire('gnd1', 'gnd', 'dec', 'g2ab'),
    wire('gnd1', 'gnd', 'dec', 'g2bb'));
  for (const [out, name, color] of [['y0b', 'lda', 'green'], ['y1b', 'add', 'green'],
    ['y2b', 'sub', 'yellow'], ['y3b', 'out', 'red']]) {
    const led = activeLowLed('dec', out, `led_${name}`, `rl_${name}`, color);
    parts.push(...led.parts); wires.push(...led.wires);
  }
  // what the machine is holding and where it is looking
  for (let i = 0; i < 4; i++) {
    const a = outputLed('mar', `q${i}`, `led_addr${i}`, `rla${i}`, 'red');
    const r = outputLed('ir', `q${i}`, `led_ir${i}`, `rli${i}`, 'green');
    parts.push(...a.parts, ...r.parts); wires.push(...a.wires, ...r.wires);
  }
  for (let i = 0; i < 3; i++) {
    const led = outputLed('ring', `q${i}`, `led_t${i + 1}`, `rlt${i}`, 'yellow');
    parts.push(...led.parts); wires.push(...led.wires);
  }
  done.push(emit('c9-fetch-cycle', {
    vcc: 5, parts, wires,
    _title: 'The fetch cycle — reading an instruction, and knowing what it says',
    _description: 'Three timing states, and at the end of them the machine is holding an instruction it '
      + 'understands. T1: the program counter drives the bus and the address register latches it. T2: the '
      + 'counter advances — safe now, because the address is already captured. T3: the RAM drives the bus '
      + 'and the instruction register latches what comes back, which the decoder immediately turns into a '
      + 'lit lamp: LDA, ADD, SUB or OUT. '
      + 'An instruction here is four bits — the top two are the opcode, the bottom two the address it works '
      + 'on — which is what a four-bit bus can honestly carry. '
      + 'Load a program first with the data switches and WRITE, then clock and watch it fetch each one in turn. '
      + 'Notice that only ONE driver is ever enabled: the counter at T1, the RAM at T3, nobody at T2. That is '
      + 'the rule the whole control unit exists to keep.',
    _category: 'computer', _difficulty: 5, _stage: 'C9',
  }));
}

// ── C10: the whole machine — it runs a program ─────────────────────

{
  // Everything from c1..c9 on one bus, sequenced by the control matrix
  // of c6 instead of by hand. Four instructions, two-bit opcode and
  // two-bit operand: 00 LDA, 01 ADD, 10 SUB, 11 OUT.
  //
  //   T1  Ep Lm   counter -> bus -> MAR
  //   T2  Cp      counter advances
  //   T3  CE Li   RAM -> bus -> instruction register
  //   T4  Ei Lm   operand address -> bus -> MAR      (LDA/ADD/SUB)
  //       Ea Lo   accumulator -> bus -> output reg   (OUT)
  //   T5  CE La   RAM -> bus -> accumulator          (LDA)
  //       CE Lb   RAM -> bus -> B register           (ADD/SUB)
  //   T6  Eu La   adder -> bus -> accumulator        (ADD/SUB)
  //       + Su    and the adder subtracts            (SUB)
  //
  // FIVE things can drive this bus and exactly one ever does. That is
  // the invariant the control matrix exists to hold.
  const P = [...rails()];
  const W = [];
  const chip = (id, kind) => {
    P.push(part(id, kind));
    if (hasPowerPins(kind)) W.push(...powerChip(id));
  };
  for (const [id, kind] of [
    ['ring', 'decade_counter'], ['pc', '74ls161'], ['ram', '74ls189'],
    ['mar', '74ls173'], ['ir', '74ls173'], ['areg', '74ls173'],
    ['breg', '74ls173'], ['oreg', '74ls173'],
    ['buf_pc', '74hc244'], ['buf_ram', '74hc244'], ['buf_ir', '74hc244'],
    ['buf_a', '74hc244'], ['buf_sum', '74hc244'],
    ['add', '74hc283'], ['xorb', '74hc86'], ['dec', '74hc138'],
    ['inv1', '74hc04'], ['inv2', '74hc04'], ['inv3', '74hc04'],
    ['and1', '74hc08'], ['and2', '74hc08'], ['and3', '74hc08'], ['and4', '74hc08'],
    ['or1', '74hc32'], ['or2', '74hc32'],
  ]) chip(id, kind);
  P.push(part('swc', 'dip_switch_spst', { switches: 0 }));
  P.push(part('swd', 'dip_switch_spst', { switches: 0 }));

  const CK = switchInput('swc', 1, 'rck');
  P.push(...CK.parts); W.push(...CK.wires);
  W.push(wire('swc', '1b', 'ring', 'clk'), wire('swc', '1b', 'inv1', '1a'));
  W.push(wire('gnd1', 'gnd', 'ring', 'en'), wire('ring', 'q6', 'ring', 'rst'));
  const NCLK = ['inv1', '1y'];
  const T = (n) => ['ring', 'q' + (n - 1)];

  // instruction decode -> active-high instruction lines
  W.push(wire('ir', 'q2', 'dec', 'a'), wire('ir', 'q3', 'dec', 'b'), wire('gnd1', 'gnd', 'dec', 'c'));
  W.push(wire('vcc1', 'vcc', 'dec', 'g1'), wire('gnd1', 'gnd', 'dec', 'g2ab'), wire('gnd1', 'gnd', 'dec', 'g2bb'));
  [['y0b', '2'], ['y1b', '3'], ['y2b', '4'], ['y3b', '5']].forEach(([o, g]) => W.push(wire('dec', o, 'inv1', g + 'a')));
  const LDA = ['inv1', '2y']; const ADDI = ['inv1', '3y'];
  const SUBI = ['inv1', '4y']; const OUTI = ['inv1', '5y'];
  W.push(wire('gnd1', 'gnd', 'inv1', '6a'));

  const AND = (c, g, x, y) => { W.push(wire(x[0], x[1], c, g + 'a'), wire(y[0], y[1], c, g + 'b')); return [c, g + 'y']; };
  const OR = AND;
  const ADDSUB = OR('or1', '1', ADDI, SUBI);
  const MEMREF = OR('or1', '2', ADDSUB, LDA);
  const memT4 = AND('and1', '1', MEMREF, T(4));
  const memT5 = AND('and1', '2', MEMREF, T(5));
  const ldaT5 = AND('and1', '3', LDA, T(5));
  const abT6 = AND('and1', '4', ADDSUB, T(6));
  const abT5 = AND('and2', '1', ADDSUB, T(5));
  const subT6 = AND('and2', '2', SUBI, T(6));
  const outT4 = AND('and2', '3', OUTI, T(4));
  W.push(wire('gnd1', 'gnd', 'and2', '4a'), wire('gnd1', 'gnd', 'and2', '4b'));

  const Ep = T(1); const Cp = T(2); const Li = T(3);
  const Lm = OR('or1', '3', T(1), memT4);
  const CE = OR('or1', '4', T(3), memT5);
  const La = OR('or2', '1', ldaT5, abT6);
  const Ei = memT4; const Lb = abT5; const Eu = abT6; const Su = subT6;
  const Ea = outT4; const Lo = outT4;
  for (const g of ['2', '3', '4']) W.push(wire('gnd1', 'gnd', 'or2', g + 'a'), wire('gnd1', 'gnd', 'or2', g + 'b'));

  const gclk = (c, g, sig, target) => {
    W.push(wire(sig[0], sig[1], c, g + 'a'), wire(NCLK[0], NCLK[1], c, g + 'b'));
    W.push(wire(c, g + 'y', target, 'clk'));
  };
  gclk('and3', '1', Lm, 'mar'); gclk('and3', '2', Cp, 'pc'); gclk('and3', '3', Li, 'ir');
  gclk('and3', '4', La, 'areg'); gclk('and4', '1', Lb, 'breg'); gclk('and4', '2', Lo, 'oreg');
  for (const g of ['3', '4']) W.push(wire('gnd1', 'gnd', 'and4', g + 'a'), wire('gnd1', 'gnd', 'and4', g + 'b'));

  for (const r of ['mar', 'ir', 'areg', 'breg', 'oreg']) {
    for (const t of ['g1b', 'g2b', 'oe1b', 'oe2b']) W.push(wire('gnd1', 'gnd', r, t));
    W.push(wire('gnd1', 'gnd', r, 'mr'));
  }
  for (const t of ['clrb', 'loadb', 'enp', 'ent']) W.push(wire('vcc1', 'vcc', 'pc', t));
  for (const t of ['d0', 'd1', 'd2', 'd3']) W.push(wire('gnd1', 'gnd', 'pc', t));

  // bus drivers: /OE is active low, so each enable goes through inv2
  const driver = (buf, sig, g) => {
    W.push(wire(sig[0], sig[1], 'inv2', g + 'a'), wire('inv2', g + 'y', buf, '1oeb'));
    W.push(wire('gnd1', 'gnd', buf, '2oeb'));
  };
  driver('buf_pc', Ep, '1'); driver('buf_ram', CE, '2'); driver('buf_ir', Ei, '3');
  driver('buf_a', Ea, '4'); driver('buf_sum', Eu, '5');
  W.push(wire('gnd1', 'gnd', 'inv2', '6a'));

  for (let i = 0; i < 4; i++) {
    const rid = 'rbus' + i;
    P.push(part(rid, 'resistor', { ohms: 100000 }));
    for (const b of ['buf_pc', 'buf_ram', 'buf_ir', 'buf_a', 'buf_sum']) W.push(wire(b, '1y' + i, rid, 'a'));
    W.push(wire(rid, 'b', 'gnd1', 'gnd'));
    for (const r of ['mar', 'ir', 'areg', 'breg', 'oreg']) W.push(wire(rid, 'a', r, 'd' + i));
    const led = outputLed(rid, 'a', 'led_bus' + i, 'rlb' + i, 'yellow');
    P.push(...led.parts); W.push(...led.wires);
  }

  for (let i = 0; i < 4; i++) {
    W.push(wire('pc', 'q' + i, 'buf_pc', '1a' + i));
    W.push(wire('areg', 'q' + i, 'buf_a', '1a' + i));
    W.push(wire('mar', 'q' + i, 'ram', 'a' + i));
  }
  W.push(wire('ir', 'q0', 'buf_ir', '1a0'), wire('ir', 'q1', 'buf_ir', '1a1'));
  W.push(wire('gnd1', 'gnd', 'buf_ir', '1a2'), wire('gnd1', 'gnd', 'buf_ir', '1a3'));
  W.push(wire('gnd1', 'gnd', 'ram', 'csb'));
  // the 74LS189 hands data back INVERTED: inv3 puts it right
  for (let i = 0; i < 4; i++) {
    W.push(wire('ram', 'o' + i, 'inv3', (i + 1) + 'a'), wire('inv3', (i + 1) + 'y', 'buf_ram', '1a' + i));
  }
  for (const g of ['5', '6']) W.push(wire('gnd1', 'gnd', 'inv3', g + 'a'));

  // hand-loading the program
  const WE = switchInputActiveLow('swc', 2, 'rwe');
  P.push(...WE.parts); W.push(...WE.wires);
  W.push(wire('swc', '2b', 'ram', 'web'));
  for (let i = 0; i < 4; i++) {
    const sw = switchInput('swd', i + 1, 'rd' + i);
    P.push(...sw.parts); W.push(...sw.wires);
    W.push(wire('swd', (i + 1) + 'b', 'ram', 'd' + i));
  }

  // the adder: A + (B xor Su) + Su  — the two's-complement trick from L8
  for (let i = 0; i < 4; i++) {
    W.push(wire('areg', 'q' + i, 'add', 'a' + i));
    W.push(wire('breg', 'q' + i, 'xorb', (i + 1) + 'a'));
    W.push(wire(Su[0], Su[1], 'xorb', (i + 1) + 'b'));
    W.push(wire('xorb', (i + 1) + 'y', 'add', 'b' + i));
    W.push(wire('add', 's' + i, 'buf_sum', '1a' + i));
  }
  W.push(wire(Su[0], Su[1], 'add', 'cin'));

  // what a person watches
  for (let i = 0; i < 4; i++) {
    for (const [src, t, tag, col] of [['areg', 'q' + i, 'a', 'green'], ['oreg', 'q' + i, 'out', 'red'],
      ['ir', 'q' + i, 'ir', 'green'], ['mar', 'q' + i, 'addr', 'yellow']]) {
      const led = outputLed(src, t, 'led_' + tag + i, 'rl_' + tag + i, col);
      P.push(...led.parts); W.push(...led.wires);
    }
  }
  for (let i = 0; i < 6; i++) {
    const led = outputLed('ring', 'q' + i, 'led_t' + (i + 1), 'rlt' + i, 'yellow');
    P.push(...led.parts); W.push(...led.wires);
  }
  done.push(emit('c10-the-machine', {
    vcc: 5, parts: P, wires: W,
    _title: 'The whole machine — it runs a program',
    _description: 'Twenty-five chips, one bus, and a program in memory. Load four cells by hand, then do '
      + 'nothing but clock: the machine fetches each instruction, works out what it means, and moves the data '
      + 'itself. LDA loads the accumulator from memory, ADD and SUB route through the B register and the '
      + 'adder, OUT copies the accumulator to the output register. '
      + 'An instruction is two bits of opcode and two bits of address, so the program and its data live in the '
      + 'first four cells. Write LDA 3, ADD 3, OUT, and 5 into cells 0 to 3 and the output lands on ten. '
      + 'Five different things can drive the bus here and exactly one ever does — that single rule, held by '
      + 'the control matrix, is what separates a computer from a pile of registers. '
      + 'Keep clocking past OUT and the answer garbles, which is not a fault: a two-bit opcode has room for '
      + 'exactly four instructions and all four are spent, so there is no HALT. The counter runs on into cell 3, '
      + 'reads the DATA there as though it were an instruction, and obeys it. Every real machine needs either a '
      + 'halt or a jump for this reason, and neither fits in two bits.',
    _category: 'computer', _difficulty: 5, _stage: 'C10',
  }));
}

// ── C16: the machine again, with a ROM where the matrix was ────────

{
  // C10 is this machine with a control MATRIX: a decoder, four AND
  // packages and two OR packages, ten chips of combinational logic whose
  // whole job is to answer "which lines, given this instruction and this
  // step". C11 showed that a ROM answers the same question by being
  // asked. This rung does the substitution on the real machine.
  //
  // The datapath below is C10's, wire for wire — same bus, same
  // registers, same adder, same hand-loading switches. Only the control
  // section changes, and the program and its answer do not. That is the
  // claim: a microcoded machine and a hardwired one are the same machine.
  //
  // What changes for the better is what happens NEXT. The matrix grows a
  // gate per instruction; the ROM grows a row. Six chips of decode and
  // gating become two, and the instruction set becomes a file.
  const CTRL_LO = ['ep', 'lm', 'cp', 'ce', 'li', 'ei', 'la', 'lb'];
  const CTRL_HI = ['eu', 'su', 'ea', 'lo'];
  const STEPS = {
    0b00: [['ep', 'lm'], ['cp'], ['ce', 'li'], ['ei', 'lm'], ['ce', 'la'], []],           // LDA
    0b01: [['ep', 'lm'], ['cp'], ['ce', 'li'], ['ei', 'lm'], ['ce', 'lb'], ['eu', 'la']], // ADD
    0b10: [['ep', 'lm'], ['cp'], ['ce', 'li'], ['ei', 'lm'], ['ce', 'lb'], ['eu', 'la', 'su']],
    0b11: [['ep', 'lm'], ['cp'], ['ce', 'li'], ['ea', 'lo'], [], []],                     // OUT
  };
  const lo = new Array(32).fill(0);
  const hi = new Array(32).fill(0);
  for (const [op, steps] of Object.entries(STEPS)) {
    steps.forEach((lines, stp) => {
      const a = (Number(op) << 3) | stp;
      for (const l of lines) {
        const i = CTRL_LO.indexOf(l);
        if (i >= 0) lo[a] |= 1 << i;
        const j = CTRL_HI.indexOf(l);
        if (j >= 0) hi[a] |= 1 << j;
      }
    });
  }

  const P = [...rails()];
  const W = [];
  const chip = (id, kind) => {
    P.push(part(id, kind));
    if (hasPowerPins(kind)) W.push(...powerChip(id));
  };
  for (const [id, kind] of [
    ['step', '74ls161'], ['wrap', '74hc00'],
    ['rom_lo', '28c256'], ['rom_hi', '28c256'],
    ['pc', '74ls161'], ['ram', '74ls189'],
    ['mar', '74ls173'], ['ir', '74ls173'], ['areg', '74ls173'],
    ['breg', '74ls173'], ['oreg', '74ls173'],
    ['buf_pc', '74hc244'], ['buf_ram', '74hc244'], ['buf_ir', '74hc244'],
    ['buf_a', '74hc244'], ['buf_sum', '74hc244'],
    ['add', '74hc283'], ['xorb', '74hc86'],
    ['inv1', '74hc04'], ['inv2', '74hc04'], ['inv3', '74hc04'],
    ['and3', '74hc08'], ['and4', '74hc08'],
  ]) chip(id, kind);
  // The ROMs carry the microcode and must never be written.
  P.find((x) => x.id === 'rom_lo').params = { readOnly: true, contents: lo };
  P.find((x) => x.id === 'rom_hi').params = { readOnly: true, contents: hi };
  P.push(part('swc', 'dip_switch_spst', { switches: 0 }));
  P.push(part('swd', 'dip_switch_spst', { switches: 0 }));

  const CK = switchInput('swc', 1, 'rck');
  P.push(...CK.parts); W.push(...CK.wires);
  W.push(wire('swc', '1b', 'step', 'clk'), wire('swc', '1b', 'inv1', '1a'));
  const NCLK = ['inv1', '1y'];
  for (const g of ['2', '3', '4', '5', '6']) W.push(wire('gnd1', 'gnd', 'inv1', g + 'a'));

  // Six states from a binary counter, cleared the moment it reaches six.
  W.push(wire('step', 'q1', 'wrap', '1a'), wire('step', 'q2', 'wrap', '1b'),
    wire('wrap', '1y', 'step', 'clrb'));
  for (const t of ['enp', 'ent', 'loadb']) W.push(wire('vcc1', 'vcc', 'step', t));
  for (const d of ['d0', 'd1', 'd2', 'd3']) W.push(wire('gnd1', 'gnd', 'step', d));
  for (const g of ['2', '3', '4']) W.push(wire('gnd1', 'gnd', 'wrap', g + 'a'), wire('gnd1', 'gnd', 'wrap', g + 'b'));

  // Address: step on a0..a2, the opcode's two bits on a3..a4. The
  // instruction register supplies them directly — no decoder, because a
  // ROM does not need one: the opcode IS part of the address.
  for (const rom of ['rom_lo', 'rom_hi']) {
    for (let i = 0; i < 3; i++) W.push(wire('step', 'q' + i, rom, 'a' + i));
    W.push(wire('ir', 'q2', rom, 'a3'), wire('ir', 'q3', rom, 'a4'));
    for (let i = 5; i <= 14; i++) W.push(wire('gnd1', 'gnd', rom, 'a' + i));
    W.push(wire('gnd1', 'gnd', rom, 'ceb'), wire('gnd1', 'gnd', rom, 'oeb'),
      wire('vcc1', 'vcc', rom, 'web'));
  }

  // The control signals are now ROM data pins. Everything downstream is
  // C10's, unchanged — which is the point.
  const Ep = ['rom_lo', 'd0']; const Lm = ['rom_lo', 'd1']; const Cp = ['rom_lo', 'd2'];
  const CE = ['rom_lo', 'd3']; const Li = ['rom_lo', 'd4']; const Ei = ['rom_lo', 'd5'];
  const La = ['rom_lo', 'd6']; const Lb = ['rom_lo', 'd7'];
  const Eu = ['rom_hi', 'd0']; const Su = ['rom_hi', 'd1'];
  const Ea = ['rom_hi', 'd2']; const Lo = ['rom_hi', 'd3'];

  const gclk = (c, g, sig, target) => {
    W.push(wire(sig[0], sig[1], c, g + 'a'), wire(NCLK[0], NCLK[1], c, g + 'b'));
    W.push(wire(c, g + 'y', target, 'clk'));
  };
  gclk('and3', '1', Lm, 'mar'); gclk('and3', '2', Cp, 'pc'); gclk('and3', '3', Li, 'ir');
  gclk('and3', '4', La, 'areg'); gclk('and4', '1', Lb, 'breg'); gclk('and4', '2', Lo, 'oreg');
  for (const g of ['3', '4']) W.push(wire('gnd1', 'gnd', 'and4', g + 'a'), wire('gnd1', 'gnd', 'and4', g + 'b'));

  for (const r of ['mar', 'ir', 'areg', 'breg', 'oreg']) {
    for (const t of ['g1b', 'g2b', 'oe1b', 'oe2b']) W.push(wire('gnd1', 'gnd', r, t));
    W.push(wire('gnd1', 'gnd', r, 'mr'));
  }
  // C10's, unchanged — including /CLR tied high. A reset line was tried
  // here and taken out again: clearing the program counter does NOT
  // restart this machine, because the accumulator, B and output registers
  // have no reset either (their 74LS173 MR is tied low), so the run picks
  // up whatever the last one left in them. Shipping a switch labelled
  // RESET that does not restart would be worse than not having one.
  for (const t of ['clrb', 'loadb', 'enp', 'ent']) W.push(wire('vcc1', 'vcc', 'pc', t));
  for (const t of ['d0', 'd1', 'd2', 'd3']) W.push(wire('gnd1', 'gnd', 'pc', t));

  const driver = (buf, sig, g) => {
    W.push(wire(sig[0], sig[1], 'inv2', g + 'a'), wire('inv2', g + 'y', buf, '1oeb'));
    W.push(wire('gnd1', 'gnd', buf, '2oeb'));
  };
  driver('buf_pc', Ep, '1'); driver('buf_ram', CE, '2'); driver('buf_ir', Ei, '3');
  driver('buf_a', Ea, '4'); driver('buf_sum', Eu, '5');
  W.push(wire('gnd1', 'gnd', 'inv2', '6a'));

  for (let i = 0; i < 4; i++) {
    const rid = 'rbus' + i;
    P.push(part(rid, 'resistor', { ohms: 100000 }));
    for (const b of ['buf_pc', 'buf_ram', 'buf_ir', 'buf_a', 'buf_sum']) W.push(wire(b, '1y' + i, rid, 'a'));
    W.push(wire(rid, 'b', 'gnd1', 'gnd'));
    for (const r of ['mar', 'ir', 'areg', 'breg', 'oreg']) W.push(wire(rid, 'a', r, 'd' + i));
    const led = outputLed(rid, 'a', 'led_bus' + i, 'rlb' + i, 'yellow');
    P.push(...led.parts); W.push(...led.wires);
  }

  for (let i = 0; i < 4; i++) {
    W.push(wire('pc', 'q' + i, 'buf_pc', '1a' + i));
    W.push(wire('areg', 'q' + i, 'buf_a', '1a' + i));
    W.push(wire('mar', 'q' + i, 'ram', 'a' + i));
  }
  W.push(wire('ir', 'q0', 'buf_ir', '1a0'), wire('ir', 'q1', 'buf_ir', '1a1'));
  W.push(wire('gnd1', 'gnd', 'buf_ir', '1a2'), wire('gnd1', 'gnd', 'buf_ir', '1a3'));
  W.push(wire('gnd1', 'gnd', 'ram', 'csb'));
  for (let i = 0; i < 4; i++) {
    W.push(wire('ram', 'o' + i, 'inv3', (i + 1) + 'a'), wire('inv3', (i + 1) + 'y', 'buf_ram', '1a' + i));
  }
  for (const g of ['5', '6']) W.push(wire('gnd1', 'gnd', 'inv3', g + 'a'));

  const WE = switchInputActiveLow('swc', 2, 'rwe');
  P.push(...WE.parts); W.push(...WE.wires);
  W.push(wire('swc', '2b', 'ram', 'web'));
  for (let i = 0; i < 4; i++) {
    const sw = switchInput('swd', i + 1, 'rd' + i);
    P.push(...sw.parts); W.push(...sw.wires);
    W.push(wire('swd', (i + 1) + 'b', 'ram', 'd' + i));
  }

  for (let i = 0; i < 4; i++) {
    W.push(wire('areg', 'q' + i, 'add', 'a' + i));
    W.push(wire('breg', 'q' + i, 'xorb', (i + 1) + 'a'));
    W.push(wire(Su[0], Su[1], 'xorb', (i + 1) + 'b'));
    W.push(wire('xorb', (i + 1) + 'y', 'add', 'b' + i));
    W.push(wire('add', 's' + i, 'buf_sum', '1a' + i));
  }
  W.push(wire(Su[0], Su[1], 'add', 'cin'));

  for (let i = 0; i < 4; i++) {
    for (const [src, t, tag, col] of [['areg', 'q' + i, 'a', 'green'], ['oreg', 'q' + i, 'out', 'red'],
      ['ir', 'q' + i, 'ir', 'green'], ['mar', 'q' + i, 'addr', 'yellow']]) {
      const led = outputLed(src, t, 'led_' + tag + i, 'rl_' + tag + i, col);
      P.push(...led.parts); W.push(...led.wires);
    }
  }
  for (let i = 0; i < 3; i++) {
    const led = outputLed('step', 'q' + i, 'led_s' + i, 'rls' + i, 'yellow');
    P.push(...led.parts); W.push(...led.wires);
  }

  done.push(emit('c16-microcoded-machine', {
    vcc: 5, parts: P, wires: W,
    _title: 'The machine again, with a ROM where the matrix was',
    _description: 'The same computer as C10, running the same program to the same answer — and ten chips '
      + 'of control logic have become two EEPROMs. Load LDA 3, ADD 3, OUT and 5 into cells 0 to 3, clock, '
      + 'and the output lands on ten, exactly as before. The datapath below the control unit is C10\'s wire '
      + 'for wire; only how the control word is produced has changed. There is no decoder either, because a '
      + 'ROM does not need one: the opcode IS part of the address. What changes is what happens next — a '
      + 'matrix grows a gate per instruction, a ROM grows a row, and the instruction set becomes a file you '
      + 'can edit rather than a board you must rewire.',
    _category: 'computer', _difficulty: 5, _stage: 'C16',
  }));
}

for (const line of done) console.log(line);
// ── C11: the control ROM — a control word you can PROGRAM ──────────

{
  // c6 computes the control word with an AND-OR array of gates. This
  // rung computes nothing: it LOOKS THE ANSWER UP. Address the ROM with
  // (opcode, step) and the byte that comes back IS the control word.
  //
  // Why that matters more than it looks: c6 needs new GATES for every
  // instruction you add, and the matrix grows as (instructions x states).
  // A ROM needs new BYTES. That is the whole reason SAP-2, SAP-3 and
  // every real CPU after them are microcoded — and it is why the step
  // counter changes here from the CD4017 ring to a 74LS161. A one-hot
  // ring says WHICH state as a lit wire; a ROM address wants a NUMBER.
  //
  //   a0..a2   step   0..5   from the 74LS161
  //   a3..a6   opcode 0..15  from the DIP switches
  //   a7..a14  tied low — 128 bytes is the whole microcode store
  //
  // Twelve control lines do not fit in one 8-bit byte, so there are two
  // ROMs on the same address bus, which is exactly what a real build
  // does. Both are readOnly: a control store that a stray /WE could
  // rewrite is not a control store.
  const CTRL_LO = ['ep', 'lm', 'cp', 'ce', 'li', 'ei', 'la', 'lb'];
  const CTRL_HI = ['eu', 'su', 'ea', 'lo'];
  const FETCH = [['ep', 'lm'], ['cp'], ['ce', 'li']];
  const EXEC = {
    0b0000: [['ei', 'lm'], ['ce', 'la'], []],                 // LDA
    0b0001: [['ei', 'lm'], ['ce', 'lb'], ['eu', 'la']],        // ADD
    0b0010: [['ei', 'lm'], ['ce', 'lb'], ['eu', 'la', 'su']],  // SUB
    0b1110: [['ea', 'lo'], [], []],                            // OUT
  };

  const lo = new Array(128).fill(0);
  const hi = new Array(128).fill(0);
  const assertLines = (addr, lines) => {
    for (const l of lines) {
      const i = CTRL_LO.indexOf(l);
      if (i >= 0) lo[addr] |= 1 << i;
      const j = CTRL_HI.indexOf(l);
      if (j >= 0) hi[addr] |= 1 << j;
    }
  };
  // The fetch phase is written for ALL SIXTEEN opcodes, not just the four
  // that decode to something. That is not padding: fetch cannot depend on
  // an instruction the machine has not read yet, and leaving the unknown
  // opcodes blank would make that property accidentally true only for the
  // ones we happened to fill in.
  for (let op = 0; op < 16; op++) {
    FETCH.forEach((lines, step) => assertLines((op << 3) | step, lines));
    const exec = EXEC[op];
    if (exec) exec.forEach((lines, k) => assertLines((op << 3) | (k + 3), lines));
  }

  const parts = [...rails(),
    part('swc', 'dip_switch_spst', { switches: 0 }),   // the step clock
    part('swi', 'dip_switch_spst', { switches: 0 }),   // the opcode
    part('step', '74ls161'),
    part('wrap', '74hc00'),
    part('rom_lo', '28c256', { readOnly: true, contents: lo }),
    part('rom_hi', '28c256', { readOnly: true, contents: hi }),
  ];
  const wires = [...powerChip('step'), ...powerChip('wrap'),
    ...powerChip('rom_lo'), ...powerChip('rom_hi')];

  // Step counter: free-running, cleared the moment it reaches six.
  // clrb is ASYNCHRONOUS and active low, so a NAND of q1 and q2 is the
  // whole wrap circuit — six states, 0..5, and state 6 never settles.
  wires.push(wire('swc', '1b', 'step', 'clk'));
  wires.push(...switchInput('swc', 1, 'r_swc').wires);
  parts.push(...switchInput('swc', 1, 'r_swc').parts);
  wires.push(wire('step', 'q1', 'wrap', '1a'), wire('step', 'q2', 'wrap', '1b'),
    wire('wrap', '1y', 'step', 'clrb'));
  for (const t of ['enp', 'ent', 'loadb']) wires.push(wire('vcc1', 'vcc', 'step', t));
  for (const d of ['d0', 'd1', 'd2', 'd3']) wires.push(wire('gnd1', 'gnd', 'step', d));

  // Opcode switches -> the ROM's upper address bits.
  for (let i = 0; i < 4; i++) {
    const sw = switchInput('swi', i + 1, `r_swi${i}`);
    parts.push(...sw.parts);
    wires.push(...sw.wires);
  }

  // One address bus, two ROMs.
  for (const rom of ['rom_lo', 'rom_hi']) {
    for (let i = 0; i < 3; i++) wires.push(wire('step', `q${i}`, rom, `a${i}`));
    for (let i = 0; i < 4; i++) wires.push(wire('swi', `${i + 1}b`, rom, `a${i + 3}`));
    for (let i = 7; i <= 14; i++) wires.push(wire('gnd1', 'gnd', rom, `a${i}`));
    wires.push(wire('gnd1', 'gnd', rom, 'ceb'), wire('gnd1', 'gnd', rom, 'oeb'),
      wire('vcc1', 'vcc', rom, 'web'));
  }

  // The control word, one LED per line — same names c6 uses, so the same
  // table can be asserted against both.
  CTRL_LO.forEach((name, i) => {
    const led = outputLed('rom_lo', `d${i}`, `led_${name}`, `rl_${name}`,
      name === 'cp' ? 'yellow' : 'green');
    parts.push(...led.parts);
    wires.push(...led.wires);
  });
  CTRL_HI.forEach((name, i) => {
    const led = outputLed('rom_hi', `d${i}`, `led_${name}`, `rl_${name}`, 'red');
    parts.push(...led.parts);
    wires.push(...led.wires);
  });
  for (let i = 0; i < 3; i++) {
    const led = outputLed('step', `q${i}`, `led_s${i}`, `rls${i}`, 'yellow');
    parts.push(...led.parts);
    wires.push(...led.wires);
  }

  done.push(emit('c11-control-rom', {
    vcc: 5, parts, wires,
    _title: 'The control ROM — a control word you can program',
    _description: 'The same control table as C6, and not one gate computes it. Four switches are the '
      + 'opcode, a 74LS161 counts the six steps, and together they ADDRESS two EEPROMs whose contents ARE '
      + 'the control word. C6 needs new gates for every instruction and grows as instructions x states; '
      + 'this needs new bytes. That is why SAP-2, SAP-3 and every real CPU after them are microcoded. Note '
      + 'the counter: a one-hot ring says which state as a lit wire, and a ROM address wants a number.',
    _category: 'computer', _difficulty: 5, _stage: 'C11',
  }));
}

// ── C12: flags — the same ROM, now with an opinion ─────────────────

{
  // A conditional jump is where a machine stops being a player piano.
  // Everything up to here does the same thing every time; JZ does one of
  // two things depending on what just happened.
  //
  // The cost is the point. In C6's gate matrix a conditional means new
  // gates on every affected control line. Here the flags are simply two
  // more ADDRESS lines on the control store: the ROM already answers
  // "given this instruction and this step", and now it answers "given
  // this instruction, this step, and these flags". Nothing is added to
  // the data path at all — the store goes from 128 bytes to 512, and the
  // machine learns to branch.
  //
  //   a0..a2  step    a3..a6  opcode    a7  Z flag    a8  C flag
  //
  // The flags arrive here on switches. In the whole machine they are the
  // ALU's zero and carry outputs latched at the moment the result lands,
  // which is C3's register discipline again and not a new idea; what is
  // new is where they GO.
  const CTRL_LO = ['ep', 'lm', 'cp', 'ce', 'li', 'ei', 'la', 'lb'];
  const CTRL_HI = ['eu', 'su', 'ea', 'lo', 'lp'];
  const FETCH = [['ep', 'lm'], ['cp'], ['ce', 'li']];
  const EXEC = {
    0b0000: () => [['ei', 'lm'], ['ce', 'la'], []],                  // LDA
    0b0001: () => [['ei', 'lm'], ['ce', 'lb'], ['eu', 'la']],         // ADD
    0b0010: () => [['ei', 'lm'], ['ce', 'lb'], ['eu', 'la', 'su']],   // SUB
    0b0011: (z) => [z ? ['ei', 'lp'] : [], [], []],                   // JZ
    0b0100: (z, c) => [c ? ['ei', 'lp'] : [], [], []],                // JC
    0b1110: () => [['ea', 'lo'], [], []],                             // OUT
  };

  const lo = new Array(512).fill(0);
  const hi = new Array(512).fill(0);
  const at = (op, stp, z, c) => (c << 8) | (z << 7) | (op << 3) | stp;
  const put = (a, lines) => {
    for (const l of lines) {
      const i = CTRL_LO.indexOf(l);
      if (i >= 0) lo[a] |= 1 << i;
      const j = CTRL_HI.indexOf(l);
      if (j >= 0) hi[a] |= 1 << j;
    }
  };
  for (let op = 0; op < 16; op++) {
    for (let z = 0; z < 2; z++) {
      for (let c = 0; c < 2; c++) {
        // Fetch is written for every opcode AND every flag combination:
        // reading an instruction cannot depend on the instruction, and it
        // certainly cannot depend on the result of the last one.
        FETCH.forEach((lines, stp) => put(at(op, stp, z, c), lines));
        const exec = EXEC[op];
        if (exec) exec(z, c).forEach((lines, k) => put(at(op, k + 3, z, c), lines));
      }
    }
  }

  const parts = [...rails(),
    part('swc', 'dip_switch_spst', { switches: 0 }),
    part('swi', 'dip_switch_spst', { switches: 0 }),
    part('swf', 'dip_switch_spst', { switches: 0 }),   // Z on 1, C on 2
    part('step', '74ls161'),
    part('wrap', '74hc00'),
    part('rom_lo', '28c256', { readOnly: true, contents: lo }),
    part('rom_hi', '28c256', { readOnly: true, contents: hi }),
  ];
  const wires = [...powerChip('step'), ...powerChip('wrap'),
    ...powerChip('rom_lo'), ...powerChip('rom_hi')];

  const clk = switchInput('swc', 1, 'r_swc');
  parts.push(...clk.parts);
  wires.push(...clk.wires, wire('swc', '1b', 'step', 'clk'));
  wires.push(wire('step', 'q1', 'wrap', '1a'), wire('step', 'q2', 'wrap', '1b'),
    wire('wrap', '1y', 'step', 'clrb'));
  for (const t of ['enp', 'ent', 'loadb']) wires.push(wire('vcc1', 'vcc', 'step', t));
  for (const d of ['d0', 'd1', 'd2', 'd3']) wires.push(wire('gnd1', 'gnd', 'step', d));

  for (let i = 0; i < 4; i++) {
    const sw = switchInput('swi', i + 1, `r_swi${i}`);
    parts.push(...sw.parts);
    wires.push(...sw.wires);
  }
  for (let i = 0; i < 2; i++) {
    const sw = switchInput('swf', i + 1, `r_swf${i}`);
    parts.push(...sw.parts);
    wires.push(...sw.wires);
  }

  for (const rom of ['rom_lo', 'rom_hi']) {
    for (let i = 0; i < 3; i++) wires.push(wire('step', `q${i}`, rom, `a${i}`));
    for (let i = 0; i < 4; i++) wires.push(wire('swi', `${i + 1}b`, rom, `a${i + 3}`));
    wires.push(wire('swf', '1b', rom, 'a7'), wire('swf', '2b', rom, 'a8'));
    for (let i = 9; i <= 14; i++) wires.push(wire('gnd1', 'gnd', rom, `a${i}`));
    wires.push(wire('gnd1', 'gnd', rom, 'ceb'), wire('gnd1', 'gnd', rom, 'oeb'),
      wire('vcc1', 'vcc', rom, 'web'));
  }

  CTRL_LO.forEach((name, i) => {
    const led = outputLed('rom_lo', `d${i}`, `led_${name}`, `rl_${name}`, 'green');
    parts.push(...led.parts);
    wires.push(...led.wires);
  });
  CTRL_HI.forEach((name, i) => {
    const led = outputLed('rom_hi', `d${i}`, `led_${name}`, `rl_${name}`,
      name === 'lp' ? 'yellow' : 'red');
    parts.push(...led.parts);
    wires.push(...led.wires);
  });
  for (let i = 0; i < 3; i++) {
    const led = outputLed('step', `q${i}`, `led_s${i}`, `rls${i}`, 'yellow');
    parts.push(...led.parts);
    wires.push(...led.wires);
  }

  done.push(emit('c12-conditional-jump', {
    vcc: 5, parts, wires,
    _title: 'Flags — the same ROM, now with an opinion',
    _description: 'A conditional jump is where a machine stops being a player piano: JZ does one of two '
      + 'things depending on what just happened. Set the opcode to 0011 (JZ) and clock to T4. With the Z '
      + 'switch off, nothing lights. Turn Z on and the same step asserts Ei and Lp — the operand goes to '
      + 'the program counter and the machine jumps. Not one gate was added: the two flags are simply two '
      + 'more ADDRESS lines on the control store, which grows from 128 bytes to 512. That is the whole '
      + 'trade microcode buys you, and it is why adding instructions to a SAP-2 is a programming job '
      + 'rather than a wiring one.',
    _category: 'computer', _difficulty: 5, _stage: 'C12',
  }));
}

// ── C13: eight bits, and flags the machine works out for itself ────

{
  // C12 took its flags from two switches and said they would come from
  // the ALU in the whole machine. This is that ALU, and it is eight bits
  // wide, which is the other half of the step toward a SAP-2.
  //
  // Widening is the boring part and that is worth seeing: two 74HC283s
  // with the carry of the low one feeding the cin of the high one, and
  // the four-bit adder from C3 is now an eight-bit adder. No new idea.
  //
  // The flags are the new idea, and neither is free.
  //   CARRY is just the top adder's cout — one wire, already there.
  //   ZERO is not. "All eight sum bits low" needs a wide gate nobody
  //   sells, so this uses a 74HC688 magnitude comparator with its Q side
  //   tied to ground: it asserts P=Q when the sum equals zero, which is
  //   exactly a zero flag, and it is active LOW like every comparator
  //   output. That is how you buy an 8-input NOR in a shop.
  const A = ['a_lo', 'a_hi'];
  const B = ['b_lo', 'b_hi'];
  const parts = [...rails(),
    part('a_lo', 'dip_switch_spst', { switches: 0 }),
    part('a_hi', 'dip_switch_spst', { switches: 0 }),
    part('b_lo', 'dip_switch_spst', { switches: 0 }),
    part('b_hi', 'dip_switch_spst', { switches: 0 }),
    part('swm', 'dip_switch_spst', { switches: 0 }),      // subtract on 1
    part('add_lo', '74hc283'), part('add_hi', '74hc283'),
    part('xor_lo', '74hc86'), part('xor_hi', '74hc86'),
    part('zero', '74hc688'),
  ];
  const wires = [...powerChip('add_lo'), ...powerChip('add_hi'),
    ...powerChip('xor_lo'), ...powerChip('xor_hi'), ...powerChip('zero')];

  for (const bank of [...A, ...B]) {
    for (let i = 0; i < 4; i++) {
      const sw = switchInput(bank, i + 1, `r_${bank}${i}`);
      parts.push(...sw.parts);
      wires.push(...sw.wires);
    }
  }
  const mode = switchInput('swm', 1, 'r_swm');
  parts.push(...mode.parts);
  wires.push(...mode.wires);

  // A goes straight in. B goes through the XOR bank, whose other input is
  // the mode line — the same trick as L8, just twice as wide: mode high
  // inverts every B bit AND enters a 1 at the bottom, which is two's
  // complement, which is subtraction.
  for (let bit = 0; bit < 8; bit++) {
    const adder = bit < 4 ? 'add_lo' : 'add_hi';
    const k = bit % 4;
    wires.push(wire(bit < 4 ? 'a_lo' : 'a_hi', `${k + 1}b`, adder, `a${k}`));
    const xchip = bit < 4 ? 'xor_lo' : 'xor_hi';
    wires.push(wire(bit < 4 ? 'b_lo' : 'b_hi', `${k + 1}b`, xchip, `${k + 1}a`));
    wires.push(wire('swm', '1b', xchip, `${k + 1}b`));
    wires.push(wire(xchip, `${k + 1}y`, adder, `b${k}`));
  }
  wires.push(wire('swm', '1b', 'add_lo', 'cin'));
  wires.push(wire('add_lo', 'cout', 'add_hi', 'cin'));

  // Sum out: eight LEDs, and the same eight bits into the comparator.
  for (let bit = 0; bit < 8; bit++) {
    const adder = bit < 4 ? 'add_lo' : 'add_hi';
    const k = bit % 4;
    const led = outputLed(adder, `s${k}`, `led_s${bit}`, `rls${bit}`, 'yellow');
    parts.push(...led.parts);
    wires.push(...led.wires);
    wires.push(wire(adder, `s${k}`, 'zero', `p${bit}`));
    wires.push(wire('gnd1', 'gnd', 'zero', `q${bit}`));
  }
  wires.push(wire('gnd1', 'gnd', 'zero', 'gb'));          // comparator enabled

  const carry = outputLed('add_hi', 'cout', 'led_carry', 'rl_carry', 'red');
  parts.push(...carry.parts);
  wires.push(...carry.wires);
  const zf = activeLowLed('zero', 'pqb', 'led_zero', 'rl_zero', 'green');
  parts.push(...zf.parts);
  wires.push(...zf.wires);

  done.push(emit('c13-alu-flags', {
    vcc: 5, parts, wires,
    _title: 'Eight bits, and flags the machine works out for itself',
    _description: 'C12 took its flags from two switches. This is where they actually come from. Two '
      + '74HC283s chained carry-to-carry make an eight-bit adder — widening is mechanical, and that is '
      + 'worth seeing once. The flags are not. CARRY is the top adder\'s cout, one wire that was already '
      + 'there. ZERO needs every one of eight sum bits to be low, and nobody sells an 8-input NOR, so a '
      + '74HC688 magnitude comparator has its Q side tied to ground: it asserts P=Q exactly when the sum '
      + 'is zero. Set the mode switch and the XOR bank inverts B while a 1 enters at the bottom — two\'s '
      + 'complement, so the same hardware subtracts, and the carry lamp now means "no borrow".',
    _category: 'computer', _difficulty: 5, _stage: 'C13',
  }));
}

// ── C14: a stack — the thing CALL and RET are made of ──────────────

{
  // Every rung so far reads memory at an address something else chose.
  // A stack chooses its own, and it is the same 16x4 RAM from C2 with a
  // 74LS193 supplying the address instead of the program counter.
  //
  // The 193 is why this rung exists: a 74LS161 counts one way, so a
  // pointer built from one can push and never pop. That part had to be
  // added to the engine before this could be wired at all.
  //
  // Convention here is EMPTY ASCENDING, the one most 8-bit machines use:
  //   push   store at [SP], then SP+1
  //   pop    SP-1, then read [SP]
  // The order is the whole discipline. Pop that reads before it
  // decrements returns the empty slot ABOVE the top of the stack — which
  // is the classic off-by-one, and it looks like memory corruption
  // rather than like a counter being clocked at the wrong moment.
  //
  // The RAM's outputs are inverted (C2's lesson), so a 74HC04 puts the
  // data back the right way up before it reaches the lamps.
  const parts = [...rails(),
    part('swd', 'dip_switch_spst', { switches: 0 }),   // the value being pushed
    part('swc', 'dip_switch_spst', { switches: 0 }),   // 1 /WE, 2 push, 3 pop, 4 clear
    part('sp', '74ls193'),
    part('ram', '74ls189'),
    part('inv', '74hc04'),
  ];
  const wires = [...powerChip('sp'), ...powerChip('ram'), ...powerChip('inv')];

  for (let i = 0; i < 4; i++) {
    const sw = switchInput('swd', i + 1, `r_swd${i}`);
    parts.push(...sw.parts);
    wires.push(...sw.wires);
    wires.push(wire('swd', `${i + 1}b`, 'ram', `d${i}`));
  }

  // /WE is active low, so it hangs on a pull-UP and the switch drags it
  // down. On an ordinary pull-down it would be asserted permanently and
  // the RAM would never stop writing — measured in C8, where every
  // address handed back the last value on the data switches.
  const we = switchInputActiveLow('swc', 1, 'r_we');
  parts.push(...we.parts);
  wires.push(...we.wires, wire('swc', '1b', 'ram', 'web'));

  // The 193's two clocks IDLE HIGH — there is no mode pin, and the chip
  // only counts when the other clock is high. So push and pop hang on
  // pull-UPS and the switch drags them down, which means the count lands
  // on RELEASE, not on press. Wired the obvious way round, with pull-
  // downs, both clocks sit low and the pointer never moves at all: the
  // stack silently rewrites one cell forever. (Measured here first, then
  // recognised as the case bw-board's own 74LS193 test already names.)
  const push = switchInputActiveLow('swc', 2, 'r_push');
  const pop = switchInputActiveLow('swc', 3, 'r_pop');
  const clr = switchInput('swc', 4, 'r_clr');
  parts.push(...push.parts, ...pop.parts, ...clr.parts);
  wires.push(...push.wires, ...pop.wires, ...clr.wires);
  wires.push(wire('swc', '2b', 'sp', 'up'));      // push advances the pointer
  wires.push(wire('swc', '3b', 'sp', 'down'));    // pop retreats it
  wires.push(wire('swc', '4b', 'sp', 'clr'));     // CLEAR is active HIGH on a 193
  wires.push(wire('vcc1', 'vcc', 'sp', 'loadb'));
  for (const d of ['d0', 'd1', 'd2', 'd3']) wires.push(wire('gnd1', 'gnd', 'sp', d));

  wires.push(wire('gnd1', 'gnd', 'ram', 'csb'));
  for (let i = 0; i < 4; i++) wires.push(wire('sp', `q${i}`, 'ram', `a${i}`));

  // Stack pointer lamps, and the data coming back the right way up.
  for (let i = 0; i < 4; i++) {
    const led = outputLed('sp', `q${i}`, `led_sp${i}`, `rlsp${i}`, 'red');
    parts.push(...led.parts);
    wires.push(...led.wires);
    wires.push(wire('ram', `o${i}`, 'inv', `${i + 1}a`));
    const dled = outputLed('inv', `${i + 1}y`, `led_d${i}`, `rld${i}`, 'green');
    parts.push(...dled.parts);
    wires.push(...dled.wires);
  }

  done.push(emit('c14-the-stack', {
    vcc: 5, parts, wires,
    _title: 'A stack — the thing CALL and RET are made of',
    _description: 'The same 16x4 RAM as C2, with a 74LS193 supplying the address instead of the program '
      + 'counter — and the 193 is the point, because a 74LS161 counts one way, so a pointer built from one '
      + 'could push and never pop. Push is: set the switches, pulse /WE to store at [SP], then pulse PUSH '
      + 'to advance. Pop is: pulse POP to retreat, THEN read. That order is the whole discipline — a pop '
      + 'that reads before it retreats hands back the empty slot above the top of the stack, which looks '
      + 'like corrupted memory and is really a counter clocked one moment too late. Push three numbers and '
      + 'pop them: they come back in the opposite order, which is the property that makes a return address '
      + 'survive a nested call.',
    _category: 'computer', _difficulty: 5, _stage: 'C14',
  }));
}

// ── C15: CALL and RET — the microcode moves the pointer ────────────

{
  // C14 worked the stack by hand: press /WE, press PUSH, press POP. This
  // rung takes the buttons away. The control store gets two more output
  // bits, Spd and Spu, and CALL and RET become what every instruction
  // already is here — a row of bytes.
  //
  // Sixteen control lines is exactly two ROMs, which is why the line list
  // stops where it does. Esp (stack pointer onto the address bus) earns
  // its place because both instructions need it; the memory WRITE itself
  // rides the path C8 already built and is not re-wired here.
  //
  // The 193's clocks idle HIGH, so Spd and Spu cannot drive them
  // directly: a control line idles LOW, both clocks would sit low, and
  // the counter would never move. They go through a 74HC04 first, which
  // means the pointer steps when the control line RELEASES — the same
  // "count on release" C14 met with its buttons, arriving here as a
  // property of the microcode's timing rather than of a finger.
  const CTRL_LO = ['ep', 'lm', 'cp', 'ce', 'li', 'ei', 'la', 'lb'];
  const CTRL_HI = ['eu', 'su', 'ea', 'lo', 'lp', 'spd', 'spu', 'esp'];
  const FETCH = [['ep', 'lm'], ['cp'], ['ce', 'li']];
  const EXEC = {
    0b0000: () => [['ei', 'lm'], ['ce', 'la'], []],                  // LDA
    0b0001: () => [['ei', 'lm'], ['ce', 'lb'], ['eu', 'la']],         // ADD
    0b0010: () => [['ei', 'lm'], ['ce', 'lb'], ['eu', 'la', 'su']],   // SUB
    0b0011: (z) => [z ? ['ei', 'lp'] : [], [], []],                   // JZ
    0b0100: (z, c) => [c ? ['ei', 'lp'] : [], [], []],                // JC
    // CALL: address the stack slot, put the return address on the bus,
    // then move the pointer and jump — in that order, because the write
    // has to land before the slot stops being the current one.
    0b0101: () => [['esp', 'lm'], ['ep'], ['spd', 'ei', 'lp']],       // CALL
    // RET is CALL backwards, and the pointer moves FIRST: the slot you
    // want is the one below where the pointer is resting.
    0b0110: () => [['spu'], ['esp', 'lm'], ['ce', 'lp']],             // RET
    0b1110: () => [['ea', 'lo'], [], []],                             // OUT
  };

  const lo = new Array(512).fill(0);
  const hi = new Array(512).fill(0);
  const at = (op, stp, z, c) => (c << 8) | (z << 7) | (op << 3) | stp;
  const put = (a, lines) => {
    for (const l of lines) {
      const i = CTRL_LO.indexOf(l);
      if (i >= 0) lo[a] |= 1 << i;
      const j = CTRL_HI.indexOf(l);
      if (j >= 0) hi[a] |= 1 << j;
    }
  };
  for (let op = 0; op < 16; op++) {
    for (let z = 0; z < 2; z++) {
      for (let c = 0; c < 2; c++) {
        FETCH.forEach((lines, stp) => put(at(op, stp, z, c), lines));
        const exec = EXEC[op];
        if (exec) exec(z, c).forEach((lines, k) => put(at(op, k + 3, z, c), lines));
      }
    }
  }

  const parts = [...rails(),
    part('swc', 'dip_switch_spst', { switches: 0 }),
    part('swi', 'dip_switch_spst', { switches: 0 }),
    part('swf', 'dip_switch_spst', { switches: 0 }),
    part('step', '74ls161'),
    part('wrap', '74hc00'),
    part('rom_lo', '28c256', { readOnly: true, contents: lo }),
    part('rom_hi', '28c256', { readOnly: true, contents: hi }),
    part('sp', '74ls193'),
    part('inv', '74hc04'),
  ];
  const wires = [...powerChip('step'), ...powerChip('wrap'), ...powerChip('rom_lo'),
    ...powerChip('rom_hi'), ...powerChip('sp'), ...powerChip('inv')];

  const clk = switchInput('swc', 1, 'r_swc');
  parts.push(...clk.parts);
  wires.push(...clk.wires, wire('swc', '1b', 'step', 'clk'));
  wires.push(wire('step', 'q1', 'wrap', '1a'), wire('step', 'q2', 'wrap', '1b'),
    wire('wrap', '1y', 'step', 'clrb'));
  for (const t of ['enp', 'ent', 'loadb']) wires.push(wire('vcc1', 'vcc', 'step', t));
  for (const d of ['d0', 'd1', 'd2', 'd3']) wires.push(wire('gnd1', 'gnd', 'step', d));

  for (let i = 0; i < 4; i++) {
    const sw = switchInput('swi', i + 1, `r_swi${i}`);
    parts.push(...sw.parts); wires.push(...sw.wires);
  }
  for (let i = 0; i < 2; i++) {
    const sw = switchInput('swf', i + 1, `r_swf${i}`);
    parts.push(...sw.parts); wires.push(...sw.wires);
  }
  // The stack-pointer reset shares the flag bank's spare position.
  const spclr = switchInput('swf', 3, 'r_spclr');
  parts.push(...spclr.parts);
  wires.push(...spclr.wires, wire('swf', '3b', 'sp', 'clr'));

  for (const rom of ['rom_lo', 'rom_hi']) {
    for (let i = 0; i < 3; i++) wires.push(wire('step', `q${i}`, rom, `a${i}`));
    for (let i = 0; i < 4; i++) wires.push(wire('swi', `${i + 1}b`, rom, `a${i + 3}`));
    wires.push(wire('swf', '1b', rom, 'a7'), wire('swf', '2b', rom, 'a8'));
    for (let i = 9; i <= 14; i++) wires.push(wire('gnd1', 'gnd', rom, `a${i}`));
    wires.push(wire('gnd1', 'gnd', rom, 'ceb'), wire('gnd1', 'gnd', rom, 'oeb'),
      wire('vcc1', 'vcc', rom, 'web'));
  }

  CTRL_LO.forEach((name, i) => {
    const led = outputLed('rom_lo', `d${i}`, `led_${name}`, `rl_${name}`, 'green');
    parts.push(...led.parts); wires.push(...led.wires);
  });
  CTRL_HI.forEach((name, i) => {
    const led = outputLed('rom_hi', `d${i}`, `led_${name}`, `rl_${name}`,
      /^sp/.test(name) ? 'yellow' : 'red');
    parts.push(...led.parts); wires.push(...led.wires);
  });
  // Spd -> /down, Spu -> /up. The inverter is what makes an idle-low
  // control line safe to hand a chip whose clocks idle high.
  wires.push(wire('rom_hi', 'd5', 'inv', '1a'), wire('inv', '1y', 'sp', 'down'));
  wires.push(wire('rom_hi', 'd6', 'inv', '2a'), wire('inv', '2y', 'sp', 'up'));
  wires.push(wire('vcc1', 'vcc', 'sp', 'loadb'));
  for (const d of ['d0', 'd1', 'd2', 'd3']) wires.push(wire('gnd1', 'gnd', 'sp', d));

  for (let i = 0; i < 3; i++) {
    const led = outputLed('step', `q${i}`, `led_s${i}`, `rls${i}`, 'yellow');
    parts.push(...led.parts); wires.push(...led.wires);
  }
  for (let i = 0; i < 4; i++) {
    const led = outputLed('sp', `q${i}`, `led_sp${i}`, `rlsp${i}`, 'red');
    parts.push(...led.parts); wires.push(...led.wires);
  }

  done.push(emit('c15-call-and-return', {
    vcc: 5, parts, wires,
    _title: 'CALL and RET — the microcode moves the pointer',
    _description: 'C14 worked the stack by hand. Here the control store does it: two more output bits, '
      + 'Spd and Spu, and CALL and RET are just rows of bytes like every other instruction. Set the opcode '
      + 'to 0101 and clock through — the stack slot is addressed, the return address goes on the bus, and '
      + 'on the last step the pointer moves and the machine jumps. 0110 is the same thing backwards, and '
      + 'the pointer moves FIRST because the slot you want is below where it is resting. Watch the '
      + 'inverter: a control line idles LOW and the 74LS193\'s clocks idle HIGH, so without it both clocks '
      + 'would sit low and the pointer would never move at all — which is C14\'s lesson arriving as a '
      + 'property of the microcode\'s timing instead of a finger on a button.',
    _category: 'computer', _difficulty: 5, _stage: 'C15',
  }));
}

console.log(`\n${done.length} computer examples written to gallery/`);
