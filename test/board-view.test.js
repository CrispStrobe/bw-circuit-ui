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
