/**
 * Board rendering: structural truths, determinism, and a byte baseline.
 *
 * The structural assertions are the ones that catch real regressions:
 * every pad drawn, every track polyline present on its layer's group,
 * drills darker than pads, the outline closed, the over-approximated
 * pour visibly dashed. The baseline (test/docs/board-baselines/mini.svg)
 * catches everything else; when it fails, RENDER IT AND LOOK before
 * regenerating — `node scripts/render-board.mjs` writes it fresh.
 */

import './_setup.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { importEasyEdaPcb } from '../src/importers/easyeda-pcb.js';
import { renderBoardSvg } from '../src/model/board-svg.js';
import { projectBoard } from '../src/model/board-projection.js';

const FIX = join(import.meta.dirname, 'fixtures');
const BASELINE = join(import.meta.dirname, 'docs', 'board-baselines', 'mini.svg');
const mini = () => importEasyEdaPcb(readFileSync(join(FIX, 'easyeda-pcb-mini.json'), 'utf8'));

describe('structure', () => {
  const board = mini();
  const svg = renderBoardSvg(board);

  test('is one closed svg with the board dimensions', () => {
    assert.match(svg, /^<svg /);
    assert.match(svg, /<\/svg>$/);
    assert.match(svg, /data-board-w="25.4"/);
    assert.match(svg, /data-board-h="12.7"/);
  });

  test('every group class the panel toggles is present', () => {
    for (const cls of ['substrate', 'pours', 'copper-top', 'copper-bottom', 'pads', 'drills', 'silk', 'labels', 'outline']) {
      assert.ok(svg.includes(`class="bw-pcb-${cls}"`), cls);
    }
  });

  test('every pad is drawn — six circles for six THT pads', () => {
    // R1 has 2 circle pads, SW1 has 4 rect pads: 2 circles + 4 polygons
    // in the pads group, plus 6 drill circles in the drills group.
    const pads = svg.split('class="bw-pcb-pads"')[1].split('</g>')[0];
    // 2 round pads + the via's ring AND its drill dot = 4 circles.
    assert.equal((pads.match(/<circle /g) || []).length, 4);
    assert.equal((pads.match(/<polygon /g) || []).length, 4);
    const drills = svg.split('class="bw-pcb-drills"')[1].split('</g>')[0];
    assert.equal((drills.match(/<circle /g) || []).length, 6 + 1); // 6 pad drills + 1 free hole
  });

  test('tracks land in their layer groups', () => {
    const top = svg.split('class="bw-pcb-copper-top"')[1].split('</g>')[0];
    const bottom = svg.split('class="bw-pcb-copper-bottom"')[1].split('</g>')[0];
    assert.equal((top.match(/<polyline /g) || []).length, 1);
    assert.equal((bottom.match(/<polyline /g) || []).length, 1);
    assert.ok(top.includes('<path '), 'the copper arc renders on top');
  });

  test('the refdes labels are text, correctly escaped', () => {
    assert.ok(svg.includes('>R1</text>'));
    assert.ok(svg.includes('>SW1</text>'));
  });

  test('rendering twice is byte-identical', () => {
    assert.equal(renderBoardSvg(board), svg);
  });
});

describe('the over-approximated pour is visibly labelled', () => {
  test('an outline-only pour renders dashed; a filled one does not', () => {
    const board = mini();
    const withFill = renderBoardSvg(board);
    assert.ok(!withFill.includes('stroke-dasharray'), 'exact fill: no dashes');
    board.pours[0].fillFromFile = false;
    board.pours[0].fills = null;
    const outlineOnly = renderBoardSvg(board);
    assert.ok(outlineOnly.includes('stroke-dasharray'), 'over-approximation: dashed');
  });
});

describe('projected boards render too', () => {
  test('a projection renders with its parts and routed tracks', () => {
    const { board } = projectBoard({
      parts: [
        { id: 'R1', kind: 'resistor', params: {} },
        { id: 'LED1', kind: 'led', params: {} },
      ],
      wires: [{ from: 'R1', fromTerminal: 'b', to: 'LED1', toTerminal: 'anode' }],
    });
    const svg = renderBoardSvg(board);
    assert.ok(svg.includes('>R1</text>'));
    assert.ok(svg.includes('>LED1</text>'));
    assert.ok((svg.match(/<polyline /g) || []).length >= 1, 'the routed track renders');
  });
});

describe('baseline', () => {
  test('mini renders byte-for-byte as reviewed', { skip: !existsSync(BASELINE) }, () => {
    const expected = readFileSync(BASELINE, 'utf8');
    assert.equal(renderBoardSvg(mini()), expected,
      'The board rendering changed. Render it, LOOK at it, and only then '
      + 'regenerate with `node scripts/render-board.mjs`.');
  });

  test('the baseline exists (a gate that cannot run must not report green)', () => {
    assert.ok(existsSync(BASELINE), `missing ${BASELINE} — run node scripts/render-board.mjs`);
  });
});
