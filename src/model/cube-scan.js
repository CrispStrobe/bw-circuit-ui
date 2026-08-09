/**
 * Cube scan accumulator — captures P2/P0 pin states to build scan history.
 *
 * The cube's select lines are P2 (active-low) and data is P0.
 * This module accumulates pin state snapshots and keeps the last ~20ms
 * worth for the brightness integration.
 */

const WINDOW_NS = 20_000_000n; // 20ms integration window
const MAX_FRAMES = 200; // cap to prevent memory growth

export class CubeScanAccumulator {
  constructor() {
    /** @type {Array<{tNs: bigint, select: number, data: number}>} */
    this._frames = [];
  }

  /**
   * Record a scan frame from the board's current pin states.
   *
   * @param {bigint} tNs — current simulation time
   * @param {Array<{pin: string, mode: string, driveHigh: boolean}>} pinStates
   */
  sample(tNs, pinStates) {
    // Read P2 (select, 8 bits) and P0 (data, 8 bits) from pin states
    let select = 0xFF; // default: all high (no select active)
    let data = 0x00;

    for (const ps of pinStates) {
      const match = ps.pin.match(/^P(\d+)\.(\d+)$/);
      if (!match) continue;
      const port = parseInt(match[1]);
      const bit = parseInt(match[2]);
      const level = ps.driveHigh ? 1 : 0;

      if (port === 2) {
        // P2: select lines
        if (level) select |= (1 << bit);
        else select &= ~(1 << bit);
      } else if (port === 0) {
        // P0: data lines
        if (level) data |= (1 << bit);
        else data &= ~(1 << bit);
      }
    }

    this._frames.push({ tNs, select, data });

    // Trim to window
    if (this._frames.length > MAX_FRAMES) {
      this._frames = this._frames.slice(-MAX_FRAMES);
    }
  }

  /**
   * Get the scan history for the integration window.
   * @returns {Array<{tNs: bigint, select: number, data: number}>}
   */
  getHistory() {
    if (this._frames.length === 0) return [];
    const latest = this._frames[this._frames.length - 1].tNs;
    const cutoff = latest - WINDOW_NS;
    return this._frames.filter(f => f.tNs >= cutoff);
  }

  /** Clear all history. */
  reset() {
    this._frames = [];
  }
}
