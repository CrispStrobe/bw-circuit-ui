/**
 * Lazy loading of the vendored bw-parts art the canvas draws as part faces
 * (src/model/part-art.js ART_FACE_KINDS).
 *
 * Nothing here is fetched at first load. Each kind's SVG is a dynamic import
 * with a template path, which both bundlers split per file:
 *   - Vite (dynamic-import-vars) turns it into a lazy glob of
 *     ../parts-data/*.svg, one chunk or asset per file;
 *   - Webpack 5 (Lite) turns it into a lazy context over the same directory,
 *     one chunk per file. Lite's asset rule inlines SVGs under 8 KB as data
 *     URLs into the IMPORTING chunk, and with a dynamic import that chunk is
 *     the per-file lazy one, not Lite's first-load bundle.
 * A static `import x from '../parts-data/x.svg'` would put every inlined SVG
 * into the chunk that imports it, which in Lite is part of first load.
 *
 * The art is drawn through <image href>, so the URL (or data: URL) is all
 * the canvas needs; the art's own ids and styles stay inside it.
 *
 * @module
 */

/** art slug -> URL, once resolved */
const urls = new Map();
/** art slug -> pending Promise<string> */
const pending = new Map();
/** art slugs whose import failed (missing file): not retried */
const failed = new Set();
const listeners = new Set();

const SLUG = /^[a-z0-9_-]+(\.[a-z0-9_-]+)?$/; // kind, or kind.variant (variantArt)

/**
 * The URL of an art file (its name without `.svg`: the sidecar's kind, or a
 * variant's `kind.value`) if it has already loaded, else null. Callers name
 * the file; the sidecar a kind resolves to (getSidecar) says which.
 */
export function partArtUrl(slug) {
  return urls.get(slug) ?? null;
}

/**
 * Load a part kind's art. Resolves to its URL; concurrent calls share one
 * import, and a loaded kind resolves from the cache.
 * @param {string} slug
 * @returns {Promise<string|null>}
 */
export function loadPartArt(slug) {
  if (urls.has(slug)) return Promise.resolve(urls.get(slug));
  if (failed.has(slug) || !SLUG.test(slug)) return Promise.resolve(null);
  if (!pending.has(slug)) {
    const p = import(/* webpackChunkName: "part-art-[request]" */ `../parts-data/${slug}.svg`)
      .then(mod => {
        const url = typeof mod === 'string' ? mod : mod?.default;
        pending.delete(slug);
        if (typeof url !== 'string' || !url) { failed.add(slug); return null; }
        urls.set(slug, url);
        for (const fn of [...listeners]) fn(slug);
        return url;
      }, () => {
        pending.delete(slug);
        failed.add(slug);
        return null;
      });
    pending.set(slug, p);
  }
  return pending.get(slug);
}

/**
 * Call fn(slug) whenever a kind's art finishes loading.
 * @returns {() => void} unsubscribe
 */
export function onPartArtLoaded(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
