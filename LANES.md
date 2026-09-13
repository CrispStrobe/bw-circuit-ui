# Work lanes

Claims are effective only after this file is merged to the canonical remote branch. A
claim covers overlapping files and package surfaces, not merely a task title. If a
claim push races, the losing writer must reread this registry and abandon an occupied
lane rather than rebasing a duplicate claim. Existing claims require explicit takeover.

## ACTIVE

| lane | owner/session/worktree | base | scope and status |
|---|---|---|---|
| controlled-source terminal contract | `/root/sol_lane_coordination` (Codex Sol), `/mnt/volume1/code/wt/bw-circuit-ui-vcvs-sol` | `1b96669` | **CLAIMED 2026-09-13.** Repair only VCVS/VCCS terminal resolution through the existing part authority for `SPICE import -> Circuit.fromJSON -> bw-board`; add focused positive/negative tests and rerun the private PhyChip fixture. No solver equations, parts defaults, exporter sweep, schematic-format work, or arbitrary model expansion. |

## DONE

| lane | owner | result | evidence |
|---|---|---|---|
| KiCad legacy hidden-definition lookup | `/root/schematic_corpus_import` (Codex Sol) | **DONE 2026-09-13.** Cache-library lookup now accepts the format's exact leading-`~` hidden-symbol spelling only after exact-name lookup, restoring rescued power-symbol pin geometry without fuzzy symbol matching. | Self-authored connected-rail and near-name negative fixtures plus shipping `bwc info`; focused suites 74/74 pass. Both local PySpice KiCad legacy schematics match their independent KiCad-exported SPICE topology: 2/2 files, 14/14 multi-node partitions. This is import topology evidence only: 0 simulations, and unsupported comparator/rescued resistor mappings remain reported. |
