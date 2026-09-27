/**
 * Board view wiring: the third view state, the overrides plumbing, and
 * the one rule that must hold — placement may never touch connectivity.
 *
 * UI contracts are asserted the warning-chip way (source text, keyed on
 * data attributes); the overrides persistence is functional.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import './_setup.js';
import { Circuit } from '../src/model/circuit.js';
import { projectBoardFromCircuit } from '../src/model/board-projection.js';
import { runPcbDrc } from '../src/model/pcb-drc.js';
import { projectBoard } from '../src/model/board-projection.js';
import { fabricationPreflight } from '../src/model/fabrication-preflight.js';

const here = dirname(fileURLToPath(import.meta.url));
const designer = readFileSync(join(here, '../src/components/CircuitDesigner.jsx'), 'utf8');
const panel = readFileSync(join(here, '../src/components/BoardPanel.jsx'), 'utf8');
const hook = readFileSync(join(here, '../src/hooks/useCircuit.js'), 'utf8');

describe('the designer gains a third view', () => {
  test('both switchers carry a board button', () => {
    assert.ok(designer.includes('data-board-view-button'), 'escape switcher');
    // The toolbar radiogroup: three data-circuit-toggle-state buttons.
    const nav = designer.slice(designer.indexOf('data-circuit-view-toggle'));
    const group = nav.slice(0, nav.indexOf('</div>'));
    assert.equal((group.match(/data-circuit-toggle-state/g) || []).length, 3);
    assert.ok(group.includes('Board view'));
  });

  test('the board pane mounts BoardPanel with the overrides action', () => {
    assert.ok(designer.includes('<BoardPanel circuit={circuit} overrides={circuit.pcb} onOverridesChange={setPcbOverrides}'));
  });

  test('setPcbOverrides lives in useCircuit and bumps rev', () => {
    const fn = hook.slice(hook.indexOf('const setPcbOverrides'));
    const body = fn.slice(0, fn.indexOf('}, [circuit, bump]'));
    assert.ok(body.includes('circuit.pcb = pcb'));
    assert.ok(body.includes('bump()'));
  });
});

describe('BoardPanel edits placement and nothing else', () => {
  test('gestures dispatch on data-part-id hit targets', () => {
    assert.ok(panel.includes("closest?.('[data-part-id]')"));
    assert.ok(panel.includes('onOverridesChange'));
  });

  test('the panel cannot state connectivity: no wire mutations exist in it', () => {
    for (const forbidden of ['addWire', 'removeWire', 'fromTerminal', 'toTerminal']) {
      assert.ok(!panel.includes(forbidden), `${forbidden} must not appear in BoardPanel`);
    }
  });

  test('rotate and package variant tools exist for the selection', () => {
    assert.ok(panel.includes('data-board-part-tools'));
    assert.ok(panel.includes('listVariants'));
    assert.ok(panel.includes("rotation: (cur + 90) % 360"));
  });
});

describe('overrides persist through the circuit file', () => {
  test('circuit.pcb round-trips toJSON/fromJSON and steers the projection', () => {
    const c = new Circuit(5);
    const r = c.addPart('resistor', 100, 100, { ohms: 220 });
    const l = c.addPart('led', 200, 100, {});
    c.addWire(r.id, 'b', l.id, 'anode');
    c.pcb = { parts: { [l.id]: { x: 30, y: 22, rotation: 90 } } };

    const restored = Circuit.fromJSON(c.toJSON());
    assert.deepEqual(restored.pcb, c.pcb);

    const { board, unrouted } = projectBoardFromCircuit(restored);
    assert.deepEqual(unrouted, []);
    assert.deepEqual(runPcbDrc(board), []);
    const led = board.parts.find((p) => p.ref === l.id);
    // The override is honoured in placement space (the board frame shifts
    // by the outline origin, so check the pads are the ROTATED geometry).
    const pads = led.pads.map((p) => [p.x - led.x, p.y - led.y]);
    // tht-5mm pads at (±1.27, 0) rotated 90° CCW land at (0, ±1.27).
    assert.ok(pads.every(([dx]) => Math.abs(dx) < 1e-6), JSON.stringify(pads));
  });

  test('a circuit without pcb serialises without the field', () => {
    const c = new Circuit(5);
    c.addPart('resistor', 0, 0, {});
    assert.ok(!('pcb' in c.toJSON()));
  });
});

describe('fabrication preflight', () => {
  const cleanBoard = () => projectBoard({
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

  test('a clean routed projection is ready and discloses drills, stack and provenance', () => {
    const { board, unrouted } = cleanBoard();
    const report = fabricationPreflight(board, { unrouted, exportId: 'gerber' });
    assert.equal(report.ready, true);
    assert.deepEqual(report.checks.map((check) => [check.id, check.ok]), [
      ['outline', true], ['danger-drc', true], ['unrouted', true],
    ]);
    assert.equal(report.drills.roundCount, 6);
    assert.equal(report.drills.slotCount, 0);
    assert.equal(report.drills.platedCount, 6);
    assert.equal(report.drills.unplatedCount, 0);
    assert.deepEqual(report.stackup, { copperLayerCount: 2, copperLayerIds: [1, 2], layerNames: ['top', 'bottom'] });
    assert.deepEqual(report.provenance, {
      generator: 'bw-circuit-ui', contract: 'fabrication-preflight-v1',
      boardFormat: 'projected-board', exportId: 'gerber',
    });
  });

  test('open outline, danger DRC and unrouted nets independently block readiness', () => {
    const { board } = cleanBoard();
    board.outline.pop();
    const findings = runPcbDrc(board);
    findings.push({ rule: 'planted-danger', severity: 'danger' });
    const report = fabricationPreflight(board, { findings, unrouted: ['N_missing'] });
    assert.equal(report.ready, false);
    assert.equal(report.checks.find((check) => check.id === 'outline').ok, false);
    assert.equal(report.checks.find((check) => check.id === 'danger-drc').ok, false);
    assert.equal(report.checks.find((check) => check.id === 'unrouted').ok, false);
    assert.deepEqual(report.unroutedNets, ['N_missing']);
  });

  test('slots, vias and unplated holes are counted without changing the board', () => {
    const { board } = cleanBoard();
    board.freePads.push({ id: 'slot', num: 'S', x: 1, y: 1, w: 2.6, h: 1.5, drill: 1, slotLength: 2.6, plated: true, through: true });
    board.vias.push({ id: 'via', x: 2, y: 2, diameter: 0.61, drill: 0.3 });
    board.holes.push({ id: 'mount', x: 3, y: 3, diameter: 3.2 });
    const report = fabricationPreflight(board);
    assert.equal(report.drills.slotCount, 1);
    assert.equal(report.drills.roundCount, 8);
    assert.equal(report.drills.platedCount, 8);
    assert.equal(report.drills.unplatedCount, 1);
    assert.deepEqual(report.drills.slots, [{ diameter: 1, length: 2.6, plated: true }]);
  });

  test('BoardPanel requires the exact ready report and acknowledgement before download', () => {
    assert.match(panel, /data-fabrication-preflight/);
    assert.match(panel, /JSON\.stringify\(\{\s*exportId: pendingExport\?\.id \|\| null,\s*board: projected\.board/);
    assert.match(panel, /fabricationAcknowledgement === fabricationReceipt/);
    assert.match(panel, /setFabricationAcknowledgement\(event\.target\.checked\s*\? fabricationReceipt/);
    assert.match(panel, /disabled=\{!preflight\.ready \|\| !fabricationAcknowledged\}/);
    assert.match(panel, /previewExport\(entry\)/);
    assert.doesNotMatch(panel, /onClick=\{\(\) => doExport\(entry\)\}/);
  });
});
