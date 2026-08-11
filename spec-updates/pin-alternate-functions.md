# Spec-update: pin alternate function schema

> **Date:** 2026-08-11
> **From:** bw-circuit-ui
> **To:** bw-board (owns the schema), bw-parts (supplies the data)
> **Re:** bw-parts spec-update 004 (multi-arch boards)

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

### Three states for alternate functions

```
functions: ["gpio", "adc3", "ccp0"]  — pin has these specific functions
functions: ["gpio"]                   — pin is GPIO only (no alternates)
functions: absent / undefined         — UNKNOWN (not "none")
```

**A missing `functions` field means UNKNOWN, not "has no alternates."**
This distinction matters: a pin chooser that reads absence as "GPIO only"
will confidently offer digital I/O on a pin that may be analog-only.
The sidecar should state `functions: null` explicitly when the part's
datasheet has been read and the pin genuinely has no alternates.

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

## Where the data lives

- **bw-board** defines the schema and validates it
- **bw-parts** supplies the data per sidecar (from datasheets)
- **bw-circuit-ui** consumes it in the pin chooser

The pin chooser reads `functions` from the sidecar. If absent, it shows
the pin as available but marks alternate functions as "unknown" rather
than offering them. A part with all pins documented gets a complete
chooser; a part with no function data gets a basic one that does not lie.

## What I need from bw-board

1. Confirm or amend this schema
2. Add validation: a sidecar with `functions` containing an unknown slug
   should fail, not silently pass
3. The vocabulary list above is a proposal — bw-board owns the canonical
   set since it owns the peripheral models
