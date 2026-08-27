# The ladders — gates to a computer, one verified rung at a time

Two teaching sequences live in `gallery/`, and they are one arc: `l0..l10`
starts at a single AND gate and ends at a keypad you can type into; `c0..c17` starts at a
555 ticking and ends at a machine that runs a program — and then at the control
unit every machine after SAP-1 actually uses. Every rung is a real
circuit made of parts you can buy, containing no CPU and no firmware, and
every rung is **simulated and asserted** — see §4, which is the part that
matters most.

They are published twice, deliberately:

| where | what it is | who reads it |
|---|---|---|
| `gallery/l*.json`, `gallery/c*.json` | wire-level, `x/y` all zero | the test corpus; the electrical truth |
| `sb3-creator` `examples/pc90..pc118` | the same circuits **seated in breadboard holes**, EN/DE intros | learners, through the app's example browser |

`scripts/gen-logic-ladder.mjs` and `scripts/gen-computer-ladder.mjs` write the
first; `scripts/gen-logic-examples.mjs --out <sb3-creator checkout>` seats them
and writes the second. **Edit the generators, never the JSON.**

---

## 1. The logic ladder — `l0..l10`

| rung | chips | the idea |
|---|---|---|
| l0 AND | 74HC08 | the truth table you can press |
| l1 NOT | 74HC04 | the first gate that does what a wire cannot |
| l2 AND/OR/XOR | '08 '32 '86 | one pair of switches, three truth tables side by side |
| l3 NAND is universal | 74HC00 ×2 | NOT, AND and OR from one gate type; De Morgan for the OR |
| l4 half adder | '86 '08 | XOR is the sum, AND is the carry — 1+1 reads as binary 10 |
| l5 full adder | '86 '08 '32 | the carry-*in* that lets adders chain |
| l6 4-bit adder | 74HC283 | four bits at once; inside it is l5, four times |
| l7 calculator | '283 CD4511 | set A, set B, read a decimal digit |
| l8 add/subtract | '283 '86 | one mode switch to the XOR bank *and* the carry-in |
| l9 BCD calculator | '283 ×2 '08 '32 CD4511 ×2 | add six when the sum leaves the decimal range |
| l10 diode keypad | 15 diodes, no chip | decimal IN: diode-OR encoding, and why priority encoders exist |

**Why l7 blanks above 9 and l9 does not.** A BCD decoder knows ten digits, so
a sum of 12 has nothing to show — l7 says so in its intro rather than
displaying nonsense, and l9 is the honest fix every decimal adder uses.

**Why l8 is the prettiest rung.** Subtraction is not a new circuit. One quad
XOR on the B inputs, its second input tied to a mode switch, and *the same
switch into the carry-in*: with it open you get A+B, with it closed every B bit
inverts and a 1 enters at the bottom, which is two's complement. The carry LED
changes meaning rather than disappearing — it now reads "no borrow".

---

## 2. The computer ladder — `c0..c17`

| rung | chips | the idea |
|---|---|---|
| c0 clock | 555 | the heartbeat everything obeys |
| c1 program counter | 74LS161 | where the machine is looking |
| c2 memory | '161 74LS189 | sixteen places to put a number |
| c3 accumulator | 74LS173 '283 | the first circuit whose answer depends on its past |
| c4 ring counter | CD4017 | six timing states, one-hot |
| c5 instruction decoder | 74HC138 ×2 | a number becomes a meaning |
| c6 control matrix | '08 ×2 '32 ×2 '04 | (state × instruction) → control lines |
| c7 the bus | 74HC244 ×2 '04 | one set of wires, many talkers — and contention |
| c8 memory walker | + '173 '244 | the machine reads its own memory |
| c9 fetch cycle | 11 chips | reads an instruction *and knows what it says* |
| c10 the machine | 25 chips | fetch, decode, **execute** |
| c11 control ROM | 74LS161, 28C256 ×2 | the control word is FETCHED, not computed |
| c12 flags | the same chips | a conditional jump, bought with address lines |
| c13 8-bit ALU | '283 ×2, '86 ×2, '688 | eight bits, and flags it derives itself |
| c14 the stack | 74LS193, '189, '04 | LIFO, and why pop retreats before it reads |
| c15 CALL / RET | + 28C256 ×2, '161 | a subroutine call as rows of bytes |
| c16 microcoded machine | 21 chips | C10's machine, control matrix replaced by a ROM |
| c17 eight bits | 33 chips | the same machine, twice as wide — and 100 + 100 = 200 |

**c10's program.** Four cells, then nothing but the clock:

```
cell 0   0011   LDA 3     load the accumulator from cell 3
cell 1   0111   ADD 3     add cell 3 to it
cell 2   1100   OUT       copy the accumulator to the output register
cell 3   0101   data 5
```

Three instruction cycles later the output register reads **ten**. Change cell 1
to SUB and the same hardware answers **zero** — which is the whole idea of a
stored program, and is asserted as such.

The six states, per instruction:

