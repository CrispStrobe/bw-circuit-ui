/**
 * X2.1 — the true small-signal AC path, in the UI, with its honesty attached.
 *
 * bw-board's `runAc` linearises the circuit at its DC operating point and
 * solves the complex network once per frequency. That is a different
 * measurement from `runAcSweep`, which drives a real sine in and correlates
 * the response the way a scope would, and the difference is not speed: the
 * linearised answer is exact for a circuit that IS linear at that bias, and
 * meaningless for one that is not. bw-board says which case it is per point
 * (`outOfLinear`, spec-updates/ac-operating-region.md) — until this landed,
 * nothing in the UI consumed that, so a railed stage's ideal gain was drawn as
 * a smooth curve with nothing to distinguish it from a measurement.
 *
 * Everything below is a HAND-COMPUTED oracle or a structural claim about the
 * chunked run. Nothing here asserts "the engine agrees with itself".
 *
 * @module
 */

import './_setup.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Circuit, resetIds } from '../src/model/circuit.js';
import { getEngine } from '../src/engine.js';
import { runBode } from '../src/model/sweep-runner.js';
import { runSweepAsync } from '../src/model/sweep-session.js';
import { acPoints, createSweepRun, netlistOf } from '../src/model/sweep-protocol.js';
import { bodeAxisLabels, formatDb, regionPhrase, regionSummary, rowIsLinear } from '../src/model/sweep-readout.js';

const netOf = (c, part, terminal) => c.board.getNets().find(n =>
  (n.terminals || []).some(t => t.part === part && t.terminal === terminal))?.id;

/** src → 10 kΩ → 100 nF → gnd. Corner exactly 1/(2π·10⁴·10⁻⁷) Hz. */
function rcBench() {
  resetIds();
  const c = new Circuit(5.0);
  const gnd = c.addPart('gnd', {}, 0, 0);
  const src = c.addPart('vsource', { wave: 'sine', amplitude: 1, offset: 0, freq: 100 }, 0, 0);
  const r = c.addPart('resistor', { ohms: 10000 }, 0, 0);
  const cap = c.addPart('capacitor', { farads: 100e-9 }, 0, 0);
  c.addWire(src.id, 'pos', r.id, 'a');
  c.addWire(r.id, 'b', cap.id, 'a');
  c.addWire(cap.id, 'b', gnd.id, 'gnd');
  c.addWire(src.id, 'neg', gnd.id, 'gnd');
  return { c, srcId: src.id, inNet: netOf(c, src.id, 'pos'), outNet: netOf(c, cap.id, 'a') };
}

/**
 * An op-amp with its + input driven straight from the swept source and its −
 * input at ground, loaded by 10 kΩ. Open loop, so the default gain of 1e6
 * decides everything: `volts` sets the DC bias, and therefore the REGION.
 *
 *   volts = 1e-6  → ideal output 1 V, inside the 0…5 V rails → linear
 *   volts = 1     → ideal output 1e6 V, far past the rail    → saturated high
 */
function opampBench(volts) {
  resetIds();
  const c = new Circuit(5.0);
  const gnd = c.addPart('gnd', {}, 0, 0);
  const src = c.addPart('vsource', { volts }, 0, 0);
  const u = c.addPart('opamp', {}, 0, 0);
  const rl = c.addPart('resistor', { ohms: 10000 }, 0, 0);
  c.addWire(src.id, 'pos', u.id, 'inp');
  c.addWire(u.id, 'inn', gnd.id, 'gnd');
  c.addWire(src.id, 'neg', gnd.id, 'gnd');
  c.addWire(u.id, 'out', rl.id, 'a');
  c.addWire(rl.id, 'b', gnd.id, 'gnd');
  return { c, srcId: src.id, opampId: u.id, inNet: netOf(c, src.id, 'pos'), outNet: netOf(c, u.id, 'out') };
}

const bode = (b, opts = {}) => runBode(getEngine(), b.c.board, {
  sourceId: b.srcId, inNet: b.inNet, outNet: b.outNet, ...opts,
});

