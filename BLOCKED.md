# bw-circuit-ui — blocked items

## Blocked on someone else's sequencing

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
