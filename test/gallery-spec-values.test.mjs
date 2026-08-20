/**
 * Gallery values that a documented spec pins — and one that guards a fix.
 *
 * TWO different things live here, and the difference matters because I got it
 * wrong once already and shipped the mistake.
 *
 * The first four tests are SPEC CONFORMANCE. Each number comes from a
 * datasheet or a shipped EXPECTED.md, never from what the engine happens to
 * print. They are true and worth keeping. They do NOT guard the
 * unconnected-terminal fix — measured, not assumed: all four pass against the
 * pre-fix solver.
 *
 * I originally claimed they did guard it. That came from an A/B whose
 * comparison module tree had its OWN devices.js with an EMPTY registry,
 * because registerAllDevices() had only been called on the primary tree. With
 * no device models, relays and 555s fell back to generic behaviour, and I read
 * a missing registry as a code change — inventing dramatic before/after values
 * for a battery tester and a relay isolator that never moved at all.
 *
 * The LAST test is the actual regression guard, and it fails against the
 * pre-fix solver. When comparing two versions of a module across separate
 * trees, register the devices in both, or the diff measures the harness.
 */


import './_setup.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { solveMNA } from '../../bw-board/src/mna.js';
import { Circuit } from '../src/model/circuit.js';

const GALLERY = process.env.EXAMPLES_DIR
  || path.join(process.env.HOME || '', 'code', 'sb3-creator', 'examples');
const SKIP = existsSync(GALLERY) ? false
  : `no gallery at ${GALLERY} — set EXAMPLES_DIR (sibling sb3-creator checkout)`;

/** Solve a gallery example flat and return netId -> volts, plus a terminal index. */
function solveExample(dir) {
  const raw = JSON.parse(readFileSync(path.join(GALLERY, dir, 'circuit.json'), 'utf8'));
  const c = Circuit.fromJSON(raw.circuit || raw);
  const nets = c.resolvedNets || [];
  const parts = c.parts.filter((p) => p.kind !== 'breadboard' && p.kind !== 'meter')
    .map((p) => ({ id: p.id, kind: p.kind, params: p.params, terminals: p.terminals }));
  const res = solveMNA(parts, nets, new Map(), new Map(), (raw.circuit || raw).vcc ?? 5);
  const at = (partDotTerminal) => {
    const [id, term] = partDotTerminal.split('.');
    const n = nets.find((x) => x.terminals.some((t) => t.part === id && t.terminal === term));
    assert.ok(n, `${dir}: no net carries ${partDotTerminal} — the example has changed shape`);
    return res.nodeVoltages.get(n.id);
  };
  return { res, at, nets, parts };
}

describe('gallery values their own specs pin', { skip: SKIP }, () => {
  test("an unconnected 555 CONTROL pin sits at 2/3 Vcc", () => {
    // Datasheet, not snapshot: the control pin is the top of the internal
    // divider. It was reading 0 V because an unwired pin was stamped to ground.
    const cases = [['51-555-astable', 'u1.control'], ['pc47-555-monostable', 'timer.control'],
      ['pc27-timer-pulse', 'u1.control'], ['pc58-555-audio-pulse', 'timer.control']];
    let checked = 0;
    for (const [dir, term] of cases) {
      if (!existsSync(path.join(GALLERY, dir, 'circuit.json'))) continue;
      const { at } = solveExample(dir);
      const v = at(term);
      assert.ok(Math.abs(v - (2 / 3) * 5) < 0.05,
        `${dir} ${term}: expected 2/3 x 5 V = 3.333, got ${v}`);
      checked++;
    }
    assert.ok(checked >= 2, `only ${checked} 555 examples found — this check has hollowed out`);
  });

  test('a good AA cell does not read as dead', () => {
    // 75-battery-tester's EXPECTED.md puts FULL above 1399 mV. Reading 0 V
    // here is not a rounding difference, it is the tester calling a good cell
    // flat — the user-visible face of the same bug.
    const { at } = solveExample('75-battery-tester');
    const v = at('cell1.pos');
    assert.ok(v > 1.399, `cell1.pos = ${v} V; the example's own FULL threshold is 1.399 V`);
    assert.ok(v < 1.6, `cell1.pos = ${v} V is above any plausible AA cell`);
  });

  test('an unconnected CONTROL pin does not load the 555 timing network', () => {
    // THIS one guards the fix. The 555's control pin is unwired in these
    // examples, and while an unconnected terminal was stamped as a grounded
    // one it loaded the chip's internal divider and dragged the timing node
    // below the rail. At the DC operating point, with the cap open and nothing
    // loading it, threshold must sit AT the supply.
    //
    // Pre-fix: 4.8077 V in 51-555-astable, 1.6656 V in pc74-ldr-555-blinker —
    // a pin attached to nothing pulling a timing node down by 3.3 V.
    let checked = 0;
    for (const [dir, term] of [['51-555-astable', 'u1.threshold'],
      ['pc74-ldr-555-blinker', 'timer_555_3.threshold']]) {
      if (!existsSync(path.join(GALLERY, dir, 'circuit.json'))) continue;
      const v = solveExample(dir).at(term);
      assert.ok(Math.abs(v - 5) < 0.01,
        `${dir} ${term} = ${v} V; an unwired CONTROL pin must not load it below the 5 V rail`);
      checked++;
    }
    assert.ok(checked >= 1, 'neither 555 example was found — this guard has hollowed out');
  });

  test('an unloaded relay contact sits at its own supply', () => {
    // pc38-relay-changeover's EXPECTED.md records relay.nc at 4.9997 V.
    const { at } = solveExample('pc38-relay-changeover');
    const v = at('relay.nc');
    assert.ok(Math.abs(v - 5) < 0.01, `relay.nc = ${v} V, EXPECTED.md says 4.9997`);
  });

  test('the isolator matches both rows of its own table', () => {
    // Both of these were wrong before, in opposite directions: the coil read
    // 2.5 V where the doc says 0, and the contact read 0 where it says 2.00.
    const { at } = solveExample('pc25-relay-isolator');
    assert.ok(Math.abs(at('relay1.coil_a') - 0) < 0.01,
      `coil_a = ${at('relay1.coil_a')} V, EXPECTED.md says 0 V with the switch open`);
    assert.ok(Math.abs(at('relay1.no') - 2) < 0.05,
      `relay1.no = ${at('relay1.no')} V, EXPECTED.md says 2.00 V`);
  });
});
