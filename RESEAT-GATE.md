# The reseat gate — scope and design (ROADMAP §3.8.3)

The owner's ask: an example drawn around a Nano, Pico, 6502, or STC should be
reseatable onto an 8086 **in the schematic**, not just in the program. lego-47
made the PROGRAM half true (same text, one DEVICE line changed; `P1/P2/P3` map
onto an 8255's ports A/B/C). This is the CIRCUIT half, and it is the harder one,
because an AVR has GPIO and an 8086 has none — so reseating substitutes a whole
SUBSYSTEM (CPU + port chip + address decode), not a part.

Scoping and design captured 2026-09-04 from lego-47, so the focused run that
builds this starts from the right gate rather than rediscovering it.

## The gate comes FIRST, because it DEFINES what reseating means

Without a gate, "substitute a subsystem" is unbounded — you can always add more
of the old board's behaviour and never know when you are done. The gate says
when. And it must be written against BEHAVIOUR, not the netlist:

> **A tempting but WRONG gate:** "the reseated circuit contains a CPU, an 8255
> and a decoder." That is a gate on your own implementation — it passes the
> moment you write it and cannot fail for the reason that matters.
>
> **The gate worth having:** the reseated example EXTRACTS to a machine, that
> machine RUNS the same program, and it produces the SAME OBSERVABLE RESULT the
> original board did — same LED pattern, same serial output, same pin states
> after N steps.

That gate fails for every real reason — a missing chip, a wrong port map, an
address decode that overlaps, a program that assembles and does nothing — and it
does not care how the substitution was achieved. §3.8.3 already names "extracts
but does not run" as the failure mode; behaviour is what separates those two.

## Why it is writable today

- **Both ends of the comparison already exist.** `capabilities().outputs` /
  `outputs()` report `value`/`dir`/`pins` per 8255 port, and `setInput` drives a
  switch — so "the same observable result" is a comparison a test can MAKE, not
  a thing to build first.
- **Start with the pair you control.** `BLINK8086` (this repo / bw-board, the
  minimal 8255 GPIO board) against a shipped 6502 or STC blink example is the
  cleanest first case — you own the 8086 end and the original is shipped. A
  candidate original is `gallery/e4-via-blink.json` (a 6502/VIA blink). If the
  gate cannot express THAT comparison, it will not express a harder one.

## Order of work (lego-47's, and it is the repo's recurring lesson)

1. **Write the gate** for one pair — the behaviour comparison above.
   ✅ **DONE (2026-09-04).** `bw-board/src/reseat-gate.js` +
   `test/reseat-gate.test.mjs`. Family-agnostic (caller supplies `buildMachine`
   + a `read()` for the observable byte); compares the change-sampled edge
   sequence, SHAPE by default. GREEN: e4-via-blink (6502) and BLINK8086 (8086)
   walk the same `0x01..0x80` → MATCH. RED: LEDs mis-wired to port A while the
   program drives B → nothing lights → DIFFER. The discipline is satisfied — the
   gate is known to fail for the reason that matters BEFORE any substitution
   exists. NB the GREEN case currently hand-builds each machine (6502 via
   `extract6502Machine` + the STEP ZERO program; 8086 via `BLINK8086`); step 2
   replaces the 8086 hand-build with the SUBSTITUTION's output.
2. **Build the substitution that makes the gate pass for that ONE pair.**
   ← NEXT. In bw-circuit-ui: transform e4-via-blink's circuit (lift the CPU
   subsystem, re-terminate the LED nets onto the 8086/8255 per the pin
   declarations, contract #4/#5), extract THAT, and feed it to the gate in
   place of the hand-built `BLINK8086`.
3. **Then generalise.** A general reseat that has never made one specific
   example run is exactly the thing this repo keeps finding and regretting.

## The one invariant the substitution MUST keep

The program-half promise is `P1/P2/P3 -> 8255 ports A/B/C`. **The circuit
substitution has to honour it:** if the reseated schematic wires an LED to a
different port than the pin declaration names, the program compiles, runs, and
lights nothing — and neither half is wrong on its own. **Whatever the gate
compares, a port mismatch MUST fail it.** (Related, from the compiler side:
writing a pin declared INPUT is now refused, since every layer below behaves
correctly and there is nothing to report — worth knowing if a demo grows a
pseudocode counterpart.)

## Pieces and where they live (for whoever picks this up)

- Dispatch: `src/model/machine-extract.js` — `extractMachine()` routes to
  INJECTED `extract6502Machine` / `extractZ80Machine` / `extract8086Machine`.
  The extractors themselves come from the host, not this repo.
- The 8086 end: `BLINK8086` (bw-board `src/i8086-machine.js`) + its
  `rom/blink-demo.bin`, which drives 8255 port B (LEDs) and reads port C
  (switches, active-low).
- Original examples: `gallery/*.json` (`e4-via-blink.json`, `e6-full-eater6502.json`).
- This is a focused, cross-repo effort (circuit model + extractor + the gate),
  not a small change — it wants its own run with the §3.8.3 spec in hand.

## SETTLED CONTRACT (2026-09-04, with lego-47 — build to THIS)

**Layout (corrected — the gate is in bw-board, not here).** `bw-circuit-ui` does
NOT depend on `bw-board`; all three extractors (`i8086-extract.js`,
`m6502-extract.js`, `z80-extract.js`) and all three machines live in `bw-board`,
so **bw-board is the only place both ends of the comparison coexist and is where
the GATE lives** (it reads the circuit JSON as data). The **SUBSTITUTION**
(circuit → circuit transform) stays HERE in `bw-circuit-ui`, testable on its own.
Do NOT add a bw-board dependency to bw-circuit-ui — that points the UI at three
CPU emulators the wrong way.

**#1 The observable — sample on CHANGE, not on a clock.** Record `(step, port,
pins & dir)` on every change; compare the resulting EDGE SEQUENCE. Rate is then
exact (the step numbers are in the trace) and you compare shape-only or
shape+timing by including/excluding the step field. A clock-sampled trace is
sensitive to the sample period K and hides sub-K rate differences — don't. Serial
is a SEPARATE stream, never interleaved into the port trace.

**#3 The original — verify it, do not trust it.** `e4-via-blink.json` is the
right original but is NOT confirmed to run to a known pattern. STEP ZERO: capture
its 6502 trace, eyeball it, and PASTE THE PATTERN BELOW so the baseline is a read
artifact, not an unread golden file.

**#4 The boundary — INFER, don't mark.** The lifted subsystem is the CPU part
plus the transitive closure of parts that talk ONLY to it — that catches the VIA,
the decoder and the ROM and stops at the LEDs (an LED's net also reaches a
resistor and ground). A marker is a place for the boundary to drift out of
agreement with the netlist; if the closure grabs something it shouldn't, that is
information about the board, not a reason for an override.

**#5 The invariant — preserve NET IDENTITY, not pin identity (the crux).** Do NOT
map "VIA:PA0" to "8255 port A bit 0" — that naming match is a coincidence, and a
board that wires LEDs to PB then silently lights nothing. The LEDs, resistors and
nets STAY (they are not lifted). The substitution re-terminates the NET ENDPOINT
that used to land on VIA:PA0 onto whichever 8255 pin the NEW pin declaration
names. The invariant: *the net the program's logical pin P1.0 drives is the SAME
net object before and after the swap.* Mapping is program-logical-pin → net; both
sides then dereference the same thing, so a port mismatch is impossible to
EXPRESS, not something the gate must catch. The pseudocode pin declarations are
the authority on both sides — which is what makes the gate test that the
PROGRAM'S view survives, not that two netlists look alike.

**Discipline — a gate that has never failed is not known to work.** BEFORE
writing the substitution, feed the gate a deliberately WRONG reseat (LEDs on
port B when the program says port A) and confirm it goes RED. Learn it there,
cheaply, not after the substitution "works."

## STEP ZERO — the captured 6502 baseline (e4-via-blink)

Captured 2026-09-04 by `bw-board/scripts/reseat-baseline-6502.mjs` — it reads
THIS gallery JSON, runs it through `extract6502Machine` (the exact config the UI
would run), pairs it with the program below, and records the change-sampled
port-B edge sequence. Re-run it to regenerate; the numbers here were read, not
assumed.

**The circuit ships no program — the baseline is circuit + program, both written
here.** The extracted config is `rom $8000–$FFFF` + `via1 @ $4000` (coarse
decode, mirrors through $7FFF). There is no crystal in the drawn circuit, so the
extractor emits no `clockHz`; the baseline injects the eater's **1 MHz**, which
scales `tMs` only — the STEP-indexed sequence below is clock-independent.

The program is the E4 lesson ("Port B drives 8 LEDs"): a single bit marches
across port B, re-entering at bit 0 when it walks off the top. VIA regs off
`$4000`: `ORB=$4000`, `DDRB=$4002`.

```
LDA #$FF ; STA DDRB      port B all output
LDA #$01                 the walking bit
L1: STA ORB              drive the LEDs
    LDY #$00 ; L2: INY ; BNE L2     (256-iter delay)
    ASL A                march the bit left
    BNE L1               still lit -> keep walking
    LDA #$01 ; JMP L1    walked off top -> re-enter at bit 0
