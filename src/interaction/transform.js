/**
 * The canvas viewport transform — THE single source of truth for
 * screen ⇄ world coordinate math.
 *
 * Every interaction bug class this repo has seen traces to coordinate math
 * scattered across handlers (a zoom applied in one place and forgotten in
 * another). This module owns it all: pan, zoom-to-point, and the two
 * conversions. Pure data, no DOM, fully unit-tested.
 *
 * Conventions:
 *  - "world" is model space: part x/y, hole positions, wire endpoints.
 *  - "screen" is CSS pixels relative to the canvas element's top-left.
 *  - screen = (world − pan) · zoom      world = screen / zoom + pan
 *
 * @module
 */

export class ViewTransform {
  constructor({ zoom = 1, panX = 0, panY = 0, minZoom = 0.3, maxZoom = 3 } = {}) {
    this.zoom = zoom;
    this.panX = panX;
    this.panY = panY;
    this.minZoom = minZoom;
    this.maxZoom = maxZoom;
  }

  /** @param {number} sx @param {number} sy @returns {{x: number, y: number}} */
  toWorld(sx, sy) {
    return { x: sx / this.zoom + this.panX, y: sy / this.zoom + this.panY };
  }

  /** @param {number} wx @param {number} wy @returns {{x: number, y: number}} */
  toScreen(wx, wy) {
    return { x: (wx - this.panX) * this.zoom, y: (wy - this.panY) * this.zoom };
  }

  /** A screen-pixel distance expressed in world units (for hit radii). */
  worldDistance(screenPx) {
    return screenPx / this.zoom;
  }

  /** Pan by a SCREEN-pixel delta (what a trackpad two-finger scroll gives). */
  panByScreen(dx, dy) {
    this.panX += dx / this.zoom;
    this.panY += dy / this.zoom;
  }

  /**
   * Zoom by a factor keeping the world point under the given SCREEN point
   * stationary — cursor-anchored zoom, the only kind that feels right.
   */
  zoomAt(sx, sy, factor) {
    const before = this.toWorld(sx, sy);
    this.zoom = Math.min(this.maxZoom, Math.max(this.minZoom, this.zoom * factor));
    const after = this.toWorld(sx, sy);
    this.panX += before.x - after.x;
    this.panY += before.y - after.y;
  }

  /** Fit a world-space bounding box into a screen-space viewport, centered. */
  fit(bounds, viewportW, viewportH, margin = 40) {
    const w = Math.max(bounds.maxX - bounds.minX, 1);
    const h = Math.max(bounds.maxY - bounds.minY, 1);
    this.zoom = Math.min(this.maxZoom, Math.max(this.minZoom, Math.min(
      (viewportW - 2 * margin) / w,
      (viewportH - 2 * margin) / h
    )));
    this.panX = bounds.minX - (viewportW / this.zoom - w) / 2;
    this.panY = bounds.minY - (viewportH / this.zoom - h) / 2;
  }

  /** Snapshot for React state / undo. */
  toJSON() {
    return { zoom: this.zoom, panX: this.panX, panY: this.panY };
  }
}

/**
 * Classify a wheel event the way macOS users expect:
 *  - pinch gesture (browsers report it as wheel + ctrlKey) → zoom
 *  - ⌘/ctrl + wheel → zoom
 *  - plain wheel / two-finger scroll → PAN (this is the one the old canvas
 *    got wrong: it zoomed on every wheel, so trackpad users could never pan)
 *
 * @param {{deltaX: number, deltaY: number, ctrlKey: boolean, metaKey: boolean}} ev
 * @returns {{kind: 'zoom', factor: number} | {kind: 'pan', dx: number, dy: number}}
 */
export function classifyWheel(ev) {
  if (ev.ctrlKey || ev.metaKey) {
    // Pinch deltas are small and continuous; wheel notches are large.
    const factor = Math.exp(-ev.deltaY * 0.01);
    return { kind: 'zoom', factor };
  }
  return { kind: 'pan', dx: -ev.deltaX, dy: -ev.deltaY };
}

/**
 * "Fit all parts" — the {zoom, pan} that frames a set of world-space part
 * bounds inside a screen-space viewport, centered. This is the single source
 * of the fit math shared by the auto-fit-on-load, the F shortcut, and the
 * Fit button, so all three frame a circuit identically.
 *
 * @param {Array<{minX:number,maxX:number,minY:number,maxY:number}>} boundsList
 *   per-part world bounds (already carrying any per-kind padding, e.g. the
 *   extra headroom a VCC/GND rail wants above it).
 * @param {{w:number, h:number}} viewport  container size in screen px.
 * @param {{margin?:number, pad?:number, minZoom?:number, maxZoom?:number}} [opts]
 * @returns {{zoom:number, pan:{x:number,y:number}} | null}
 *   null when there is nothing to frame (no parts, degenerate box, or an
 *   unmeasured viewport) — callers should leave the view untouched.
 */
export function computeFitView(boundsList, viewport, opts = {}) {
  const { margin = 40, pad = 20, minZoom = 0.08, maxZoom = 1.5 } = opts;
  if (!Array.isArray(boundsList) || boundsList.length === 0) return null;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const b of boundsList) {
    if (!b) continue;
    minX = Math.min(minX, b.minX);
    maxX = Math.max(maxX, b.maxX);
    minY = Math.min(minY, b.minY);
    maxY = Math.max(maxY, b.maxY);
  }
  if (!Number.isFinite(minX)) return null;
  const contentW = maxX - minX + margin;
  const contentH = maxY - minY + margin;
  const FW = viewport && viewport.w, FH = viewport && viewport.h;
  if (!(contentW > 0) || !(contentH > 0) || !(FW > 0) || !(FH > 0)) return null;
  const fitZoom = Math.min(maxZoom, Math.min(FW / contentW, FH / contentH));
  const zoom = Math.max(minZoom, Math.min(maxZoom, fitZoom));
  const viewW = FW / zoom, viewH = FH / zoom;
  return {
    zoom,
    pan: {
      x: minX - pad - Math.max(0, (viewW - contentW) / 2),
      y: minY - pad - Math.max(0, (viewH - contentH) / 2),
    },
  };
}
