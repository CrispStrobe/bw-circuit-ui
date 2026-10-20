# Seated wire names on the first load

An accepted seat can complete an empty or partial stored terminal list. The
loader now finishes that physical seat decision before resolving saved wire
terminal aliases and grouping legacy wires without net IDs. It uses the same
unique-match alias resolver, with no global uppercase conversion.

This makes the first save use the final accepted terminal names. Repeating a
load/save no longer changes only the wire endpoint's case. Wire order, supplied
IDs/net IDs, unknown names, ambiguous aliases and breadboard-hole endpoints keep
their existing contracts. A rejected seat adds no terminal authority. Existing
physical-package/seat migrations, stored terminal order and the host's
`stc_mcu` passthrough remain unchanged.

The new regression module retains exact public supplier input fixtures from
`CrispStrobe/sb3-creator` commit `5a3977fb6333cf690f675ee1b5a7a3492f5195a8`.
Source URLs, SHA-256 hashes and their MPL-2.0 licence accompany the unmodified
JSON copies under `test/fixtures/seated-wire-supplier5a/`. The supplier gallery
is not rewritten. Each original case checks the first canonical endpoints,
complete save/load fixed point, input immutability, part/wire order and supplied
wire metadata. Additional controls cover mixed-case endpoints sharing a legacy
net, distinct pins remaining separate, real resolved nets, stored declarations,
unknown/ambiguous endpoints, holes and rejected seats.

The seven complete affected test modules pass all 42 tests with zero skips or
TODOs. Running those same controls against the exact original loader produces
36 passes and six failures: all four retained gallery cases plus the two new
seat/legacy-net positive controls. Enabled hosted checks, followed by explicit
downstream pin adoption and fresh comparison, remain required before closure. These load/save controls do not execute
firmware or independently qualify electrical values.
