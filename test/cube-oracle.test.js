/**
 * Cube-trace oracle — verify our scan accumulator against bw-board's
 * property-based oracle.
 *
 * CATEGORY: 3 (single implementation) — the voxel map is empty, polarity
 * is unverified, and brightness is a separate path. Category 2b if both
 * emulators agree; category 1 only from the bench. Do not let a passing
 * oracle read as a working cube.
 *
 * Uses bw-board's verifyTrace (invariant checker) and generateTrace
 * (reference scan pattern). Import, do not reimplement.
 */

import './_setup.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateTrace, verifyTrace } from '../../bw-board/test/golden/cube-oracle.js';
import { computeCubeVoxels, BW_CUBE_ACTIVE_HIGH, VOXEL_MAP } from '../src/model/ledcube.js';

describe('cube-trace oracle (category 3)', () => {
  it('reference trace passes all invariants', () => {
    const trace = generateTrace(25);
    assert.ok(trace.length > 0, 'trace must not be empty');

    const results = verifyTrace(trace);
    assert.ok(results.length > 0, 'oracle must check at least one invariant');

    for (const r of results) {
      assert.ok(r.pass, `invariant failed: ${r.message}`);
    }
  });

  it('our accumulator produces 64 voxels from the reference trace', () => {
    const trace = generateTrace(25);

    // Convert oracle trace format to our accumulator's format
    let currentSelect = 0xFF;
    let currentData = 0x00;
    const history = [];

    for (const e of trace) {
      if (e.port === 2) currentSelect = e.value;
      if (e.port === 0) currentData = e.value;
      // Record state at every event
      history.push({ tNs: e.tNs, select: currentSelect, data: currentData });
    }

    const voxels = computeCubeVoxels(history);
    assert.ok(voxels.length > 0, 'accumulator must produce voxels');
    // 8 select lines × 8 data bits = 64 voxels
    assert.equal(voxels.length, 64, `expected 64 voxels, got ${voxels.length}`);
  });

  it('32 voxels lit, 32 dark (alternating 0x0F/0xF0 pattern)', () => {
    const trace = generateTrace(25);
    let currentSelect = 0xFF;
    let currentData = 0x00;
    const history = [];
    for (const e of trace) {
      if (e.port === 2) currentSelect = e.value;
      if (e.port === 0) currentData = e.value;
      history.push({ tNs: e.tNs, select: currentSelect, data: currentData });
    }

    const voxels = computeCubeVoxels(history);
    const lit = voxels.filter(v => v.brightness > 0.01);
    const dark = voxels.filter(v => v.brightness <= 0.01);
    assert.equal(lit.length, 32, `expected 32 lit voxels, got ${lit.length}`);
    assert.equal(dark.length, 32, `expected 32 dark voxels, got ${dark.length}`);
  });

  it('states its own limits, and holds them to it', () => {
    // This test exists so a passing suite does not read as "the cube works".
    // It used to say so with assert.ok(true, '...long note...'), which cannot
    // fail — so the day the map IS measured, the note would keep announcing an
    // empty one. Assert the limit instead: when someone fills VOXEL_MAP from a
    // real cube this goes red and the text above has to be rewritten.
    const mapped = VOXEL_MAP.flat().filter((v) => v !== null);
    assert.equal(mapped.length, 0,
      `${mapped.length} voxel(s) are now mapped — the cube has been measured, so this test's `
      + 'LIMITS note is out of date. Update it and lower this expectation.');
    assert.ok(true,
      'LIMITS: voxel map is EMPTY (no (select,bit)→(x,y,z) mapping), ' +
      'polarity unverified (BW_CUBE_ACTIVE_HIGH=' + BW_CUBE_ACTIVE_HIGH + '), ' +
      'brightness is a separate path (cubeBrightness in board.js). ' +
      'Category 3: single implementation. BENCH-CUBE would settle polarity.');
  });
});
