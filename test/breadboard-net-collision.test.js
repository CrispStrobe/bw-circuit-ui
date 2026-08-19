/**
 * Breadboard net-id collision regression: deriveNets must produce UNIQUE
 * net ids across multiple breadboards.  Without the boardId prefix, the
 * same column index on two different boards yielded the same strip id
 * (e.g. "n-col-t13-m1"), merging electrically distinct nets — an LED
 * indicator net collapsed onto a CPU data bus in the eater6502 benches.
 *
 * The fix: deriveNets(boardId) prefixes every net id with the boardId,
 * so t13 on bb1 cannot equal t13 on bb2.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BreadboardModel } from '../src/model/breadboard.js';

const here = dirname(fileURLToPath(import.meta.url));

describe('breadboard net-id collision', () => {

  test('deriveNets with boardId prefixes net ids', () => {
    const bb = new BreadboardModel({});
    // Seat two parts on the same column (t13)
    bb.occupy('partA', { termA: 'a13' });
    bb.occupy('partB', { termB: 'c13' });
    const { nets } = bb.deriveNets('bb1');
    const ids = nets.map(n => n.id);
    assert.ok(ids.every(id => id.startsWith('bb1:')),
      `all net ids must be prefixed with boardId: ${ids.join(', ')}`);
  });

  test('same column on two boards yields DISTINCT net ids', () => {
    const bb1 = new BreadboardModel({});
    const bb2 = new BreadboardModel({});
    // Same column t13 on both boards
    bb1.occupy('partA', { termA: 'a13' });
    bb2.occupy('partB', { termB: 'a13' });
    const nets1 = bb1.deriveNets('bb1').nets;
    const nets2 = bb2.deriveNets('bb2').nets;
    const ids1 = new Set(nets1.map(n => n.id));
    const ids2 = new Set(nets2.map(n => n.id));
    // Intersection must be empty
    const overlap = [...ids1].filter(id => ids2.has(id));
    assert.equal(overlap.length, 0,
      `net ids must not collide across boards: ${overlap.join(', ')}`);
  });

  test('rail ids are also prefixed', () => {
    const bb = new BreadboardModel({});
    bb.occupy('partC', { termC: 't+1' }); // power rail
    const { nets } = bb.deriveNets('bb3');
    const railNets = nets.filter(n => n.id.includes('rail'));
    assert.ok(railNets.length > 0, 'rail nets exist');
    assert.ok(railNets.every(n => n.id.startsWith('bb3:')),
      `rail net ids must be prefixed: ${railNets.map(n => n.id).join(', ')}`);
  });
});

// ── Multi-breadboard circuit integration ─────────────────────────────

describe('eater6502 multi-breadboard: no duplicate net ids', () => {
  const exDir = join(here, '../../sb3-creator/examples');
  const BENCHES = [
    'eater6502-blink',
    'eater6502-full-build',
    'eater6502-vdp-hello',
  ];

  for (const bench of BENCHES) {
    const circuitFile = join(exDir, bench, 'circuit.json');
    let data;
    try { data = JSON.parse(readFileSync(circuitFile, 'utf8')); } catch { data = null; }
    const skip = !data && 'sb3-creator checkout not available';

    test(`${bench}: no duplicate net ids across ${data ? data.parts.filter(p => p.kind === 'breadboard').length : '?'} breadboards`, { skip }, () => {
      const bbParts = data.parts.filter(p => p.kind === 'breadboard');
      assert.ok(bbParts.length >= 2, `needs ≥2 breadboards (has ${bbParts.length})`);

      // Build breadboard models and derive nets, same as circuit.js does
      const allNetIds = [];
      for (const bbPart of bbParts) {
        const bb = new BreadboardModel(bbPart.params || {});
        // Seat parts
        for (const part of data.parts) {
          if (!part.seat || part.seat.boardId !== bbPart.id) continue;
          try { bb.occupy(part.id, part.seat.leadMap); } catch { /* seat conflict */ }
        }
        // Add jumper wires
        for (const jw of data.holeWires || []) {
          if (jw.boardId !== bbPart.id) continue;
          try { bb.addWire(jw.ref || `jw-${jw.a}-${jw.b}`, jw.a, jw.b, jw.color); } catch { /* occupied */ }
        }
        const { nets } = bb.deriveNets(bbPart.id);
        for (const n of nets) allNetIds.push(n.id);
      }

      // Check for duplicates
      const seen = new Set();
      const dupes = [];
      for (const id of allNetIds) {
        if (seen.has(id)) dupes.push(id);
        seen.add(id);
      }
      assert.equal(dupes.length, 0,
        `duplicate net ids: ${[...new Set(dupes)].join(', ')}`);
    });
  }
});
