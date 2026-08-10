/**
 * Sidecar loader — the missing consumer.
 *
 * parts-registry offered registerSidecar and NOTHING ever called it, so the
 * "bw-parts owns pin maps" ownership existed on paper while every runtime
 * quietly used the local fallback tables — the third
 * producer-with-no-consumer in this stack's history, and the reason the
 * standing rule says the producing side must assert its reader exists.
 *
 * All vendored sidecars (src/parts-data/, synced from bw-parts by
 * scripts/sync-parts-data.mjs) load eagerly at import time; the assertion
 * lives in the test suite: the STC12 DIP-40 map with pin 32 = P0.7 MUST be
 * present, or the suite goes red.
 *
 * @module
 */

import { registerSidecar } from './parts-registry.js';

const modules = import.meta.glob('../parts-data/*.json', { eager: true });

let count = 0;
for (const mod of Object.values(modules)) {
  const sidecar = mod.default ?? mod;
  if (sidecar && sidecar.kind) {
    registerSidecar(sidecar);
    count++;
  }
}

/** How many sidecars registered — consumers can sanity-check. */
export const SIDECAR_COUNT = count;
