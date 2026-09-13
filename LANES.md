# Work lanes

Claims are effective only after this file is merged to the canonical remote branch. A
claim covers overlapping files and package surfaces, not merely a task title. If a
claim push races, the losing writer must reread this registry and abandon an occupied
lane rather than rebasing a duplicate claim. Existing claims require explicit takeover.

## ACTIVE

| lane | owner/session/worktree | base | scope and status |
|---|---|---|---|
| KiCad legacy verified rescued resistors | `/root/schematic_corpus_import` (Codex Sol), `/tmp/cui-kicad-assess.Ht5oOH` | `a14e35a` | **CLAIMED 2026-09-13.** Resolve only `R-RESCUE-<project>` legacy symbols when their exact supplied cache-library definition proves a two-pin passive 1/2 pinout; preserve source identity and add self-authored positive/ambiguous-negative plus shipping CLI checks. No generic suffix stripping, comparator/opamp approximation, modern KiCad work, circuit/solver/MNA paths, corpus index/schema, or numeric-oracle claims. |

## DONE

| lane | owner | result | evidence |
|---|---|---|---|
| KiCad legacy hidden-definition lookup | `/root/schematic_corpus_import` (Codex Sol) | **DONE 2026-09-13.** Cache-library lookup now accepts the format's exact leading-`~` hidden-symbol spelling only after exact-name lookup, restoring rescued power-symbol pin geometry without fuzzy symbol matching. | Self-authored connected-rail and near-name negative fixtures plus shipping `bwc info`; focused suites 74/74 pass. Both local PySpice KiCad legacy schematics match their independent KiCad-exported SPICE topology: 2/2 files, 14/14 multi-node partitions. This is import topology evidence only: 0 simulations, and unsupported comparator/rescued resistor mappings remain reported. |
| controlled-source terminal contract | `/root/sol_lane_coordination` (Codex Sol) | **DONE 2026-09-13.** Core `vcvs`/`vccs` parts now retain bw-board's `outp/outn/inp/inn` contract through SPICE import and `Circuit.fromJSON`; stale `a/b` input remains a loud rejection. No solver or importer-card mapping changed. | Focused Node suite: 105/105 pass. The reviewed private PhyChip case now reaches all three finite comparisons on clean bw-board `838492f`; two agree and the resistor-current observable exposes a separate sign-orientation manifest correction. |
