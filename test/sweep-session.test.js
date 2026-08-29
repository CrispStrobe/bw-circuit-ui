/**
 * X2.6 / D9 — a sweep that does not own the thread.
 *
 * The claim under test is not "it is faster" (it is not) but three separate
 * things that were all false before:
 *
 * 1. **Other work runs while a sweep runs.** Asserted by scheduling a timer
 *    before the sweep and counting how many times it fired during it. Under the
 *    old synchronous call that count was exactly ZERO, whatever the sweep cost,
 *    because nothing between `run()` and its result could reach the event loop.
 * 2. **The rows are identical to the synchronous path.** Not close — the same
 *    numbers. `runDcSweep`/`runAcSweep` are loops over points against one
 *    board with monotonic time, so one point per call in the same order is the
 *    same sequence of operations. A tolerance here would hide the only bug
 *    this refactor could have.
 * 3. **Stop stops the machine.** Cancelling mid-sweep returns the rows
 *    measured so far and stops measuring, rather than leaving the sweep running
 *    with nobody listening.
 *
 * A fourth, for the worker path: what crosses the boundary must survive
 * `structuredClone`, because a live BoardImpl does not and that is the reason
 * the netlist is what is sent.
 */

import './_setup.js';
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Circuit, resetIds } from '../src/model/circuit.js';
import { runSweepAsync } from '../src/model/sweep-session.js';
import {
  createSweepRun, dcPoints, netlistOf, refuseSweep, sweepWorkerHandler,
} from '../src/model/sweep-protocol.js';
import { runBode, runKennlinie } from '../src/model/sweep-runner.js';
import { getEngine } from '../src/engine.js';
import { runDcSweep, runAcSweep, logSpace } from '../../bw-board/src/sweep.js';

beforeEach(() => resetIds());

/** The engine as a host wires it, sweep functions included. */
function engineWithSweep(extra = {}) {
  return { ...getEngine(), runDcSweep, runAcSweep, logSpace, ...extra };
}

/** src → 10 kΩ → 100 nF → gnd. Corner 1/(2π·10k·100n) = 159.155 Hz. */
function rcBench() {
  const c = new Circuit(5.0);
  const gnd = c.addPart('gnd', {}, 0, 0);
  const src = c.addPart('vsource', { wave: 'sine', amplitude: 1, offset: 0, freq: 100 }, 0, 0);
  const r = c.addPart('resistor', { ohms: 10000 }, 0, 0);
  const cap = c.addPart('capacitor', { farads: 100e-9 }, 0, 0);
  c.addWire(src.id, 'pos', r.id, 'a');
  c.addWire(r.id, 'b', cap.id, 'a');
  c.addWire(cap.id, 'b', gnd.id, 'gnd');
  c.addWire(src.id, 'neg', gnd.id, 'gnd');
  const netOf = (part, term) => c.board.getNets().find(n =>
    (n.terminals || []).some(t => t.part === part && t.terminal === term)).id;
  return { c, srcId: src.id, inNet: netOf(src.id, 'pos'), outNet: netOf(cap.id, 'a') };
}

/** src → 470 Ω → LED → gnd, for the V/I curve. */
function ledBench() {
  const c = new Circuit(5.0);
  const gnd = c.addPart('gnd', {}, 0, 0);
  const src = c.addPart('vsource', { volts: 5 }, 0, 0);
  const r = c.addPart('resistor', { ohms: 470 }, 0, 0);
  const led = c.addPart('led', { vForward: 2.0 }, 0, 0);
  c.addWire(src.id, 'pos', r.id, 'a');
  c.addWire(r.id, 'b', led.id, 'anode');
  c.addWire(led.id, 'cathode', gnd.id, 'gnd');
  c.addWire(src.id, 'neg', gnd.id, 'gnd');
  return { c, srcId: src.id };
}

