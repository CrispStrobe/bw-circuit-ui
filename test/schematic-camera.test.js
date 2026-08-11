/**
 * Schematic camera properties — the failure modes a camera introduces.
 *
 * The camera is view state (pan/zoom via SVG viewBox), not model state.
 * These tests assert the properties that matter:
 *
 * 1. Camera moves must not alter the netlist or projection (view ≠ model)
 * 2. Double-click-to-fit must leave every symbol inside the viewport
 * 3. A projection with symbols must produce wires (the zero-wires defect)
 *
 * Hit-testing (click a symbol at its new position after pan/zoom) requires
 * a browser and belongs in verify:interaction. These tests check the
 * model-level invariants that hold regardless of the camera.
 */

import './_setup.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Circuit, resetIds } from '../src/model/circuit.js';
import { projectSchematic } from '../src/model/schematic-projection.js';

function buildCircuit() {
  resetIds();
  const c = new Circuit(5.0);
  const vcc = c.addPart('vcc', {}, 0, 0);
  const gnd = c.addPart('gnd', {}, 0, 0);
  const r = c.addPart('resistor', { ohms: 1000 }, 0, 0);
  const led = c.addPart('led', { vf: 2.0 }, 0, 0);
  const mcu = c.addPart('mcu', { pins: ['P1.0'] }, 0, 0);
  c.addWire(vcc.id, 'vcc', r.id, 'a');
  c.addWire(r.id, 'b', led.id, 'anode');
  c.addWire(led.id, 'cathode', mcu.id, 'P1.0');
  return c;
}

describe('schematic camera properties', () => {
  it('projection is a pure function: calling it twice returns identical results', () => {
    const c = buildCircuit();
    const nets = c.board.getNets();
    const p1 = projectSchematic(c.parts, nets);
    const p2 = projectSchematic(c.parts, nets);
    assert.deepEqual(
      JSON.parse(JSON.stringify(p1)),
      JSON.parse(JSON.stringify(p2)),
      'projection must be deterministic — camera cannot alter it'
    );
  });

  it('projection does not mutate the circuit or the board', () => {
    const c = buildCircuit();
    const netsBefore = JSON.stringify(c.board.getNets());
    const partsBefore = JSON.stringify(c.parts.map(p => ({ id: p.id, kind: p.kind })));

    // Call projection multiple times (simulating camera redraws)
    for (let i = 0; i < 5; i++) {
      projectSchematic(c.parts, c.board.getNets());
    }

    const netsAfter = JSON.stringify(c.board.getNets());
    const partsAfter = JSON.stringify(c.parts.map(p => ({ id: p.id, kind: p.kind })));
    assert.equal(netsBefore, netsAfter, 'projection must not mutate nets');
    assert.equal(partsBefore, partsAfter, 'projection must not mutate parts');
  });

  it('double-click-to-fit: all symbols inside projection bounds', () => {
    // Double-click resets cam to null, which means viewBox = (0, 0, width, height).
    // Every symbol must be inside those bounds.
    const c = buildCircuit();
    const proj = projectSchematic(c.parts, c.board.getNets());

    for (const s of proj.symbols) {
      // Symbol center is (s.x, s.y), with width s.w and height s.h
      const left = s.x - (s.w || 0) / 2;
      const right = s.x + (s.w || 0) / 2;
      const top = s.y - (s.h || 0) / 2;
      const bottom = s.y + (s.h || 0) / 2;

      assert.ok(left >= -10, `${s.kind} left edge ${left} outside viewport`);
      assert.ok(right <= proj.width + 10, `${s.kind} right edge ${right} outside viewport (width=${proj.width})`);
      assert.ok(top >= -10, `${s.kind} top edge ${top} outside viewport`);
      assert.ok(bottom <= proj.height + 10, `${s.kind} bottom edge ${bottom} outside viewport (height=${proj.height})`);
    }
  });

  it('a connected circuit produces both symbols AND wires (zero-wires guard)', () => {
    const c = buildCircuit();
    const proj = projectSchematic(c.parts, c.board.getNets());

    assert.ok(proj.symbols.length >= 3,
      `expected >=3 symbols, got ${proj.symbols.length}`);
    assert.ok(proj.wires.length >= 2,
      `a circuit with ${proj.symbols.length} connected symbols must have wires, ` +
      `got ${proj.wires.length} — parts floating disconnected is the zero-wires defect`);
  });

  it('camera state is separate from model state', () => {
    // The camera in SchematicPanel is a React useState({x, y, k}).
    // Verify the projection carries no camera state — it is a pure
    // function of (parts, nets) with no {x, y, k} anywhere in its output.
    const c = buildCircuit();
    const proj = projectSchematic(c.parts, c.board.getNets());
    const json = JSON.stringify(proj);

    // The projection should not contain any camera-like fields
    assert.ok(!json.includes('"k":'), 'projection must not carry zoom factor k');
    // It SHOULD have x, y (symbol positions) but not cam-related ones
    assert.ok(proj.width > 0 && proj.height > 0, 'projection has dimensions');
  });
});
