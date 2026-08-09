/**
 * LED cube model — a 4x4x4 bi-colour cube driven by 8 select + 8 data lines.
 *
 * The voxel map (select, bit) → physical position is UNKNOWN until measured
 * on a real cube with probe.c. Until then, each voxel is labeled by its
 * electrical address, not its spatial position.
 *
 * Brightness is integrated over ~20ms, exactly like the LED model.
 * A voxel lit one line in eight looks dimmer by that factor.
 */

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
          if (frame.data & (1 << bit)) {
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
      data: 1 << sel, // diagonal pattern
    });
  }
  return history;
}
