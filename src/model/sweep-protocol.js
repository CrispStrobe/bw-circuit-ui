/**
 * A sweep as DATA — the shape that can cross a worker boundary, and the
 * point-at-a-time executor that both sides run.
 *
 * X2.6 / D9 (the bw-circuit-ui half). `SweepPanel.run` called `runKennlinie`
 * or `runBode` inside a `setTimeout(…, 20)` whose only purpose was to let the
 * button repaint BEFORE the freeze. Everything after that was one synchronous
 * call: a Bode point costs 10/f seconds of simulated time (6 settle + 4 measure
 * cycles), a sweep is dozens of points, and the whole of it ran between two
 * frames. The tab did not repaint, the canvas did not drag, and there was no
 * cancel, because there was no moment at which anything else could run.
 *
 * Two things had to become true, and they are separable:
 *
 * 1. **The sweep has to be interruptible.** That is what `createSweepRun` is
 *    for: it holds the offline board and yields ONE ROW at a time, so the
 *    caller decides what happens between points — yield to the event loop,
 *    report progress, stop.
 * 2. **It should not be on the main thread at all.** That needs a worker, and
 *    a worker cannot be handed a live `BoardImpl` — the engine is INJECTED
 *    into this library as live JS objects (`setEngine`), and a class is not
 *    structured-cloneable. So what crosses the boundary is the netlist, and
 *    the worker rebuilds the board on its own side out of its own engine
 *    import. `netlistOf` is that snapshot, and it is plain data by
 *    construction — `sweep-protocol.test.js` puts it through `structuredClone`
 *    rather than trusting the claim.
 *
 * Splitting by point is EXACTLY equal to the whole-sweep call, not merely
 * close: `runDcSweep` and `runAcSweep` are both a loop over points against one
 * board with monotonically advancing time, re-reading `board.timeNs` on entry.
 * One point per call, in the same order, on the same board, performs the same
 * operations in the same sequence. The test asserts bit-equality rather than a
 * tolerance, because a tolerance would hide the one bug this could have.
 */

/**
 * The cloneable snapshot of a board: what a worker needs to rebuild it.
 * @param {object} board
 * @returns {{parts: Array<object>, nets: Array<object>, vcc: number}}
 */
export function netlistOf(board) {
  return {
    parts: (board?.parts || []).map(p => ({
      id: p.id,
      kind: p.kind,
      params: { ...(p.params || {}) },
      terminals: [...(p.terminals || [])],
    })),
    nets: (board?.getNets?.() || []).map(n => ({
      id: n.id,
      terminals: (n.terminals || []).map(t => ({ part: t.part, terminal: t.terminal })),
    })),
    vcc: board?.vcc ?? 5.0,
  };
}

/**
 * Build the offline board a sweep runs on, from a netlist snapshot.
 * @param {object} engine
 * @param {{parts: Array, nets: Array, vcc: number}} netlist
 * @param {{sourceId?: string, sourceParams?: object}} [opts]
 */
export function buildBoardFromNetlist(engine, netlist, opts = {}) {
  if (!engine?.BoardImpl) throw new Error('engine injection lacks BoardImpl — the host must wire it via setEngine');
  const parts = netlist.parts.map(p => {
    const clone = { ...p, params: { ...(p.params || {}) } };
    if (opts.sourceId && p.id === opts.sourceId && opts.sourceParams) {
      clone.params = { ...clone.params, ...opts.sourceParams };
    }
    return clone;
  });
  const nets = netlist.nets.map(n => ({ ...n, terminals: [...(n.terminals || [])] }));
  const board = new engine.BoardImpl(netlist.vcc ?? 5.0);
  board.setNetlist(parts, nets);
  if (board.setPower) board.setPower(true);
  return board;
}

/** The V/I sweep's own point list — the same formula `runDcSweep` uses. */
export function dcPoints({ from = 0, to = 5, steps = 60 } = {}) {
  const out = [];
  for (let k = 0; k < steps; k++) {
    out.push(steps === 1 ? from : from + ((to - from) * k) / (steps - 1));
  }
  return out;
}

/**
 * The small-signal sweep's own frequency list — the same formula `BoardImpl.runAc`
 * uses internally, reproduced here for the same reason `dcPoints` reproduces
 * `runDcSweep`'s: the run has to know its points BEFORE it computes any of them,
 * or it cannot hand them out one at a time.
 *
 * The values must be bit-identical to the ones a single batched `runAc` would
 * choose, because a per-point run that lands on slightly different frequencies
 * is a different measurement wearing the same label.
 * `sweep-protocol.test.js` asserts that against the engine's own list.
 *
 * @param {{fFrom?: number, fTo?: number, pointsPerDecade?: number}} opts
 * @returns {number[]} hertz, ascending
 */
