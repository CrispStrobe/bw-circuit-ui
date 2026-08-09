// Cross-check: golden cube trace through the scan accumulator.
// The same trace runs through bw-board's cubeBrightness and our
// computeCubeVoxels — if they disagree, one of the models is wrong.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeCubeVoxels, BW_CUBE_ACTIVE_HIGH } from '../src/model/ledcube.js';
import { cubeTrace, expectedBrightness } from '../../bw-board/test/golden/cube-trace.js';

describe('golden cube trace cross-check', () => {
  it('accumulator agrees with bw-board expected brightness', () => {
    // Build scan history from the golden trace
    const { scanLines, lineTimeNs, scans, dataPerLine } = cubeTrace;
    const history = [];

    for (let scan = 0; scan < scans; scan++) {
      for (let line = 0; line < scanLines; line++) {
        const tNs = BigInt(scan * scanLines + line) * lineTimeNs;
        // Active-low select: clear one bit at a time
        const select = 0xFF ^ (1 << line);
        const data = dataPerLine[line];
        history.push({ tNs, select, data });
      }
    }

    // Run through our accumulator
    const voxels = computeCubeVoxels(history);

    // Compare: voxel index = select * 8 + bit
    let mismatches = 0;
    for (let sel = 0; sel < scanLines; sel++) {
      for (let bit = 0; bit < 8; bit++) {
        const v = voxels.find(vv => vv.select === sel && vv.bit === bit);
        const expected = expectedBrightness[sel * 8 + bit];

        if (Math.abs(v.brightness - expected) > 0.01) {
          mismatches++;
          console.log(`  MISMATCH S${sel}B${bit}: got ${v.brightness.toFixed(3)}, expected ${expected.toFixed(3)}`);
        }
      }
    }

    assert.equal(mismatches, 0,
      `${mismatches} voxels disagree with bw-board golden trace`);
  });

  it('32 voxels lit at 12.5%, 32 dark', () => {
    const lit = expectedBrightness.filter(b => b > 0);
    const dark = expectedBrightness.filter(b => b === 0);
    assert.equal(lit.length, 32);
    assert.equal(dark.length, 32);
    for (const b of lit) {
      assert.ok(Math.abs(b - 0.125) < 0.001, `lit voxel should be 12.5%, got ${b}`);
    }
  });
});
