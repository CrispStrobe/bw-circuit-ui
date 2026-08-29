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
    if (!engine?.runAcSweep || !engine?.logSpace) return 'this build has no AC sweep wired — the host must inject runAcSweep and logSpace via setEngine';
    if (!params.sourceId) return 'no vsource selected — the Bode sweep drives a voltage source';
    if (!params.inNet || !params.outNet) return 'pick an input and an output net — the sweep measures the transfer between them';
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
  } = params;
  const board = buildBoardFromNetlist(engine, netlist, {
    sourceId,
    sourceParams: { wave: 'sine', amplitude, offset: 0, freq: fFrom },
  });
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
