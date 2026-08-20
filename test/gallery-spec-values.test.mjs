/**
 * Gallery values that a documented spec pins, not that we snapshotted.
 *
 * Every number here is asserted because a datasheet or a shipped EXPECTED.md
 * says so — not because the engine currently produces it. That distinction is
 * the point: these same examples were producing DIFFERENT numbers until an
 * unconnected terminal stopped being stamped as a grounded one, and the old
 * values contradicted content we ship.
 *
 *   pc38-relay-changeover  EXPECTED.md: relay.nc 4.9997 V   (was 0.000)
 *   75-battery-tester      EXPECTED.md: >1399 mV -> FULL    (was 0.000, "dead")
 *   pc25-relay-isolator    EXPECTED.md: coil 0 V, no 2.00 V (was 2.5 / 0.000)
 *   the 555 examples       datasheet: CONTROL = 2/3 Vcc     (was 0.000)
 *
 * Why this exists as well as bw-board's dangling-terminal unit test: the same
 * ground/no-net conflation still lives in stampZener, stampOpamp and
 * stampCapAsSource, which were left alone deliberately. If it comes back
 * through one of those, a unit test on stampResistor will not notice and
 * twenty-three shipped examples will quietly go wrong again. This will notice.
 *
 * Skips, loudly, without the gallery checkout — it is a sibling, not vendored.
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