export function acPoints({ fFrom = 10, fTo = 100000, pointsPerDecade = 8 } = {}) {
  if (!(fFrom > 0)) throw new Error('AC sweep: the start frequency must be above zero');
  // One frequency is a legitimate request (a lesson reads a single Bode point)
  // and `runAc` refuses `to === from`, so it is answered here rather than by
  // nudging the end of the range and hoping the first row is the wanted one.
  if (fTo === fFrom) return [fFrom];
  if (!(fTo > fFrom)) throw new Error('AC sweep: the end frequency must be above the start');
  const decades = Math.log10(fTo / fFrom);
  const n = Math.max(2, Math.round(decades * pointsPerDecade) + 1);
  return Array.from({ length: n }, (_, i) => fFrom * Math.pow(10, (i * decades) / (n - 1)));
}

/**
 * ONE small-signal point, measured on `board` — the single route by which a
 * Bode row is produced, whether the caller wants the whole sweep at once
 * (`runBode`) or one point at a time (`createSweepRun`).
 *
 * It is one route on purpose. `BoardImpl.runAc` can compute a whole range in a
 * single call, and that call is FASTER — it reuses one symbolic factorization
 * across the sweep. It is also uninterruptible, and the moment the analytical
 * method became the default it made the panel's progress readout and its Stop
 * button into theatre over rows that had already been computed. Point-at-a-time
 * makes both real, at the cost of re-solving the operating point per point.
 *
 * The two are NOT bit-identical — reusing a factorization is a different
 * floating-point route to the same answer, and on an RC bench two of nine
 * points differ in the last unit in the last place. Rather than loosen the
 * bit-equality invariant that X2.6's whole test rests on, the product has one
 * route and `sweep-protocol.test.js` measures the engine's batched answer
 * against it explicitly, with the difference bounded and its cause named.
 *
 * @param {object} board — an offline board with `runAc`
 * @param {{sourceId: string, f: number, pointsPerDecade?: number, inNet: string, outNet: string}} opts
 * @returns {{f: number, magDb: number, phaseDeg: number, outOfLinear?: Array}}
 */
export function acRowAt(board, { sourceId, f, pointsPerDecade = 8, inNet, outNet }) {
  // `runAc` insists on to > from, so one frequency is asked for as the
  // narrowest range that still satisfies it, and the first row taken.
  const point = board.runAc({
    sourceId, from: f, to: f * (1 + Number.EPSILON * 8), pointsPerDecade,
    probes: [inNet, outNet],
  })[0];
  return acRow(point, inNet, outNet);
}

/**
 * One small-signal point as a Bode row: the transfer OUT/IN, in dB and degrees,
 * carrying the engine's operating-region verdict when there is one.
 *
 * `outOfLinear` is bw-board's honesty about the linearization itself: a stage
 * sitting at a rail cannot move its output and a current-limited one cannot
 * move its current, so the small-signal answer at that bias is not the stage's
 * gain — it is the gain of a model that does not apply. Carrying the flag on
 * the ROW rather than only on the sweep is what lets a reader see WHICH points
 * are unreliable instead of being told the whole curve might be.
 *
 * @param {{hz: number, results: Map, outOfLinear?: Array}} point
 * @param {string} inNet
 * @param {string} outNet
 * @returns {{f: number, magDb: number, phaseDeg: number, outOfLinear?: Array}}
 */
export function acRow(point, inNet, outNet) {
  const input = point.results.get(inNet);
  const output = point.results.get(outNet);
  if (!input || !output) throw new Error('analytical AC sweep did not return both selected probe nets');
  if (!(input.mag > 0)) throw new Error('analytical AC sweep input magnitude is zero — transfer is undefined');
  let phaseDeg = output.phaseDeg - input.phaseDeg;
  while (phaseDeg > 180) phaseDeg -= 360;
  while (phaseDeg <= -180) phaseDeg += 360;
  return {
    f: point.hz,
    magDb: 20 * Math.log10(output.mag / input.mag),
    phaseDeg,
    ...(point.outOfLinear?.length ? { outOfLinear: point.outOfLinear } : {}),
  };
}

/**
 * A request, validated. Returns the refusal string the panel should show, or
 * null when the request can run. Refusals name what is missing on OUR side —
 * never a message that blames the circuit for a missing engine function.
 *
 * @param {object} engine
 * @param {{mode: string, params: object}} request
 * @returns {string|null}
 */
export function refuseSweep(engine, request) {
  const { mode, params = {} } = request || {};
  if (mode === 'vi') {
    if (!engine?.runDcSweep) return 'this build has no DC sweep wired — the host must inject runDcSweep via setEngine';
    if (!params.sourceId) return 'no vsource selected — the curve tracer steps a voltage source';
    return null;
  }
  if (mode === 'bode') {
    const method = params.method ?? 'analytic';
    if (!params.sourceId) return 'no vsource selected — the Bode sweep drives a voltage source';
    if (!params.inNet || !params.outNet) return 'pick an input and an output net — the sweep measures the transfer between them';
    if (method === 'scope' && (!engine?.runAcSweep || !engine?.logSpace)) return 'this build has no scope-measured AC sweep wired — the host must inject runAcSweep and logSpace via setEngine';
    if (method !== 'scope' && !engine?.BoardImpl?.prototype?.runAc) return 'this build has no analytical AC sweep wired — the injected BoardImpl must provide runAc';
    return null;
  }
  return `unknown sweep mode "${mode}"`;
}

