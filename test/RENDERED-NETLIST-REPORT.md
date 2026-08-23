# Rendered-netlist correspondence — divergence report

**Date:** 2026-08-23 · **Branch:** `electrical-correspondence` · **Corpus:** 1,034 `circuit*.json` variants

Companion to `ELECTRICAL-CORRESPONDENCE-REPORT.md`. That gate compared the *projection* to the
solver. This one compares the **artwork** to the solver, which is what the invariant was
actually about, and it found a defect the first gate cannot see.

## The invariant

Let VISIBLE be the drawn pins of non-infrastructure symbols.

**RENDERED partition R** — two visible pins are connected iff the artwork says so, by the only
two mechanisms the renderer has:

- **drawn copper** — a trunk route joins every pin its stubs land on; an obstacle-routed
  polyline joins its two ends. Matched to pins by coordinate, **pin-side endpoints only**.
- **repeated net labels** — when a net is too dense to draw (`labelledRouting`) or its trunk
  collides with a symbol, the renderer emits labelled stubs instead. Standard schematic
  convention: same text = same net. For those pins the text is the *entire* connectivity.

**SOLVER partition S** — two terminals are connected iff they share a resolved net.

"Equal" means R and S induce the same partition on VISIBLE.

- **SOUNDNESS** R-connected ⟹ S-connected. The artwork must never invent a connection.
- **COMPLETENESS** S-connected ⟹ R-connected.

### What "equal" means for the renderer's legitimate devices

| Device | Ruling |
|---|---|
| Repeated labels for **one** net | Correct — that *is* the convention. Not a divergence. |
| One label text across **two** nets | Divergence. A reader cannot tell them apart, so the artwork asserts a connection. Enforced as label injectivity. |
| Breadboard strips | Infrastructure; excluded on **both** sides. A strip is not a symbol, and its electrical effect is already in S. |
| Implicit ground | The projection may add a synthetic `__implicit_gnd__` with no solver counterpart. Excluded — a reference marker, not a claimed connection. |

**Stated conservatism.** Terminal keys are lowercased on both sides, because `findPinNet`
matches case-insensitively. Where a circuit has the case-split defect this makes S *coarser*
than the solver truly is. A coarser S can only suppress soundness findings, never invent one,
so the gate under-reports rather than false-alarms.

## Divergences found

### D1 — Net labels are not injective: the artwork shorted a power switch — FIXED

**Circuits:** `70-calculator`, `70-calculator-simple`. **Found by:** this gate. **Invisible to
the prior gate.**

`netName()` returns the literal text `VCC` for any net containing a vcc-ish terminal, and `GND`
for any ground-ish one. Those heuristics are not injective. A board with a power switch has two
such nets:

```
bb1:rail-t+   pico1:vbus, pwr:a, vcc1:vcc
bb1:n-col-b4  pico1:vsys, oled1:vcc, pwr:com, rpu_scl:a, rpu_sda:a, 17 keypad commons
```

Both were drawn as `VCC`. These two circuits are `labelledRouting` with **zero wires drawn** —
the label text is the whole schematic — so the rendered artwork joined `pwr:a` to `pwr:com`:
**it drew the power switch as a piece of wire**, along with `pico1:vbus ↔ pico1:vsys`. The whole
point of `pwr` is to separate those rails.

Two independent detectors agreed on the same two circuits: label injectivity, and geometric
soundness over the artwork.

**Fixed** in `schematic-projection.js` by making the label table injective — the first claimant
keeps the plain name, later ones take a suffix — so every circuit without a collision renders
byte-identically.

**Why the prior gate cannot see it.** `projectSchematic` sets `pin.netId = findPinNet(nets, …)`:
it *copies the solver's net id onto the pin*. Two pins share a projected net id iff they share a
solver net, so that gate's SOUNDNESS direction is very nearly a tautology — which is why it
reported 0 soundness errors across all 1,034 variants. The A/B test in the gate asserts this
blindness directly: the label-text mutation leaves every `pin.netId` untouched.

### D2 — One physical pin split across two nets: schematic drew the MCU driving nothing — FIXED

**Circuits:** 27 `circuit.stc15f2k60s2.json` variants. Independently reproduced here; matches
class 3 of the prior report, now with rendered-side evidence.

`seat.leadMap` spells STC pins uppercase (`P1.0`); `part.terminals` and the wires referencing
them are lowercase (`p1.0`). `_syncNetlist` built net keys from the literal spelling, so the
union-find saw two terminals and split one pin into two nets. In `01-blink`:

