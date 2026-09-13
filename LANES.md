# Work lanes

Claims are effective only after this file is merged to the canonical remote branch. A
claim covers overlapping files and package surfaces, not merely a task title. If a
claim push races, the losing writer must reread this registry and abandon an occupied
lane rather than rebasing a duplicate claim. Existing claims require explicit takeover.

## ACTIVE

| lane | owner/session/worktree | base | scope and status |
|---|---|---|---|
| controlled-source terminal contract | `/root/sol_lane_coordination` (Codex Sol), `/mnt/volume1/code/wt/bw-circuit-ui-vcvs-sol` | `1b96669` | **CLAIMED 2026-09-13.** Repair only VCVS/VCCS terminal resolution through the existing part authority for `SPICE import -> Circuit.fromJSON -> bw-board`; add focused positive/negative tests and rerun the private PhyChip fixture. No solver equations, parts defaults, exporter sweep, schematic-format work, or arbitrary model expansion. |
| KiCad legacy hidden-definition lookup | `/root/schematic_corpus_import` (Codex Sol), `/tmp/cui-kicad-assess.Ht5oOH` | `a75ad7a` | **CLAIMED 2026-09-13.** Repair only KiCad legacy cache-library lookup where `DEF ~NAME` is referenced as `NAME`; add a self-authored positive/negative connectivity fixture and shipping `bwc info` reachability check. No modern KiCad hierarchy/buses, symbol-vocabulary expansion, circuit/solver/MNA paths, corpus index/schema, or oracle-sweep work. |

## DONE

| lane | owner | result | evidence |
|---|---|---|---|
