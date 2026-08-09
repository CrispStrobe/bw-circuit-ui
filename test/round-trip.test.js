// Round-trip test: inferCircuit → Circuit → circuitToDeclarations
// should produce declarations that agree with the original pins.json.
//
// The fixtures in stc/examples/<name>/pins.json were produced from the
// compiler side. Agreeing with them is a real round-trip validation.

import './_setup.js';
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { inferCircuit } from '../src/model/inference.js';
import { Circuit, resetIds } from '../src/model/circuit.js';
import { circuitToDeclarations } from '../src/model/declarations.js';

beforeEach(() => resetIds());

// Resolve fixtures relative to THIS FILE, never the process CWD — a
// CWD-relative path made the suite pass or fail depending on which checkout
// ran it, which read as "the agent ignored the red tests" when it was really
// "the tests only exist from one directory". Vendored copies win; a live
// sibling stc checkout (or $BW_STC_DIR) is consulted after them.
const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_BASES = [
  (name) => join(HERE, 'fixtures', 'pins', `${name}.json`),
  (name) => join(HERE, '..', '..', 'stc', 'examples', name, 'pins.json'),
  (name) => join(HERE, '..', '..', '..', 'stc', 'examples', name, 'pins.json'),
  ...(process.env.BW_STC_DIR ? [(name) => join(process.env.BW_STC_DIR, 'examples', name, 'pins.json')] : []),
];

function loadFixture(name) {
  for (const base of FIXTURE_BASES) {
    try {
      return JSON.parse(readFileSync(base(name), 'utf-8'));
    } catch { /* next candidate */ }
  }
  return null;
}

function buildCircuit(stc) {
  const { parts, nets } = inferCircuit(stc);
  const c = new Circuit(5.0);
  for (const p of parts) {
    // Add declName from the original pin declarations
    const pin = (stc.pins || []).find(pp => {
      const safeName = pp.name.replace(/[^a-zA-Z0-9_]/g, '_');
      return p.id.includes(safeName) && ['led', 'buzzer', 'button', 'potentiometer'].some(k => p.kind === k);
    });
    const pCopy = { ...p };
    if (pin) pCopy.declName = pin.name;
    c.parts.push(pCopy);
  }
  for (const net of nets) {
    for (let i = 1; i < net.terminals.length; i++) {
      c.wires.push({
        id: `w_${net.id}_${i}`, netId: net.id,
        from: net.terminals[0], to: net.terminals[i],
      });
    }
  }
  c._syncNetlist();
  return c;
}

// Test cases: examples whose pins should round-trip cleanly.
// Skip examples that use PORT or PART shapes (circuitToDeclarations
// produces individual PINs, not PORTs/PARTs).
const PIN_EXAMPLES = [
  { name: '01-blink', expectedPins: 2 },
  { name: '02-button', expectedPins: 3 },
  { name: '03-potentiometer', expectedPins: 2 },
  { name: '04-brightness', expectedPins: 2 },
  { name: '05-scheduler', expectedPins: 2 },
  { name: '06-dimmer', expectedPins: 2 },
  { name: '07-buzzer', expectedPins: 2 },
];

describe('round-trip: pins.json → inferCircuit → circuitToDeclarations', () => {
  for (const { name, expectedPins } of PIN_EXAMPLES) {
    it(`${name}: declarations match fixture`, () => {
      const fixture = loadFixture(name);
      if (!fixture) { assert.fail(`fixture not found: ${name}`); return; }

      const c = buildCircuit(fixture);
      const decls = circuitToDeclarations(c.parts, c.wires);

      // Same number of pin declarations
      assert.equal(decls.pins.length, expectedPins,
        `${name}: expected ${expectedPins} pins, got ${decls.pins.length}`);

      // Each fixture pin should have a matching declaration
      for (const fpin of fixture.pins) {
        const match = decls.pins.find(d => d.name === fpin.name);
        assert.ok(match, `${name}: missing declaration for "${fpin.name}"`);

        // Port and bit must match
        assert.equal(match.port, fpin.port,
          `${name}/${fpin.name}: port ${match.port} != fixture ${fpin.port}`);
        assert.equal(match.bit, fpin.bit,
          `${name}/${fpin.name}: bit ${match.bit} != fixture ${fpin.bit}`);

        // Direction must agree (normalize pwm → output, tone → tone)
        const normDir = fpin.direction === 'pwm' ? 'output' : fpin.direction;
        assert.equal(match.direction, normDir,
          `${name}/${fpin.name}: direction "${match.direction}" != fixture "${normDir}"`);

        // Polarity must agree
        assert.equal(match.activeLow, fpin.activeLow,
          `${name}/${fpin.name}: activeLow ${match.activeLow} != fixture ${fpin.activeLow}`);
      }
    });
  }
});
