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

// Panels — for host integration (lite's circuit tab)
export { DrcPanel } from './components/DrcPanel.jsx';
export { BomPanel } from './components/BomPanel.jsx';
export { ExamplesBrowser } from './components/ExamplesBrowser.jsx';
export { VdpScreen } from './components/VdpScreen.jsx';
export { OrientationInput } from './components/OrientationInput.jsx';
export { MidiMonitor } from './components/MidiMonitor.jsx';
export { StimulusControls } from './components/StimulusControls.jsx';
export { SerialConsole } from './components/SerialConsole.jsx';
export { AsmDebugPanel } from './components/AsmDebugPanel.jsx';
export { ArchitectureFace } from './components/ArchitectureFace.jsx';
export { FramebufferFace } from './components/FramebufferFace.jsx';
export { MediaPanel } from './components/MediaPanel.jsx';

// Panel data functions
export { runDrc, setExtractors } from './model/drc.js';
export { generateBom, bomToCsv } from './model/bom.js';

// Machine extraction (wired-bus → bootable config)
export { extractMachine } from './model/machine-extract.js';

// i18n
export { t } from './i18n/strings.js';
