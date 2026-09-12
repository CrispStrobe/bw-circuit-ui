/**
 * The dev harness's sweep worker — and the reference implementation of the one
 * a host has to write.
 *
 * It lives in `dev/`, NOT in `src/`, and that is load-bearing: a host takes
 * this library as an npm package and imports what it needs from `src/`; the
 * worker is the harness's, not the library's, so it stays out of the package
 * surface the host wires up. The library itself receives the engine through
 * `setEngine`, and a live `BoardImpl` class cannot be cloned into a worker —
 * so the worker has to import an engine of its own. Since 2026-09-12 that
 * engine is the `bw-board` package (a git-sha devDependency here, a peer
 * dependency for hosts), imported BY NAME; the gate in
 * scripts/ci-sibling-pins.test.mjs refuses any sibling-path reach in this
 * file, because a worker is its own module graph and a stale path here
 * fails silently (the sweep falls back to the main thread). What crosses
 * the thread boundary is a netlist (see `sweep-protocol.js`).
 *
 * A host copies this file (the three engine imports already resolve by name),
 * and hands the panel a factory:
 *
 *     setEngine({
 *       BoardImpl, inferNetlist, checkWiring, runDcSweep, runAcSweep, logSpace,
 *       createSweepWorker: () =>
 *         new Worker(new URL('./sweep-worker.js', import.meta.url), { type: 'module' }),
 *     });
 *
 * Without the factory the panel runs the same points chunked on the main
 * thread, which still repaints between them; the worker is the version that
 * survives one slow POINT rather than one slow sweep.
 */

import { BoardImpl } from 'bw-board/board.js';
import { runDcSweep, runAcSweep, logSpace } from 'bw-board/sweep.js';
import { registerAllDevices } from 'bw-board/register-all.js';
import { sweepWorkerHandler } from '../src/model/sweep-protocol.js';

// The same registration main.jsx does: without it every registered kind
// (keypad_4x4, at24c02, …) rejects the netlist and the offline board the sweep
// builds is empty — the sweep would then return a curve of nothing.
registerAllDevices();

const handle = sweepWorkerHandler({ BoardImpl, runDcSweep, runAcSweep, logSpace });

self.onmessage = (e) => handle(e.data, (m) => self.postMessage(m));