/**
 * A running sweep, one point at a time.
 *
 * @param {object} engine
 * @param {{mode: 'vi'|'bode', netlist: object, params: object}} request
 * @returns {{total: number, next: () => ({done: true} | {done: false, row: object, index: number, total: number})}}
 */
export function createSweepRun(engine, request) {
  const refusal = refuseSweep(engine, request);
  if (refusal) throw new Error(refusal);
  const { mode, netlist, params } = request;
  const { sourceId } = params;

  if (mode === 'vi') {
    const board = buildBoardFromNetlist(engine, netlist, { sourceId });
    const points = dcPoints(params);
    let k = 0;
    return {
      total: points.length,
      next() {
        if (k >= points.length) return { done: true };
        const v = points[k++];
        const row = engine.runDcSweep(board, { sourceId, from: v, to: v, steps: 1 })[0];
        return { done: false, row, index: k, total: points.length };
      },
    };
  }

  const {
    inNet, outNet, fFrom = 10, fTo = 100000, pointsPerDecade = 8, amplitude = 1,
    method = 'analytic',
  } = params;
  // Analytical AC supplies its own unit phasor and MUST retain the source's DC
  // value: that bias decides whether an op-amp is linear, railed, or limited.
  const board = buildBoardFromNetlist(engine, netlist, method === 'scope' ? {
    sourceId, sourceParams: { wave: 'sine', amplitude, offset: 0, freq: fFrom },
  } : {});
  if (method !== 'scope') {
    // ONE FREQUENCY PER CALL, not one batched `runAc` dribbled out afterwards.
    // The first version of this did the latter: the whole small-signal sweep
    // ran inside `createSweepRun`, synchronously, and the "chunked" run then
    // handed out rows that were already computed. That yields between rows a
    // reader can no longer wait for, which is the freeze X2.6 removed, moved
    // one function inwards — and it became the DEFAULT path the moment the
    // analytical method did.
    //
    // Each call re-solves the DC operating point. That is the cost, and it is
    // paid deliberately: the board is not mutated by `runAc`, so every point
    // linearises around the SAME bias and the rows come out bit-identical to
    // the batched call. `sweep-session.test.js` asserts that equality rather
    // than assuming it.
    const freqs = acPoints({ fFrom, fTo, pointsPerDecade });
    let k = 0;
    return {
      total: freqs.length,
      next() {
        if (k >= freqs.length) return { done: true };
        const f = freqs[k++];
        const row = acRowAt(board, { sourceId, f, pointsPerDecade, inNet, outNet });
        return { done: false, row, index: k, total: freqs.length };
      },
    };
  }

  const freqs = engine.logSpace(fFrom, fTo, pointsPerDecade);
  let k = 0;
  return {
    total: freqs.length,
    next() {
      if (k >= freqs.length) return { done: true };
      const f = freqs[k++];
      const row = engine.runAcSweep(board, { sourceId, freqs: [f], inNet, outNet })[0];
      return { done: false, row, index: k, total: freqs.length };
    },
  };
}

/**
 * The worker side of the protocol, as a message handler factory.
 *
 * A host builds its own worker entry — only the host knows where its engine
 * module lives — imports its engine there, and installs this:
 *
 *     import { sweepWorkerHandler } from 'bw-circuit-ui/model/sweep-protocol.js';
 *     const handle = sweepWorkerHandler({ BoardImpl, runDcSweep, runAcSweep, logSpace });
 *     self.onmessage = (e) => handle(e.data, (m) => self.postMessage(m));
 *
 * Messages in:  {type:'run', id, mode, netlist, params} · {type:'cancel', id}
 * Messages out: {type:'progress', id, index, total, row} ·
 *               {type:'done', id, rows} · {type:'error', id, reason}
 *
 * Progress is posted per point rather than only at the end, because a sweep
 * that shows nothing for eleven seconds and then everything is a freeze with
 * extra steps, even when the freeze is on another thread.
 *
 * @param {object} engine
 * @returns {(msg: object, post: (m: object) => void) => void}
 */
export function sweepWorkerHandler(engine) {
  const cancelled = new Set();
  return function handle(msg, post) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'cancel') { cancelled.add(msg.id); return; }
    if (msg.type !== 'run') return;
    const { id } = msg;
    cancelled.delete(id);
    let run;
    try {
      run = createSweepRun(engine, msg);
    } catch (e) {
      post({ type: 'error', id, reason: (e && e.message) || String(e) });
      return;
    }
    const rows = [];
    const step = () => {
      if (cancelled.has(id)) { post({ type: 'cancelled', id, rows }); return; }
      let r;
      try { r = run.next(); } catch (e) {
        post({ type: 'error', id, reason: (e && e.message) || String(e) });
        return;
      }
      if (r.done) { post({ type: 'done', id, rows }); return; }
      rows.push(r.row);
      post({ type: 'progress', id, index: r.index, total: r.total, row: r.row });
      // A macrotask between points so a 'cancel' message can be delivered.
      // Without it the worker is as uninterruptible as the main thread was.
      setTimeout(step, 0);
    };
    step();
  };
}
