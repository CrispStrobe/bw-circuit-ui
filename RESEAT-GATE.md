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
   ✅ **DONE (2026-09-04).** `bw-circuit-ui/src/model/reseatOnto8086` lifts
   e4-via-blink's 6502 subsystem (boundary inferred, #4) and drops in an
   8086/8255, re-terminating the LED nets by NET IDENTITY (#5).
   `scripts/gen-reseated-8086.mjs` emits `gallery/e4-reseated-8086.json` and a
   wrong-port variant; `test/reseat.test.mjs` proves the transform standalone.
   The gate (`bw-board/test/reseat-gate.test.mjs`) now EXTRACTS the reseated
   circuit and runs the program on it — GREEN off the transformed circuit, and
   RED off the wrong-port one (observable derived from the schematic, so a port
   mismatch is caught). Prerequisite added: an i8255 DIP-40 schematic part
   (`bw-board/src/devices/retro-dips.js`) — see the resolved blocker below.
3. **Then generalise.** A general reseat that has never made one specific
   example run is exactly the thing this repo keeps finding and regretting.
   ← NEXT. The transform hardcodes the 6502→8086 direction and the e4 board's
   shape; generalising means other originals (Nano/Pico/STC) and inferring the
   pin declaration rather than passing it. Also OPEN: generate the 8086 program
   from pseudocode (option 3) so the program equivalence is generated, not
   asserted — unblocked now that `buildPseudocode8086` lowers whole-port writes.

**✅ Behavioural RED — DONE (2026-09-05).** The wrong-port RED case proves the
gate fails on wrong WIRING; it said nothing about wrong BEHAVIOUR, because shape
(the ordered distinct values) is deliberately clock-independent — a reseat that
lit the right LEDs at a quarter the rate was green. That was contract #1's
original concern. `bw-board/src/reseat-gate.js` now captures `tMs` per edge and
`reseatGate` takes an opt-in `{ timing: { tolerance, expectedRatio } }`: once
shape matches, it requires the reseat's real-time cadence to be `expectedRatio×`
the original's, flipping MATCH→DIFFER otherwise. The test drives a reseat at a
4×-too-slow clock (a wrong crystal): the walk is byte-identical (shape MATCH) but
the timing gate goes RED at ratio ~4, and an equal-rate reseat still passes.
Shape stays the default across families that don't share a cycle budget;
`expectedRatio` is the caller's model of "same speed" when they do compare.

**The diagnostic that cost a red master, written down (lego-47).** The gate's
GREEN case and its RED mutation case read the same fixtures. So: **the green case
and the red mutation case failing _together_ means the fixture is absent, not
that the behaviour moved; a real behaviour change moves only one.** A missing
fixture (or a cross-repo path present only on one box) makes both go red and reads
as "the reseat behaves differently" — which is exactly how a cross-repo fixture
path shipped a red master on 2026-09-04. The fixtures are now committed in-repo
(`bw-board/test/fixtures/reseat/`) with an existence assertion that fails as "the
fixture is not here", naming the path — never as a behaviour change.

## Program equivalence — the axis the gate does NOT close yet (be honest)

A circuit reseat transforms the SCHEMATIC; it cannot carry object code across.
The E4 walking-bit program is 6502 machine code; the reseated board runs an
8086, so its ROM is a SEPARATE program. The gate compares the two boards'
behaviour — but whether the 8086 program is *equivalent* to the 6502 one is a
second axis, and right now that equivalence is **asserted, not generated**: both
ROMs are hand-written to the same walking-bit intent. If the 8086 ROM happened
to walk a bit for a different reason, the gate would be green and the claim
hollow (lego-47's catch, 2026-09-04).

The clean fix is that both ends compile from ONE pseudocode source (`PIN led =
P1.0 OUTPUT` + a walking loop) through a 6502 back end and an 8086 back end;
then "only the DEVICE line changed" is literally true and equivalence is
generated. **But only the 8086 back end exists today** —
`overlay/scratch-gui/src/lib/bw-asm/pseudocode-8086.js`,
`buildPseudocode8086({project, source}, seams) → {bytes, format, asm}`. A grep
across every repo for a 6502 / Z80 / STC code generator finds nothing; the 6502
DEVICE *parses* (pin vocab `PA0-7`, `PB0-7`) but has no emitter. So no pair can
have both ends generated now.

**Current honest scope (option 2):** the gate proves the circuit transform
preserves observable behaviour GIVEN an independently-written equivalent 8086
program. That is real and worth having — it fails for a missing chip, a wrong
port map, a decode overlap. It does NOT yet certify that the two programs are
the same program.

**The near-term improvement (option 3), when someone drives it:** generate the
8086 end from a walking-bit pin program via `buildPseudocode8086`, so the RESEAT
TARGET's program is lowered rather than hand-written. That makes one end
generated and structures the gate for full both-ends equivalence the day a
second back end lands — no rebuild needed. It needs the pin-program syntax for a
walking bit (lego-47's DSL; a keypad lowers today, a blink loop's syntax is TBD)
and reaches into the scratch-gui overlay, so coordinate before wiring it.
Writing a 6502 back end (option 1) is correct but its own project, not a step
inside this gate.

## STEP 2 BLOCKER — RESOLVED (2026-09-04): the i8255 now has a schematic part

*Resolved:* an i8255 DIP-40 was registered in `bw-board/src/devices/retro-dips.js`
(alongside the W65C22), with the real 8255A pinout — port A split across both
ends, port C upper nibble before lower, `reset` ACTIVE HIGH (not `resb`). The
substitution now re-terminates LED nets onto `ppi86.pb0..pb7`, and the gate
detects a wrong port from the schematic. The original finding, kept for the
record:

The substitution must re-terminate the LED nets onto the 8255's port-B pins, and
the gate must be able to tell — FROM THE SCHEMATIC — which port the LEDs landed
on, so a port mismatch fails (the invariant below). That needs an i8255 part
whose port pins (`pb0..pb7`) are terminals you can wire. **No such part exists
anywhere:**

- No `i8255.json` sidecar in bw-circuit-ui (only `i8086.json`); `terminalsForKind`
  falls back to `[a,b]` for it.
- No i8255 DIP in bw-board `src/devices/retro-dips.js` / `board-kinds.js` (the
  W65C22 IS there — that is why e4-via-blink can wire LEDs to `via1.pb0`).
- No `registerDevice('i8255')` in bw-board's device REGISTRY, so
  `getDevice('i8255')` is undefined — the injected engine gives no terminals
  either.
- The extractor recognises kind `i8255` but reads only `csb`, `a0`, `a1`
  (`i8086-extract.js` IO_SELECT/RS_PINS); it NEVER references port pins. Port B
  is a pure register in the runtime model (`i8255.js` `outB`/`dirB`), which
  declares no schematic terminals. The `decode138Circuit` extractor test wires
  the PPI with only those three pins.

So an 8086/8255 GPIO board like e4-via-blink has never been drawable, and the
port-B re-termination has no target terminals. **This is the blocker for the
circuit half.** The two halves are independent:

- **Program half — UNBLOCKED (lego-47, 2026-09-04).** `PORT leds = P2 OUTPUT` +
  a walking loop lowers via `buildPseudocode8086({project, source}) →
  {bytes, format, chips, asm}` and runs on `createI8086DosBench({bytes, format,
  chips})` (the ▶-button path — call THAT, not `emitI8086Asm`). Verified output
  `0x00 0x01 0x02 .. 0x80` — the SAME shape as STEP ZERO. This closes option 3
  for the 8086 program.
- **Circuit half — BLOCKED here.** Needs an i8255 schematic part with port pins
  before the substitution can re-terminate onto them. The fix: register an i8255
  device pinout (DIP-40: `pa0-7 pb0-7 pc0-7 d0-7 rdb wrb csb a0 a1 reset vcc
  gnd`) in bw-board's device model (the terminal authority the extractor already
  agrees with on `csb/a0/a1`), plus a bw-circuit-ui sidecar for rendering.
  Coordinating whose lane that part is before adding it to the shared tree.

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
  drives all eight pins before the first ORB pattern write, so this raw capture
  (via `onPinChange`) shows one all-dark edge. **The gate excludes it, and for a
  named cause:** its capture treats the observable as un-live until the port's
  direction becomes output, so the all-dark value at the direction write is the
  baseline, not an edge — not a rule that keys off "a leading zero" (which would
  one day swallow a program whose first real data write is genuinely `0x00`).
  The SHAPE the gate defends is the walking `0x01..0x80` sequence and its wrap.
- Cadence is uniform: 516 steps per position at this delay constant. The gate
  compares the EDGE SEQUENCE (order of distinct values), not step counts — the
  8086 end walks at ~8199 steps/position and will never share this cycle budget.
  Rate is REPORTED in the gate result (mean inter-edge interval), not part of
  the verdict; a caller with a shared time base can assert on it.
