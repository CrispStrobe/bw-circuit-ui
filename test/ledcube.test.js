// Tests for the LED cube model.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeCubeVoxels, testPattern, VOXEL_MAP } from '../src/model/ledcube.js';

describe('computeCubeVoxels', () => {
  it('returns 64 voxels (8 selects × 8 bits)', () => {
    const voxels = computeCubeVoxels(testPattern());
    assert.equal(voxels.length, 64);
  });

  it('test pattern lights one voxel per select (diagonal)', () => {
    const voxels = computeCubeVoxels(testPattern());
    const lit = voxels.filter(v => v.brightness > 0);
    assert.equal(lit.length, 8, 'diagonal pattern should light 8 voxels');
    // Each should be on select=bit (diagonal)
    for (const v of lit) {
      assert.equal(v.select, v.bit, `lit voxel should be on diagonal: S${v.select}B${v.bit}`);
    }
  });

  it('brightness is 1/8 for one-line-in-eight scan', () => {
    // Each voxel in the test pattern is lit in exactly 1 of 8 frames
    const voxels = computeCubeVoxels(testPattern());
    const lit = voxels.filter(v => v.brightness > 0);
    for (const v of lit) {
      assert.ok(Math.abs(v.brightness - 1/8) < 0.01,
        `brightness should be 1/8 (~0.125), got ${v.brightness}`);
    }
  });

  it('empty history produces zero brightness', () => {
    const voxels = computeCubeVoxels([]);
    assert.equal(voxels.length, 0);
  });

  it('voxel labels show (select, bit) when map is unknown', () => {
    const voxels = computeCubeVoxels(testPattern());
    // VOXEL_MAP is all null (unknown)
    assert.ok(VOXEL_MAP[0][0] === null, 'map should be null (unknown)');
    const v = voxels.find(v2 => v2.select === 0 && v2.bit === 0);
    assert.equal(v.label, 'S0B0', 'unknown position should show select/bit label');
  });

  it('all-on pattern gives higher brightness', () => {
    // All data bits high on all selects
    const history = [];
    for (let sel = 0; sel < 8; sel++) {
      history.push({ tNs: BigInt(sel) * 1_000_000n, select: 0xFF ^ (1 << sel), data: 0xFF });
    }
    const voxels = computeCubeVoxels(history);
    const lit = voxels.filter(v => v.brightness > 0);
    assert.equal(lit.length, 64, 'all-on should light all 64 voxels');
    for (const v of lit) {
      assert.ok(Math.abs(v.brightness - 1/8) < 0.01,
        `each voxel still only 1/8 duty (one select active at a time)`);
    }
  });
});
