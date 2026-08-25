/**
 * Gerber/Excellon export: hand-computed coordinates, complete drills,
 * and the pour-hole polarity that must never flip.
 *
 * The mini fixture's geometry has been computed on paper since Phase 0:
 * R1 pad 1 sits at mm (2.54, 2.54), which in %FSLAX46% integers is
 * X2540000Y2540000 — asserted verbatim, not derived. The drill file must
 * carry every hole the model knows (6 pad drills + the via + the free
 * M3), and a pour's carve-out holes must plot CLEAR (%LPC*%) between
 * dark passes — a flipped polarity would print the holes as copper,
 * the exact bug the even-odd import work existed to prevent.
 */

import './_setup.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { importEasyEdaPcb } from '../src/importers/easyeda-pcb.js';
import { exportGerbers } from '../src/model/exporters/gerber.js';
import { projectBoard } from '../src/model/board-projection.js';

const FIX = join(import.meta.dirname, 'fixtures');
const mini = () => importEasyEdaPcb(readFileSync(join(FIX, 'easyeda-pcb-mini.json'), 'utf8'));

describe('mini fixture', () => {
  const { files, warnings } = exportGerbers(mini());

  test('the full fab set exists', () => {
    assert.deepEqual(Object.keys(files).sort(), [
      'copper-bottom.gbl', 'copper-top.gtl', 'drill.drl', 'mask-bottom.gbs',
      'mask-top.gts', 'outline.gko', 'silk-bottom.gbo', 'silk-top.gto',
    ]);
    for (const text of Object.values(files)) {
      if (text.startsWith('M48')) continue; // Excellon
      assert.match(text, /%FSLAX46Y46\*%/);
      assert.match(text, /%MOMM\*%/);
      assert.match(text, /M02\*\n$/);
    }
  });

  test('R1 pad 1 flashes at the hand-computed nanometre grid point', () => {
    // (2.54, 2.54) mm → X2540000Y2540000, through a C,1.524 aperture.
    const top = files['copper-top.gtl'];
    assert.match(top, /%ADD\d+C,1\.524\*%/);
    assert.ok(top.includes('X2540000Y2540000D03*'), 'the flash location is exact');
  });

  test('the top track draws from R1.2 through its bend', () => {
    const top = files['copper-top.gtl'];
    // (12.7, 2.54) D02 then (14.732, 2.54) D01 (the polyline's first leg).
    assert.ok(top.includes('X12700000Y2540000D02*'));
    assert.ok(top.includes('X14732000Y2540000D01*'));
  });

  test('the pour hole polarity: dark boundary, clear holes, dark restored', () => {
    const bottom = files['copper-bottom.gbl'];
    const zoneStart = bottom.indexOf('G36*');
    assert.ok(zoneStart > 0, 'the fill plots as a region');
    // The mini pour has a single ring (no holes): one dark region, no LPC.
    assert.ok(!bottom.includes('%LPC*%'), 'no holes, no clear pass');
    // A synthetic holed pour MUST produce the clear pass.
    const board = mini();
    board.pours[0].fills = [[board.pours[0].fills[0][0], [[19, 7], [21, 7], [21, 9], [19, 9]]]];
    const holed = exportGerbers(board).files['copper-bottom.gbl'];
    const dark = holed.indexOf('%LPD*%', holed.indexOf('G36*'));
    const clear = holed.indexOf('%LPC*%');
    assert.ok(clear > 0, 'the hole plots clear');
    assert.ok(holed.indexOf('%LPD*%', clear) > clear, 'polarity restored after the hole');
    assert.ok(dark !== -1);
  });

  test('every hole the model knows reaches the drill file', () => {
    const drl = files['drill.drl'];
    assert.match(drl, /^M48\nMETRIC,TZ\n/);
    // 6 THT pad drills + 1 via (plated) and the free M3 (unplated):
    // 8 hits across the tool list.
    const hits = (drl.match(/^X-?\d+\.\d{3}Y-?\d+\.\d{3}$/gm) || []).length;
    assert.equal(hits, 8);
    assert.ok(drl.includes('C3'), 'the 3.0 mm M3 tool exists');
    assert.match(drl, /M30\n$/);
  });

  test('outline closes: as many draw moves as segments', () => {
    const gko = files['outline.gko'];
    assert.equal((gko.match(/D02\*/g) || []).length, 4);
    assert.equal((gko.match(/D01\*/g) || []).length, 4);
  });

  test('silk text loss is REPORTED, never silent', () => {
    assert.ok(warnings.some((w) => /silk text/.test(w)), warnings.join('; '));
  });

  test('deterministic: exporting twice is byte-identical', () => {
    const again = exportGerbers(mini());
    assert.deepEqual(again.files, files);
  });
});

describe('projected boards export too', () => {
  test('a routed projection produces a complete, non-empty fab set', () => {
    const { board } = projectBoard({
      parts: [
        { id: 'J1', kind: 'header', params: { pins: 2 } },
        { id: 'R1', kind: 'resistor', params: {} },
        { id: 'LED1', kind: 'led', params: {} },
      ],
      wires: [
        { from: 'J1', fromTerminal: 'p1', to: 'R1', toTerminal: 'a' },
        { from: 'R1', fromTerminal: 'b', to: 'LED1', toTerminal: 'anode' },
        { from: 'LED1', fromTerminal: 'cathode', to: 'J1', toTerminal: 'p2' },
      ],
    });
    const { files } = exportGerbers(board);
    assert.ok(files['copper-top.gtl'].includes('D03*'), 'pads flash');
    assert.ok(files['copper-top.gtl'].includes('D01*'), 'tracks draw');
    assert.ok((files['drill.drl'].match(/^X/gm) || []).length >= 6, 'every THT pad drills');
    // The pin-1 legend is text, so it must be counted in the warnings.
  });
});
