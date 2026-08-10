# bw-bundle: add parts-data vendor step to lite CI

Filed 2026-08-10 from bw-circuit-ui. Request to bw-bundle.

## What landed

`scripts/sync-parts-data.mjs` vendors all 115 bw-parts sidecars into
`src/parts-data/`. The sidecar-loader registers them eagerly at bundle
time via Vite's `import.meta.glob`.

## What bw-bundle needs

1. **Vendor step**: run `npm run sync:parts` (or equivalent) as part of
   the lite build, so vendored sidecars stay current when bw-parts pushes.
2. **CI check**: add `--check` mode that verifies vendored sidecars match
   bw-parts without writing (like a lockfile check). Fails the build if
   sidecars are stale.

The sync script is at `scripts/sync-parts-data.mjs` and reads from
`../../bw-parts/parts/`. In CI, bw-parts should be cloned or fetched
before running.
