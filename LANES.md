# Work lanes

Claims are effective only after this file is merged to the canonical remote branch. A
claim covers overlapping files and package surfaces, not merely a task title. If a
claim push races, the losing writer must reread this registry and abandon an occupied
lane rather than rebasing a duplicate claim. Existing claims require explicit takeover.

## ACTIVE

| lane | owner/session/worktree | base | scope and status |
|---|---|---|---|
| SPICE independent-current polarity contract | `/root/sol_lane_coordination` (Codex Sol), `/mnt/volume1/code/wt/bw-circuit-ui-vcvs-sol` | `4c21d28` | **CLAIM 2026-09-13.** Align positive SPICE `I` card flow (first node to second) with bw-board `isource` flow (`neg` to `pos`) at both import and export boundaries. Scope: `src/importers/spice.js`, `src/model/exporters/spice.js`, focused SPICE import/export tests, and this row only. Preserve positive source magnitude, topology, round-trip behavior, V-source semantics and engine code; add reversed-orientation numeric/KCL and negative regression evidence. |

## DONE

| lane | owner | result | evidence |
|---|---|---|---|
| KiCad legacy verified rescued resistors | `/root/schematic_corpus_import` (Codex Sol) | **DONE 2026-09-13.** `R-RESCUE-<project>` maps to a resistor only when its exact supplied library definition is exactly passive pins 1/2; the original libsource is retained. An extra-pin definition is refused, and no generic suffix or comparator mapping was added. | Self-authored positive/ambiguous-negative fixture and shipping CLI path; focused merged-head suites 107/107 pass. Both local PySpice legacy schematics now map 12/13 placements (three rescued resistors each), retain all 14/14 KiCad-exported SPICE topology partitions, and leave only LM193 explicitly unmapped. Import evidence only: 0 simulations and 0 numeric oracle comparisons. |
| KiCad legacy hidden-definition lookup | `/root/schematic_corpus_import` (Codex Sol) | **DONE 2026-09-13.** Cache-library lookup now accepts the format's exact leading-`~` hidden-symbol spelling only after exact-name lookup, restoring rescued power-symbol pin geometry without fuzzy symbol matching. | Self-authored connected-rail and near-name negative fixtures plus shipping `bwc info`; focused suites 74/74 pass. Both local PySpice KiCad legacy schematics match their independent KiCad-exported SPICE topology: 2/2 files, 14/14 multi-node partitions. This is import topology evidence only: 0 simulations, and unsupported comparator/rescued resistor mappings remain reported. |
| controlled-source terminal contract | `/root/sol_lane_coordination` (Codex Sol) | **DONE 2026-09-13.** Core `vcvs`/`vccs` parts now retain bw-board's `outp/outn/inp/inn` contract through SPICE import and `Circuit.fromJSON`; stale `a/b` input remains a loud rejection. No solver or importer-card mapping changed. | Focused Node suite: 105/105 pass. The reviewed private PhyChip case now reaches all three finite comparisons on clean bw-board `838492f`; two agree and the resistor-current observable exposes a separate sign-orientation manifest correction. |
