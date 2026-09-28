/**
 * Is the reader on a small screen? Not "is the window narrow".
 *
 * `innerWidth` cannot answer this inside Brickwright: the app declares a
 * 1024px layout (its own CSS floors html/body there, and the floor is
 * load-bearing), so on a 430pt phone innerWidth is 1024 and the BROWSER
 * scales the page to fit instead. The signal is therefore the layout width
 * TIMES the scale the browser chose — 1024 x 0.42 on that phone, which is the
 * 430 we actually care about.
 *
 * Standalone, where there is no such floor, scale is 1 and this degrades to
 * the window width, which is the right answer there too.
 *
 * @module
 */

/** Below this many effective pixels, side panels start costing more than they give. */
export const NARROW_PX = 700;

/**
 * Effective screen width from a VisualViewport-like object. Pure, so the
 * arithmetic is testable without a browser.
 * @param {{width: number, scale: number}|null} vv
 * @param {number} innerWidth fallback when there is no VisualViewport
 * @returns {number}
 */
export function effectiveWidth (vv, innerWidth) {
  if (!vv || typeof vv.width !== 'number' || !(vv.width > 0)) return innerWidth || 0;
  const scale = typeof vv.scale === 'number' && vv.scale > 0 ? vv.scale : 1;
  return vv.width * scale;
}

/** @param {number} width @returns {boolean} */
export const isNarrow = (width) => width > 0 && width < NARROW_PX;

/** Ask the current global. Returns false where there is no window (tests, SSR). */
export const narrowScreenNow = () => {
  if (typeof window === 'undefined') return false;
  return isNarrow(effectiveWidth(window.visualViewport, window.innerWidth));
};

/**
 * Subscribe to narrowness. LIVE, unlike {@link narrowScreenNow}, because
 * rotating a phone changes the answer and a layout floor chosen at mount would
 * be wrong for the rest of the session. Pinch-zoom fires `resize` on the
 * VisualViewport, which is exactly when the effective width changes.
 *
 * @param {(narrow: boolean) => void} onChange
 * @returns {() => void} unsubscribe
 */
export function subscribeNarrowScreen (onChange) {
  if (typeof window === 'undefined') return () => {};
  let last = narrowScreenNow();
  const fire = () => {
    const next = narrowScreenNow();
    if (next !== last) { last = next; onChange(next); }
  };
  const vv = window.visualViewport;
  window.addEventListener('resize', fire);
  window.addEventListener('orientationchange', fire);
  if (vv) { vv.addEventListener('resize', fire); vv.addEventListener('scroll', fire); }
  return () => {
    window.removeEventListener('resize', fire);
    window.removeEventListener('orientationchange', fire);
    if (vv) { vv.removeEventListener('resize', fire); vv.removeEventListener('scroll', fire); }
  };
}
