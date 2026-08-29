/**
 * The dev harness's sweep worker — and the reference implementation of the one
 * a host has to write.
 *
 * This file is the ONLY place in the library that imports bw-board by path,
 * apart from `main.jsx`, and for the same reason: both are the harness, not the
 * library. The library itself receives the engine through `setEngine`, and a
 * live `BoardImpl` class cannot be cloned into a worker — so the worker has to
 * import an engine of its own, and only the host knows where its engine module
 * is. What crosses the thread boundary is a netlist (see `sweep-protocol.js`).
 *
 * A host copies this file, points the three imports at its own vendored engine,
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

import { BoardImpl } from '../../bw-board/src/board.js';
import { runDcSweep, runAcSweep, logSpace } from '../../bw-board/src/sweep.js';
import { registerAllDevices } from '../../bw-board/src/register-all.js';
import { sweepWorkerHandler } from './model/sweep-protocol.js';

// The same registration main.jsx does: without it every registered kind
// (keypad_4x4, at24c02, …) rejects the netlist and the offline board the sweep
// builds is empty — the sweep would then return a curve of nothing.
registerAllDevices();

const handle = sweepWorkerHandler({ BoardImpl, runDcSweep, runAcSweep, logSpace });

self.onmessage = (e) => handle(e.data, (m) => self.postMessage(m));
