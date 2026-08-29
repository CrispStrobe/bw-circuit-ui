/**
 * Driving a sweep without freezing the tab — the panel's half of X2.6 / D9.
 *
 * Two paths, one result:
 *
 * - **Worker**, when the host supplied `createSweepWorker` through `setEngine`.
 *   The engine reaches this library as live JS objects, so it cannot be cloned
 *   into a worker; only the host knows where its engine module lives, so only
 *   the host can build the worker entry. What crosses is the netlist
 *   (`sweep-protocol.js`).
 * - **Chunked on this thread** otherwise, one point per macrotask. Not as good
 *   — a single very slow point still blocks — but it is the difference between
 *   a tab that repaints between points and one that does not, and it is what
 *   every host gets for free.
 *
 * Both go through `createSweepRun`, so the rows are identical to each other
 * AND to the old synchronous call. `sweep-session.test.js` asserts that
 * equality exactly.
 *
 * Cancellation is real in both: the chunked path checks between points, the
 * worker gets a `cancel` message it can act on because it also yields between
 * points. A "cancel" that only stops the UI listening is a lie about what the
 * machine is doing.
 */

import { createSweepRun, netlistOf, refuseSweep } from './sweep-protocol.js';

/** One macrotask. `setTimeout(0)` and not a microtask: a promise chain does
 *  not let the browser paint, which is the entire point. */
const yieldToEventLoop = () => new Promise(resolve => setTimeout(resolve, 0));

/**
 * Run a sweep off the critical path.
 *
 * @param {object} opts
 * @param {object} opts.engine   the injected engine
 * @param {object} opts.board    the LIVE board; only its netlist is used
 * @param {'vi'|'bode'} opts.mode
 * @param {object} opts.params   sourceId, from/to or fFrom/fTo, inNet/outNet…
 * @param {(p: {index: number, total: number, row: object}) => void} [opts.onProgress]
 * @param {{cancelled: boolean}} [opts.token] set `.cancelled = true` to stop
 * @returns {Promise<{ok: true, rows: Array<object>, cancelled: boolean, via: 'worker'|'chunked'}
 *                 | {ok: false, reason: string}>}
 */
export async function runSweepAsync({ engine, board, mode, params, onProgress, token }) {
  const refusal = refuseSweep(engine, { mode, params });
  if (refusal) return { ok: false, reason: refusal };

  let netlist;
  try {
    netlist = netlistOf(board);
  } catch (e) {
    return { ok: false, reason: (e && e.message) || String(e) };
  }
  const request = { mode, netlist, params };

  if (typeof engine.createSweepWorker === 'function') {
    try {
      return await runInWorker(engine, request, onProgress, token);
    } catch (e) {
      // A worker that cannot start is not a reason to give no answer, but it
      // IS a reason to say which path produced the numbers — `via` carries
      // that all the way to the panel's footer.
      return runChunked(engine, request, onProgress, token, (e && e.message) || String(e));
    }
  }
  return runChunked(engine, request, onProgress, token, null);
}

async function runChunked(engine, request, onProgress, token, workerError) {
  let run;
  try {
    run = createSweepRun(engine, request);
  } catch (e) {
    return { ok: false, reason: (e && e.message) || String(e) };
  }
  const rows = [];
  for (;;) {
    if (token && token.cancelled) return { ok: true, rows, cancelled: true, via: 'chunked', workerError };
    let r;
    try { r = run.next(); } catch (e) {
      return { ok: false, reason: (e && e.message) || String(e) };
    }
    if (r.done) break;
    rows.push(r.row);
    if (onProgress) onProgress({ index: r.index, total: r.total, row: r.row });
    await yieldToEventLoop();
  }
  return { ok: true, rows, cancelled: false, via: 'chunked', workerError };
}

function runInWorker(engine, request, onProgress, token) {
  return new Promise((resolve, reject) => {
    let worker;
    try { worker = engine.createSweepWorker(); } catch (e) { reject(e); return; }
    if (!worker || typeof worker.postMessage !== 'function') {
      reject(new Error('createSweepWorker returned no worker'));
      return;
    }
    const id = `s${Date.now()}${Math.random().toString(36).slice(2, 7)}`;
    const rows = [];
    let watchdog = null;
    const finish = (value) => {
      clearInterval(watchdog);
      try { worker.terminate?.(); } catch { /* already gone */ }
      resolve(value);
    };
    worker.onerror = (e) => {
      clearInterval(watchdog);
      try { worker.terminate?.(); } catch { /* already gone */ }
      reject(new Error(`sweep worker failed: ${(e && e.message) || 'unknown'}`));
    };
    worker.onmessage = (e) => {
      const m = e.data;
      if (!m || m.id !== id) return;
      if (m.type === 'progress') {
        rows.push(m.row);
        if (onProgress) onProgress({ index: m.index, total: m.total, row: m.row });
      } else if (m.type === 'done') {
        finish({ ok: true, rows: m.rows || rows, cancelled: false, via: 'worker' });
      } else if (m.type === 'cancelled') {
        finish({ ok: true, rows: m.rows || rows, cancelled: true, via: 'worker' });
      } else if (m.type === 'error') {
        clearInterval(watchdog);
        try { worker.terminate?.(); } catch { /* already gone */ }
        reject(new Error(m.reason));
      }
    };
    // The cancel flag lives on this thread; the worker has to be told.
    if (token) {
      watchdog = setInterval(() => {
        if (token.cancelled) {
          clearInterval(watchdog);
          worker.postMessage({ type: 'cancel', id });
        }
      }, 50);
    }
    worker.postMessage({ type: 'run', id, ...request });
  });
}
