/**
 * bw-circuit-ui — importable entry point.
 *
 * Exports a single React component for embedding in brickwright-lite.
 * No Vite-only imports, no import.meta.env, no CSS modules.
 *
 * Usage:
 *   import { CircuitDesigner } from 'bw-circuit-ui';
 *   <CircuitDesigner project={{ pins: [...] }} />
 *
 * The component is self-contained: it creates a BoardImpl internally,
 * infers a default circuit from the project's pin declarations, and
 * drives the simulation. Every electrical value comes from bw-board.
 */

export { CircuitDesigner } from './components/CircuitDesigner.jsx';

// Also export the model for advanced consumers
export { Circuit } from './model/circuit.js';
export { inferCircuit, checkWiring } from './model/inference.js';
export { createMeterState, readMeter } from './model/multimeter.js';
