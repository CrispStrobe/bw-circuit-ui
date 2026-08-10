# Verification ledger audit — independent check by bw-circuit-ui

Audited 2026-08-10 against `stc/docs/VERIFICATION-LEDGER.md` (`7270576`).
I did not write the ledger; this is the first independent check.

## Denominator

The ledger has three tables:
- **Cross-model measurements**: 15 rows (enumerated by manual read of the
  Markdown table, counting `|` rows between the header and the next `##`)
- **Defects found and fixed**: 11 rows (same method)
- **Bench questions**: 4 rows (same method)

Rows checked: **15** measurement rows (all), **11** defect rows (all),
**4** bench rows (read, not independently verified — they are plans, not claims).

Sections not treated as claims: the introductory paragraph and the closing
"The principle" section are prose, not tabular claims. No rows exist outside
the three tables.

Enumeration method: manual read of the rendered Markdown. A claim phrased
as a sentence outside a table would be invisible to this method.

## Methodology

For each row: checked the cited commit exists in the named repo, checked
the number matches, checked the category against EVIDENCE-CATEGORIES.md,
and checked for findings this campaign produced that the ledger omits.

## Numerical claims: all checked, all match

| Claim | Ledger says | Commit says | Match? |
|-------|-------------|-------------|--------|
| Servo 90° | emu: 1500.0 µs, ucsim: 1499.6 µs | `c02fa9f`: "1500.0 µs … ucsim independently measured 1499.6" | ✓ |
| Servo 0°/180° | 499.2 / 2500.6 µs | `c02fa9f`: same numbers | ✓ |
| Servo period | 20003.5 µs = 50.0 Hz | `c02fa9f`: same | ✓ |
| LED brightness | 0.07248 vs 0.07246 (0.03%) | `76943ba`: "0.07248 measured vs 0.07246 predicted = 0.03%" | ✓ |
| 555 astable | 214 ms vs 207.9 ms (3%) | `49435b9`: "214ms vs 207.9ms = ratio 1.03" | ✓ |
| PCA ISR defect | `4f14c35` | "add servo end-to-end test: real compiled hex through emu8051" | ✓ |
| ECCF contract | `e9a3f02` in stc | "PERIPHERAL-MODEL: there is no IE.EC on this part" | ✓ |

## Discrepancy 1: LED brightness category

**Ledger says: 2b.** EVIDENCE-CATEGORIES.md lists the LED brightness
cross-check as a **Cat 1 example**: "emu8051's PCA model (C) → adapter →
bw-board's brightness integrator (JS). Found the adapter time-zero bug."

The ledger's 2b is more honest — both sides were corrected in this campaign,
the adapter bug was found between them, and the same people wrote both. But
the categories document and the ledger disagree on which category it is.

**Resolution needed:** one of the two documents should change. The ledger's
2b with the note "found the adapter time-zero bug" is the stronger claim
because it explains WHY the cross-check was useful rather than just that it
agreed. The categories doc should either demote its example or the ledger
should promote the row — either way, they should match.

## Discrepancy 2: Motor duty — counts vs pin measurement

The ledger says "84/128/192 of 256 counts. Period 277561 ns unchanged."
ucsim's measurement (`dafbaf9`) says "33% -> 32.83%, 50% -> 50.05%,
75% -> 75.07%". The count ratios (84/256 = 32.8%) and pin measurements
(32.83%) differ slightly because pin measurement includes edge timing.
The ledger records the register value, not the pin measurement.

**Not wrong, but the distinction matters:** the ledger makes a claim about
counts, the measurement is about pin voltage. A table that collapses them
loses the ISR-dispatch latency that makes 32.8% become 32.83%.

## Discrepancy 3: Missing findings

The coordinator's audit request named these findings. Four are NOT in the
defects table:

| Finding | In ledger? | Where it lives |
|---------|-----------|----------------|
| Dead PCA ISR (IE=0x00) | ✓ | defects table |
| IE.6/ELVD trap | ✓ | defects table |
| L293D pinout scramble | ✓ | defects table |
| PSEN/ALE/EA on MCU sidecar | ✓ | defects table |
| §4.6 citation fabricated | ✓ | defects table |
| `aggregateCurrent()` in test only | ✓ | defects table |
| **CL-wrap bug** | **✗** | — |
| **4.7 µs trigger** | **✗** | — |
| **NeoPixel driver sent all zeros** | **✗** | — |
| **ADC ROADMAP "proven on hardware"** | **✗** | `b4f4bb1` in stc |

The ledger records 11 defects. At least 4 more were found this campaign
and not recorded. The ledger's own principle says: "A ledger of successes
is an advertisement. A ledger that includes what nearly shipped is a record."
By its own standard, 4 omissions make it less complete than it claims.

## Discrepancy 4: NeoPixel row missing entirely

The coordinator says "The NeoPixel is 3 and stays 3." The ledger has NO
row for NeoPixel in the measurements table. If it's category 3 (single-
implementation assertion, weakest), it should be listed as such — an
absent row and a category-3 row say different things.

## What is NOT wrong

- Every cited commit exists in the expected repo
- Every numerical claim matches its commit
- The bench questions table correctly maps rows to measurements
- The defects that ARE listed carry correct "how it presented" and
  "what found it" columns
- The principle statement is honest

## Summary

15 measurement rows checked, 11 defect rows checked, 4 bench rows read.
All 15 numerical claims match their cited commits. The categories have
one disagreement between two documents. Four findings are missing from
the defects table (11 recorded, ≥15 produced). One measurement (NeoPixel)
is missing entirely. The motor duty conflates register counts with pin
measurements.

The auditor was right: nobody re-checks the auditor, and the check found
real gaps — not in the numbers, but in the completeness of what is recorded.

A control only proves the method works on the population you actually
looked at. This audit's population is the three Markdown tables;
a claim phrased outside them would not have been found.
