/**
 * LED cube model — a 4x4x4 bi-colour cube driven by 8 select + 8 data lines.
 *
 * TWO THINGS ARE UNKNOWN and only a real cube can answer them:
 *
 * 1. The voxel map: (select, bit) → physical (x,y,z) position.
 *    Until measured with probe.c, each voxel is labeled by its
 *    electrical address, not its spatial position.
 *
 * 2. P0 data polarity: does a set bit (1) mean the LED is ON or OFF?
 *    - Active-high (BW_CUBE_ACTIVE_HIGH = true): bit=1 → LED on.
 *      This matches probe.c's convention (blank = 0x00, probe = 1<<bit).
 *    - Active-low  (BW_CUBE_ACTIVE_HIGH = false): bit=0 → LED on.
 *      This matches main.c's convention (clear = 0xFF, set = clear bit).
 *    Both are internally consistent code; only a real cube can settle it.
 *    Flip this one constant to invert the entire cube's rendering.
 *
 * Brightness is integrated over ~20ms, exactly like the LED model.
 * A voxel lit one line in eight looks dimmer by that factor.
 */

/**
 * P0 data polarity — UNVERIFIED. Only a real cube can settle this.
 *
 * Fleet-wide symbol: BW_CUBE_ACTIVE_HIGH. All four consumers use the
 * same name and the same sense so they can be aligned in one pass.
 *
 * true  = active-high: a set bit (1) lights the LED.
 *   Evidence (b77b176): probe.c blank = {0,…}, probe = 1<<bit;
 *   vendor firmware P0=0 is called "blanking".
 * false = active-low: a clear bit (0) lights the LED.
 *   main.c fb_clear = 0xFF, set = clear bit.
 *
 * Defaulted active-high on the weight of evidence. If measurement
 * settles it differently, change this one value — everything follows.
 *
 * See: ucsim-stc spec-008 §2, stc/src/20-ledcube/README.md §"What is
 * still unknown", sb3-creator BW_CUBE_ACTIVE_HIGH.
 */
export const BW_CUBE_ACTIVE_HIGH = true;

/**
 * The voxel map. null = unknown (not yet measured).
 * When filled: { x, y, z, color } for each (select, bit).
 * @type {Array<Array<{x:number,y:number,z:number,color:string}|null>>}
 */
export const VOXEL_MAP = Array.from({ length: 8 }, () =>
  Array.from({ length: 8 }, () => null)
);

/**
 * Compute cube voxel brightnesses from board state.
 *
 * Reads P2 (select, active-low) and P0 (data) pin states, integrates
 * brightness over recent history.
 *
 * @param {object} board — BoardImpl with pin states
 * @param {Array<{tNs: bigint, select: number, data: number}>} scanHistory
 *   Recent scan frames (last ~20ms worth)
 * @returns {Array<{select: number, bit: number, brightness: number, label: string}>}
 */
export function computeCubeVoxels(scanHistory) {
  if (!scanHistory || scanHistory.length === 0) return [];

  const voxels = [];
  // For each (select, bit) pair, compute duty cycle over the history window
  const totalFrames = scanHistory.length;

  for (let sel = 0; sel < 8; sel++) {
    for (let bit = 0; bit < 8; bit++) {
      // Count how many frames this voxel was lit
      let litCount = 0;
      for (const frame of scanHistory) {
        // select is active-low: FE = line 0, FD = line 1, etc.
        const activeLine = frame.select ^ 0xFF;
        if (activeLine === (1 << sel)) {
          // This select line is active — check the data bit
          // BW_CUBE_ACTIVE_HIGH determines whether a set bit means ON or OFF.
          const bitSet = !!(frame.data & (1 << bit));
          if (BW_CUBE_ACTIVE_HIGH ? bitSet : !bitSet) {
            litCount++;
          }
        }
      }

      const brightness = totalFrames > 0 ? litCount / totalFrames : 0;

      // Voxel label: position if known, (select, bit) if not
      const mapped = VOXEL_MAP[sel][bit];
      const label = mapped
        ? `(${mapped.x},${mapped.y},${mapped.z})`
        : `S${sel}B${bit}`;

      if (brightness > 0 || true) { // include all for the grid
        voxels.push({ select: sel, bit, brightness, label });
      }
    }
  }

  return voxels;
}

/**
 * Default scan history for static rendering (no simulation running).
 * Shows a test pattern: one voxel per select line.
 */
export function testPattern() {
  const history = [];
  for (let sel = 0; sel < 8; sel++) {
    history.push({
      tNs: BigInt(sel) * 1_235_000n, // 1.235ms per line
      select: 0xFF ^ (1 << sel), // active-low
      // Diagonal pattern: light one voxel per select.
      // Respects BW_CUBE_ACTIVE_HIGH: set bit = on (active-high) or clear bit = on (active-low).
      data: BW_CUBE_ACTIVE_HIGH ? (1 << sel) : (0xFF ^ (1 << sel)),
    });
  }
  return history;
}
