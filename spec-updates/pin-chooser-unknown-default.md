# Pin chooser UI default for unaudited pins

> **Date:** 2026-08-11
> **From:** bw-circuit-ui
> **For:** bw-parts (when they return at 05:50 UTC)

## The number

bw-parts `10b8105`: 866 terminals across 123 sidecars, 113 audited
(13%), 753 with `functions: null` (87% unknown). The schema is working
as designed — it tells the truth about how little is known.

## Decision: GPIO default + unaudited marker

A pin with unknown functions (`null`) is shown as a basic GPIO pin
with a subtle "?" indicator. The three states render as:

| `functions` value | Pin chooser shows | Marker |
|---|---|---|
| `null` | GPIO (assumed) | `?` — "not yet audited" tooltip |
| `[]` | GPIO only | none — confirmed, no alternates |
| `["gpio", "adc3", "ccp0"]` | GPIO · ADC3 · CCP0 | none — audited |
| `["analog_only"]` | Analog input only | greyed for digital, with reason |

### Why this option

- **Not "show unknown everywhere"** — 87% unknown makes the tool look
  broken to a first-time user, not incomplete.
- **Not "hide unknowns silently"** — indistinguishable from "no
  alternates", which is the conflation spec-update 007 exists to prevent.
- **GPIO default + marker** — keeps the chooser usable (every MCU pin
  can do at least GPIO), keeps the gap visible (the `?` says "we haven't
  checked this pin's alternates yet"), and preserves the null/[] distinction.

### Coverage reporting

Coverage is now countable: `terminals.filter(t => t.functions !== null)`.
The pin chooser can show "13% of pins audited" or log it, so progress
from 13% → 30% → 100% is a sentence this project can say.

## What this does NOT decide

- Which alternates vocabulary is canonical (bw-board's call)
- Whether the chooser auto-selects based on alternates (future work)
- The collision UI (P1.3 = ADC3 OR CCP0) — needs alternates data first