```

**Captured change-sampled port-B trace (17 edges / 8000 steps):**

```
  step   portB   LEDs
      2   0x00    ........   <- DDRB=$FF drives all 8 pins; ORB latch still 0
      4   0x01    .......#   <- first pattern write
    520   0x02    ......#.
   1036   0x04    .....#..
   1552   0x08    ....#...
   2068   0x10    ...#....
   2584   0x20    ..#.....
   3100   0x40    .#......
   3616   0x80    #.......
   4134   0x01    .......#   <- wraps; walk repeats every ~4128 steps
   ... (8 more, the pattern repeating)
```

Distinct values in order of first appearance:
`0x00 -> 0x01 -> 0x02 -> 0x04 -> 0x08 -> 0x10 -> 0x20 -> 0x40 -> 0x80`.

**Eyeball reading (the artifact the gate is allowed to trust):**
- A clean 8-position walking bit on port B, one LED at a time, wrapping cleanly.
- The leading `0x00` is REAL, not noise: configuring port B as output (DDRB write)
  drives all eight pins before the first ORB pattern write, so there is one
  all-dark edge. A reseat that omits it (e.g. sets the direction and the first
  pattern in one indistinguishable step) is a defensible EQUIVALENT, not a match
  — the SHAPE the gate defends is the walking `0x01..0x80` sequence and its wrap,
  not the exact leading edge. Compare shape by default; require the leading edge
  only when timing-strict.
- Cadence is uniform: 516 steps per position at this delay constant. The gate
  compares the EDGE SEQUENCE (order of distinct values), not step counts, unless
  run timing-strict — the 8086 end will not share this cycle budget.
