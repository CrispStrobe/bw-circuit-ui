# Electrical correspondence gate — divergence report

**Date:** 2026-08-22  
**Branch:** `electrical-correspondence`  
**SHA:** `367e716`  
**Corpus:** 1,034 circuit variants from `brickwright-lite/overlay/scratch-gui/examples/`

## Summary

The gate asserts that the schematic projection's connectivity matches the solver's
connectivity across every circuit variant in the corpus. Two properties are checked:

| Property | Result | Meaning |
|---|---|---|
| **SOUNDNESS** | **0 failures** | The schematic never invents connections the solver doesn't have |
| **COMPLETENESS** | **0 unexplained** | Every divergence is classified into a documented gap category |

### Coverage

| Metric | Value |
|---|---|
| Total variants | 1,034 |
| Strict pass (identical connectivity) | 816 (78.9%) |
| Known-gap only (classified divergence) | 218 (21.1%) |
| Unexplained divergence | 0 |
| Skipped | 0 |
| **Coverage** | **100.0%** |

## Documented divergences

Each is a genuine bug. None are waved away — they are classified, counted, and tracked.

### 1. Undeclared-terminal gap — 1,091 pairs across 175+ circuits

**What:** The schematic projection draws only terminals listed in `part.terminals`. The
solver's nets include additional terminals from breadboard `seat.leadMap` entries and wire
endpoints that aren't in `part.terminals`. Power, ground, and unused GPIO pins are
electrically real in the solver but invisible in the schematic.

**Example:** An `arduino_nano` with `terminals: ["d13"]` is seated on a breadboard with a
30-pin `leadMap`. The solver creates nets for all 30 seated pins (gnd, 5v, a0–a7, d0–d12,
etc.), but the schematic only shows the one declared pin.

**Impact:** Schematic users see only the program-driven pins, not the physical power/ground
connections through the breadboard. A learner looking at the schematic cannot see how the
MCU gets power.

**Root cause:** `part.terminals` is populated from program declarations (the `PIN` directives),
not from the physical pin count. `Circuit.fromJSON` preserves the circuit file's terminal
list verbatim.

**Fix:** Expand `part.terminals` from `seat.leadMap` on load, so all physically connected pins
are declared and visible to the projection. This is a `Circuit.fromJSON` change.

### 2. Implicit-GND representation — 64 pairs

**What:** When no explicit GND post exists, `projectSchematic` adds a synthetic
`__implicit_gnd__` symbol to represent the ground reference (the vsource's neg terminal).
This symbol appears in the schematic's connectivity but not the solver's, creating a
representation-level mismatch.

**Impact:** Cosmetic only. The implicit GND is correct behavior — it makes the ground
reference visible. The gate classifies this and does not count it as a failure.

### 3. Case-mismatch split nets — 197 pairs across 27 STC15F2K60S2 circuits

**What:** `seat.leadMap` uses uppercase terminal names (`P1.0`, `P3.2`), while
`part.terminals` uses lowercase (`p1.0`, `p3.2`). The union-find in `_syncNetlist`
treats these as different terminals, creating two separate nets for one physical pin.

**Example:** For `MCU` with `terminals: ["p1.0"]` seated with `leadMap: {P1.0: "t11", ...}`:
- Net `n-col-t11` contains `MCU:P1.0` (from the breadboard strip)
- Net `n-col-t34` contains `MCU:p1.0` (from a wire endpoint) and `LED:cathode`

These SHOULD be one net. The schematic projection's case-insensitive `findPinNet` picks
one of the two, so the MCU pin appears connected to the breadboard column but not to the
LED — the opposite of what the user wired.

**Impact:** The schematic shows a broken circuit for 27 STC15F2K60S2 variants. The MCU's
signal pins appear disconnected from the components they drive.

**Root cause:** `_syncNetlist` builds net keys from terminal names without case normalization.
The breadboard strip resolver uses the `leadMap`'s case; the wire resolver uses the wire's
case. When they differ, the union-find fails to merge them.

**Fix:** Normalize terminal case in `_syncNetlist`'s net-key construction (the `tKey`
function at the `netMap` level). This is a `circuit.js` change.

### 4. Multi-net terminal — 141 pairs across 3 pc-series circuits

**What:** The same terminal (e.g., `vcc_1:vcc`) appears as a member of two different solver
nets. This violates the partition invariant — a terminal should belong to exactly one net.

**Affected circuits:**
- `pc84-led-herz/circuit.json` — `vcc_1:vcc` in both `net_5` and `net_8`
- `pc85-led-lampe-puls/circuit.json` — `vcc_1:vcc` in both `net_6` and `net_5`
- `pc88-lichtorgel/circuit.json` — `vcc_1:vcc` in both `net_12` and `net_5`

**Impact:** The solver has a contradictory view of the circuit. In pc84, `net_8` contains
both VCC and GND terminals — an effective short circuit. The schematic picks one net for
each terminal and shows a plausible-looking but incorrect circuit.

**Root cause:** The `mergeNets` union-find or `_syncNetlist` wire/strip merge fails to fully
unify these nets. The exact path needs investigation per circuit.

**Fix:** Audit the net-merge path for these three circuits. Likely a missing union step
when tap wires bridge strip nets.

## Mutation proofs

| Mutation | Expected | Actual |
|---|---|---|
| Drop a wire from solver nets | Completeness RED | RED |
| Add a spurious net to projection | Soundness RED | RED |
| Registry parity check | Both sides same | Same |

The registry parity check guards against the false-blast-radius trap documented in
`ROADMAP.md` §Working rules: a comparison where one side has an uninitialised device
registry produces a dramatic but fictional result.

## What this gate does NOT cover

This gate checks **connectivity** (which terminals are in the same net). It does not check:

- **Part parameter fidelity** — whether the schematic shows the correct resistance, capacitance,
  or voltage values (those come from `part.params`, not from the netlist).
- **Layout quality** — whether wires cross symbols, symbols overlap, or the schematic is readable
  (that is the legibility gate in `schematic-legibility.test.js`).
- **Terminal identity** — whether a pin drawn at position (x,y) in the SVG artwork corresponds
  to the terminal name it claims (that would require validating the symbol geometry).
