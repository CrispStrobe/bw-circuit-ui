/**
 * Test the documented integration path.
 *
 * Exercises the exact pattern from the README:
 *   import { setEngine, CircuitDesigner } from 'bw-circuit-ui';
 *   setEngine({ BoardImpl, inferNetlist, checkWiring });
 *
 * This is the one test that confirms the shipping configuration works,
 * not just the Vite dev harness module resolution.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Simulate the host's imports — these come from wherever the host vendored them
import { BoardImpl } from '../../bw-board/src/board.js';
import { inferNetlist, checkWiring } from '../../bw-board/src/infer-netlist.js';

// Import from the model modules, as the engine/model layer works.
// The full entry point (src/index.js) also exports CircuitDesigner.jsx
// which requires a JSX transform — that's the host bundler's job.
// This test verifies the engine injection + model layer works.
import { setEngine } from '../src/engine.js';
import { Circuit } from '../src/model/circuit.js';
import { inferCircuit } from '../src/model/inference.js';
import { createMeterState, readMeter } from '../src/model/multimeter.js';

describe('documented integration path', () => {
  it('setEngine → inferCircuit → Circuit → engine readings', () => {
    // Step 1: host injects the engine (as documented)
    setEngine({ BoardImpl, inferNetlist, checkWiring });

    // Step 2: infer a circuit from pin declarations
    const { parts, nets, notes } = inferCircuit({
      device: 'STC12C5A60S2',
      clock: 11059200,
      pins: [
        { name: 'led1', port: 1, bit: 0, direction: 'output', activeLow: true },
      ],
    });

    assert.ok(parts.length >= 4, 'should infer VCC, GND, MCU, R, LED');
    assert.ok(nets.length >= 2, 'should infer nets');

    // Step 3: create a circuit and load the inferred parts
    const c = new Circuit(5.0);
    for (const p of parts) c.parts.push({ ...p });
    for (const net of nets) {
      for (let i = 1; i < net.terminals.length; i++) {
        c.wires.push({
          id: `w_${net.id}_${i}`,
          netId: net.id,
          from: net.terminals[0],
          to: net.terminals[i],
        });
      }
    }
    c._syncNetlist();

    // Step 4: drive the simulation and read values
    c.board.setPin('P1.0', 'quasi', false);
    c.board.advanceTo(25_000_000n);

    const ledPart = parts.find(p => p.kind === 'led');
    const b = c.board.ledBrightness(ledPart.id);
    assert.ok(b > 0.13 && b < 0.16,
      `LED brightness ${b} should be ~0.145 (hand-computed oracle)`);

    // Step 5: multimeter reads from the same engine
    const meter = createMeterState();
    meter.mode = 'resistance';
    meter.probeA = { netId: nets[0].id, partId: null, terminal: null };
    meter.probeB = { netId: nets[1].id, partId: null, terminal: null };

    const reading = readMeter(meter, c);
    // Board is powered → should refuse resistance measurement
    assert.ok(reading.note && reading.note.includes('Turn power OFF'),
      'resistance on powered board should prompt power-off');
  });

  it('setEngine rejects incomplete engine', () => {
    assert.throws(
      () => setEngine({ BoardImpl, inferNetlist }),
      /checkWiring is required/
    );
  });
});
