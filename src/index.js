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
export { exportGerbers } from './model/exporters/gerber.js';

// Every writer we ship, and the only list a menu may render from. Exporting
// the REGISTRY rather than eleven functions is the point: a host that adds a
// format to its own menu by hand is how three of ours went dark.
// (model/exporters/registry.js carries the measurement.)
export {
  CIRCUIT_EXPORTS, BOARD_EXPORTS, ALL_EXPORTS, runExport,
} from './model/exporters/registry.js';
export { downloadText, downloadBlob } from './model/exporters/download.js';
export { svgToPngBlob, svgStringToPngBlob, serializeSvgStandalone, exportSvgAsPng } from './model/export-png.js';
export { IMPORT_FORMATS, importCircuit, getSupportedFormats } from './importers/index.js';

// Machine extraction (wired-bus → bootable config)
export { extractMachine } from './model/machine-extract.js';

// Audio — share the host's AudioContext so circuit buzzers and Scratch
// sound blocks don't fight over the browser's audio thread.
export { setSharedAudioContext } from './audio/buzzer-audio.js';

// i18n
export { t } from './i18n/strings.js';