```
before   bb1:n-col-t11  MCU:P1.0                        <- breadboard column, stranded
         bb1:n-col-t34  LED_led1:cathode, MCU:p1.0
after    bb1:n-col-t11  LED_led1:cathode, MCU:p1.0      <- one pin, one net
```

The circuit still *solved* — the stray half was a singleton — which is exactly why this survived
so long. But `findPinNet` could resolve the schematic's `p1.0` to the empty half, and the
schematic then drew **the MCU pin disconnected from the LED it drives**. A learner reading it
sees a circuit that cannot work.

**Fixed** in `circuit.js`: every terminal is canonicalised to the part's declared spelling before
any net key is built. Corpus effect: completeness offenders **27 circuits / 82 pairs → 3 / 26**.

### D3 — Broken solver partition: one terminal in two nets — OPEN, not ours to fix here

**Circuits:** `pc84-led-herz`, `pc85-led-lampe-puls`, `pc88-lichtorgel`. Matches class 4 of the
prior report.

`vcc_1:vcc` is a member of two different resolved nets, violating the partition invariant. No
drawing can be faithful to both, so the artwork picks one and the gate sees the other as
undrawn (26 pairs). This is a defect on the **solver** side, in the net-merge path — not a
schematic bug. The gate names these three circuits individually in `KNOWN_BROKEN_PARTITION`
and additionally fails if a listed circuit stops diverging, so the allowlist cannot rot into a
blanket exemption.

## Coverage — asserted, not assumed

| Metric | Value |
|---|---|
| Variants discovered | 1,034 |
| Analysed | 1,034 |
| Errored / silently dropped | 0 |
| Rendered pairs actually compared | 24,376 across 1,033 circuits |
| Circuits with no drawn connectivity | 1 (nothing to compare) |

Coverage is enforced by tests, not claimed in prose: the accounting must balance
(`analysed + errored == discovered`), and an anti-vacuity test asserts the pair count — "0
failures" while comparing nothing is the most expensive kind of green.

**Cross-repo.** The corpus lives outside this repo. Per ROADMAP §5 a missing sibling **fails**
rather than skips. It resolves from `sb3-creator/examples` or lite's
`overlay/scratch-gui/examples`, verified byte-identical on 2026-08-23 (file-name list and
concatenated contents both hash equal across all 1,034). CI already clones sb3-creator, so the
gate runs there; cloning lite would cost ~1.1 GB.

## Mutation proofs

| Mutation | Expected | Actual |
|---|---|---|
| Drop a drawn wire from the artwork | COMPLETENESS red | red; restoring returns green |
| Merge two label texts | SOUNDNESS red + label collision | red; restoring returns green |
| A/B: same label mutation, netId-derived view | unchanged (blind) | unchanged — asserted |
| Instrument: one module instance, shared terminals | same | same |

### The rig was wrong first — and looked dramatic

The first corpus run reported **21 circuits inventing connections**. That was the instrument,
not the schematics. Pins were being resolved at the *trunk-side* stub endpoint, which sits in
free space, so any trunk merely passing through a pin's coordinate fabricated a connection —
the tell was that the "invented" pairs were adjacent DIP pins (`d26↔d27`, `p1.2↔p1.3`). Only
pin-side endpoints count now, and the number fell to the 2 real circuits, the same 2 the
independent injectivity check names. Recorded because ROADMAP's standing rule earned it: when a
result is dramatic, check the rig first.

## Required follow-up outside this repo

`brickwright-lite` **vendors two copies** of `schematic-projection.js` —
`overlay/scratch-gui/src/lib/bw-circuit-ui/model/` and `packages/scratch-gui/src/lib/…`. Both
still carry the pre-fix `netName(r, routeIndex)` at lines 374 and 405, so **lite currently ships
the shorted-power-switch schematic**. The D1 fix reaches users only after a vendor sync from
this SHA. Not done here: lite is a read-only reference mirror for this agent.

## What this gate does NOT cover

- **Part parameter fidelity** — whether the drawn resistance/voltage matches `part.params`.
- **Layout quality** — crossings and overlaps; that is `schematic-legibility.test.js`.
- **Terminal-to-artwork identity** — whether the pin drawn at (x,y) is the terminal it names.
  Connectivity is compared at the pin coordinates the projection reports; if a symbol's artwork
  mislabels a pin, both sides inherit the same error and agree.
- **SVG serialisation** — connectivity is taken from the geometry the renderer emits, one step
  before the SVG string.
