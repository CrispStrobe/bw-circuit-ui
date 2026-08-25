/**
 * Loading a circuit must clear the BREADBOARDS, not only parts and wires.
 *
 * A breadboard is not in `circuit.parts`, so a load path that clears parts and
 * wires leaves the previous circuit's board behind — and its strips go on
 * resolving nets that name the parts just deleted. `_syncNetlist` then emits
 *
 *     Invalid netlist: Net "breadboard_1:n-col-b1" references unknown part "led_13"
 *
 * the engine refuses the WHOLE netlist, and the canvas shows `netlist-rejected`
 * with the board inactive. In the app that is: load an example, simulation
 * dead. `useCircuit.loadInferred` did exactly this until 2026-08-25;
 * `handleClear` in CircuitDesigner.jsx had always cleared them, so the repo
 * knew the rule and one path missed it.
 *
 * Found by test/rendering.test.js asserting the LED junction voltage (~2.1 V):
 * the value was missing because nothing was solved at all. That test had never
 * been able to run — see docs/TEST-REGISTRATION.md. This gate is the headless
 * half, because the browser suite deliberately never runs in CI.
 *
 * @module
 */
import './_setup.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Circuit, resetIds } from '../src/model/circuit.js';

/** Parts named by the resolved nets that are not in `circuit.parts`. */
function danglingReferences (circuit) {
  const present = new Set(circuit.parts.map((p) => p.id));
  const missing = new Set();
  for (const net of circuit.resolvedNets || []) {
    for (const t of net.terminals || []) {
      const id = t.part || t.partId;
      if (!id || String(id).startsWith('@bb:')) continue;
      if (!present.has(id)) missing.add(`${net.id} -> ${id}`);
    }
  }
  return [...missing].sort();
}

describe('loading a circuit clears the breadboards too', () => {
  /** A seated circuit: a breadboard with parts whose legs are in its holes. */
  function seated () {
    resetIds();
    const c = new Circuit(5.0);
    const bb = c.addPart('breadboard', 0, 0);
    const led = c.addPart('led', 40, 40);
    const res = c.addPart('resistor', 80, 40);
    c.seatPart?.(led.id, bb.id, { anode: 'e1', cathode: 'e2' });
    c.seatPart?.(res.id, bb.id, { a: 'e2', b: 'e3' });
    c._syncNetlist();
    return { c, bb, led, res };
  }

  test('the fixture really does seat parts on a board', () => {
    const { c } = seated();
    assert.ok(c.breadboards.size > 0,
      'no breadboard was created — this gate would pass vacuously');
    assert.deepEqual(danglingReferences(c), [],
      'a freshly built circuit must not reference parts it does not have');
  });

  test('clearing parts and wires WITHOUT the boards leaves dangling references', () => {
    // The defect, reproduced: this is precisely what loadInferred used to do.
    const { c } = seated();
    c.parts.length = 0;
    c.wires.length = 0;
    c._syncNetlist();
    const dangling = danglingReferences(c);
    assert.ok(dangling.length > 0,
      'clearing parts while keeping the breadboard should strand its strips on the deleted '
      + 'parts. If this passes, the reproduction no longer reproduces and the gate below '
      + 'proves nothing — re-derive it before trusting either.');
  });

  test('clearing the boards as well leaves nothing dangling', () => {
    const { c } = seated();
    c.parts.length = 0;
    c.wires.length = 0;
    c.breadboards = new Map();
    c._syncNetlist();
    assert.deepEqual(danglingReferences(c), [],
      'after clearing parts, wires AND breadboards, no net may name a part that is gone. '
      + 'Every load path must do all three: useCircuit.loadInferred and '
      + 'CircuitDesigner.handleClear.');
  });
});
