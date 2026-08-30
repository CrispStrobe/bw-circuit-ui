/**
 * Sweep runner — the panel-side plumbing for the engine's sweep instrument
 * (bw-board src/sweep.js: runDcSweep / runAcSweep).
 *
 * A sweep MUTATES its board: setControl steps the source and advanceTo
 * fast-forwards sim time. Running that on the interactive board would
 * teleport the student's circuit minutes into the future mid-experiment.
 * So every sweep runs on a FRESH board built from the live board's own
 * netlist — an offline copy, discarded after the run. The live board is
 * never touched.
 *
 * Truthful-refusal contract (the machine-extract lesson, 2026-08-16):
 * when the engine injection lacks the sweep functions, say THAT — never
 * a message that blames the circuit.
 */

import { acPoints, acRowAt } from './sweep-protocol.js';

/**
 * List the sweepable sources on a board: vsource parts, id + params.
 * @param {object} board - live engine board
 * @returns {Array<{id: string, params: object}>}
 */
export function listSweepSources(board) {
  const parts = board?.parts || [];
  return parts.filter(p => p.kind === 'vsource').map(p => ({ id: p.id, params: p.params || {} }));
}

/**
 * Find the net a part terminal sits on.
 * @returns {string|null}
 */
export function netOfTerminal(board, partId, terminal) {
  for (const n of board?.getNets?.() || []) {
    if ((n.terminals || []).some(t => t.part === partId && t.terminal === terminal)) return n.id;
  }
  return null;
}

/**
 * Build the offline copy: same parts and nets, fresh time, powered.
 * `configureSource` may rewrite the swept source's params (e.g. force a
 * sine for Bode) — it gets a cloned part and returns its params.
 *
 * @param {object} engine - the injected engine (BoardImpl required)
 * @param {object} board - live board to copy
 * @param {{sourceId?: string, sourceParams?: object, vcc?: number}} opts
 * @returns {object} the fresh, powered board
 */
export function buildSweepBoard(engine, board, opts = {}) {
  if (!engine?.BoardImpl) throw new Error('engine injection lacks BoardImpl — the host must wire it via setEngine');
  const parts = (board.parts || []).map(p => {
    const clone = { ...p, params: { ...(p.params || {}) } };
    if (opts.sourceId && p.id === opts.sourceId && opts.sourceParams) {
      clone.params = { ...clone.params, ...opts.sourceParams };
    }
    return clone;
  });
  const nets = (board.getNets?.() || []).map(n => ({ ...n, terminals: [...(n.terminals || [])] }));
  const fresh = new engine.BoardImpl(opts.vcc ?? board.vcc ?? 5.0);
  fresh.setNetlist(parts, nets);
  if (fresh.setPower) fresh.setPower(true);
  return fresh;
}

/**
 * V/I characteristic (Kennlinie) of whatever load hangs on the source.
 * @returns {{ok: true, rows: Array<{v:number,i:number}>} | {ok: false, reason: string}}
 */
export function runKennlinie(engine, board, { sourceId, from = 0, to = 5, steps = 60 } = {}) {
  if (!engine?.runDcSweep) {
    return { ok: false, reason: 'this build has no DC sweep wired — the host must inject runDcSweep via setEngine' };
  }
  if (!sourceId) return { ok: false, reason: 'no vsource selected — the curve tracer steps a voltage source' };
  try {
    const fresh = buildSweepBoard(engine, board, { sourceId });
    const rows = engine.runDcSweep(fresh, { sourceId, from, to, steps });
    return { ok: true, rows };
  } catch (e) {
    return { ok: false, reason: (e && e.message) || String(e) };
  }
}

/**
 * Bode sweep between two nets. Forces the source to a 1 V sine centred on
 * its own offset (or 0), leaving the live board's params untouched.
 * @returns {{ok: true, rows: Array<{f:number,magDb:number,phaseDeg:number}>} | {ok: false, reason: string}}
 */
export function runBode(engine, board, {
  sourceId, inNet, outNet,
  fFrom = 10, fTo = 100000, pointsPerDecade = 8,
  amplitude = 1, method = 'analytic',
} = {}) {
  if (!sourceId) return { ok: false, reason: 'no vsource selected — the Bode sweep drives a voltage source' };
  if (!inNet || !outNet) return { ok: false, reason: 'pick an input and an output net — the sweep measures the transfer between them' };
  if (method === 'scope' && (!engine?.runAcSweep || !engine?.logSpace)) {
    return { ok: false, reason: 'this build has no scope-measured AC sweep wired — the host must inject runAcSweep and logSpace via setEngine' };
  }
  if (method !== 'scope' && !engine?.BoardImpl?.prototype?.runAc) {
    return { ok: false, reason: 'this build has no analytical AC sweep wired — the injected BoardImpl must provide runAc' };
  }
  try {
    const fresh = buildSweepBoard(engine, board, method === 'scope' ? {
      sourceId, sourceParams: { wave: 'sine', amplitude, offset: 0, freq: fFrom },
    } : {});
    const rows = method === 'scope'
      ? engine.runAcSweep(fresh, {
        sourceId, freqs: engine.logSpace(fFrom, fTo, pointsPerDecade), inNet, outNet,
      })
      // POINT AT A TIME, through the same `acRowAt` the chunked run uses.
      // `runAc` will happily compute the whole range in one call and it is the
      // faster way to ask — it reuses one symbolic factorization across the
      // sweep. It is also uninterruptible, and this is the DEFAULT method, so
      // the panel's progress readout and its Stop button would have been
      // theatre over rows already computed. One route means the synchronous
      // and the chunked answers are equal by construction rather than by
      // assertion; the engine's batched answer is compared against this one,
      // and bounded, in test/sweep-protocol.test.js.
      : acPoints({ fFrom, fTo, pointsPerDecade })
        .map(f => acRowAt(fresh, { sourceId, f, pointsPerDecade, inNet, outNet }));
    return { ok: true, rows };
  } catch (e) {
    return { ok: false, reason: (e && e.message) || String(e) };
  }
}
