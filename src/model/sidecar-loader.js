/**
 * Sidecar loader (vite build/dev entry) — the missing consumer.
 *
 * import.meta.glob is a vite-ism: node's runtime cannot even PARSE it, so
 * this module must only ever be imported from bundler-served entries
 * (src/main.jsx here; lite's circuit tab there). Tests and node tools load
 * the same vendored directory through the fs path in
 * test/sidecar-loading.test.js — same data, same assertions.
 *
 * History: parts-registry offered registerSidecar and nothing called it —
 * the third producer-with-no-consumer in this stack. The first fix then
 * repeated the mistake's mirror image by putting a vite-only construct in
 * engine.js, which every node test imports: 37 red tests. Runtime-agnostic
 * modules stay runtime-agnostic.
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
