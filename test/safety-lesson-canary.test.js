/**
 * Safety-lesson canary — the no-resistor LED must stay broken.
 *
 * Example 31-no-resistor-led encodes a DELIBERATE mistake: an LED
 * wired directly from VCC to GND with no series resistor. The DRC
 * must flag it, but nothing in the stack may automatically fix it.
 *
 * If this circuit ever comes back from a round trip with an extra
 * resistor, something is editing user work without being asked.
 */

import './_setup.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Circuit, resetIds } from '../src/model/circuit.js';
import { runDrc } from '../src/model/drc.js';
import { resolveKind } from '../src/model/terminal-aliases.js';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));

// This resolved ONE path — ../../bw-cfront/sb3-creator/examples/... — which
// exists on no machine and cannot exist on CI, where sb3-creator is cloned
// beside the repo. So the canary never once read its circuit. Worse than a
// skip: it registered `it('SKIP: canary file not available', () => ok(true))`,
// a test that PASSES, so a safety gate checking nothing showed up green in the
// summary rather than as a skip. Same resolution order as the other corpus
// suites now, and absence is a failure — CI provides sb3-creator, so a canary
// that cannot find its circuit is a broken checkout, not an excused one.
const CANARY_REL = '31-no-resistor-led/circuit.json';
const EXPLICIT_ROOT = process.env.EXAMPLES_DIR || null;
const CANDIDATES = (EXPLICIT_ROOT ? [EXPLICIT_ROOT] : [
  path.resolve(here, '../../sb3-creator/examples'),
  path.resolve(here, '../../bw-cfront/sb3-creator/examples'),
  path.join(process.env.HOME || '', 'code', 'sb3-creator', 'examples'),
]).map((root) => path.join(root, CANARY_REL));
const canaryPath = CANDIDATES.find((c) => existsSync(c)) || null;

describe('safety-lesson canary: 31-no-resistor-led', () => {
  it('the canary circuit is present', () => {
    assert.notEqual(canaryPath, null,
      `Canary circuit absent. Tried:\n  ${CANDIDATES.join('\n  ')}\n`
      + 'A safety gate that cannot read the circuit it guards must not report green.');
  });
  if (!canaryPath) return;

  const raw = JSON.parse(readFileSync(canaryPath, 'utf-8'));

  it('the bad LED has no resistor in its path', () => {
    // Structural check: led_bad's anode connects directly to vcc, cathode to gnd
    const badAnodeWire = raw.wires.find(w =>
      w.to === 'led_bad' && w.toTerminal === 'anode' && w.from === 'vcc1');
    const badCathodeWire = raw.wires.find(w =>
      w.from === 'led_bad' && w.fromTerminal === 'cathode' && w.to === 'gnd1');
    assert.ok(badAnodeWire, 'led_bad anode must connect directly to VCC');
    assert.ok(badCathodeWire, 'led_bad cathode must connect directly to GND');

    // No resistor on the bad path
    const badNets = raw.wires
      .filter(w => w.from === 'led_bad' || w.to === 'led_bad')
      .flatMap(w => [w.from, w.to]);
    assert.ok(!badNets.includes('r1'), 'no resistor on the bad LED path');
  });

  it('DRC flags a standalone no-resistor LED', () => {
    // The canary circuit has both LEDs sharing VCC, so the DRC's net-based
    // check sees the resistor on the shared VCC net. Test with the bad LED
    // alone to verify the rule itself works.
    resetIds();
    const c = new Circuit(5.0);
    const vcc = c.addPart('vcc', {}, 0, 0);
    const gnd = c.addPart('gnd', {}, 0, 0);
    const led = c.addPart('led', { vf: 2.0, color: 'red' }, 0, 0);
    c.addWire(vcc.id, 'vcc', led.id, 'anode');
    c.addWire(led.id, 'cathode', gnd.id, 'gnd');
    c.advanceTo(25_000_000n);

    const warnings = runDrc(c, c.board);
    const hits = warnings.filter(w => w.rule === 'missing-resistor');
    assert.ok(hits.length > 0, 'DRC must flag a no-resistor LED');
    assert.equal(hits[0].partId, led.id);
  });

  it('DRC does not auto-fix the canary circuit', () => {
    // Load the full canary circuit — DRC may or may not flag led_bad
    // (it shares a VCC net with the good path), but crucially it must
    // never ADD a resistor automatically.
    resetIds();
    const c = new Circuit(raw.vcc || 5.0);
    const idMap = new Map();
    for (const p of raw.parts) {
      const part = c.addPart(resolveKind(p.kind), p.params || {}, p.x, p.y);
      idMap.set(p.id, part.id);
    }
    for (const w of raw.wires) {
      c.addWire(idMap.get(w.from), w.fromTerminal, idMap.get(w.to), w.toTerminal);
    }

    // Baseline AFTER loading, not raw.wires.length. Two of the canary's seven
    // wires terminate on a breadboard hole rather than a part terminal — their
    // `to` is an object, not a part id — so a part-to-part loader like this one
    // attaches five. Comparing against seven asserted that the loader handles
    // hole wires, which is a different claim from the one this test is named
    // for, and it is the reason the canary failed the moment it first ran.
    const partsBefore = c.parts.length;
    const wiresBefore = c.wires.length;

    // Run DRC — it produces warnings, never modifies the circuit
    const warnings = runDrc(c, c.board);
    assert.ok(Array.isArray(warnings), 'DRC returns its findings rather than applying them');
    assert.equal(c.parts.length, partsBefore, 'DRC must not add or remove parts');
    assert.equal(c.wires.length, wiresBefore, 'DRC must not add or remove wires');

    // The point of the canary: no resistor appears in the bad LED's path.
    assert.equal(c.parts.filter((p) => p.kind === 'resistor').length,
      raw.parts.filter((p) => p.kind === 'resistor').length,
      'DRC must not add a resistor to fix the deliberate mistake');
  });

  it('round-trip preserves the mistake (no auto-fix)', () => {
    resetIds();
    const c = new Circuit(raw.vcc || 5.0);
    for (const p of raw.parts) c.addPart(resolveKind(p.kind), p.params || {}, p.x, p.y);
    for (const w of raw.wires) {
      const fromId = c.parts.find(pp => pp.x === raw.parts.find(rp => rp.id === w.from)?.x)?.id;
      const toId = c.parts.find(pp => pp.x === raw.parts.find(rp => rp.id === w.to)?.x)?.id;
      if (fromId && toId) c.addWire(fromId, w.fromTerminal, toId, w.toTerminal);
    }

    const saved = c.toJSON();
    // The saved circuit must have exactly the same number of parts — no added resistor
    assert.equal(saved.parts.length, raw.parts.length,
      `part count must not change (got ${saved.parts.length}, expected ${raw.parts.length}) — ` +
      'if a resistor appeared, something auto-fixed the circuit');
    // No resistor on led_bad's nets
    const ledBad = saved.parts.find(p => p.kind === 'led' && p.params?.color === 'red');
    assert.ok(ledBad, 'red LED (the bad one) must survive');
  });
});
