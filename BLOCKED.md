# bw-circuit-ui — blocked items

## Blocked on someone else's sequencing

**The engine pin cannot advance past bw-board `959574e`** (2026-09-13). Taking
the vf datasheet correction re-derives four single-LED brightness expectations
cleanly — `(5 − 1.8) / (1000 + 10) = 3.16832 mA -> 0.158416`, done on
`lane/standard-parts-sidecars`. `test/drc.test.js` "keeps sub-floor
contributors out of the list" cannot be re-derived, because the number it would
be re-derived TO is produced by an engine defect.

Measured on bw-board `51e750d`: one MCU pin pushpull-high -> 10 Ω -> LED
(vf 2.0) -> GND, fitted over two operating points (R = 10 and R = 1000).

    second branch = none      I(R=10) 71.1111 mA   series 35.000   knee 1.8000 V
    second branch = resistor  I(R=10) 71.1111 mA   series 35.000   knee 1.8000 V
    second branch = LED       I(R=10) 80.4123 mA   series 28.969   knee 1.8664 V

The first two lines are exactly right: series 35 = rd 10 + pin 25, and
knee 1.8000 = 2.0 − 0.020·10 is the correction landing. The third adds a second
LED on a DIFFERENT, UNDRIVEN pin which carries 0.0000 A — and the first LED's
current moves +13.1 %. A part conducting nothing cannot change another branch.
A second *resistor* branch changes nothing, so it is specific to a second
junction part being present.

Evidence it is new rather than pre-existing: this repo's DRC test records
"two LEDs through 10 Ω draw 66.7 mA each (measured)", and 66.7 = 3/45 is exactly
the no-interaction value; that test is green on master at pin `d7436dc`, which
predates the correction. (Caveat on the fit: two points assume a linear branch,
so read "series 28.969 / knee 1.8664" as "the line stops holding", not as the
model. The solid facts are 71.1111 vs 80.4123 mA and the second LED's zero.)

*To unblock:* bw-board fixes the second-junction interaction (reported to
lego-ac 2026-09-13; reproduction is four lines and was offered with the report),
then bump the pin here and re-derive the DRC expectation against the fixed
engine. Until then `lane/standard-parts-sidecars` stays a draft PR carrying one
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
