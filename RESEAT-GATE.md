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
2. **Build the substitution that makes the gate pass for that ONE pair.**
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
