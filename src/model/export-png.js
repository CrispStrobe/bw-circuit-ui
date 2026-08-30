/**
 * PNG export — rasterise an SVG (a live element, or a self-contained string)
 * to a downloadable PNG image.
 *
 * Browser-only: it needs Canvas 2D, Image and Blob.
 *
 * TWO THINGS THIS FILE USED TO GET WRONG, both fixed for X0.4:
 *
 * 1. **The style inlining its own comment promised did not happen.** The loop
 *    over `svgClone.querySelectorAll('*')` only cleared `pointerEvents`. That
 *    matters because a rasterised SVG is loaded through `new Image()` from a
 *    blob URL, and a document loaded that way sees NONE of the page's
 *    stylesheets: anything whose colour, stroke or font came from a CSS rule
 *    rasterises as the SVG default — black fill, no stroke, browser font. The
 *    presentation properties are now copied from `getComputedStyle` of the
 *    LIVE element onto the clone, which is the only place they still exist.
 * 2. **The background was hardcoded to `#16213e`.** A light-theme export came
 *    back on a dark slab. The fill now comes from the element's own computed
 *    background, and a caller may name one explicitly.
 *
 * @module
 */

/**
 * SVG presentation properties that survive as an attribute-or-inline-style and
 * that a stylesheet can supply. Copied from the live element's computed style
 * onto the clone, because the clone is about to be read with no stylesheets.
 */
const PRESENTATION_PROPS = [
  'fill', 'fill-opacity', 'fill-rule',
  'stroke', 'stroke-width', 'stroke-opacity', 'stroke-linecap',
  'stroke-linejoin', 'stroke-dasharray', 'stroke-dashoffset',
  'opacity', 'visibility', 'display',
  'font-family', 'font-size', 'font-weight', 'font-style',
  'text-anchor', 'dominant-baseline', 'letter-spacing',
];

/** The theme background behind an SVG, walking up until something paints. */
function computedBackground(el) {
  if (typeof getComputedStyle !== 'function') return null;
  for (let node = el; node && node.nodeType === 1; node = node.parentElement) {
    const bg = getComputedStyle(node).backgroundColor;
    if (bg && bg !== 'transparent' && !/^rgba\(0,\s*0,\s*0,\s*0\)$/.test(bg)) return bg;
  }
  return null;
}

/**
 * Rasterise a self-contained SVG STRING to a PNG blob.
 *
 * This is the entry point for documents that were never in the DOM — the
 * headless schematic renderer produces one — so there is nothing to inline and
 * nothing to compute: what the string says is what gets drawn.
 *
 * @param {string} svgString — a complete `<svg …>…</svg>` document
 * @param {{scale?: number, background?: string|null, width?: number, height?: number}} [opts]
 * @returns {Promise<Blob>}
 */
export async function svgStringToPngBlob(svgString, opts = {}) {
  const { scale = 2, background = null } = opts;
  let { width, height } = opts;
  if (!(width > 0) || !(height > 0)) {
    const vb = /viewBox\s*=\s*"([^"]+)"/.exec(svgString);
    if (vb) {
      const n = vb[1].trim().split(/[\s,]+/).map(Number);
      width = n[2];
      height = n[3];
    }
  }
  if (!(width > 0) || !(height > 0)) {
    width = Number(/\bwidth\s*=\s*"(\d+(?:\.\d+)?)"/.exec(svgString)?.[1]) || 700;
    height = Number(/\bheight\s*=\s*"(\d+(?:\.\d+)?)"/.exec(svgString)?.[1]) || 500;
  }

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  // A named background, or none: an SVG that paints its own (the schematic
  // document does) must not be re-floored with somebody else's colour.
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);
  }

  const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(svgBlob);
  const img = new Image();
  return new Promise((resolve, reject) => {
    img.onload = () => {
      ctx.drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(url);
      canvas.toBlob((blob) => {
        if (!blob) { reject(new Error('Failed to create PNG blob')); return; }
        resolve(blob);
      }, 'image/png');
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to render SVG to image'));
    };
    img.src = url;
  });
}

/**
 * Serialize a LIVE SVG element into a string that stands on its own.
 *
 * Exported so a test can read what an export would contain without a canvas.
 *
 * @param {SVGElement} svgElement
 * @returns {string}
 */
export function serializeSvgStandalone(svgElement) {
  const clone = svgElement.cloneNode(true);
  const live = [svgElement, ...svgElement.querySelectorAll('*')];
  const copy = [clone, ...clone.querySelectorAll('*')];
  const canCompute = typeof getComputedStyle === 'function';
  for (let i = 0; i < copy.length; i++) {
    const el = copy[i];
    if (el.style) el.style.pointerEvents = '';
    if (!canCompute || !live[i]) continue;
    const cs = getComputedStyle(live[i]);
    for (const prop of PRESENTATION_PROPS) {
      const v = cs.getPropertyValue(prop);
      // Only what the element actually resolves to, and only onto elements
      // that can carry it: `setProperty` on a value of '' is a no-op that
      // would otherwise leave the CSS-supplied paint behind.
      if (v && el.style) el.style.setProperty(prop, v);
    }
  }
  if (!clone.getAttribute('xmlns')) clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  return new XMLSerializer().serializeToString(clone);
}

/**
 * Render an SVG element to a PNG Blob.
 *
 * Split out of exportSvgAsPng so the export registry has ONE download path
 * (download.js) rather than one writer that downloads itself and six that
 * hand back bytes.
 *
 * @param {SVGElement} svgElement — the canvas SVG
 * @param {number} [scale=2] — resolution multiplier (2 = retina)
 * @param {{background?: string}} [opts]
 * @returns {Promise<Blob>}
 */
export async function svgToPngBlob(svgElement, scale = 2, opts = {}) {
  const svgString = serializeSvgStandalone(svgElement);

  const viewBox = svgElement.getAttribute('viewBox');
  let w, h;
  if (viewBox) {
    const parts = viewBox.split(/[\s,]+/).map(Number);
    w = parts[2];
    h = parts[3];
  } else {
    w = svgElement.clientWidth || 700;
    h = svgElement.clientHeight || 500;
  }

  return svgStringToPngBlob(svgString, {
    scale, width: w, height: h,
    // The theme's background, not a constant. `#16213e` was the app's dark
    // slab and it painted itself under every light-theme export too.
    background: opts.background ?? computedBackground(svgElement) ?? '#16213e',
  });
}

/**
 * Render an SVG element to PNG and download it.
 *
 * @param {SVGElement} svgElement — the canvas SVG
 * @param {string} [filename='circuit.png']
 * @param {number} [scale=2] — resolution multiplier (2 = retina)
 * @returns {Promise<void>}
 */
export async function exportSvgAsPng(svgElement, filename = 'circuit.png', scale = 2) {
  const blob = await svgToPngBlob(svgElement, scale);
  const { downloadBlob } = await import('./exporters/download.js');
  downloadBlob(blob, filename);
}