describe('X2.6: the chunked run gives the synchronous run\'s numbers', () => {
  it('V/I: every one of the 60 points is identical', async () => {
    const a = ledBench();
    const sync = runKennlinie(engineWithSweep(), a.c.board, { sourceId: a.srcId, from: 0, to: 5 });
    assert.equal(sync.ok, true, sync.reason);

    const b = ledBench();
    const async_ = await runSweepAsync({
      engine: engineWithSweep(), board: b.c.board, mode: 'vi',
      params: { sourceId: b.srcId, from: 0, to: 5 },
    });
    assert.equal(async_.ok, true, async_.reason);
    assert.equal(async_.rows.length, sync.rows.length);
    assert.equal(async_.rows.length, 60);
    for (let k = 0; k < sync.rows.length; k++) {
      assert.equal(async_.rows[k].v, sync.rows[k].v, `point ${k} voltage`);
      assert.equal(async_.rows[k].i, sync.rows[k].i, `point ${k} current`);
    }
  });

  it('Bode: every point is identical, and the RC corner is still where physics puts it', async () => {
    const a = rcBench();
    const sync = runBode(engineWithSweep(), a.c.board, {
      sourceId: a.srcId, inNet: a.inNet, outNet: a.outNet, fFrom: 100, fTo: 1000,
    });
    assert.equal(sync.ok, true, sync.reason);

    const b = rcBench();
    const async_ = await runSweepAsync({
      engine: engineWithSweep(), board: b.c.board, mode: 'bode',
      params: { sourceId: b.srcId, inNet: b.inNet, outNet: b.outNet, fFrom: 100, fTo: 1000 },
    });
    assert.equal(async_.ok, true, async_.reason);
    assert.equal(async_.rows.length, sync.rows.length);
    for (let k = 0; k < sync.rows.length; k++) {
      assert.equal(async_.rows[k].f, sync.rows[k].f, `point ${k} frequency`);
      assert.equal(async_.rows[k].magDb, sync.rows[k].magDb, `point ${k} magnitude`);
      assert.equal(async_.rows[k].phaseDeg, sync.rows[k].phaseDeg, `point ${k} phase`);
    }
    // The bench is a 10 kΩ / 100 nF low-pass: −3 dB at 159.155 Hz. Somewhere in
    // 100…1000 Hz the magnitude must cross −3 dB and the phase −45°.
    const dbs = async_.rows.map(r => r.magDb);
    assert.ok(Math.max(...dbs) > -3 && Math.min(...dbs) < -3, 'the sweep brackets the corner');
  });
});

describe('X2.6: the main thread keeps running', () => {
  it('a timer scheduled before the sweep fires DURING it', async () => {
    const { c, srcId } = ledBench();
    let ticks = 0;
    const timer = setInterval(() => { ticks++; }, 1);
    const result = await runSweepAsync({
      engine: engineWithSweep(), board: c.board, mode: 'vi',
      params: { sourceId: srcId, from: 0, to: 5 },
    });
    clearInterval(timer);
    assert.equal(result.ok, true);
    // Under the old synchronous call this was exactly 0, because the whole
    // sweep sat between two turns of the loop. One tick per yielded point is
    // the floor; the exact count depends on the box.
    assert.ok(ticks >= 10,
      `the event loop ran ${ticks} times during a 60-point sweep — it used to be 0`);
  });

  it('progress arrives per point, in order, ending at the total', async () => {
    const { c, srcId } = ledBench();
    const seen = [];
    const result = await runSweepAsync({
      engine: engineWithSweep(), board: c.board, mode: 'vi',
      params: { sourceId: srcId, from: 0, to: 5 },
      onProgress: p => seen.push(p.index),
    });
    assert.equal(seen.length, result.rows.length);
    assert.deepEqual(seen, seen.map((_, i) => i + 1), 'indices count 1…n without gaps');
    assert.equal(seen.at(-1), 60);
  });

  it('Stop stops it, and returns what was measured', async () => {
    const { c, srcId } = ledBench();
    const token = { cancelled: false };
    const result = await runSweepAsync({
      engine: engineWithSweep(), board: c.board, mode: 'vi',
      params: { sourceId: srcId, from: 0, to: 5 }, token,
      onProgress: (p) => { if (p.index >= 5) token.cancelled = true; },
    });
    assert.equal(result.ok, true);
    assert.equal(result.cancelled, true);
    assert.equal(result.rows.length, 5, 'the rows measured before the stop are kept');
  });

  it('the run reports WHICH path produced the numbers', async () => {
    const { c, srcId } = ledBench();
    const r = await runSweepAsync({
      engine: engineWithSweep(), board: c.board, mode: 'vi',
      params: { sourceId: srcId, from: 0, to: 1, steps: 60 },
    });
    assert.equal(r.via, 'chunked', 'no worker factory injected, so it says so');
  });
});

