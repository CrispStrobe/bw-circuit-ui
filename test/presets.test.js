/**
 * Tests that ALL presets produce valid circuits when run through inferCircuit.
 * This catches regressions when the engine or inference code changes.
 */

import './_setup.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { inferCircuit } from '../src/model/inference.js';
import { Circuit, resetIds } from '../src/model/circuit.js';

// Import the preset data directly from InferPanel's source constants.
// Since it's JSX we can't import it, so we replicate the stc objects.
const PRESETS = [
  // stc/examples
  { name: '01-blink', stc: { device: 'stc12c5a60s2', clock: 11059200,
    pins: [
      { name: 'led1', port: 1, bit: 0, direction: 'output', activeLow: true },
      { name: 'led2', port: 1, bit: 1, direction: 'output', activeLow: true },
    ]}},
  { name: '02-button', stc: { device: 'stc12c5a60s2', clock: 11059200,
    pins: [
      { name: 'led1', port: 1, bit: 0, direction: 'output', activeLow: true },
      { name: 'led2', port: 1, bit: 1, direction: 'output', activeLow: true },
      { name: 'button', port: 3, bit: 2, direction: 'input', activeLow: true },
    ]}},
  { name: '03-potentiometer', stc: { device: 'stc12c5a60s2', clock: 11059200,
    pins: [
      { name: 'led', port: 1, bit: 0, direction: 'output', activeLow: true },
      { name: 'pot', port: 1, bit: 2, direction: 'analog', activeLow: false },
    ]}},
  { name: '04-brightness', stc: { device: 'stc12c5a60s2', clock: 11059200,
    pins: [
      { name: 'low_side', port: 1, bit: 0, direction: 'output', activeLow: true },
      { name: 'high_side', port: 1, bit: 1, direction: 'output', activeLow: false },
    ]}},
  { name: '05-scheduler', stc: { device: 'stc12c5a60s2', clock: 11059200,
    pins: [
      { name: 'slow', port: 1, bit: 0, direction: 'output', activeLow: true },
      { name: 'fast', port: 1, bit: 1, direction: 'output', activeLow: true },
    ]}},
  { name: '06-dimmer', stc: { device: 'stc12c5a60s2', clock: 11059200,
    pins: [
      { name: 'pot', port: 1, bit: 2, direction: 'analog', activeLow: false },
      { name: 'lamp', port: 1, bit: 3, direction: 'pwm', activeLow: true },
    ]}},
  { name: '07-buzzer', stc: { device: 'stc12c5a60s2', clock: 11059200,
    pins: [
      { name: 'button', port: 3, bit: 2, direction: 'input', activeLow: true },
      { name: 'buzzer', port: 3, bit: 5, direction: 'tone', activeLow: false },
    ]}},
  // PORT shape
  { name: '08-seven-segment', stc: { device: 'stc12c5a60s2', clock: 11059200,
    pins: [],
    ports: [{ name: 'segments', port: 0, sfr: 'P0', width: 8, direction: 'output', activeLow: false }],
  }},
  // PART shape
  { name: '09-shift-register', stc: { device: 'stc12c5a60s2', clock: 11059200,
    pins: [], ports: [],
    parts: [{ name: 'leds', kind: '74hc595',
      pins: { data: 'P3.4', clock: 'P3.6', latch: 'P3.5' },
      outputs: 8, activeLow: true }],
  }},
  // Reidemeister drawable-only
  { name: 'R-char-lcd', stc: { device: 'stc12c5a60s2', clock: 11059200,
    pins: [
      { name: 'lcd_rs', port: 2, bit: 6, direction: 'output', activeLow: false },
      { name: 'lcd_e', port: 2, bit: 7, direction: 'output', activeLow: false },
      { name: 'lcd_d4', port: 0, bit: 4, direction: 'output', activeLow: false },
      { name: 'lcd_d5', port: 0, bit: 5, direction: 'output', activeLow: false },
      { name: 'lcd_d6', port: 0, bit: 6, direction: 'output', activeLow: false },
      { name: 'lcd_d7', port: 0, bit: 7, direction: 'output', activeLow: false },
    ]}},
  // LED matrix (PORT + PART combined)
  { name: 'R-led-matrix', stc: { device: 'stc12c5a60s2', clock: 11059200,
    pins: [],
    ports: [{ name: 'cols', port: 0, sfr: 'P0', width: 8, direction: 'output', activeLow: true }],
    parts: [{ name: 'rows', kind: '74hc595',
      pins: { data: 'P3.4', clock: 'P3.6', latch: 'P3.5' },
      outputs: 8, activeLow: false }],
  }},
  // Full board (PIN + PORT combined)
  { name: 'R-full-board', stc: { device: 'stc12c5a60s2', clock: 11059200,
    pins: [
      { name: 'btn0', port: 3, bit: 2, direction: 'input', activeLow: true },
      { name: 'btn1', port: 3, bit: 3, direction: 'input', activeLow: true },
      { name: 'buzzer', port: 1, bit: 5, direction: 'tone', activeLow: false },
      { name: 'pot', port: 1, bit: 2, direction: 'analog', activeLow: false },
    ],
    ports: [{ name: 'leds', port: 2, sfr: 'P2', width: 8, direction: 'output', activeLow: true }],
  }},
];

