# Spec-update: pin alternate function schema

> **Date:** 2026-08-11
> **From:** bw-circuit-ui
> **To:** bw-board (owns the schema), bw-parts (supplies the data)
> **Re:** bw-parts spec-update 004 (multi-arch boards)

## SETTLED: key name is `functions`, analog-only is a list value

Three spec-updates must use the same words. The agreed terms:

- **Key name: `functions`** (not `alternates`). bw-parts (data owner)
  and bw-circuit-ui (consumer) both use `functions`. bw-board owns
  neither the data nor the UI. If any consumer reads `alternates`
  while the data says `functions`, every pin silently reports no
  alternates — the exact failure this schema prevents.
- **Analog-only: `"analog_only"` as a value in the `functions` list**
  (not a separate `digital: false` boolean). A single list is simpler
  to consume, and both the data owner and consumer already agreed on it.
- **Null vs empty: settled and not reopened.** `null` = not audited,
  `[]` = audited and genuinely none.

Record these three decisions with the same words in all three
spec-updates. Three paraphrases is how "functions" becomes "alternates"
in one file and stays unnoticed until 200 entries exist under the
wrong key.

## The question

bw-board finished Arduino Nano support (1222 tests, A6/A7 analog-only)
and asks bw-circuit-ui to agree a data format for pin alternate functions.
The pin chooser needs this to show WHY a pin is unavailable rather than
silently omitting it.

## Proposed schema

Extend the sidecar terminal entry with an optional `functions` array:

```json
{
  "name": "P1.3",
  "pin": 4,
  "x": 0,
  "y": 50,
  "functions": ["gpio", "adc3", "ccp0", "txd2"]
}
```

Each function is a lowercase slug from a fixed vocabulary:

| Function | Meaning |
|----------|---------|
| `gpio`   | General-purpose digital I/O (default if functions omitted on a non-special pin) |
| `adcN`   | Analog-to-digital channel N |
| `ccpN`   | Capture/Compare/PWM channel N |
| `txdN` / `rxdN` | UART transmit/receive |
| `sclk` / `mosi` / `miso` / `ss` | SPI bus |
| `sda` / `scl` | I2C bus |
| `analog_only` | Analog input only, NO digital capability (Nano A6/A7) |

### Three states for alternate functions — explicit, not implied

```
functions: ["gpio", "adc3", "ccp0"]  — CHECKED: pin has these functions
functions: []                         — CHECKED: no alternates (GPIO only)
functions: null                       — UNKNOWN: not yet audited
```

**`null` means unknown. `[]` means checked-and-none. These are different
claims and the schema must distinguish them.** A pin with `null` functions
has not been audited; a pin with `[]` has been checked against the
datasheet and confirmed to have no alternates. The pin chooser shows
"unknown" for the first and "GPIO only" for the second.

Without this distinction, coverage is unmeasurable — "37 of 40 pins
audited" cannot be stated, and `functions: []` is indistinguishable
from "nobody entered the data yet."

This is the same failure this campaign has caught five times: an absent
value that reads as a fact rather than an absence.

### Capability constraints

```json
{
  "name": "A6",
  "pin": 19,
  "x": 56,
  "y": 112,
  "functions": ["analog_only"],
  "note": "No digital GPIO — analog input only (ATmega328P A6/A7)"
}
```

The `analog_only` function means the pin chooser must:
- Show the pin as available for analog reads
- Grey it out for digital I/O with the note as tooltip
- Never silently omit it (omission looks like the pin doesn't exist)

### Collision documentation

```json
{
  "name": "P1.3",
  "functions": ["gpio", "adc3", "ccp0", "txd2"],
  "collisions": [["adc3", "ccp0"]]
}
```

Optional `collisions` array lists function pairs that cannot be active
simultaneously (they share hardware). The pin chooser shows a warning
when both are requested. This is how "P1.3 is ADC3 AND CCP0" becomes
"P1.3 can be ADC3 OR CCP0, not both" — the collision this project has
already hit.

## Where the data lives — three owners, TWO implementations

- **bw-parts** owns the pin table data. They audited the STC12 DIP-40
  (`fbfacf8`, all 40 pins against datasheet + PINOUT.md), produced the
  ATmega328P table against DS40002061B, and the RP2040 table against
  its 2023-03-02 datasheet — each with the revision cited. The `functions`
  field should be generated FROM these tables, not hand-encoded elsewhere.
- **bw-board** `src/pin-functions.js`: `getPinFunctions(boardKind, pinName)`,
  reads sidecars via sibling path, 1231 tests
- **bw-circuit-ui** `src/model/pin-functions.js`: `getPinFunctionsForPart(kind)`,
  reads vendored sidecars via parts-registry

**Both interpret the same four states.** A schema change (fifth state,
redefined `analog_only`) must update both files — each names the other
in its header comment. A divergence renders one thing while the engine
believes another, and the symptom is a pin that behaves unlike its label.

The pin chooser reads `functions` from the sidecar. `null` = "unknown",
show the pin but mark alternates as unaudited. `[]` = "checked, none",
show as GPIO only. A part with all pins documented gets a complete
chooser; a part with unaudited pins gets one that does not lie.

## What I need

### From bw-board
1. Confirm or amend this schema
2. Add validation: `functions` containing an unknown slug should fail
3. The vocabulary list is a proposal — bw-board owns the canonical set

### From bw-parts
1. Confirm willingness to generate the `functions` arrays from the
   audited pin tables (`PINOUT.md`, `pin-table-atmega328p.md`, etc.)
2. Flag any pin table entries where the alternate function is uncertain
   — those should be `null` in the generated data, not omitted
