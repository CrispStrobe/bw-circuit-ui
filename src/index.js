/**
 * bw-circuit-ui — importable entry point.
 *
 * Standalone (demo mode):
 *   import { setEngine, CircuitDesigner } from 'bw-circuit-ui';
 *   setEngine({ BoardImpl, inferNetlist, checkWiring });
 *   <CircuitDesigner project={{ pins: [...] }} />
 *
 * With live emulator:
 *   const board = new BoardImpl(5.0);
 *   const adapter = createEmu8051Adapter(emulator, board);
 *   board.setNetlist(parts, nets);
 *   <CircuitDesigner project={{ pins: [...] }} board={board} />
 *
 * With declaration sync (parts → blocks):
 *   <CircuitDesigner
 *     project={{ pins: [...] }}
 *     onDeclarationChange={(decls) => {
 *       // decls = { pins: [...], ports: [...], parts: [...] }
 *       // Write decls to project.stc — the block palette reads from there.
 *       // Polarity derived from wiring, TONE singular, ANALOG P1.x only.
 *     }}
 *   />
 *
 * The host decides where the engine comes from.
 */

export { setEngine } from './engine.js';
export { CircuitDesigner } from './components/CircuitDesigner.jsx';
export { Circuit } from './model/circuit.js';
export { inferCircuit, checkWiring } from './model/inference.js';
export { createMeterState, readMeter } from './model/multimeter.js';
export { generatePartName, partToDeclaration, circuitToDeclarations } from './model/declarations.js';
