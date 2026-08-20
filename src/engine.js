/**
 * Engine injection point.
 *
 * The UI never reaches into bw-board by path. Instead, the host calls
 * setEngine() before rendering CircuitDesigner, providing { BoardImpl,
 * inferNetlist, checkWiring }. The Vite dev harness does this at boot
 * with the local copy; brickwright-lite does it with its vendored copy.
 *
 * OPTIONAL: `getDevice` — bw-board's device-registry accessor. When the
 * host injects it, the engine's registered device model becomes the
 * AUTHORITY for terminal NAMES (see terminalsForKind in model/circuit.js).
 * Without it the catalog keeps its pre-2026-08-20 behaviour, so a host
 * that injects only the three required keys still works.
 *
 * Usage (host):
 *   import { setEngine } from 'bw-circuit-ui';
 *   import { BoardImpl } from './lib/bw-board/board.js';
 *   import { inferNetlist, checkWiring } from './lib/bw-board/infer-netlist.js';
 *   import { getDevice, registerAllDevices } from './lib/bw-board/index.js';
 *   registerAllDevices();
 *   setEngine({ BoardImpl, inferNetlist, checkWiring, getDevice });
 *
 * Usage (consumer inside this package):
 *   import { getEngine } from '../engine.js';
 *   const { BoardImpl } = getEngine();
 */

/** @type {{ BoardImpl: any, inferNetlist: any, checkWiring: any, getDevice?: (kind: string) => any } | null} */
let _engine = null;

/**
 * Inject the engine. Must be called before CircuitDesigner mounts.
 *
 * @param {{ BoardImpl: Function, inferNetlist: Function, checkWiring: Function,
 *           getDevice?: (kind: string) => ({terminals?: string[]}|undefined) }} engine
 */
export function setEngine(engine) {
  if (!engine.BoardImpl) throw new Error('setEngine: BoardImpl is required');
  if (!engine.inferNetlist) throw new Error('setEngine: inferNetlist is required');
  if (!engine.checkWiring) throw new Error('setEngine: checkWiring is required');
  _engine = engine;
}

/**
 * Get the injected engine. Throws if not yet set.
 *
 * @returns {{ BoardImpl: Function, inferNetlist: Function, checkWiring: Function }}
 */
export function getEngine() {
  if (!_engine) {
    throw new Error(
      'bw-circuit-ui: engine not injected. Call setEngine({ BoardImpl, inferNetlist, checkWiring }) before using CircuitDesigner.'
    );
  }
  return _engine;
}


/**
 * The engine's registered device model for a kind, or null.
 *
 * Deliberately non-throwing: terminalsForKind() is called from node CLIs
 * and from tests that never inject an engine at all, and a catalog lookup
 * must not be the thing that explodes. Null means "no opinion" and every
 * caller falls back to the local catalog.
 *
 * @param {string} kind
 * @returns {{terminals?: string[]} | null}
 */
export function engineDevice(kind) {
  const getDevice = _engine && _engine.getDevice;
  if (typeof getDevice !== 'function') return null;
  try {
    return getDevice(kind) || null;
  } catch {
    return null;
  }
}

/**
 * The engine's terminal NAMES for a kind, in engine order, or null when the
 * engine has no model for it (built-in kinds, unregistered kinds, or a host
 * that injected no getDevice).
 *
 * @param {string} kind
 * @returns {string[] | null}
 */
export function engineTerminals(kind) {
  const dev = engineDevice(kind);
  const terminals = dev && dev.terminals;
  if (!Array.isArray(terminals) || terminals.length === 0) return null;
  return terminals.slice();
}