describe('X2.1: the small-signal answer, against hand arithmetic', () => {
  it('the RC corner is −3.0103 dB and −45.000°, at the frequency algebra puts it', () => {
    const b = rcBench();
    // f0 = 1/(2πRC) = 1/(2π · 10 kΩ · 100 nF) = 159.15494309189535 Hz.
    const f0 = 1 / (2 * Math.PI * 10000 * 100e-9);
    assert.equal(f0, 159.15494309189535);
    const r = bode(b, { fFrom: f0, fTo: f0 });
    assert.equal(r.ok, true, r.reason);
    assert.equal(r.rows.length, 1, 'a single-frequency request measures ONE point');
    assert.equal(r.rows[0].f, f0, 'and measures it at the frequency asked for');

    // |H(jω0)| = 1/√2 exactly, so 20·log10(1/√2) = −3.010299956639812 dB,
    // and arg H = −atan(ω0RC) = −atan(1) = −45° exactly.
    const magOracle = 20 * Math.log10(1 / Math.SQRT2);
    assert.equal(magOracle, -3.0102999566398125);
    // The residual is the solver's `gmin`: acSweep adds 1e-12 S to every node
    // diagonal, which against this node's 1e-4 S is a 1e-8 relative
    // perturbation — and 4.3e-8 dB is what shows up. Anything larger than a
    // few times that is a model error, not conditioning.
    assert.ok(Math.abs(r.rows[0].magDb - magOracle) < 1e-6,
      `magnitude ${r.rows[0].magDb} vs hand-computed ${magOracle}`);
    assert.ok(Math.abs(r.rows[0].phaseDeg - -45) < 1e-5,
      `phase ${r.rows[0].phaseDeg} vs hand-computed -45`);
    assert.ok(rowIsLinear(r.rows[0]), 'an RC has no stage that can leave a linear region');
    assert.equal(regionSummary(r.rows[0]), '');
  });

  it('a decade above the corner the RC rolls off by 19.957 dB, not by the slogan', () => {
    // The second hand-check on the same bench, and the one a single-point
    // agreement cannot give: the SHAPE. At 10·f0 the magnitude is
    // 20·log10(1/√101) = −20.0432 dB, and at 100·f0 it is
    // 20·log10(1/√10001) = −40.0004 dB.
    const b = rcBench();
    const f0 = 1 / (2 * Math.PI * 10000 * 100e-9);
    const at = (f) => bode(b, { fFrom: f, fTo: f }).rows[0].magDb;
    const oracle = (n) => 20 * Math.log10(1 / Math.sqrt(1 + n * n));
    assert.ok(Math.abs(at(10 * f0) - oracle(10)) < 1e-6, `${at(10 * f0)} vs ${oracle(10)}`);
    assert.ok(Math.abs(at(100 * f0) - oracle(100)) < 1e-6, `${at(100 * f0)} vs ${oracle(100)}`);
    // The decade between them is 10·log10(10001/101) = 19.95722 dB, NOT 20 —
    // the asymptote is only reached in the limit, and asserting 20 here to
    // three decimals would be asserting the textbook slogan instead of the
    // circuit. The gap to the asymptote is itself a hand-computable 0.04278 dB.
    const decade = 10 * Math.log10(10001 / 101);
    assert.ok(Math.abs(decade - 19.9572205) < 1e-6, `hand value drifted: ${decade}`);
    assert.ok(Math.abs((at(10 * f0) - at(100 * f0)) - decade) < 1e-6,
      `measured ${at(10 * f0) - at(100 * f0)} dB per decade, hand-computed ${decade}`);
  });

  it('an op-amp INSIDE its linear region reports its open-loop gain, and says nothing', () => {
    // Gain 1e6 by default, so 20·log10(1e6) = 120 dB exactly. A 1 µV bias puts
    // the ideal output at 1 V, comfortably inside the 0…5 V rails.
    const b = opampBench(1e-6);
    const r = bode(b, { fFrom: 1000, fTo: 1000 });
    assert.equal(r.ok, true, r.reason);
    assert.ok(Math.abs(r.rows[0].magDb - 120) < 1e-6,
      `${r.rows[0].magDb} dB, hand-computed 20·log10(1e6) = 120`);
    assert.equal(r.rows[0].outOfLinear, undefined,
      'a linear stage must carry no flag at all — an always-present warning is no warning');
    assert.equal(regionPhrase(r.rows[0]), '');
  });

  it('an op-amp AT ITS RAIL says so, and its output cannot move', () => {
    // Same part, same gain, one bias apart: 1 V in wants 1e6 V out, so the
    // FSM settles the stage at `high` and the row pins the output VOLTAGE.
    // The small-signal transfer is then exactly zero — the output cannot
    // move — which is −Infinity dB, and that is the correct answer rather
    // than a failure.
    const b = opampBench(1);
    const r = bode(b, { fFrom: 1000, fTo: 1000 });
    assert.equal(r.ok, true, r.reason);
    assert.deepEqual(r.rows[0].outOfLinear,
      [{ part: b.opampId, kind: 'opamp', region: 'high' }]);
    assert.equal(r.rows[0].magDb, -Infinity,
      'a pinned output has zero small-signal transfer, not a small one');
    assert.equal(rowIsLinear(r.rows[0]), false);
    assert.equal(regionSummary(r.rows[0]), `${b.opampId}:high`);

    // And it reaches a reader as a sentence, not as a region code.
    const phrase = regionPhrase(r.rows[0]);
    assert.match(phrase, /not in its linear region at this point/);
    assert.match(phrase, new RegExp(b.opampId));
    assert.match(phrase, /positive rail/);
    assert.match(phrase, /not the stage's gain/);
    assert.match(regionPhrase(r.rows[0], true), /nicht im linearen Bereich/);
  });

  it('the SAME op-amp gives 120 dB or nothing, depending only on where it sits', () => {
    // The whole point of the region flag, stated as one comparison: two runs
    // that differ in nothing but a DC bias, one of which is a measurement and
    // one of which is not.
    const linear = bode(opampBench(1e-6), { fFrom: 1000, fTo: 1000 }).rows[0];
    const railed = bode(opampBench(1), { fFrom: 1000, fTo: 1000 }).rows[0];
    assert.ok(Math.abs(linear.magDb - 120) < 1e-6);
    assert.equal(railed.magDb, -Infinity);
    assert.equal(rowIsLinear(linear), true);
    assert.equal(rowIsLinear(railed), false);
  });
});

describe('X2.1: a −∞ point does not break the readout it belongs to', () => {
  it('the axis is scaled by the points that have a magnitude', () => {
    // Including −Infinity made dbLo −Infinity, every plotted y NaN, and the
    // axis label literally read "-Infinity dB". The railed point is still
    // there — it just does not get to set the scale.
    const rows = [
      { f: 100, magDb: -Infinity, phaseDeg: 0, outOfLinear: [{ part: 'U1', region: 'high' }] },
      { f: 1000, magDb: -6, phaseDeg: -30 },
      { f: 10000, magDb: -20, phaseDeg: -80 },
    ];
    const ax = bodeAxisLabels(rows);
    assert.equal(ax.dbLo, '-20.0 dB');
    assert.equal(ax.dbHi, '1.0 dB');
    assert.ok(!/Infinity|NaN/.test(JSON.stringify(ax)));
  });

  it('the table cell says −∞ rather than "-Infinity"', () => {
    assert.equal(formatDb(-Infinity), '−∞');
    assert.equal(formatDb(Infinity), '+∞');
    assert.equal(formatDb(NaN), '—');
    assert.equal(formatDb(-3.0102999566398125), '-3.010');
  });
});

describe('X2.1: the small-signal sweep runs one point at a time', () => {
  it('acPoints reproduces the frequencies runAc picks for itself', () => {
    // The chunked run has to know its points before it computes any of them.
    // If that list drifts from the engine's, the panel measures a different
    // sweep from the one the engine would have run, under the same label.
    const b = rcBench();
    const engineFreqs = b.c.board.runAc({
      sourceId: b.srcId, from: 100, to: 100000, pointsPerDecade: 8,
      probes: [b.inNet, b.outNet],
    }).map(p => p.hz);
    const ours = acPoints({ fFrom: 100, fTo: 100000, pointsPerDecade: 8 });
    assert.equal(ours.length, engineFreqs.length, 'the same number of points');
    for (let i = 0; i < ours.length; i++) {
      assert.equal(ours[i], engineFreqs[i], `frequency ${i} is bit-identical`);
    }
    assert.deepEqual(acPoints({ fFrom: 250, fTo: 250 }), [250],
      'one frequency is a legitimate request, answered with one point');
    assert.throws(() => acPoints({ fFrom: 0, fTo: 100 }), /above zero/);
    assert.throws(() => acPoints({ fFrom: 100, fTo: 10 }), /above the start/);
  });

  it('one engine call per point — not one batched call handed out slowly', () => {
    // The freeze X2.6 removed, moved one function inwards: computing the whole
    // sweep inside createSweepRun and then dribbling out rows yields between
    // rows that already exist. Counted, because "it feels responsive" is not a
    // measurement.
    const b = rcBench();
    const engine = getEngine();
    let calls = 0;
    class CountingBoard extends engine.BoardImpl {
      runAc(opts) { calls++; return super.runAc(opts); }
    }
    const run = createSweepRun({ ...engine, BoardImpl: CountingBoard }, {
      mode: 'bode', netlist: netlistOf(b.c.board),
      params: { sourceId: b.srcId, inNet: b.inNet, outNet: b.outNet, fFrom: 100, fTo: 10000 },
    });
    assert.equal(calls, 0, 'building the run must not run the sweep');
    assert.ok(run.total >= 9, `only ${run.total} points`);
    for (let i = 1; i <= 3; i++) {
      const step = run.next();
      assert.equal(step.done, false);
      assert.equal(step.index, i);
      assert.equal(calls, i, `after ${i} points the engine has been asked ${i} times`);
    }
  });

  it('the panel\'s async run reaches the same rows the synchronous one does', async () => {
    const sync = bode(rcBench(), { fFrom: 100, fTo: 10000 });
    const b = rcBench();
    const out = await runSweepAsync({
      engine: getEngine(), board: b.c.board, mode: 'bode',
      params: { sourceId: b.srcId, inNet: b.inNet, outNet: b.outNet, fFrom: 100, fTo: 10000 },
    });
    assert.equal(out.ok, true, out.reason);
    assert.equal(out.rows.length, sync.rows.length);
    for (let k = 0; k < sync.rows.length; k++) {
      assert.equal(out.rows[k].f, sync.rows[k].f, `point ${k} frequency`);
      assert.equal(out.rows[k].magDb, sync.rows[k].magDb, `point ${k} magnitude`);
      assert.equal(out.rows[k].phaseDeg, sync.rows[k].phaseDeg, `point ${k} phase`);
    }
  });

  it('the region flag survives the chunked path and the worker protocol', async () => {
    const b = opampBench(1);
    const out = await runSweepAsync({
      engine: getEngine(), board: b.c.board, mode: 'bode',
      params: { sourceId: b.srcId, inNet: b.inNet, outNet: b.outNet, fFrom: 1000, fTo: 10000 },
    });
    assert.equal(out.ok, true, out.reason);
    assert.ok(out.rows.length >= 8, `only ${out.rows.length} points`);
    for (const row of out.rows) {
      assert.deepEqual(row.outOfLinear, [{ part: b.opampId, kind: 'opamp', region: 'high' }],
        'every point of a sweep taken at a saturated bias is flagged');
    }
    // And the row survives structuredClone, which is what a worker does to it.
    const cloned = structuredClone(out.rows[0]);
    assert.deepEqual(cloned.outOfLinear, out.rows[0].outOfLinear);
  });

  it('the engine\'s own batched answer agrees, to the last few bits', () => {
    // `runAc` reuses ONE symbolic factorization across a batched sweep
    // (ac.js: `lu.refactor(csc)`), so asking for the range in one call is a
    // different floating-point route to the same answer than asking point by
    // point. On this bench two of nine points differ by one unit in the last
    // place. That is why the product has ONE route — the panel would otherwise
    // report numbers that depended on whether anything had been chunked — and
    // the residual is measured here rather than assumed small.
    const b = rcBench();
    const batched = b.c.board.runAc({
      sourceId: b.srcId, from: 100, to: 1000, pointsPerDecade: 8,
      probes: [b.inNet, b.outNet],
    });
    const chunked = bode(b, { fFrom: 100, fTo: 1000 });
    assert.equal(chunked.rows.length, batched.length);
    let worst = 0;
    for (let i = 0; i < batched.length; i++) {
      assert.equal(chunked.rows[i].f, batched[i].hz, `point ${i} frequency is bit-identical`);
      const inMag = batched[i].results.get(b.inNet).mag;
      const outMag = batched[i].results.get(b.outNet).mag;
      const db = 20 * Math.log10(outMag / inMag);
      worst = Math.max(worst, Math.abs(chunked.rows[i].magDb - db) / Math.abs(db || 1));
    }
    assert.ok(worst < 1e-12,
      `batched and point-at-a-time differ by ${worst} relative — that is no longer "the last few bits"`);
  });
});