```
T1  Ep Lm   counter -> bus -> address register
T2  Cp      counter advances; the address is already captured
T3  CE Li   RAM -> bus -> instruction register; the decoder lights
T4  Ei Lm   operand address -> bus -> address register   (LDA/ADD/SUB)
    Ea Lo   accumulator -> bus -> output register        (OUT)
T5  CE La   RAM -> bus -> accumulator                    (LDA)
    CE Lb   RAM -> bus -> B register                     (ADD/SUB)
T6  Eu La   adder -> bus -> accumulator                  (ADD/SUB)
    + Su    and the adder subtracts                      (SUB)
```

The control-signal names and the six-state shape were read from
`wnoyan/SAP-1-Computer-Logisim` (MIT) as a **specification**; the circuits are
built from real 74-series parts and verified independently. See §5 on why that
file was read rather than imported.

**Why c11 exists.** c6 computes the control word with an AND-OR array; c11 looks
it up in a ROM. Both are asserted against the SAME table, which is the claim.
The difference is what happens when you add an instruction: the matrix needs new
GATES and grows as (instructions x states), the ROM needs new BYTES. That is why
SAP-2, SAP-3 and every real CPU after them are microcoded, and it is the gap
between our ladder and the SAP-2/SAP-3 designs in the wild.

Two details that are the lesson rather than incidental. The step counter stops
being a CD4017 ring: one-hot says WHICH state as a lit wire, and a ROM address
wants a NUMBER, so it becomes a 74LS161 cleared asynchronously the moment q1 and
q2 are both high — six states, and state 6 never settles. And the fetch words are
written for all SIXTEEN opcodes, not just the four that decode to something,
because fetch cannot depend on an instruction the machine has not read yet.

**Why c12 is only bytes.** A conditional jump is where a machine stops being a
player piano. In C6's gate matrix that means new gates on every affected control
line; here the two flags are simply two more ADDRESS lines on the store, which
grows from 128 bytes to 512 and learns to branch. The data path is untouched, and
`test/computer-ladder.test.js` asserts exactly that: C12 holds no logic chip C11
does not, and its ROM is 4x the size. It also checks the two things a mis-wired
address line would break — LDA must behave identically at every flag setting, and
fetch must, since reading an instruction cannot depend on the result of the last
one.

**Why c13 buys its zero flag.** Widening to eight bits is mechanical — two
74HC283s, carry to carry — and seeing that it is mechanical is the point. The
flags are not symmetrical, though. CARRY is the top adder's cout, a wire that was
already there. ZERO needs all eight sum bits low at once, and **an 8-input NOR is
not a part you can buy**, so a 74HC688 magnitude comparator has its Q side tied to
ground and asserts P=Q exactly when the sum is zero. The test checks that
structurally, because the shopping IS the lesson.

Its sweeps are deliberately boundary-shaped rather than exhaustive: each case
costs ~0.7 s of settling, so all 256 values ran 78 s and the self-subtract 181 s —
together longer than the rest of CI. The values kept are the ones that can fail
(the nibble carry at 15/16/17, the byte carry, and 85/170 so no dead comparator
input can hide).

**c14 is what the 74LS193 was for.** A 74LS161 counts one way, so a pointer built
from one can push and never pop; the part had to be added to bw-board (b63a6ec)
before this rung could be wired at all. Convention is empty-ascending — push
stores at [SP] then advances, pop retreats then reads — and that order is the
whole discipline: a pop that reads first hands back the empty slot above the top
of the stack, which presents as corrupted memory rather than as a counter clocked
a moment too late.

Two things it refuses to hide. The pointer is four bits and there is no depth
check anywhere, so sixteen pushes wrap to zero and quietly overwrite the bottom —
which is why real machines add the check. And the 193's two clocks IDLE HIGH: they
hang on pull-ups and count on RELEASE. Wired the obvious way, with pull-downs,
both clocks sit low, the pointer never moves, and the stack silently rewrites one
cell forever. That cost a debugging round here even though bw-board's own 74LS193
test already names the case.

---

## 3. Real-hardware facts these rungs refuse to hide

Each of these cost a debugging cycle here, and each is a thing a learner meets
on a bench.

- **The 74LS189's outputs are INVERTED.** Store 5, read 10. That is the chip,
  and it is why SAP-1 builds put a hex inverter after the RAM. c2 shows it;
  c8 and c10 correct it with an inverter bank.
- **Active low means pull UP.** The RAM's `/WE` wired through an ordinary
  pull-*down* is asserted permanently: the RAM never stops writing and every
  address hands back the last value on the data switches. Every cell read 12.
  Invisible to a write-once-read-immediately test; caught by write-then-walk-back.
- **Clock phases are not decoration.** States advance on the RISING edge,
  registers latch on the FALLING one through an inverter. Latch on the same
  edge that changes the state and you capture the bus mid-transition.
- **A 555's control pin needs its 10 nF.** Left floating, the comparator
  reference is undefined, the timer never trips, and the capacitor sits at a
  hundredth of a volt forever.
