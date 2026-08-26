/**
 * Generate the COMPUTER ladder — gallery/c0..c8, the pieces a
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

for (const line of done) console.log(line);
console.log(`\n${done.length} computer examples written to gallery/`);