describe('all presets produce valid circuits', () => {
  for (const preset of PRESETS) {
    it(`${preset.name}: infers without error`, () => {
      resetIds();
      const result = inferCircuit(preset.stc);

      // Must have VCC, GND, MCU
      assert.ok(result.parts.find(p => p.kind === 'vcc'), `${preset.name}: missing VCC`);
      assert.ok(result.parts.find(p => p.kind === 'gnd'), `${preset.name}: missing GND`);
      assert.ok(result.parts.find(p => p.kind === 'mcu'), `${preset.name}: missing MCU`);

      // Must have at least one net
      assert.ok(result.nets.length > 0, `${preset.name}: no nets`);

      // All parts must have layout positions
      for (const part of result.parts) {
        assert.ok(typeof part.x === 'number' && !isNaN(part.x),
          `${preset.name}: ${part.id} missing x`);
        assert.ok(typeof part.y === 'number' && !isNaN(part.y),
          `${preset.name}: ${part.id} missing y`);
      }

      // No "Unknown direction" warnings
      const unknowns = result.notes.filter(n => n.includes('Unknown direction'));
      assert.equal(unknowns.length, 0,
        `${preset.name}: unknown directions: ${unknowns.join('; ')}`);
    });

    it(`${preset.name}: loads into Circuit without crash`, () => {
      resetIds();
      const { parts, nets } = inferCircuit(preset.stc);
      const c = new Circuit(5.0);
      for (const p of parts) c.parts.push({ ...p });
      for (const net of nets) {
        for (let i = 1; i < net.terminals.length; i++) {
          c.wires.push({
            id: `w_${net.id}_${i}`, netId: net.id,
            from: net.terminals[0], to: net.terminals[i],
          });
        }
      }
      c._syncNetlist();

      // "Should not throw" was the entire check, and it was implicit. A preset
      // that inferred ZERO parts, or whose nets resolved to nothing, sailed
      // through it — the test could not tell "loaded" from "loaded nothing".
      assert.ok(c.parts.length > 0,
        `${preset.name}: inferred no parts at all, so "loads without crash" is vacuous`);
      assert.deepEqual(c.parts.length, parts.length,
        `${preset.name}: every inferred part must reach the circuit`);
      assert.doesNotThrow(() => c.advanceTo(1_000_000n),
        `${preset.name}: advancing the loaded circuit must not throw`);

      // And the netlist the engine will be handed must not name parts that are
      // not there — the exact shape that made the app show `netlist-rejected`
      // when a load path left a stale breadboard behind (see
      // test/load-clears-breadboards.test.js).
      const present = new Set(c.parts.map((x) => x.id));
      const dangling = (c.resolvedNets ?? []).flatMap((n) => (n.terminals ?? [])
        .map((t) => t.part || t.partId)
        .filter((id) => id && !String(id).startsWith('@bb:') && !present.has(id)));
      assert.deepEqual([...new Set(dangling)], [],
        `${preset.name}: resolved nets reference parts the circuit does not have`);
    });
  }
});