- **No CMOS input may float.** Every switch node has a pull-down and every
  spare gate input is tied. A floating input reads 0 V in the engine and reads
  the room on a bench — the lesson silently becomes a different lesson.
- **At T6 in c10 the bus shows 15 while the accumulator holds 10.** Real, not a
  modelling error: the accumulator feeds the adder, so the instant it latches
  10 the adder recomputes 10+5. The latched value is correct; the lamp shows
  the adder still working after the capture.

- **A real 74-series chip has NO propagation delay in this engine.**
  `chip-composer.js` models logic levels; only the abstract `gate_*` kinds
  honour `params.tpdNs`. So a timing lesson cannot be built from buyable
  parts — an adder made of 74HC08s settles instantly however deep its carry
  chain runs. This is why there is no "carry look-ahead" rung, and why the
  comparison lives in `test/gate-delay.test.js` instead, where the delay is
  real and countable. Measured there, the result is not the textbook one:
  look-ahead assembled from 2-input packages buys **1.33x the speed for 2.1x
  the gates**, a bad trade, and only reaches the textbook **2x** when the
  gates are WIDE. Which is the actual lesson — carry look-ahead ships as
  dedicated silicon (the 74182 uses 5-input gates) precisely because you
  cannot get it out of a bag of quad-gate chips.

---

## 4. How they are proven

An example that merely loads proves nothing — a gate wired to the wrong pin
renders beautifully and computes garbage. So:

- `test/logic-ladder.test.js` — every truth table in full. **All 256 four-bit
  pairs** for the adder; both modes for the subtractor with the carry checked as
  a borrow flag each time; every decimal pair across two digits for the BCD
  adder, including the pair that matters (9+0 must *not* carry, 9+1 must).
- `test/computer-ladder.test.js` — sequences, not single readings. A register
  that always reads 5 passes any one-shot check and is still broken, so the
  counter is walked through all sixteen addresses and round again, the ring
  counter through **two full laps** (one that wraps by luck fails on the
  second), and the accumulator is checked for the thing that separates a
  register from a wire: *changing the addend with no clock must leave the total
  alone*.
- `test/logic-examples.test.js` — the **seated** copies re-run the same
  arithmetic, because a breadboard strip joins five holes and two nets sharing
  a column are shorted by the board while the wire list still looks perfect.

Three assertions are worth copying into any future rung, because they fail on
the plausible-but-wrong version rather than the obviously-broken one:

1. **The negative half.** c6 asserts not only that the right control lines fire
   but that *every other line is dark*. A control unit that asserts a spare
   signal is not a smaller bug than one that misses a needed signal — it would
   put two drivers on the bus at once.
2. **The bus is empty at T2.** c9 and c10 check that at T2 nobody drives: the
   counter has let go and nothing else is enabled. One driver or none, always.
3. **Contention is not survivable.** c7 asserts that with two drivers
   disagreeing, *no* line reads as a clean level. A simulator that quietly
   picked a winner would teach the opposite of the lesson.

---

## 5. Formats: what imports, and what should not

- **Fritzing (`.fz`, `.fzz`)** — imported, `src/importers/fritzing.js`.
  Connections are stated per VIEW and the views are different graphs: the
  breadboard view routes through the board's own strips and carries connections
  the circuit does not have, so the *schematic* view is read. Drawn wires are
  dissolved; parts whose `moduleIdRef` is a hash from the author's bin are
  REPORTED, never guessed.
- **Logisim (`.circ`)** — **do not import.** A component is one anchor
  coordinate plus attributes, with *no pin positions*, and connectivity is
  bare `<wire from="(x,y)" to="(x,y)"/>` elements — 1499 of them in the SAP-1
  file. Attaching anything means reimplementing Logisim's per-component pin
  layout, where each rule subtly wrong yields a circuit that imports cleanly
  and is wired incorrectly. Add multi-bit buses through splitters (our nets are
  one bit) and hierarchical sub-circuits to flatten. Read such a file as a
  specification instead — which is exactly what c4..c6 did with it.

---

## 6. Adding a rung

1. Write it in the generator, not the JSON. Terminal names come from the
   **engine** (`terminalsForKind`), never a datasheet — a 74HC283's bit slices
   are `s0..s3` with `s0` the ones bit, and the CD4511's segments are `qa..qg`
   with blanking on `bl`.
2. Tie every unused input. The tests enforce it for gate chips.
3. Assert the full space if it is small enough to enumerate, and always assert
   the negative half.
4. Publish it by adding an entry to `LADDER` in `gen-logic-examples.mjs`
   (title/teaches EN **and** DE — the example corpus is bilingual), then run
   `node scripts/gen-example-enrolment.mjs --write` in the sb3-creator checkout
   and the five example gates: bench-layout, gate-enrolment, index-metadata,
   circuit-params, corpus-contract.
5. Simulation gotchas that will otherwise cost an hour: `advanceTo` takes an
   **absolute** time, and `ledBrightness` averages a trailing 20 ms window — so
   settle twice after changing an input or the reading lags a full step and
   looks exactly like inverted logic.
