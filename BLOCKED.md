# bw-circuit-ui — blocked items

## Blocked on someone else's sequencing

**The engine pin cannot advance past bw-board `959574e`** (2026-09-13). Taking
the vf datasheet correction re-derives four single-LED brightness expectations
cleanly — `(5 − 1.8) / (1000 + 10) = 3.16832 mA -> 0.158416`, done on
`lane/standard-parts-sidecars`. `test/drc.test.js` "keeps sub-floor
contributors out of the list" cannot be re-derived, because the number it would
be re-derived TO is produced by an engine defect.

Measured on bw-board `51e750d`: one MCU pin pushpull-high -> 10 ohm -> LED
(vf 2.0) -> GND, fitted over two operating points (R = 10 and R = 1000).

    second branch = none      I(R=10) 71.1111 mA
    second branch = resistor  I(R=10) 71.1111 mA
    second branch = LED       I(R=10) 80.4123 mA   (+13.1 %, and it carries 0.0000 A)

**Root cause (lego-ac, 2026-09-13): a MODEL SWAP, not a perturbed solve.**
`board.js _junctionHeadroomV()` summed `vf` over *every* junction in the
netlist regardless of topology and fed one number to `junctionModelOf` for all
of them. A second, unrelated LED drags the global headroom from 3.00 V to
1.00 V and flips the first LED's routing from piecewise to exponential. The
second LED never perturbs the solve; it changes which model the first one is
solved with -- which is why a second *resistor* did nothing.

Both measurements land exactly on the closed form, and that is what confirms
the swap. Solving Shockley by hand against the same 35 ohm (R 10 + pin 25),
with Is calibrated so junction + rs drop vf at the rated 20 mA:

    shockley rs = 2   ->  80.4123 mA   (this repo's measurement, engine at 51e750d)
    shockley rs = 10  ->  69.8184 mA   (lego-ac's, with classDefaults in their tree)
    piecewise knee 1.8, rd 10  ->  71.1111 mA

Note the sign: at rs = 2 the swap RAISES current, at rs = 10 it lowers it
slightly, so a recorded number is only meaningful together with the rs its
engine carried. The earlier two-point fit here read this as a changed
series/knee; it was measuring the swap, and the giveaway was a fitted series
BELOW the resistor plus pin resistance, which is impossible.

Evidence it was new rather than pre-existing: this repo's DRC test records
"two LEDs through 10 ohm draw 66.7 mA each (measured)", and 66.7 = 3/45 is
exactly the no-interaction value; that test is green on master at pin
`d7436dc`, which predates the correction.

*To unblock:* bw-board lands `_junctionHeadroomFor(part)` -- headroom derived
from the part's series CHAIN rather than a netlist-wide sum (written 2026-09-13,
held with the `rs = classDefaults` change until its own expectations are
re-derived) -- then bump the pin here and re-run the DRC test, which should read
3/45 each again with no interaction. Until then `lane/standard-parts-sidecars` stays a draft PR carrying one
red test, which is the honest state — updating that expectation to 161 mA would
record a defect as the specification.


**pc115 and pc116 cannot publish** (2026-08-27). The rungs are built, tested
and shipped here as `gallery/c14-the-stack.json` and
`gallery/c15-call-and-return.json`; what cannot happen is publishing them as
sb3-creator examples.

They place a **74LS193**, added to bw-board in `b63a6ec`. sb3-creator's CI pins
its siblings to exact SHAs — deliberately, so its verdict does not float with
another repo's HEAD — and both pins predate that commit, so its corpus gate
rejects the examples with `Unknown part kind "74ls193"`.

**Bumping the pin is not ours to do.** `sb3-creator/test/fixtures/siblings.json`
records that moving past bw-cui2's attiny88 `pa0` -> `gnd2` rename inherits a
**135-circuit re-seat**, sequenced to happen once and owned by the rename
chain. Taking that on as a side effect of publishing two examples is exactly
what the sequencing exists to prevent.

*To unblock:* in the commit that bumps sb3-creator's pins past `b63a6ec`,
delete the two entries from `BLOCKED_ON_SIBLING_PIN` in
`scripts/gen-logic-examples.mjs` and re-run it. Nothing else is needed — the
examples regenerate from the gallery rungs.

---

Previous items resolved:

- ~~placingGhost mode~~ — landed (7d2a3bd), machine.startPlacing + breadboard-snap.js
- ~~hittest.js led_cube~~ — fixed by coordinator (d168795)
- ~~PARTS-CATALOG.md~~ — landed via bw-parts agent (111 parts, 3 tiers)
- ~~breadboard-continuity design~~ — adopted, mergeNets landed (8b3ff6b)
