/**
 * Sidecar loader — the missing consumer, bundler-agnostic edition.
 *
 * v1 used import.meta.glob: a vite-ism. It worked in the dev harness and
 * quietly depended on downstream vendoring to survive webpack (lite's
 * bundler). The sync script now GENERATES src/parts-data/index.js with
 * plain static imports, and this module consumes it — vite, webpack,
 * esbuild and every future bundler resolve static imports identically.
 * Node tests keep reading the same directory via fs (JSON import
 * attributes differ across node versions; the data is identical).
 *
 * @module
 */

import { registerSidecar } from './parts-registry.js';
import { SIDECARS } from '../parts-data/index.js';

let count = 0;
for (const sidecar of SIDECARS) {
  const sc = sidecar && sidecar.default ? sidecar.default : sidecar;
  if (sc && sc.kind) {
    registerSidecar(sc);
    count++;
  }
}

/** How many sidecars registered — consumers can sanity-check. */
export const SIDECAR_COUNT = count;
