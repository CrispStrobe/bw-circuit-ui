/**
 * LED cube model — a 4x4x4 bi-colour cube driven by 8 select + 8 data lines.
 *
 * TWO THINGS ARE UNKNOWN and only a real cube can answer them:
 *
 * 1. The voxel map: (select, bit) → physical (x,y,z) position.
 *    Until measured with probe.c, each voxel is labeled by its
 *    electrical address, not its spatial position.
 *
 * 2. P0 data polarity: measured active-HIGH (Finding #14, zero exceptions
 *    in 3,930+ writes). The firmware's intent is now known; whether the
 *    hardware matches it awaits probe.c on a real cube.
 *
 * Brightness is integrated over ~20ms, exactly like the LED model.
 * A voxel lit one line in eight looks dimmer by that factor.
 */

/**
 * P0 data polarity — measured active-HIGH.
 *
 * emu8051-stc Finding #14: P0 value histogram over 5 s of vendor firmware,
 * zero exceptions in 3,930+ writes. 0x00 = blank (always before a select),
 * 0xFF = all-on data, 0x0F = red columns, 0xF0 = blue columns. Under
 * active-low 0x0F would mean red-off/blue-on, the opposite of what the
 * animation visibly performs. Conclusive for the firmware's intent.
 *
 * Not yet confirmed on silicon — probe.c on a real cube is the definitive
 * check that the hardware matches the firmware's assumption.
 *
 * Fleet-wide symbol: BW_CUBE_ACTIVE_HIGH. All four consumers
 * (main.c, spec-008, sb3-creator, bw-circuit-ui) use the same name.
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