describe('X2.6: what crosses a worker boundary', () => {
  it('the netlist snapshot survives structuredClone — a live board does not', () => {
    const { c } = rcBench();
    const snap = netlistOf(c.board);
    const clone = structuredClone(snap);
    assert.deepEqual(clone, snap);
    assert.ok(clone.parts.length >= 4);
    assert.equal(clone.vcc, 5);
    // The thing this exists to avoid. A structured clone keeps DATA and drops
    // the prototype, so a cloned board arrives on the other side looking like a
    // board and answering no method call — which is worse than refusing,
    // because it fails at the first `setNetlist` with a TypeError about
    // something that appears to be right there.
    const clonedBoard = structuredClone(c.board);
    assert.equal(typeof c.board.setNetlist, 'function');
    assert.equal(typeof clonedBoard.setNetlist, 'undefined',
      'a cloned board has no methods — this is why the netlist is what is sent');
  });

  it('the worker handler runs a sweep and posts progress then done', async () => {
    const { c, srcId } = ledBench();
    const handle = sweepWorkerHandler(engineWithSweep());
    const posted = [];
    const finished = new Promise((resolve) => {
      handle({ type: 'run', id: 'x', mode: 'vi', netlist: netlistOf(c.board), params: { sourceId: srcId, from: 0, to: 5 } },
        (m) => { posted.push(m); if (m.type === 'done' || m.type === 'error') resolve(m); });
    });
    const done = await finished;
    assert.equal(done.type, 'done', done.reason);
    assert.equal(done.rows.length, 60);
    assert.equal(posted.filter(m => m.type === 'progress').length, 60);
  });

  it('a cancel message reaches a worker mid-sweep', async () => {
    const { c, srcId } = ledBench();
    const handle = sweepWorkerHandler(engineWithSweep());
    const end = new Promise((resolve) => {
      handle({ type: 'run', id: 'y', mode: 'vi', netlist: netlistOf(c.board), params: { sourceId: srcId, from: 0, to: 5 } },
        (m) => {
          if (m.type === 'progress' && m.index === 3) handle({ type: 'cancel', id: 'y' }, () => {});
          if (m.type === 'cancelled' || m.type === 'done') resolve(m);
        });
    });
    const m = await end;
    assert.equal(m.type, 'cancelled');
    assert.ok(m.rows.length >= 3 && m.rows.length < 60, `stopped after ${m.rows.length} points`);
  });

  it('a worker that fails falls back to the chunked path rather than to nothing', async () => {
    const { c, srcId } = ledBench();
    const engine = engineWithSweep({
      createSweepWorker: () => { throw new Error('no worker in node'); },
    });
    const r = await runSweepAsync({
      engine, board: c.board, mode: 'vi', params: { sourceId: srcId, from: 0, to: 5 },
    });
    assert.equal(r.ok, true);
    assert.equal(r.via, 'chunked');
    assert.match(r.workerError, /no worker in node/);
    assert.equal(r.rows.length, 60);
  });
});

describe('X2.6: refusals name what is missing on OUR side', () => {
  it('a build with no sweep functions blames the build, not the circuit', () => {
    assert.match(refuseSweep({}, { mode: 'vi', params: { sourceId: 'V1' } }), /host must inject runDcSweep/);
    assert.match(refuseSweep({}, { mode: 'bode', params: { sourceId: 'V1', inNet: 'a', outNet: 'b' } }), /runAcSweep/);
  });

  it('a missing source or net is named exactly', () => {
    const e = engineWithSweep();
    assert.match(refuseSweep(e, { mode: 'vi', params: {} }), /no vsource selected/);
    assert.match(refuseSweep(e, { mode: 'bode', params: { sourceId: 'V1' } }), /input and an output net/);
    assert.equal(refuseSweep(e, { mode: 'vi', params: { sourceId: 'V1' } }), null);
  });

  it('an unknown mode is refused rather than silently treated as one of the two', () => {
    assert.match(refuseSweep(engineWithSweep(), { mode: 'montecarlo', params: {} }), /unknown sweep mode/);
    assert.throws(() => createSweepRun(engineWithSweep(), { mode: 'nope', netlist: { parts: [], nets: [] }, params: {} }));
  });

  it('dcPoints reproduces runDcSweep\'s own formula, ends included', () => {
    assert.deepEqual(dcPoints({ from: 0, to: 5, steps: 6 }), [0, 1, 2, 3, 4, 5]);
    assert.deepEqual(dcPoints({ from: 2, to: 2, steps: 1 }), [2]);
    assert.equal(dcPoints({ from: 0, to: 5 }).length, 60);
  });
});
