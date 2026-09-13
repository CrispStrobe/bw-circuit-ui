# Work lanes

Claims are effective only after this file is merged to the canonical remote branch. A
claim covers overlapping files and package surfaces, not merely a task title. If a
claim push races, the losing writer must reread this registry and abandon an occupied
lane rather than rebasing a duplicate claim. Existing claims require explicit takeover.

## ACTIVE

| lane | owner/session/worktree | base | scope and status |
|---|---|---|---|
| KiCad legacy hidden-definition lookup | `/root/schematic_corpus_import` (Codex Sol), `/tmp/cui-kicad-assess.Ht5oOH` | `a75ad7a` | **CLAIMED 2026-09-13.** Repair only KiCad legacy cache-library lookup where `DEF ~NAME` is referenced as `NAME`; add a self-authored positive/negative connectivity fixture and shipping `bwc info` reachability check. No modern KiCad hierarchy/buses, symbol-vocabulary expansion, circuit/solver/MNA paths, corpus index/schema, or oracle-sweep work. |

## DONE

| lane | owner | result | evidence |
|---|---|---|---|
| controlled-source terminal contract | `/root/sol_lane_coordination` (Codex Sol) | **DONE 2026-09-13.** Core `vcvs`/`vccs` parts now retain bw-board's `outp/outn/inp/inn` contract through SPICE import and `Circuit.fromJSON`; stale `a/b` input remains a loud rejection. No solver or importer-card mapping changed. | Focused Node suite: 105/105 pass. The reviewed private PhyChip case now reaches all three finite comparisons on clean bw-board `838492f`; two agree and the resistor-current observable exposes a separate sign-orientation manifest correction. |
