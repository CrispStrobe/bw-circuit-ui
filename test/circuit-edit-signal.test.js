/**
 * `onCircuitEdit` — the "the circuit changed" signal a host could not get.
 *
 * `onDeclarationChange` fires when the DERIVED PIN DECLARATIONS move. On a
 * bench with no microcontroller they never do, so on those benches a host was
 * told nothing about any edit at all. That cost three lesson waves in
 * brickwright-lite a checkpoint each — `starter-circuit-path`,
 * `signals-resonance` and `machines-contention`, whose benches are a battery
 * and an LED, an RLC network and a 6502 bus. Each review found it
 * independently, one wave at a time.
 */
import './_setup.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { circuitSignature } from '../src/model/circuit-signature.js';
import { circuitToDeclarations } from '../src/model/declarations.js';

const R = (id, ohms) => ({ id, kind: 'resistor', params: { ohms }, x: 0, y: 0 });
const wire = (a, at, b, bt) => ({ from: { part: a, terminal: at }, to: { part: b, terminal: bt } });

describe('circuitSignature', () => {
  it('moves when a part param changes — the commonest edit a lesson asks for', () => {
    const before = circuitSignature([R('r1', 1000)], []);
    const after = circuitSignature([R('r1', 470)], []);
    assert.notEqual(before, after, '1 kOhm -> 470 Ohm must be visible to the host');
  });

  it('moves when a wire is broken and again when it is restored', () => {
    const parts = [R('r1', 1000), R('r2', 1000)];
    const wired = circuitSignature(parts, [wire('r1', 'b', 'r2', 'a')]);
    const cut = circuitSignature(parts, []);
    assert.notEqual(wired, cut);
    assert.equal(circuitSignature(parts, [wire('r1', 'b', 'r2', 'a')]), wired,
      'restoring the same wire must return to the same signature');
  });

  it('moves when a wire is RE-ROUTED — same count, different endpoints', () => {
    // The wire-count alone would carry the broken/restored case above, so this
    // is the one that actually pins the endpoints being in the signature.
    const parts = [R('r1', 1000), R('r2', 1000)];
    assert.notEqual(circuitSignature(parts, [wire('r1', 'b', 'r2', 'a')]),
      circuitSignature(parts, [wire('r1', 'a', 'r2', 'a')]),
      'moving a wire from one terminal to another changes the circuit');
  });

  it('moves when a part is deleted', () => {
    assert.notEqual(circuitSignature([R('r1', 1000), R('r2', 1000)], []),
      circuitSignature([R('r1', 1000)], []));
  });

  it('does NOT move when a part is dragged across the canvas', () => {
    // Position is the drawing, not the circuit. A host that treated it as an
    // edit would fire on every pointermove.
    const a = circuitSignature([{ ...R('r1', 1000), x: 0, y: 0 }], []);
    const b = circuitSignature([{ ...R('r1', 1000), x: 400, y: 250 }], []);
    assert.equal(a, b);
  });

  it('tolerates an empty circuit and missing wire endpoints', () => {
    assert.equal(typeof circuitSignature([], []), 'string');
    assert.equal(typeof circuitSignature(undefined, undefined), 'string');
    assert.equal(typeof circuitSignature([R('r1', 1)], [{}]), 'string');
  });
});

describe('why the declaration signal was not enough', () => {
  it('an MCU-less circuit derives the SAME declarations before and after every edit', () => {
    // This is the defect, stated as the test that would have caught it: two
    // materially different circuits, one declaration.
    const before = circuitToDeclarations([R('r1', 1000)], [], null);
    const after = circuitToDeclarations([R('r1', 470)], [], null);
    assert.deepEqual(before, after,
      'if this ever stops being true the declaration signal has grown teeth and ' +
      'this test should be revisited');
    assert.notEqual(circuitSignature([R('r1', 1000)], []),
      circuitSignature([R('r1', 470)], []),
      'the circuit signal must see what the declaration signal cannot');
  });
});

describe('CircuitDesigner wiring', () => {
  const src = readFileSync(new URL('../src/components/CircuitDesigner.jsx', import.meta.url), 'utf8');

  it('accepts an onCircuitEdit prop and calls it from a signature effect', () => {
    assert.match(src, /onCircuitEdit/, 'the prop is gone');
    assert.match(src, /circuitSignature\(parts, wires\)/, 'the effect no longer builds a signature');
  });

  it('does not report the circuit ARRIVING as an edit', () => {
    // One spurious event per load is exactly the false positive `circuit-ready`
    // already covers, and a lesson checkpoint that ticks on load certifies
    // nothing.
    assert.match(src, /if \(!first\) onCircuitEdit\(/,
      'the first signature must be recorded without firing');
  });
});
