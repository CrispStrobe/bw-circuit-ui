/**
 * CircuitDesigner — the top-level React component for embedding.
 *
 * Props:
 *   project: { device?, clock?, pins: StcPin[] }
 *     Pin declarations from the project. The circuit is re-inferred
 *     whenever this prop changes (shallow compare on pins array).
 *
 *   board?: BoardImpl
 *     Optional external board instance. When provided, the component
 *     uses it instead of creating its own. The host connects the
 *     emulator adapter to this board; the component subscribes to
 *     onChange for re-rendering. The scripted simulation loop is
 *     skipped — the emulator drives pin events.
 *     When omitted, the component creates its own board and runs
 *     a scripted demo simulation.
 *
 *   debugState?: { halted: boolean, skewNs?: bigint }
 *     When the debugger halts the program, advanceTo stops being called
 *     and the board freezes coherently. setControl stays live (user intent,
 *     not physics). On resume, time continues from where it stopped — no
 *     wall-clock catch-up. skewNs > 0 means a live target whose hardware
 *     kept moving while the program was halted; the panel must render that
 *     differently from a genuinely frozen simulation.
 *
 *   circuitData?: { vcc, parts, wires }
 *     When set to a non-null value, loads the circuit (replacing the
 *     current one). Previous state is pushed to history, so Ctrl+Z
 *     recovers unsaved work. The designer tolerates a circuit without
 *     matching pin declarations — standalone circuits have no MCU.
 *     Set to null/undefined after loading to allow the next load.
 *
 *   onProgramChange?: (program: {source: string, device?: string, pins?: Array}) => void
 *     Called when an example with both circuit AND program is loaded.
 *     The host uses this to load the program into the blocks/runtime
 *     (without it, examples with program.bw load only the circuit half
 *     and the debugger says "no pins declared").
 *
 * Every electrical value comes from bw-board. Nothing is fabricated.
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { BoardCanvas } from './BoardCanvas.jsx';
import { PartPalette } from './PartPalette.jsx';
import { InferPanel } from './InferPanel.jsx';
import { ImportCircuitMenu } from './ImportCircuitMenu.jsx';
import { ExamplesBrowser } from './ExamplesBrowser.jsx';
import { CodexBrowser } from './CodexBrowser.jsx';
import { t } from '../i18n/strings.js';
import { Multimeter } from './Multimeter.jsx';
import { ScopePanel } from './ScopePanel.jsx';
import { SweepPanel } from './SweepPanel.jsx';
import { SchematicPanel } from './SchematicPanel.jsx';
import { useCircuit } from '../hooks/useCircuit.js';
import { useBoard } from '../hooks/useBoard.js';
import { inferCircuit } from '../model/inference.js';
import { generatePartName, circuitToDeclarations } from '../model/declarations.js';
import { flatWire, isLegacyFlatWire, wireEndpoint } from '../model/wire-endpoints.js';
import { updateBuzzerAudio, stopBuzzer, stopAllBuzzers } from '../audio/buzzer-audio.js';
import { CubeScanAccumulator } from '../model/cube-scan.js';
import { DebugStatus } from './DebugStatus.jsx';
import { VdpScreen } from './VdpScreen.jsx';
import { Circuit } from '../model/circuit.js';
import { extractMachine } from '../model/machine-extract.js';
import { OrientationInput } from './OrientationInput.jsx';
import { SerialConsole } from './SerialConsole.jsx';
import { ArchitectureFace } from './ArchitectureFace.jsx';
import { FramebufferFace } from './FramebufferFace.jsx';
import { StimulusControls } from './StimulusControls.jsx';
import { getEngine } from '../engine.js';
import { FOOTPRINTS as BB_FOOTPRINTS, computeLeadMap } from '../model/footprints.js';
import { buildSeatedFromDeclarations } from '../model/infer-seated.js';
import { runDrc } from '../model/drc.js';
import { migrateStarterAutosave } from '../model/starter-migration.js';
import './circuit-theme.css';

const MS = 1_000_000n;
const GRID = 20;

function snapToGrid(v) {
  return Math.round(v / GRID) * GRID;
}

export function CircuitDesigner({ project, stc, board: externalBoard, debugState, debuggerOn = false, debuggerPanel = null, benchOpen = false, simulationOnly, onDeclarationChange, onBoardReady, onCircuitReady, circuitData, runToken, stopToken, onSimulationStart, panelNav, embedded = false, examples, curriculum, onLoadExample, onProgramChange, lang = 'en', debugDock = 'top', onDebugDockChange }) {
  // Accept both `project` and `stc` props (backward compat with lite integration)
  const projectData = project || stc;
  const {
    parts, wires, powered, rev,
    addPart, removePart, nudgeSeated, movePart, duplicatePart, rotatePart, flipPart, updateParams,
    addWire, removeWire, addHoleWire, addTapWire, updateWire,
    setControl, setPartParam, setPin, advanceTo, advanceBy, setPower,
    loadInferred, undo, redo, canUndo, canRedo, saveHistory,
    ledBrightness, buzzerTone, nodeVoltage,
    circuit,
  } = useCircuit(5.0);

  // The active board: external (from host/emulator) or internal (from circuit model)
  const activeBoard = externalBoard || circuit.board;

  // Subscribe to board changes for automatic re-rendering
  const { renderState, refresh } = useBoard(activeBoard);

  // Instrument reads follow the ACTIVE board. useCircuit's readers are bound
  // to circuit.board — the designer's own instance — and that is the LAST
  // link that kept "Blink does not blink" alive (2026-08-10): the emulator
  // drove its (correctly netlisted, correctly grounded) board while every
  // rendered LED still asked the idle internal board and read 0. One board,
  // one truth applies to READS as much as writes.
  const readLedBrightness = useCallback((id) => {
    if (externalBoard && externalBoard.ledBrightness) {
      try { return externalBoard.ledBrightness(id); } catch { return 0; }
    }
    return ledBrightness(id);
  }, [externalBoard, ledBrightness]);

  // Seven-segment faces follow the ACTIVE board, same rule as every
  // other read. The face used to render HARDCODED segments — a running
  // counter always showed "0" (owner: displays must SHOW something).
  const readSevenSegment = useCallback((id) => {
    const b = (externalBoard && externalBoard.sevenSegmentBrightness) ? externalBoard
      : (circuit && circuit.board && circuit.board.sevenSegmentBrightness) ? circuit.board : null;
    if (!b) return null;
    try { return b.sevenSegmentBrightness(id); } catch { return null; }
  }, [externalBoard, circuit]);
  const readSevenSeg3 = useCallback((id, digits = 3) => {
    const b = (externalBoard && externalBoard.sevenSeg3Brightness) ? externalBoard
      : (circuit && circuit.board && circuit.board.sevenSeg3Brightness) ? circuit.board : null;
    if (!b) return null;
    try { return b.sevenSeg3Brightness(id, digits); } catch { return null; }
  }, [externalBoard, circuit]);
  const readBuzzerTone = useCallback((id) => {
    if (externalBoard && externalBoard.buzzerTone) {
      try { return externalBoard.buzzerTone(id); } catch { return null; }
    }
    return buzzerTone(id);
  }, [externalBoard, buzzerTone]);
  const readNodeVoltage = useCallback((netId) => {
    if (externalBoard && externalBoard.nodeVoltage) {
      try { return externalBoard.nodeVoltage(netId); } catch { return null; }
    }
    return nodeVoltage(netId);
  }, [externalBoard, nodeVoltage]);

  // ── Emit declaration changes to host ──────────────────────────
  const lastDeclRef = useRef(null);
  useEffect(() => {
    if (!onDeclarationChange) return;
    // Pass the RESOLVED nets: a seated bench connects through breadboard
    // rows and jumpers, which the wire-walk alone cannot see — without
    // this, every seated board-kind bench derived zero pins and the
    // host's declaration merge wiped the program's pins with the empty
    // list (owner report, 2026-08-17).
    const decls = circuitToDeclarations(parts, wires, circuit.resolvedNets);
    const json = JSON.stringify(decls);
    if (json !== lastDeclRef.current) {
      lastDeclRef.current = json;
      onDeclarationChange(decls);
    }
  }, [parts, wires, onDeclarationChange, circuit]);

  // ── Expose the Board to the host (for the circuit extension) ──
  useEffect(() => {
    if (onBoardReady && circuit.board) {
      onBoardReady(circuit.board);
    }
  }, [circuit.board, onBoardReady, parts, wires]); // re-fire when netlist changes (board rebuilt)

  const [selectedParts, setSelectedParts] = useState(new Set());
  const [selectedWire, setSelectedWire] = useState(null);
  const [fitToken, setFitToken] = useState(0); // bumps on file load → BoardCanvas auto-fits

  // Convenience: first selected part (for single-selection UI like property editor)
  const selectedPart = selectedParts.size === 1 ? [...selectedParts][0] : null;

  const handleSelectPart = useCallback((id, additive) => {
    if (!id) { setSelectedParts(new Set()); return; }
    setSelectedParts(prev => {
      if (additive) {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
      }
      return new Set([id]);
    });
    setSelectedWire(null);
  }, []);
  const [mode, setMode] = useState(externalBoard ? 'simulate' : 'build');
  const lastRunToken = useRef(0);
  const lastStopToken = useRef(0);
  useEffect(() => {
    if (!runToken || runToken === lastRunToken.current) return;
    lastRunToken.current = runToken;
    setMode('simulate');
  }, [runToken]);
  useEffect(() => {
    if (!stopToken || stopToken === lastStopToken.current) return;
    lastStopToken.current = stopToken;
    setMode('build');
  }, [stopToken]);
  const [selectorsOpen, setSelectorsOpen] = useState(!embedded);
  const [partsOpen, setPartsOpen] = useState(!embedded);
  const [examplesOpen, setExamplesOpen] = useState(true);
  const [selectorSplit, setSelectorSplit] = useState(0.68);
  const [codexMode, setCodexMode] = useState(false);
  // Owner requirement: every fresh designer prioritizes bench space. A
  // debugger or lesson/bench context may explicitly demand Instruments;
  // simulation opens the column at the moment it is used.
  const [rightOpen, setRightOpen] = useState(!!debuggerOn || !!benchOpen);
  useEffect(() => {
    if (debuggerOn || benchOpen) setRightOpen(true);
  }, [debuggerOn, benchOpen]);
  const [showScope, setShowScope] = useState(() => {
    try { return localStorage.getItem('bw-instr-scope') === '1'; } catch { return false; }
  });
  const [showMeter, setShowMeter] = useState(() => {
    try { return localStorage.getItem('bw-instr-meter') === '1'; } catch { return false; }
  });
  const toggleScope = () => setShowScope(v => { const n = !v; try { localStorage.setItem('bw-instr-scope', n ? '1' : '0'); } catch {} return n; });
  const toggleMeter = () => setShowMeter(v => { const n = !v; try { localStorage.setItem('bw-instr-meter', n ? '1' : '0'); } catch {} return n; });
  const [showSweep, setShowSweep] = useState(() => {
    try { return localStorage.getItem('bw-instr-sweep') === '1'; } catch { return false; }
  });
  const toggleSweep = () => setShowSweep(v => { const n = !v; try { localStorage.setItem('bw-instr-sweep', n ? '1' : '0'); } catch {} return n; });
  // warningsOpen state removed — warnings now live in the toolbar chip (BoardCanvas)
  const hasMcuPins = !!(projectData?.pins?.length > 0);
  const [machineResult, setMachineResult] = useState(null); // extractMachine result
  const [loaderNote, setLoaderNote] = useState(null); // Machine Loader feedback line

  // Detect retro CPU on the board for the Build Machine action
  const hasRetroCpu = parts.some(p => p.kind === 'w65c02' || p.kind === 'z80');
  useEffect(() => {
    // Machine-class examples need Build Machine and their program loader,
    // both of which live in Instruments. This is a contextual exception to
    // the owner default; an empty or ordinary Circuit Designer stays closed.
    if (hasRetroCpu) setRightOpen(true);
  }, [hasRetroCpu]);

  // Build Machine action: run the extractor, show result, boot on success.
  // Extractors come from the engine (injected via setEngine) or via the
  // onBuildMachine prop. The host wires the bw-board extractors at boot.
  const handleBuildMachine = useCallback(() => {
    const flatCircuit = {
      parts: parts.map(p => ({ id: p.id, kind: p.kind, params: p.params })),
      // flatWire is the canonical dialect reader; this used to be a
      // fifth private copy of it (`w.from?.part || w.from`), which
      // handed a breadboard-hole endpoint straight through as the
      // extractor's `from` string.
      wires: wires.map(flatWire),
    };

    // Try extractors from the engine injection
    const eng = typeof getEngine === 'function' ? getEngine() : {};
    const extractors = {
      extract6502Machine: eng.extract6502Machine,
      extractZ80Machine: eng.extractZ80Machine,
    };

    const result = extractMachine(flatCircuit, extractors);
    setMachineResult(result);

    // On success, notify the host so it can boot the machine. The two
    // extractors shape their bus differently — 6502 memory-maps its
    // chips, the Z80 decodes I/O ports — so both fields travel and the
    // machine constructor reads the one its architecture has.
    if (result.ok && typeof window !== 'undefined') {
      const config = { regions: result.regions };
      if (result.chips) config.chips = result.chips;
      if (result.ports) config.ports = result.ports;
      window.dispatchEvent(new CustomEvent('bw-machine-extracted', {
        detail: { kind: result.kind, config },
      }));
    }
  }, [parts, wires]);

  // Breadboard model (persistent across renders)
  const [bbRev, setBbRev] = useState(0);
  const bbBump = useCallback(() => setBbRev(r => r + 1), []);
  const bbWireIdRef = useRef(0);

  const [annotations, setAnnotations] = useState([]);

  // LED cube scan accumulator
  const cubeScanRef = useRef(new CubeScanAccumulator());
  const [cubeScans, setCubeScans] = useState({});

  // Sample pin states for cube when renderState updates
  useEffect(() => {
    if (!renderState || !renderState.pins) return;
    const hasCube = parts.some(p => p.kind === 'led_cube');
    if (!hasCube) return;

    cubeScanRef.current.sample(renderState.timeNs || 0n, renderState.pins);
    const history = cubeScanRef.current.getHistory();
    // Build cubeScans map for all cube parts
    const scans = {};
    for (const p of parts) {
      if (p.kind === 'led_cube') scans[p.id] = history;
    }
    setCubeScans(scans);
  }, [renderState, parts]);

  // Multimeter
  const [placingProbe, setPlacingProbe] = useState(null);
  const [placingPart, setPlacingPart] = useState(null); // {kind, params} riding the cursor
  const [showSchematic, setShowSchematic] = useState(false);
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem('bw-circuit-theme') || 'light'; } catch { return 'light'; }
  });
  useEffect(() => {
    const onSettings = event => {
      const {key, value} = event.detail || {};
      if (key !== 'bw-circuit-theme' || (value !== 'light' && value !== 'dark')) return;
      setTheme(value);
      try { localStorage.setItem('bw-circuit-theme', value); } catch { /* private mode */ }
    };
    window.addEventListener('bw-settings-change', onSettings);
    return () => window.removeEventListener('bw-settings-change', onSettings);
  }, []);
  const [simPaused, setSimPaused] = useState(false);
  const [simSpeed, setSimSpeed] = useState(1); // 0.25 | 1 | 4 x real time
  const [probePlacement, setProbePlacement] = useState(null);
  const handleStartPlacing = useCallback((which) => setPlacingProbe(which), []);
  const handleStopPlacing = useCallback(() => setPlacingProbe(null), []);

  const handleTerminalClickForProbe = useCallback((partId, terminal) => {
    if (!placingProbe) return false;
    const wire = wires.find(w => ['from', 'to'].some(side => {
      const e = wireEndpoint(w, side);
      return e && e.part === partId && e.terminal === terminal;
    }));
    setProbePlacement({ netId: wire?.netId || null, partId, terminal });
    return true;
  }, [placingProbe, wires]);

  // ── Project prop → infer circuit ────────────────────────────────
  // Re-infer when the project's pins change.
  const prevPinsRef = useRef(null);
  // Set the moment a circuitData FILE is applied (the effect below).
  // Loading an example loads its PROGRAM first; the resulting project
  // change ripples new pins into THIS effect, which used to rebuild
  // the bench from declarations and WIPE the just-loaded file — a race
  // the thermostat happened to win and the blinkenrocket pendant lost
  // (owner screenshot: the inferred 8-of-18-pins bench where the
  // curated seated build should be). A loaded file wins until another
  // file loads or the user explicitly rebuilds via the Infer panel.
  //
  // The ref used to reset to false on every remount, opening a race
  // window where the inference effect could rebuild an "mcu1" bench
  // between mount and the circuitData load. Seeding it from a
  // localStorage flag (written beside the autosave) closes that window.
  const fileLoadedRef = useRef(
    // Seed from localStorage so the flag survives remounts.
    (() => { try { return localStorage.getItem('bw-circuit-file-loaded') === '1'; } catch { return false; } })()
    // If the host already has a circuitData prop waiting, inference must
    // not run — the circuitData effect will load the file momentarily.
    || !!circuitData
  );
  useEffect(() => {
    const pins = projectData?.pins;
    // Shallow compare: skip if same array reference
    if (pins === prevPinsRef.current) return;
    prevPinsRef.current = pins;
    if (fileLoadedRef.current) return;

    // No declared pins: the last session's autosaved wiring beats the
    // canned demo - losing an evening's circuit to a reload was the bug.
    if (!(pins?.length > 0) && typeof localStorage !== 'undefined') {
      try {
        const saved = localStorage.getItem('bw-circuit-autosave');
        if (saved) {
          const data = JSON.parse(saved);
          if (data && Array.isArray(data.parts) && data.parts.length > 0) {
            handleLoad(migrateStarterAutosave(data));
            return;
          }
        }
      } catch { /* corrupt autosave: fall through to the demo */ }
    }
    // First-open starter: a COMPLETE no-MCU bench circuit, seated and lit.
    // The battery taps directly into the two component strips so this simple
    // example has one visible positive wire and one visible return wire. A
    // rail-plus-jumper layout is electrically equivalent, but unnecessarily
    // draws four wires and makes the starter look duplicated.
    if (!(pins?.length > 0)) {
      try {
        const bb = addPart('breadboard', {}, 470, 300);
        const bat = addPart('vsource', { variant: '9v', volts: 5 }, 130, 150);
        const r1 = addPart('resistor', { ohms: 1000 }, 0, 0);
        const led = addPart('led', { color: 'red' }, 0, 0, 'led1');
        circuit.seatPart(r1.id, bb.id, computeLeadMap(BB_FOOTPRINTS.resistor, 'b5'));
        circuit.seatPart(led.id, bb.id, computeLeadMap(BB_FOOTPRINTS.led, 'c9'));
        addTapWire(bat.id, 'pos', bb.id, 'a5', '#e74c3c');
        addTapWire(bat.id, 'neg', bb.id, 'a10', '#2c3e50');
        setAnnotations([{ x: 470, y: 130, text: 'a complete circuit — battery + → resistor → LED → battery −', color: '#7f8c8d' }]);
        return;
      } catch { /* fall through to the inferred demo */ }
    }
    if (pins?.length > 0) {
      // The code PREFILLS the bench: declared pins arrive as a seated
      // breadboard build - chip above the board, parts in the strips,
      // taps from the pins, rails powered. Derivable is derived.
      try {
        circuit.parts.length = 0;
        circuit.wires.length = 0;
        circuit.breadboards = new Map();
        const { notes } = buildSeatedFromDeclarations(circuit, projectData);
        setAnnotations(notes.map((text, i) => ({ x: 470, y: 585 + i * 14, text, color: '#7f8c8d' })));
        return;
      } catch { /* fall through to abstract inference */ }
    }
    const inferStc = pins?.length > 0
      ? projectData
      : {
          device: 'STC12C5A60S2',
          clock: 11059200,
          pins: [{ name: 'led1', port: 1, bit: 0, direction: 'output', activeLow: true }],
        };

    const { parts: ip, nets: in_, annotations: ann } = inferCircuit(inferStc);
    loadInferred(ip, in_);
    setAnnotations(ann || []);
  }, [projectData, loadInferred]);

  // ── Buzzer audio ────────────────────────────────────────────────
  // Direct import (no dynamic import — the module guards against
  // missing AudioContext in non-browser environments).
  // Autosave: every structural change lands in localStorage (debounced);
  // a fresh mount with an empty canvas restores the last session's work.
  // Save/load-to-file stays explicit; this is the safety net under it.
  const autosaveTimer = useRef(null);
  useEffect(() => {
    if (typeof localStorage === 'undefined') return undefined;
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(() => {
      try {
        if (parts.length > 0) {
          localStorage.setItem('bw-circuit-autosave', JSON.stringify(circuit.toJSON()));
        }
      } catch { /* storage full/blocked: the explicit save still works */ }
    }, 800);
    return () => { if (autosaveTimer.current) clearTimeout(autosaveTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rev]);

  // Publish the circuit to the host (harness/integration) once on mount.
  useEffect(() => {
    if (onCircuitReady) onCircuitReady(circuit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onTheme = event => {
      const next = event.detail && event.detail.value;
      if (next !== 'light' && next !== 'dark') return;
      setTheme(next);
      try { localStorage.setItem('bw-circuit-theme', next); } catch { /* private mode */ }
    };
    window.addEventListener('bw-circuit-theme', onTheme);
    return () => window.removeEventListener('bw-circuit-theme', onTheme);
  }, []);

  useEffect(() => {
    return () => stopAllBuzzers();
  }, []);

  // The Scratch green flag is the shared start affordance. Pure circuits do
  // not have an MCU board to drive them, so the flag explicitly enters the
  // designer's simulation mode and opens Instruments; MCU-backed circuits are
  // already externally clocked and simply continue to receive the VM's pin writes.
  useEffect(() => {
    const onGreenFlag = () => {
      setMode('simulate');
      setRightOpen(true);
      setSimPaused(false);
    };
    const onStopAll = () => {
      setMode('build');
      setSimPaused(false);
    };
    window.addEventListener('bw-green-flag', onGreenFlag);
    window.addEventListener('bw-stop-all', onStopAll);
    return () => {
      window.removeEventListener('bw-green-flag', onGreenFlag);
      window.removeEventListener('bw-stop-all', onStopAll);
    };
  }, []);

  useEffect(() => {
    if (mode !== 'simulate') return; // only produce audio while simulating
    const buzzers = parts.filter(p => p.kind === 'buzzer');
    for (const bz of buzzers) {
      try {
        const tone = readBuzzerTone(bz.id);
        updateBuzzerAudio(bz.id, tone);
      } catch {}
    }
  }, [rev, parts, readBuzzerTone, renderState, mode]);

  useEffect(() => {
    if (mode !== 'simulate') stopAllBuzzers();
  }, [mode]);

  // Spectrum beeper: poll debugState.audio() and pipe to updateBuzzerAudio
  useEffect(() => {
    if (!debugState || typeof debugState.audio !== 'function') return;
    const BEEPER_ID = '__spectrum_beeper';
    let raf;
    const poll = () => {
      const tone = debugState.audio();
      updateBuzzerAudio(BEEPER_ID, tone);
      raf = requestAnimationFrame(poll);
    };
    raf = requestAnimationFrame(poll);
    return () => { cancelAnimationFrame(raf); stopBuzzer(BEEPER_ID); };
  }, [debugState]);

  // ── Simulation loop ─────────────────────────────────────────────
  // Only runs when no external board is provided (demo mode).
  // When an external board is present, the emulator drives pin events
  // and the UI re-renders via onChange subscription.
  const simInterval = useRef(null);
  const simStep = useRef(0);

  useEffect(() => {
    // Skip scripted sim when external board drives the simulation
    if (externalBoard) return;

    if (mode !== 'simulate') {
      if (simInterval.current) clearInterval(simInterval.current);
      return;
    }

    const mcu = parts.find(p => ['mcu', 'arduino_uno', 'arduino_nano', 'arduino_mega', 'pi_pico'].includes(p.kind));
    // No MCU is NOT "no simulation": pure circuits (battery+LED, FG+scope,
    // RC charge) need the clock just as much. Only the demo pin script
    // below is MCU-conditional.

    // Classify pins by what's connected to them
    const outputPins = []; // pins with LEDs or buzzers connected
    const inputPins = [];  // pins with buttons connected
    const analogPins = []; // pins with pots connected

    // Reset stale board state (cap voltages, LED history) for EVERY circuit.
    if (circuit.board.reset) circuit.board.reset();

    if (mcu) {
      for (const pin of mcu.terminals) {
        // Find what's wired to this pin
        const connectedKinds = new Set();
        for (const w of wires) {
          const f = wireEndpoint(w, 'from');
          const t = wireEndpoint(w, 'to');
          if (!f || !t) continue;
          let otherPart = null;
          if (f.part === mcu.id && f.terminal === pin) {
            otherPart = t.part;
          } else if (t.part === mcu.id && t.terminal === pin) {
            otherPart = f.part;
          }
          if (otherPart) {
            const p = parts.find(pp => pp.id === otherPart);
            if (p) connectedKinds.add(p.kind);
          }
        }

        if (connectedKinds.has('led') || connectedKinds.has('buzzer') || connectedKinds.has('resistor')) {
          outputPins.push(pin);
        } else if (connectedKinds.has('button')) {
          inputPins.push(pin);
        } else if (connectedKinds.has('potentiometer')) {
          analogPins.push(pin);
        } else {
          outputPins.push(pin); // default: treat as output
        }
      }


      for (const pin of outputPins) setPin(pin, 'quasi', true);
      for (const pin of inputPins) setPin(pin, 'quasi', true);
      for (const pin of analogPins) setPin(pin, 'input', false);
    }

    simStep.current = 0;

    simInterval.current = setInterval(() => {
      if (simPausedRef.current) return; // frozen coherently; controls stay live
      simStep.current++;
      const step = simStep.current;

      if (mcu) {
        // Blink all output pins at 2 Hz of SIM time (500 ms period)
        for (const pin of outputPins) {
          const on = (step % Math.max(1, Math.round(20 / simSpeedRef.current))) <
            Math.max(1, Math.round(10 / simSpeedRef.current));
          setPin(pin, 'quasi', on); // HIGH = LED off (active-low)
        }
      }

      advanceBy(BigInt(Math.round(50 * simSpeedRef.current)) * MS);
    }, 50);

    return () => { if (simInterval.current) clearInterval(simInterval.current); };
  }, [mode, parts, wires]);

  // Refs so pause/speed act immediately without restarting the interval.
  const simPausedRef = useRef(false); simPausedRef.current = simPaused;
  const simSpeedRef = useRef(1); simSpeedRef.current = simSpeed;

  const handleSimStep = useCallback(() => {
    // One 50 ms tick while paused — the circuits half of single-stepping.
    advanceBy(50n * MS);
  }, [advanceBy]);

  // ── Part placement — find empty space ────────────────────────────
  const handleAddPart = useCallback((kind, params) => {
    // Find a position that doesn't overlap existing parts
    const occupied = parts.map(p => ({ x: p.x, y: p.y }));
    let x = 200, y = 200;
    const spacing = 80;
    let found = false;
    // Spiral outward from center to find empty spot
    for (let ring = 0; ring < 10 && !found; ring++) {
      for (let dx = -ring; dx <= ring && !found; dx++) {
        for (let dy = -ring; dy <= ring && !found; dy++) {
          if (Math.abs(dx) !== ring && Math.abs(dy) !== ring) continue; // only border
          const cx = snapToGrid(200 + dx * spacing);
          const cy = snapToGrid(200 + dy * spacing);
          if (cx < 40 || cy < 40 || cx > 600 || cy > 440) continue;
          const tooClose = occupied.some(o =>
            Math.abs(o.x - cx) < 60 && Math.abs(o.y - cy) < 50
          );
          if (!tooClose) { x = cx; y = cy; found = true; }
        }
      }
    }
    // Generate a declaration name for parts that produce blocks
    const declarable = ['led', 'buzzer', 'button', 'potentiometer'];
    const existingNames = parts.filter(p => p.declName).map(p => p.declName);
    const declName = declarable.includes(kind) ? generatePartName(kind, existingNames) : undefined;
    addPart(kind, params, x, y, declName);
  }, [addPart, parts]);

  // Snap-to-grid on move (drag)
  const handleMovePart = useCallback((partId, x, y) => {
    movePart(partId, snapToGrid(x), snapToGrid(y));
  }, [movePart]);

  // Raw move without snap (fine nudge with Shift+arrow)
  const handleNudgePart = useCallback((partId, x, y) => {
    movePart(partId, x, y);
  }, [movePart]);

  // ── Copy/paste ────────────────────────────────────────────────────
  const clipboardRef = useRef(null);

  const handleCopy = useCallback((partIds) => {
    if (!partIds || partIds.size === 0) return;
    const idSet = partIds instanceof Set ? partIds : new Set(partIds);
    const copiedParts = parts.filter(p => idSet.has(p.id)).map(p => ({ ...p, params: { ...p.params } }));
    // Wires where both ends are in the copied set
    // wireEndpoint already returns a fresh object per side, so the copy the
    // clipboard needs falls out of reading through the canonical accessor.
    const copiedWires = wires.flatMap(w => {
      const from = wireEndpoint(w, 'from');
      const to = wireEndpoint(w, 'to');
      if (!from || !to || !idSet.has(from.part) || !idSet.has(to.part)) return [];
      return [{ ...w, from, to }];
    });
    clipboardRef.current = { parts: copiedParts, wires: copiedWires };
  }, [parts, wires]);

  const handlePaste = useCallback(() => {
    if (!clipboardRef.current) return;
    const { parts: srcParts, wires: srcWires } = clipboardRef.current;
    if (srcParts.length === 0) return;

    const OFFSET = 40;
    const idMap = new Map(); // old id → new id
    const newIds = [];

    for (const src of srcParts) {
      const existingNames = parts.map(p => p.declName).filter(Boolean);
      let declName;
      if (src.declName) {
        const base = src.declName.replace(/\d+$/, '');
        for (let i = 1; ; i++) {
          const candidate = base + i;
          if (!existingNames.includes(candidate) && ![...idMap.values()].some((_, idx) => srcParts[idx]?.declName === candidate)) {
            declName = candidate;
            existingNames.push(candidate);
            break;
          }
        }
      }
      const p = addPart(src.kind, { ...src.params }, snapToGrid(src.x + OFFSET), snapToGrid(src.y + OFFSET), declName);
      if (p) {
        if (src.rotation) p.rotation = src.rotation;
        idMap.set(src.id, p.id);
        newIds.push(p.id);
      }
    }

    // Re-create internal wires with new IDs
    for (const w of srcWires) {
      const f = wireEndpoint(w, 'from');
      const t = wireEndpoint(w, 'to');
      if (!f || !t) continue;
      const fromId = idMap.get(f.part);
      const toId = idMap.get(t.part);
      if (fromId && toId) {
        addWire(fromId, f.terminal, toId, t.terminal);
      }
    }

    // Select the pasted parts
    setSelectedParts(new Set(newIds));
  }, [parts, addPart, addWire, setSelectedParts]);

  // Node voltages and warnings from getRenderState (if available)
  const nodeVoltages = {};
  const warnings = [];
  if (renderState) {
    for (const { net, voltage } of renderState.nodeVoltages || []) {
      nodeVoltages[net] = voltage;
    }
    warnings.push(...(renderState.warnings || []));
  } else if (rev >= 0) {
    // Fallback for boards without getRenderState
    const seenNets = new Set();
    for (const w of wires) {
      if (!seenNets.has(w.netId)) {
        seenNets.add(w.netId);
        try { nodeVoltages[w.netId] = readNodeVoltage(w.netId); } catch {}
      }
    }
  }

  const handleControlChange = useCallback((partId, value) => {
    setControl(partId, value);
    // One board, one truth — for WRITES too: while the debugger drives an
    // external board, the pot the user rolls must reach THAT board or the
    // emulator's ADC keeps reading the untouched internal one.
    if (externalBoard && externalBoard.setControl) {
      try { externalBoard.setControl(partId, value); } catch { /* board mid-rebuild */ }
    }
    advanceBy(1n * MS);
  }, [setControl, advanceBy, externalBoard]);

  // Buttons follow the same one-board-one-truth WRITE rule as the pot
  // above. They didn't, and it was the last link in the pendant chain
  // (owner report 2026-08-16): with the debugger driving an external
  // board, a press reached only the idle internal board — the firmware
  // polled a pin the press never touched, on every target kind.
  const handleButtonDown = useCallback((partId) => {
    setControl(partId, 1);
    if (externalBoard && externalBoard.setControl) {
      try { externalBoard.setControl(partId, 1); } catch { /* board mid-rebuild */ }
    }
    advanceBy(1n * MS);
  }, [setControl, advanceBy, externalBoard]);

  const handleButtonUp = useCallback((partId) => {
    setControl(partId, 0);
    if (externalBoard && externalBoard.setControl) {
      try { externalBoard.setControl(partId, 0); } catch { /* board mid-rebuild */ }
    }
    advanceBy(1n * MS);
  }, [setControl, advanceBy, externalBoard]);

  // A keypad key press/release: sets the device's `pressed` param so the
  // engine stamps/unstamps the row-column bridge (-1 = none). Same
  // one-board-one-truth rule as buttons for an external board.
  const handleKeypadKey = useCallback((partId, key) => {
    setPartParam(partId, 'pressed', key);
    if (externalBoard && externalBoard.setPartParam) {
      try { externalBoard.setPartParam(partId, 'pressed', key); } catch { /* board mid-rebuild */ }
    }
    advanceBy(1n * MS);
  }, [setPartParam, advanceBy, externalBoard]);

  const handleSetPartParam = useCallback((partId, param, value) => {
    setPartParam(partId, param, value);
    if (externalBoard && externalBoard.setPartParam) {
      try { externalBoard.setPartParam(partId, param, value); } catch { /* board mid-rebuild */ }
    }
    advanceBy(1n * MS);
  }, [setPartParam, advanceBy, externalBoard]);

  const handleLoadCircuit = useCallback((inferredParts, inferredNets, ann) => {
    loadInferred(inferredParts, inferredNets);
    // An EXPLICIT rebuild hands the canvas back to inference: future
    // declaration edits may re-derive again.
    fileLoadedRef.current = false;
    try { localStorage.removeItem('bw-circuit-file-loaded'); } catch { /* ok */ }
    setAnnotations(ann || []);
    setSelectedParts(new Set());
    setSelectedWire(null);
    setMode('build');
  }, [loadInferred]);

  // Clear everything: wipe parts/wires/boards/annotations, save history
  // so Ctrl+Z recovers, and clear the autosave slot deliberately.
  const handleClear = useCallback(() => {
    circuit._saveHistory();
    circuit.parts.length = 0;
    circuit.wires.length = 0;
    circuit.breadboards = new Map();
    circuit._syncNetlist();
    setAnnotations([]);
    setSelectedParts(new Set());
    setSelectedWire(null);
    setMode('build');
    fileLoadedRef.current = false;
    try { localStorage.removeItem('bw-circuit-autosave'); } catch { /* ok */ }
    try { localStorage.removeItem('bw-circuit-file-loaded'); } catch { /* ok */ }
  }, [circuit]);

  // Save circuit to JSON file download
  const handleSave = useCallback(() => {
    const json = JSON.stringify(circuit.toJSON(), null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'circuit.json';
    a.click();
    URL.revokeObjectURL(url);
  }, [circuit]);

  // Load circuit from JSON file
  const handleLoad = useCallback((data) => {
    if (!data || !Array.isArray(data.parts)) return;
    // fromJSON owns the parsing: it normalizes the gallery's legacy flat
    // wire format, drops malformed wires instead of crashing, and restores
    // breadboard occupancy AND hole wires (this inline copy used to lose
    // the hole wires, so loaded saves stopped conducting through the rails).
    let parsed;
    try {
      parsed = Circuit.fromJSON(data);
    } catch (e) {
      console.error('circuit load rejected:', e);
      return; // a bad file must never take the designer down
    }
    // Save current state first so Ctrl+Z recovers the previous circuit
    circuit._saveHistory();
    circuit.parts = parsed.parts;
    circuit.wires = parsed.wires;
    circuit.breadboards = parsed.breadboards;
    // Generated per-device benches carry {parts, nets} (engine-format nets,
    // no wires). syncWithExternalNets feeds these directly to setNetlist,
    // which is strictly more truthful than the wire→net derivation that
    // _syncNetlist performs — the bench generator already computed the nets.
    if (Array.isArray(data.nets) && data.nets.length > 0) {
      circuit.syncWithExternalNets(data.nets);
    } else {
      circuit._syncNetlist();
    }
    circuit._saveHistory();
    setSelectedParts(new Set());
    setSelectedWire(null);
    setMode('build');
    // A loaded file always deserves a fresh fit — keying auto-fit on part
    // COUNT skipped it whenever the new file matched the old project's
    // count (SOS opened half off-screen, self-taken screenshot).
    setFitToken(t => t + 1);
  }, [circuit]);

  // ── circuitData prop: load an example or saved circuit declaratively ──
  // When circuitData changes to a non-null value, load it. The previous
  // state is pushed to history first, so Ctrl+Z recovers unsaved work.
  // The designer tolerates a circuit without matching pin declarations —
  // standalone circuits have no MCU; the host loads program.bw separately
  // if needed.
  const prevCircuitDataRef = useRef(null);
  useEffect(() => {
    if (!circuitData || circuitData === prevCircuitDataRef.current) return;
    prevCircuitDataRef.current = circuitData;
    // The example gallery's circuit files predate the breadboard world:
    // flat wire records, abstract vcc/gnd symbols, an mcu with no pin list.
    // When such a file arrives WITH declared pins, the declarations carry
    // strictly more truth — build the seated bench from them and let the
    // legacy file inform nothing. Modern files (endpoint objects) load
    // verbatim.
    const legacy = Array.isArray(circuitData.wires) &&
      circuitData.wires.some(isLegacyFlatWire);
    // A file carrying seats or hole wires was deliberately RE-AUTHORED as a
    // breadboard build — the seated-catalog generator keeps the original
    // flat wires as electrical truth, so the wire dialect alone no longer
    // means "predates the breadboard world". Discarding such a file for the
    // declaration-built bench threw away every shipped MCU seat (the owner
    // saw 187 re-authored examples all render the chip floating).
    const reauthored = (Array.isArray(circuitData.holeWires) && circuitData.holeWires.length > 0) ||
      (Array.isArray(circuitData.parts) && circuitData.parts.some(p => p && p.seat));
    // "The declarations carry strictly more truth" is only true when the
    // file holds nothing the declaration bench can rebuild. The bench
    // synthesizes exactly LED+resistor / button / potentiometer per pin —
    // so a legacy file carrying ANY other part kind (an SSD1306, an LCD,
    // a 7-segment block, an LM358, a buzzer…) knows more than the pins
    // do, and rebuilding turned the Pocket Calculator's OLED + 15-key
    // matrix into eight generic LEDs (owner report, and five more
    // instrument examples lost their displays the same way).
    const SYNTHESIZABLE = /^(breadboard|vcc|gnd|vsource|battery|led|resistor|button|potentiometer|slide_switch|mcu|stc_mcu|arduino_(uno|nano)|pi_pico|attiny\d*)/;
    const richFile = Array.isArray(circuitData.parts) &&
      circuitData.parts.some(p => p && p.kind && !SYNTHESIZABLE.test(p.kind));
    const pins = projectData?.pins;
    // fileOnly: the host says this circuit arrived WITHOUT a program — a
    // pure-circuit example. Pins still in the project then belong to
    // whatever was loaded before, and inferring from them would rebuild
    // the PREVIOUS bench over this file (that is exactly what happened:
    // examples 47-53 all showed example 46's 19-part board).
    if (legacy && !reauthored && !richFile && pins?.length > 0 && !circuitData.fileOnly) {
      try {
        circuit._saveHistory();
        circuit.parts.length = 0;
        circuit.wires.length = 0;
        circuit.breadboards = new Map();
        const { notes } = buildSeatedFromDeclarations(circuit, projectData);
        circuit._syncNetlist();
        circuit._saveHistory();
        setSelectedParts(new Set());
        setSelectedWire(null);
        setMode('build');
        setAnnotations(notes.map((text, i) => ({ x: 470, y: 585 + i * 14, text, color: '#7f8c8d' })));
        return;
      } catch { /* fall through: load the file as-is */ }
    }
    handleLoad(circuitData);
    // The file's canvas is CLEAN: annotations from a previous inference
    // run must not survive onto it (the pendant showed the curated
    // build with the inferred bench's '8 of 18 pins' notes still
    // underneath — owner screenshot; they are SVG text, which even the
    // deployed verifier's innerText probe could not see).
    setAnnotations([]);
    // A file is now on the canvas: the pin-inference effect must not
    // rebuild over it when the example's program load ripples new pins
    // through projectData a tick later (the pendant race).
    fileLoadedRef.current = true;
    try { localStorage.setItem('bw-circuit-file-loaded', '1'); } catch { /* full */ }
    // Auto-seat: if a breadboard and an unseated MCU-class part both exist,
    // seat the MCU onto the breadboard. Many legacy examples ship the MCU
    // floating off the breadboard; this is the leveraged fix rather than
    // re-authoring 200 circuits.
    try {
      const mcuKinds = new Set(['mcu', 'stc_mcu', 'arduino_nano', 'arduino_uno', 'pi_pico', 'attiny85', 'attiny88', 'attiny13', 'attiny2313']);
      const bb = circuit.parts.find(p => p.kind === 'breadboard');
      const unseatMcu = circuit.parts.find(p => mcuKinds.has(p.kind) && !p.seat);
      if (bb && unseatMcu && BB_FOOTPRINTS[unseatMcu.kind]) {
        circuit.seatPart(unseatMcu.id, bb.id, computeLeadMap(BB_FOOTPRINTS[unseatMcu.kind], 'e1'));
      }
    } catch { /* seating failed — leave as-is */ }
  }, [circuitData, handleLoad, projectData, circuit]);

  // ── Main-menu File/ integration ─────────────────────────────────
  // The host's menu bar dispatches 'bw-circuit-file' CustomEvents with
  // detail.action = 'load'|'save'|'import'|'export'. Map each to the
  // SAME handlers the ⋯ menu uses — one handler set, no duplication.
  // For import/export, set fileAction state so BoardCanvas opens the
  // format-picker submenu.
  const [fileAction, setFileAction] = useState(null);
  useEffect(() => {
    const handler = (e) => {
      const action = e.detail?.action;
      if (action === 'save') { handleSave(); return; }
      if (action === 'load') {
        // Same file-picker as the ⋯ menu's Open
        const input = document.createElement('input');
        input.type = 'file'; input.accept = '.json';
        input.onchange = () => {
          const f = input.files?.[0]; if (!f) return;
          const reader = new FileReader();
          reader.onload = () => { try { handleLoad(JSON.parse(String(reader.result))); } catch {} };
          reader.readAsText(f);
        };
        input.click();
        return;
      }
      if (action === 'import' || action === 'export') {
        setFileAction(action); // BoardCanvas FileMenu opens the submenu
      }
    };
    window.addEventListener('bw-circuit-file', handler);
    return () => window.removeEventListener('bw-circuit-file', handler);
  }, [handleSave, handleLoad]);

  // All keyboard shortcuts are handled by BoardCanvas (single focus scope).
  const handleUndo = useCallback(() => undo(), [undo]);
  const handleRedo = useCallback(() => redo(), [redo]);
  const handleSelectAll = useCallback(() => {
    setSelectedParts(new Set(parts.map(p => p.id)));
  }, [parts]);

  // What this board IS right now. `LIVE` was shown for any attached board,
  // which is wrong the moment the debugger halts: the pins stop moving and the
  // label still claims the emulator is driving them.
  //
  // The distinction that matters is not running-vs-stopped but WHOSE time
  // stopped (DEBUG-CONTROL-MODEL §3.1). On an emulator, halting stops program
  // time and the board with it — everything on screen is exactly true. On a
  // live chip it stops the program and nothing else: capacitors discharge,
  // motors coast, someone keeps turning the pot. `skewNs` is precisely that
  // difference, so a non-zero one turns this from a frozen world into a
  // SNAPSHOT of one that kept moving, and it has to say so.
  const halted = !!(debugState && debugState.halted);
  const skewNs = (debugState && debugState.skewNs) || 0n;
  const staleBy = Number(skewNs) / 1e6;

  // simulationOnly: true = simulator target (values available),
  // false = live hardware (no nodeVoltage, no branchCurrent, no ledBrightness).
  // undefined = not specified, assume simulator if board exists.
  const hasSimulation = simulationOnly !== false;

  // When simulation is unavailable, don't show voltage labels or meter readings.
  // The wiring is still correct — you can see parts and connections — but
  // the numbers would be fabricated, which is worse than absent.
  const effectiveNodeVoltages = hasSimulation ? nodeVoltages : {};

  let statusText = null;
  if (!hasSimulation && externalBoard) {
    statusText = 'HARDWARE — voltage/current readings need the simulator';
  } else if (externalBoard && halted && staleBy > 0) {
    statusText = `SNAPSHOT — the board kept running for ${
      staleBy < 1000 ? `${staleBy.toFixed(0)} ms` : `${(staleBy / 1000).toFixed(1)} s`
    } while the program was stopped`;
  } else if (externalBoard && halted) {
    statusText = 'PAUSED — program and board are frozen together';
  } else if (externalBoard) statusText = 'LIVE — emulator driving pins';
  else if (mode === 'simulate') statusText = 'SIMULATING — scripted MCU demo';
  else if (placingProbe) statusText = `Placing probe ${placingProbe} — click a terminal`;

  return (
    <div
      className="bw-circuit-designer"
      data-bw-circuit-theme={theme}
      data-sim-mode={mode}
      data-selectors-open={selectorsOpen ? 'true' : 'false'}
      style={{
        display: 'flex',
        gap: '12px',
        // The Code-tab portal shares the right pane with Scratch's stage
        // controls. Keep this first row below the green flag/stop row.
        padding: embedded ? '56px 12px 12px' : '12px',
        height: '100%',
        minHeight: 0, // allow flex shrinking
        alignItems: 'stretch',
        position: 'relative',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        overflow: 'auto',
        boxSizing: 'border-box',
      }}
    >
      {/* Left sidebar — collapsible. Hidden entirely in schematic view:
          a parts palette next to a read-only projection is dead width,
          and the projection needs every pixel this column can spare. */}
      <div data-selectors-rail style={{position: 'relative', display: 'flex', flex: selectorsOpen ? '0 0 190px' : '0 0 0px', width: selectorsOpen ? 190 : 0, minWidth: selectorsOpen ? 190 : 0, minHeight: 0, height: '100%', overflow: 'visible'}}>
      {selectorsOpen ? (
        <div data-selectors-panel style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: '6px', flex: '1 1 auto', width: '100%', minWidth: 0, minHeight: 0, height: '100%', overflow: 'visible', overscrollBehavior: 'contain' }}>
          <div data-parts-selector style={{position: 'relative', flex: partsOpen ? `${selectorSplit} 1 0` : '0 0 30px', minHeight: partsOpen ? 80 : 30, display: 'flex', minWidth: 0, overflow: 'hidden'}}>
            <button onClick={() => setPartsOpen(v => !v)} aria-label={partsOpen ? 'Collapse Parts' : 'Expand Parts'} aria-expanded={partsOpen} title={partsOpen ? 'Collapse Parts' : 'Expand Parts'} style={{position: 'absolute', zIndex: 4, left: 2, top: 4, width: 24, height: 24, padding: 0, border: '1px solid #94a3b8', borderRadius: 999, background: '#fff', color: '#334155', cursor: 'pointer'}}>{partsOpen ? '‹' : '›'}</button>
            {partsOpen ? (
              <PartPalette theme={theme} onAddPart={handleAddPart} onStartPlace={(kind, params) => setPlacingPart({ kind, params })} />
            ) : (
              <div style={{padding: '6px 8px 6px 14px', color: '#334155', fontSize: 13, fontWeight: 700, cursor: 'pointer', width: '100%'}} onClick={() => setPartsOpen(true)}>Parts</div>
            )}
          </div>
          <div data-selector-divider role="separator" aria-label="Resize Parts and Examples selectors" tabIndex={0}
            onPointerDown={event => {
              event.preventDefault();
              const startY = event.clientY;
              const start = selectorSplit;
              const parent = event.currentTarget.parentElement;
              const total = parent ? parent.getBoundingClientRect().height : 1;
              const move = moveEvent => setSelectorSplit(Math.max(0.2, Math.min(0.85, start + (moveEvent.clientY - startY) / total)));
              const end = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end); };
              window.addEventListener('pointermove', move);
              window.addEventListener('pointerup', end, {once: true});
            }}
            style={{height: 10, flex: '0 0 10px', cursor: 'row-resize', borderTop: '2px solid #94a3b8', borderBottom: '2px solid #94a3b8', background: '#e2e8f0', margin: '1px 0'}}>
            <span style={{display: 'block', width: 42, height: 2, margin: '2px auto', background: '#475569', borderRadius: 2}} />
          </div>
          <div data-examples-selector style={{position: 'relative', flex: examplesOpen ? `${1 - selectorSplit} 1 0` : '0 0 30px', minHeight: examplesOpen ? 70 : 30, overflowY: examplesOpen ? 'auto' : 'hidden', display: 'flex', flexDirection: 'column'}}>
            <button onClick={() => setExamplesOpen(v => !v)} aria-label={examplesOpen ? 'Collapse Examples' : 'Expand Examples'} aria-expanded={examplesOpen} title={examplesOpen ? 'Collapse Examples' : 'Expand Examples'} style={{position: 'absolute', zIndex: 4, left: 2, top: 4, width: 24, height: 24, padding: 0, border: '1px solid #94a3b8', borderRadius: 999, background: '#fff', color: '#334155', cursor: 'pointer'}}>{examplesOpen ? '‹' : '›'}</button>
            {examplesOpen ? (<>
            {/* Codex / Gallery toggle — only shown when both examples and curriculum are available */}
            {examples && onLoadExample && curriculum && (
              <div style={{display: 'flex', gap: 0, padding: '3px 4px 2px', borderBottom: '1px solid #2c3e50', flexShrink: 0}}>
                <button type="button" onClick={() => setCodexMode(false)}
                  style={{flex: 1, padding: '3px 6px', fontSize: 9, fontWeight: codexMode ? 400 : 700,
                    fontFamily: 'system-ui, sans-serif', cursor: 'pointer',
                    background: codexMode ? 'transparent' : 'rgba(59,130,246,0.15)',
                    color: codexMode ? '#8a8a8a' : '#3b82f6',
                    border: 'none', borderRadius: '3px 0 0 3px',
                  }}>▦ Gallery</button>
                <button type="button" onClick={() => setCodexMode(true)}
                  style={{flex: 1, padding: '3px 6px', fontSize: 9, fontWeight: codexMode ? 700 : 400,
                    fontFamily: 'Georgia, "Times New Roman", serif', cursor: 'pointer',
                    background: codexMode ? 'rgba(212,165,116,0.15)' : 'transparent',
                    color: codexMode ? '#d4a574' : '#8a8a8a',
                    border: 'none', borderRadius: '0 3px 3px 0',
                  }}>☙ Codex</button>
              </div>
            )}
            {/* Import moved to the ⋯ toolbar menu (BoardCanvas FileMenu) */}
            <div style={{flex: 1, overflowY: 'auto'}}>
            {examples && onLoadExample ? (
              codexMode && curriculum ? (
                <CodexBrowser curriculum={curriculum} examples={examples} lang={lang}
                  onLoadExample={(ex, opts) => {
                    onLoadExample(ex, opts);
                    if (onProgramChange && ex.program) onProgramChange(ex.program, opts);
                  }} theme={theme} />
              ) : (
                <ExamplesBrowser examples={examples} onLoadExample={(ex, opts) => {
                  onLoadExample(ex, opts);
                  if (onProgramChange && ex.program) onProgramChange(ex.program, opts);
                }} theme={theme} />
              )
            ) : (
              <InferPanel onLoadCircuit={handleLoadCircuit} />
            )}
            </div>
            </>) : (
              <div style={{padding: '6px 8px 6px 14px', color: '#334155', fontSize: 13, fontWeight: 700, cursor: 'pointer', width: '100%'}} onClick={() => setExamplesOpen(true)}>Examples</div>
            )}
          </div>
        </div>
      ) : null}
        <button data-selectors-toggle onPointerDown={e => { e.stopPropagation(); setShowSchematic(false); setSelectorsOpen(v => !v); }} onMouseDown={e => e.stopPropagation()} onTouchStart={e => { e.stopPropagation(); setShowSchematic(false); setSelectorsOpen(v => !v); }} onClick={e => { e.stopPropagation(); setShowSchematic(false); setSelectorsOpen(v => !v); }} style={{
          position: 'absolute', right: -13, top: 4, zIndex: 70,
          width: 28, height: 28, padding: 0, display: 'grid', placeItems: 'center',
          background: 'rgba(255,255,255,.96)', border: '1px solid #94a3b8',
          boxShadow: '0 2px 8px rgba(15,23,42,.24)', borderRadius: '999px',
          color: '#334155', cursor: 'pointer', fontFamily: 'system-ui, sans-serif', fontSize: 20, lineHeight: 1,
        }} aria-label={selectorsOpen ? 'Collapse Selectors Panel' : 'Expand Selectors Panel'} aria-expanded={selectorsOpen} title={selectorsOpen ? 'Collapse Selectors Panel' : 'Expand Selectors Panel'}>{selectorsOpen ? '‹' : '›'}</button>
      </div>

      {/* A snapshot must not LOOK like a live board. Desaturating it is the
          cheapest honest signal: the reading is real but it is of a world that
          has moved on since. A frozen simulation gets no treatment, because
          nothing about it is stale — that is the whole difference `skewNs`
          exists to carry, and rendering both the same would throw it away.
          `setControl` stays live either way: turning the pot is user intent,
          not physics, so nothing here disables interaction. */}
      <div style={{
        // minWidth:0 lets this flex wrapper shrink below its content width so the
        // designer column is bounded by the pane, not the (wide) circuit canvas.
        // Without it the whole column stayed at canvas width and the circuit
        // toolbar (which already flex-wraps) overflowed the pane, clipping the
        // Undo/Redo/⋯ buttons off the right edge.
        flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0,
        filter: !hasSimulation ? 'saturate(0.5) brightness(0.9)' : staleBy > 0 ? 'saturate(0.35)' : 'none',
        transition: 'filter 120ms ease-out',
        position: 'relative',
      }}>
        {/* Stale-age badge: shows how old the snapshot is */}
        {staleBy > 0 && (
          <div style={{
            position: 'absolute', top: 8, right: 8, zIndex: 50,
            background: 'rgba(243, 156, 18, 0.9)',
            color: '#000', padding: '4px 10px', borderRadius: '4px',
            fontFamily: 'monospace', fontSize: '11px', fontWeight: 'bold',
            pointerEvents: 'none',
          }}>
            {staleBy < 1000 ? `${staleBy.toFixed(0)} ms stale` : `${(staleBy / 1000).toFixed(1)} s stale`}
          </div>
        )}
        {/* Hardware-only badge */}
        {!hasSimulation && (
          <div style={{
            position: 'absolute', top: 8, right: 8, zIndex: 50,
            background: 'rgba(52, 152, 219, 0.9)',
            color: '#fff', padding: '4px 10px', borderRadius: '4px',
            fontFamily: 'monospace', fontSize: '11px', fontWeight: 'bold',
            pointerEvents: 'none',
          }}>
            wiring only — no sim
          </div>
        )}
        <div data-designer-main style={{ flex: '1 1 auto', width: 'auto', minHeight: 0, minWidth: 0, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
        {showSchematic && (
          <div data-schematic-escape data-circuit-view-switcher style={{display: 'inline-flex', gap: 4, alignItems: 'center', marginBottom: 8}}>
            <button onClick={() => setShowSchematic(false)} aria-label="Realistic view" aria-pressed={false} title="Realistic view"
              style={{width: 34, height: 30, cursor: 'pointer', background: '#16213e', color: '#fff', border: '1px solid #3498db', borderRadius: 4}}>◉</button>
            <button onClick={() => setShowSchematic(true)} aria-label="Schematic view" aria-pressed="true" title="Schematic view"
              style={{width: 34, height: 30, cursor: 'pointer', background: '#3498db', color: '#fff', border: '1px solid #2c3e50', borderRadius: 4}}>⌁</button>
          </div>
        )}
        {!showSchematic ? (<>
        <BoardCanvas
          engineBoard={activeBoard}
          videoFn={debugState && typeof debugState.video === 'function' ? debugState.video : null}
          fitToken={fitToken}
          sevenSegments={readSevenSegment}
          sevenSeg3={readSevenSeg3}
          parts={parts}
          wires={wires}
          theme={theme}
          mode={mode}
          onModeChange={nextMode => {
            setMode(nextMode);
            // Simulation controls live in the instrument column. Selecting
            // Sim must reveal that column even in the compact embedded view;
            // otherwise the mode changes but its controls are unreachable.
            if (nextMode === 'simulate') {
              setRightOpen(true);
              // SIM runs the authored MCU program as well as the circuit.
              if (onSimulationStart) onSimulationStart();
            }
          }}
          powered={powered}
          onPowerToggle={next => setPower(typeof next === 'boolean' ? next : !powered)}
          simulate={mode === 'simulate'}
          ledBrightness={readLedBrightness}
          buzzerTones={readBuzzerTone}
          nodeVoltages={effectiveNodeVoltages}
          onAddWire={addWire}
          onRemoveWire={removeWire}
          onAddHoleWire={(boardId, a, b) => addHoleWire(boardId, a, b)}
          onAddTapWire={(partId, terminal, boardId, hole) => addTapWire(partId, terminal, boardId, hole)}
          onRewire={(wireId, fixedEnd, newEnd) => {
            // Re-route one end: drop the old wire, land the new one between
            // the untouched end and the drop target (terminal or hole).
            removeWire(wireId);
            if (newEnd.boardId) {
              if (fixedEnd.board) return; // hole-to-hole re-route: jumper land, not here
              addTapWire(fixedEnd.part, fixedEnd.terminal, newEnd.boardId, newEnd.hole);
            } else if (fixedEnd.board) {
              addTapWire(newEnd.partId, newEnd.terminal, fixedEnd.board, fixedEnd.hole);
            } else {
              addWire(fixedEnd.part, fixedEnd.terminal, newEnd.partId, newEnd.terminal);
            }
            setSelectedWire(null);
          }}
          onRemovePart={removePart}
          onMovePart={handleMovePart}
          onNudgePart={handleNudgePart}
          onNudgeSeated={(id, dcol, drow) => {
            const before = circuit.parts.find(q => q.id === id)?.seat?.leadMap;
            nudgeSeated(id, dcol, drow);
            const after = circuit.parts.find(q => q.id === id)?.seat?.leadMap;
            if (before && after && JSON.stringify(before) === JSON.stringify(after)) {
              // Refused for a reason the user cannot see: the target holes are
              // occupied (often by wire ends), the row hits the gutter, or the
              // board edge. Silence read as "arrow keys are broken".
              const part = circuit.parts.find(q => q.id === id);
              setAnnotations(a => [...a.filter(n => !n.transient), {
                x: (part?.x ?? 400), y: (part?.y ?? 300) - 46,
                text: 'move blocked — target holes occupied, gutter, or board edge',
                color: '#e67e22', transient: true,
              }]);
              setTimeout(() => setAnnotations(a => a.filter(n => !n.transient)), 1600);
            }
          }}
          onSelectPart={handleSelectPart}
          selectedPart={selectedPart}
          selectedParts={selectedParts}
          onSelectWire={setSelectedWire}
          selectedWire={selectedWire}
          onControlChange={handleControlChange}
          onButtonDown={handleButtonDown}
          onButtonUp={handleButtonUp}
          onKeypadKey={handleKeypadKey}
          onSetPartParam={handleSetPartParam}
          statusText={statusText}
          placingProbe={placingProbe}
          placing={placingPart}
          onPlacingDone={() => setPlacingPart(null)}
          onTerminalClickForProbe={handleTerminalClickForProbe}
          onDuplicatePart={(id) => { const dup = duplicatePart(id); if (dup) handleSelectPart(dup.id); }}
          onRotatePart={rotatePart}
          onFlipPart={flipPart}
          onDropPart={(kind, params, x, y, seat) => {
            const declarable = ['led', 'buzzer', 'button', 'potentiometer'];
            const existingNames = parts.filter(p => p.declName).map(p => p.declName);
            const declName = declarable.includes(kind) ? generatePartName(kind, existingNames) : undefined;
            // A snapped drop keeps the exact hole-lattice position; free
            // drops take the 20 px grid.
            const p = addPart(kind, params, seat ? x : snapToGrid(x), seat ? y : snapToGrid(y), declName);
            if (p && seat && BB_FOOTPRINTS[kind]) {
              try {
                const leadMap = computeLeadMap(BB_FOOTPRINTS[kind], seat.hole);
                circuit.seatPart(p.id, seat.boardId, leadMap);
              } catch { /* rail or edge reference: part stays free, honestly */ }
            }
            if (p) handleSelectPart(p.id);
          }}
          onSeatPart={(partId, boardId, hole) => {
            const part = parts.find(pp => pp.id === partId);
            if (!part || !BB_FOOTPRINTS[part.kind]) return false;
            const fp = BB_FOOTPRINTS[part.kind];
            const tryAt = (h) => {
              try { return circuit.seatPart(partId, boardId, computeLeadMap(fp, h)); }
              catch { return false; }
            };
            if (tryAt(hole)) return true;
            // The exact hole is taken or runs off an edge — walk the
            // neighbourhood before giving up. Without this, a drop one
            // column into another part's legs silently fell back to the
            // free grid, which read as "seating never works" for anything
            // bigger than a resistor.
            const rows = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
            const row = hole[0];
            const col = Number(hole.slice(1));
            const ri = rows.indexOf(row);
            for (let radius = 1; radius <= 4; radius++) {
              if (tryAt(`${row}${col + radius}`) || tryAt(`${row}${col - radius}`)) return true;
              for (const rr of [rows[ri + radius], rows[ri - radius]]) {
                if (rr && tryAt(`${rr}${col}`)) return true;
              }
            }
            return false;
          }}
          onUnseatPart={(partId) => { circuit.unseatPart(partId); }}
          circuit={circuit}
          warnings={warnings}
          annotations={annotations}
          cubeScans={cubeScans}
          onUpdateParams={updateParams}
          onSaveHistory={saveHistory}
          onCopy={handleCopy}
          onPaste={handlePaste}
          onUpdateWire={updateWire}
          onUndo={handleUndo}
          onRedo={handleRedo}
          onSelectAll={handleSelectAll}
          onSaveCircuit={handleSave}
          onClearCircuit={handleClear}
          onImport={handleLoad}
          fileAction={fileAction}
          onFileActionDone={() => setFileAction(null)}
          onLoadCircuit={() => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'application/json,.json';
            input.onchange = () => {
              const f = input.files && input.files[0];
              if (!f) return;
              const reader = new FileReader();
              reader.onload = () => { try { handleLoad(JSON.parse(String(reader.result))); } catch { /* bad file */ } };
              reader.readAsText(f);
            };
            input.click();
          }}
          drcWarnings={(() => {
            try {
              const drc = runDrc(circuit, circuit.board);
              if (circuit.netlistError) {
                drc.unshift({
                  severity: 'error',
                  rule: 'netlist-rejected',
                  partId: parts[0]?.id,
                  explanation: `The engine rejected this circuit — the board is ` +
                    `inactive until this is fixed: ${circuit.netlistError}`,
                });
              }
              // Merge bw-board engine warnings (from getWarnings/renderState)
              for (const w of warnings) {
                if (w.partIds && w.partIds.length > 0) {
                  for (const pid of w.partIds) {
                    drc.push({
                      severity: w.severity || 'warning',
                      rule: w.type || 'engine',
                      partId: pid,
                      explanation: w.message,
                      unratedIds: w.unratedIds,
                    });
                  }
                } else {
                  drc.push({
                    severity: w.severity || 'warning',
                    rule: w.type || 'engine',
                    partId: w.partId || parts.find(p => p.kind === 'mcu')?.id || parts[0]?.id,
                    explanation: w.message,
                  });
                }
              }
              // Phantom guard: strip warnings referencing parts that are
              // not in the current circuit — an inference-over-example race
              // could leave phantom "mcu1" warnings on an eater6502 bench.
              const partIds = new Set(parts.map(p => p.id));
              return drc.filter(w => !w.partId || partIds.has(w.partId));
            } catch { return []; }
          })()}
          panelNav={panelNav}
          rightOpen={rightOpen}
          lang={lang}
          viewNav={(
            <div role="radiogroup" aria-label="Circuit view" data-circuit-view-toggle data-circuit-view-switcher style={{display: 'inline-flex', width: 70, height: 34, border: '1px solid #64748b', borderRadius: 5, overflow: 'hidden', background: '#0f172a'}}>
              <button data-circuit-toggle-state={!showSchematic ? 'selected' : 'unselected'} role="radio" aria-checked={!showSchematic} onClick={() => setShowSchematic(false)} aria-label="Realistic view" title="Realistic view"
                style={{width: 34, minWidth: 34, height: 34, padding: 0, cursor: 'pointer', background: !showSchematic ? '#2563eb' : '#475569', color: '#fff', border: 'none', borderRight: '1px solid #cbd5e1', fontSize: 17}}>◉</button>
              <button data-circuit-toggle-state={showSchematic ? 'selected' : 'unselected'} role="radio" aria-checked={showSchematic} onClick={() => setShowSchematic(true)} aria-label="Schematic view" title="Schematic view"
                style={{width: 34, minWidth: 34, height: 34, padding: 0, cursor: 'pointer', background: showSchematic ? '#2563eb' : '#475569', color: '#fff', border: 'none', fontSize: 17}}>⌁</button>
            </div>
          )}
        />
        </>) : (
          <div style={{ flex: 1, minWidth: 0, overflow: 'auto', overscrollBehavior: 'contain',
            background: '#16213e', borderRadius: 8, border: '1px solid #2c3e50', padding: 8 }}>
            <div style={{ color: '#7f8c8d', fontFamily: 'monospace', fontSize: 10, marginBottom: 4 }}>
              Schematic — read-only projection of the circuit above. Edit in Realistic view.
            </div>
            <SchematicPanel parts={parts}
              nets={(circuit.board && circuit.board.getNets) ? circuit.board.getNets() : []} />
          </div>
        )}
        </div>

        {/* Engine warnings moved to the toolbar warning chip (BoardCanvas).
            The bottom triangle is gone — all findings surface in the top-row
            count-badged chip with its popover listing. */}
      </div>

      {/* Right sidebar — collapsible */}
      {rightOpen ? (
      <div data-instruments-column style={{ position: 'relative', display: 'flex', flexDirection: 'column', flex: '0 1 280px', width: 280, minWidth: 280, minHeight: 0, maxHeight: '100%', height: '100%', overflow: 'hidden', alignSelf: 'stretch', boxSizing: 'border-box' }}>
        <button onPointerDownCapture={e => { e.stopPropagation(); setRightOpen(false); }} onMouseDownCapture={e => e.stopPropagation()} onClick={() => setRightOpen(false)} aria-label={/^de/i.test(lang) ? 'Instrumentenpanel einklappen' : 'Collapse instruments panel'} aria-expanded="true" title={/^de/i.test(lang) ? 'Instrumentenpanel einklappen' : 'Collapse instruments panel'} style={{
          position: 'absolute', zIndex: 3, top: 4, left: 4, background: '#ffffff', border: '1px solid #cbd5e1',
          boxShadow: '0 1px 3px rgba(15,23,42,.18)', borderRadius: '999px', color: '#475569', cursor: 'pointer',
          fontSize: '16px', lineHeight: 1, width: 24, height: 24, padding: 0,
        }}>›</button>
        <div data-instruments-scroll style={{display: 'flex', flexDirection: 'column', gap: '12px', flex: '1 1 auto', minHeight: 0, height: 0, overflowY: 'auto', overflowX: 'hidden', overscrollBehavior: 'contain', paddingTop: 36, padding: '36px 6px 6px', boxSizing: 'border-box'}}>
        {/* Debugger surface — hidden entirely for pure circuits (no MCU/pins).
            The FACES below gate on capability, not on pins: a machine-class
            bench (6502/Z80) has no PIN concept, yet its booted machine has
            video/serial/registers. Gating faces on hasMcuPins kept the
            VdpScreen dark on a booted VDP machine (deploy probe, 2026-08-16).
            "Capabilities decide what is offered — never an assumption." */}
        {/* DebugStatus/step controls mount when the runner is active —
            either via MCU pins (STC/Arduino) or via machine-class runner
            (6502/Z80). The gate is debugState presence, not hasMcuPins:
            a machine bench has no PIN concept but its runner provides
            step/stepOver/registers. (widened per 57617b3 principle) */}
        {/* ── Debugger dock: 'top' = render here in instruments; 'right' = host
            renders full-size in the right column. The >> / << button flips. */}
        {debugDock === 'top' && (<>
        {debugState && (
          <DebugStatus
            debugState={debugState}
            capabilities={debugState.capabilities || null}
            onStep={debugState.step}
            onStepOver={debugState.stepOver}
            onStepOut={debugState.stepOut}
            onAddWatchpoint={debugState.addWatchpoint}
            lang={lang}
          />
        )}
        {debugState && typeof debugState.video === 'function' && (
          <VdpScreen videoFn={debugState.video} setButtonsFn={debugState.setButtons} setKeysFn={debugState.setKeys} loadSnapshotFn={debugState.loadSnapshot} lang={lang} />
        )}
        {debugState && typeof debugState.onSerial === 'function' && (
          <section style={{width: '100%', flex: '0 0 auto', boxSizing: 'border-box'}}>
            <div style={{fontSize: 11, fontWeight: 600, color: '#e2e8f0', marginBottom: 4, fontFamily: 'monospace'}}>
              {t('serialConsole', lang)}
            </div>
            <SerialConsole onSerialFn={debugState.onSerial} sendSerialFn={debugState.sendSerial}
              newline={debugState.serialNewline || 0x0d} lang={lang} />
          </section>
        )}
        {debugState && debugState.framebuffer && (
          <FramebufferFace chipState={debugState.framebuffer}
            width={debugState.framebuffer.width || 128}
            height={debugState.framebuffer.height || 64}
            stride={debugState.framebuffer.stride}
            lang={lang} />
        )}
        {debugState && typeof debugState.regs === 'function' && (
          <ArchitectureFace debugState={debugState} lang={lang} />
        )}
        {(hasMcuPins || debugState || benchOpen || (machineResult && machineResult.ok)) && debuggerPanel && (
          <section data-debugger-panel style={{width: '100%', flex: '0 0 auto', minHeight: 0, boxSizing: 'border-box', padding: 8,
            borderRadius: 6, background: '#0f172a', border: '1px solid #475569'}}>
            <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6}}>
              <span style={{fontSize: 12, fontWeight: 700, color: '#e2e8f0'}}>Debugger</span>
              {onDebugDockChange && (
                <button type="button" onClick={() => onDebugDockChange('right')}
                  title="Move debugger to full-size right pane"
                  style={{padding: '1px 6px', fontSize: 10, background: '#1e293b', color: '#94a3b8',
                    border: '1px solid #475569', borderRadius: 3, cursor: 'pointer'}}>&gt;&gt;</button>
              )}
            </div>
            {debuggerPanel}
          </section>
        )}
        </>)}
        {/* When docked right, show a << button to bring it back to instruments */}
        {debugDock === 'right' && onDebugDockChange && (hasMcuPins || debugState || benchOpen || debuggerOn) && (
          <section style={{width: '100%', flex: '0 0 auto', padding: 8, borderRadius: 6,
            background: '#0f172a', border: '1px solid #475569'}}>
            <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
              <span style={{fontSize: 11, color: '#94a3b8'}}>Debugger in right pane</span>
              <button type="button" onClick={() => onDebugDockChange('top')}
                title="Move debugger back to instruments"
                style={{padding: '1px 6px', fontSize: 10, background: '#1e293b', color: '#94a3b8',
                  border: '1px solid #475569', borderRadius: 3, cursor: 'pointer'}}>&lt;&lt;</button>
            </div>
          </section>
        )}
        {/* MCU-class benches without pins get PIN advice; a MACHINE-class
            bench (6502/Z80) has no PIN concept AT ALL — telling its user to
            "add a PIN declaration" points them at a door that does not
            exist (owner report, z80-bench 2026-08-16). It gets the truth:
            Build Machine, then the ASM tab. */}
        {debuggerOn && (!stc || !stc.pins || !stc.pins.length) && !hasRetroCpu && (() => {
          const mcuPart = parts.find(p =>
            p.kind === 'mcu' || p.kind === 'arduino_uno' || p.kind === 'arduino_nano' || p.kind === 'arduino_mega' || p.kind === 'pi_pico');
          if (!mcuPart) return null;
          const chipName = mcuPart.kind === 'pi_pico' ? 'Pico (RP2040)'
            : mcuPart.kind === 'arduino_nano' ? 'Arduino Nano'
            : mcuPart.kind === 'arduino_uno' ? 'Arduino Uno'
            : mcuPart.declName || mcuPart.kind;
          return (
            <div data-no-code-indicator style={{flex: '0 0 auto', padding: '10px 9px', borderRadius: 6,
              background: '#fff7ed', border: '1px solid #fdba74', color: '#9a3412',
              fontSize: 12, lineHeight: 1.35, marginTop: 4}}>
              <strong>{/^de/i.test(lang) ? 'Debugger inaktiv' : 'Debugger inactive'}</strong>
              <div>{/^de/i.test(lang)
                ? `Keine Programm-Pins für ${chipName}. Programm laden oder PIN-Deklaration in Blöcken hinzufügen.`
                : `No program pins for ${chipName}. Load a program or add a PIN declaration in Blocks. If you retargeted an example, the pin mapping may not be available for this chip.`}</div>
            </div>
          );
        })()}
        {debuggerOn && hasRetroCpu && (!stc || !stc.pins || !stc.pins.length) && (
          <div data-machine-hint style={{flex: '0 0 auto', padding: '10px 9px', borderRadius: 6,
            background: '#eff6ff', border: '1px solid #93c5fd', color: '#1e40af',
            fontSize: 12, lineHeight: 1.35, marginTop: 4}}>
            <strong>{/^de/i.test(lang) ? 'Maschinen-Werkbank' : 'Machine bench'}</strong>
            <div>{/^de/i.test(lang)
              ? 'Dieser Rechner hat keine Pins — er hat einen Bus. „Build Machine" bootet ihn aus der Verdrahtung; das Programm kommt aus dem ASM-Tab.'
              : 'This computer has no pins — it has a bus. "Build Machine" boots it from the wiring; the program comes from the ASM tab.'}</div>
          </div>
        )}
        {/* Build Machine — for retro breadboard computers */}
        {hasRetroCpu && (
          <section data-build-machine style={{width: '100%', flex: '0 0 auto', boxSizing: 'border-box', padding: 8, borderRadius: 6, background: '#0f172a', border: '1px solid #475569'}}>
            <button onClick={handleBuildMachine} title={t('buildMachineTitle', lang)}
              style={{width: '100%', minHeight: 32, padding: '5px 8px', cursor: 'pointer',
                background: '#1e3a5f', border: '1px solid #3b82f6', borderRadius: 4,
                color: '#93c5fd', fontFamily: 'monospace', fontSize: 11, fontWeight: 600}}>
              🔧 {t('buildMachine', lang)}
            </button>
            {machineResult && (
              <div style={{marginTop: 6, fontSize: 10, fontFamily: 'monospace', lineHeight: 1.4}}>
                {machineResult.ok ? (
                  <div style={{color: '#22c55e'}}>
                    ✓ {t('machineBooted', lang)}
                    {machineResult.lines && machineResult.lines.map((l, i) =>
                      <div key={i} style={{color: '#94a3b8', marginLeft: 8}}>{l}</div>
                    )}
                  </div>
                ) : (
                  <div style={{color: '#f87171'}}>
                    ✗ {t('extractFailed', lang)}
                    {machineResult.reasons.map((r, i) =>
                      <div key={i} style={{color: '#fbbf24', marginLeft: 8, marginTop: 2}}>{r}</div>
                    )}
                  </div>
                )}
                {machineResult.notes && machineResult.notes.length > 0 && (
                  <div style={{color: '#94a3b8', marginTop: 4}}>
                    {machineResult.notes.map((n, i) =>
                      <div key={i} style={{marginLeft: 8}}>💡 {n}</div>
                    )}
                  </div>
                )}
              </div>
            )}
            {/* Machine Loader — visible after successful Build Machine */}
            {machineResult && machineResult.ok && (() => {
              // extractMachine reports kind 'eater6502' (not '6502') for the
              // W65C02 bench — matching only '6502' here left the 6502 loader
              // with zero presets on deploy (owner report, 2038790).
              const kind = (machineResult.kind === 'eater6502' || machineResult.kind === '6502') ? 'eater6502'
                : machineResult.kind === 'z80' ? 'z80' : null;
              // Each preset names its SLOT (machine-media routing) and its
              // boot PROFILE — the machine shape the image was built for.
              // Tali Forth is a py65mon build and MS BASIC an Eater-map/ACIA
              // build; booting either on the user's extracted bus map would
              // run silently into open bus, which is worse than saying so.
              const presets = kind === 'eater6502' ? [
                { id: 'forth', label: 'Tali Forth 2', rom: 'taliforth-py65mon.bin', slot: 'rom', profile: 'py65mon',
                  hint: 'Interactive Forth (public domain) — py65mon console map, type at the ok prompt' },
                { id: 'basic', label: 'MS BASIC (6502)', rom: 'basic.rom', slot: 'rom', profile: 'eater',
                  hint: 'Microsoft BASIC 1.1 (MIT reconstruction) — Eater map, ACIA serial' },
                // The one-click display proof: boots on the EXTRACTED machine
                // (no profile), so the VIA drives whatever the bench wires —
                // the LCD on the Eater build. Without a program that writes
                // the display, "nothing shows on the LCD" is the correct and
                // useless truth (owner report, 2026-08-17).
                { id: 'lcdhello', label: 'LCD Hello', rom: 'lcd-hello.bin', slot: 'rom',
                  hint: 'Writes HI BRICKWRIGHT to the HD44780 through the VIA — busy-window honest; turn the contrast pot' },
              ] : kind === 'z80' ? [
                { id: 'bbcbasic', label: 'BBC BASIC', rom: 'bbcbasic.com', slot: 'com', profile: 'cpm',
                  hint: 'R.T. Russell (zlib) — CP/M .COM over the BDOS shim, type at the > prompt' },
                // Six bytes, the whole first program of every Searle-lineage
                // build: IN A,(0); OUT (0),A; JR -6. Boots on the EXTRACTED
                // machine so it reads the DIP and drives the LEDs the bench
                // actually wires.
                { id: 'mirror', label: 'Switch Mirror', rom: 'z80-mirror.bin', slot: 'rom',
                  hint: 'Mirrors the DIP switches onto the LEDs through the 244/374 pair — flip a switch, watch the LED' },
              ] : [];
              const dispatchLoad = (slotId, bytes, profile, name) => {
                window.dispatchEvent(new CustomEvent('bw-machine-media-load', {
                  detail: { slotId, bytes, kind, profile, name },
                }));
              };
              const loadPreset = async (p) => {
                try {
                  setLoaderNote(`fetching ${p.rom}…`);
                  const url = new URL(`static/roms/${p.rom}`, document.baseURI).href;
                  const res = await fetch(url);
                  if (!res.ok) throw new Error(`HTTP ${res.status}`);
                  const bytes = new Uint8Array(await res.arrayBuffer());
                  dispatchLoad(p.slot, bytes, p.profile, p.rom);
                  setLoaderNote(`${p.rom} (${bytes.length} bytes) → bench`);
                } catch (e) {
                  setLoaderNote(`✗ ${p.rom}: ${e.message}`);
                }
              };
              const loadFile = async (file) => {
                const bytes = new Uint8Array(await file.arrayBuffer());
                const slot = /\.com$/i.test(file.name) ? 'com' : 'rom';
                dispatchLoad(slot, bytes, slot === 'com' ? 'cpm' : null, file.name);
                setLoaderNote(`${file.name} (${bytes.length} bytes) → bench`);
              };
              return (
                <div style={{marginTop: 8, padding: 6, borderRadius: 4, background: '#1e293b', border: '1px solid #334155'}}>
                  <div style={{fontSize: 10, color: '#94a3b8', fontWeight: 600, marginBottom: 4}}>
                    Load onto machine
                  </div>
                  <div style={{display: 'flex', flexDirection: 'column', gap: 4}}>
                    {presets.map(p => (
                      <button key={p.id} onClick={() => loadPreset(p)} title={p.hint}
                        style={{padding: '4px 8px', cursor: 'pointer', fontSize: 10,
                          background: '#0f172a', border: '1px solid #475569', borderRadius: 3,
                          color: '#93c5fd', fontFamily: 'monospace', textAlign: 'left'}}>
                        📀 {p.label}
                      </button>
                    ))}
                    <label style={{padding: '4px 8px', cursor: 'pointer', fontSize: 10,
                      background: '#0f172a', border: '1px solid #475569', borderRadius: 3,
                      color: '#a5b4fc', fontFamily: 'monospace'}}>
                      📁 Load .hex / .bin file…
                      <input type="file" accept=".hex,.ihx,.bin,.rom,.com"
                        style={{display: 'none'}}
                        onChange={e => { if (e.target.files[0]) loadFile(e.target.files[0]); }} />
                    </label>
                    <div style={{fontSize: 9, color: '#64748b', marginTop: 2}}>
                      …or write ASM in the Code tab and Assemble &amp; Run
                    </div>
                    {loaderNote && (
                      <div data-loader-note style={{fontSize: 9, marginTop: 2,
                        color: loaderNote.startsWith('✗') ? '#f87171' : '#22c55e'}}>
                        {loaderNote}
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}
          </section>
        )}
        {mode === 'simulate' && (
          <section data-simulation-controls style={{width: '100%', flex: '0 0 auto', boxSizing: 'border-box', padding: 8, borderRadius: 6, background: '#f8fafc', border: '1px solid #cbd5e1'}}>
            <div style={{fontSize: 12, fontWeight: 600, color: '#334155', marginBottom: 6}}>{/^de/i.test(lang) ? 'Simulationssteuerung' : 'Simulation controls'}</div>
            <div style={{display: 'grid', gridTemplateColumns: '1fr', gap: 5}}>
              <button onClick={() => setSimPaused(v => !v)} title={simPaused ? (/^de/i.test(lang) ? 'Simulation fortsetzen' : 'Resume simulation') : (/^de/i.test(lang) ? 'Simulation pausieren' : 'Pause simulation')}
                style={{minHeight: 32, padding: '5px 8px', cursor: 'pointer'}}>{simPaused ? (/^de/i.test(lang) ? '▶ Fortsetzen' : '▶ Resume simulation') : (/^de/i.test(lang) ? '⏸ Pausieren' : '⏸ Pause simulation')}</button>
              <button onClick={handleSimStep} disabled={!simPaused} title={/^de/i.test(lang) ? 'Einen 50-ms-Takt vorspulen' : 'Advance one 50 ms tick'}
                style={{minHeight: 32, padding: '5px 8px', cursor: simPaused ? 'pointer' : 'default'}}>{/^de/i.test(lang) ? '⏭ Ein Takt' : '⏭ Step one tick'}</button>
            </div>
            <label style={{display: 'grid', gridTemplateColumns: '1fr', gap: 3, marginTop: 7, fontSize: 11, color: '#475569'}}>
              <span>Speed</span>
              <select value={simSpeed} onChange={e => setSimSpeed(Number(e.target.value))} title="Simulation speed" style={{minHeight: 30}}>
                <option value={0.25}>0.25×</option><option value={1}>1×</option><option value={4}>4×</option>
              </select>
            </label>
          </section>
        )}
        <div style={{ display: 'flex', flex: '0 0 auto', gap: 4, width: 280 }}>
          <button onClick={toggleScope} style={{ flex: 1, padding: '4px 6px', background: showScope ? '#2c3e50' : '#16213e', border: '1px solid #3498db', borderRadius: 4, color: '#3498db', fontFamily: 'monospace', fontSize: 10 }}>
            {showScope ? (/^de/i.test(lang) ? '▣ Oszilloskop verbergen' : '▣ Hide scope') : (/^de/i.test(lang) ? '▣ Oszilloskop' : '▣ Scope')}
          </button>
          <button onClick={toggleMeter} style={{ flex: 1, padding: '4px 6px', background: showMeter ? '#2c3e50' : '#16213e', border: '1px solid #f1c40f', borderRadius: 4, color: '#f1c40f', fontFamily: 'monospace', fontSize: 10 }}>
            {showMeter ? (/^de/i.test(lang) ? '⌁ Multimeter verbergen' : '⌁ Hide meter') : (/^de/i.test(lang) ? '⌁ Multimeter' : '⌁ Meter')}
          </button>
          <button onClick={toggleSweep} data-testid="bw-sweep-toggle" style={{ flex: 1, padding: '4px 6px', background: showSweep ? '#2c3e50' : '#16213e', border: '1px solid #9b59b6', borderRadius: 4, color: '#9b59b6', fontFamily: 'monospace', fontSize: 10 }}>
            {showSweep ? (/^de/i.test(lang) ? '∿ Sweep verbergen' : '∿ Hide sweep') : '∿ Sweep'}
          </button>
        </div>
        {showScope && <div data-scope-module style={{width: 280, flex: '0 0 auto'}}><ScopePanel board={circuit.board} nets={(circuit.board && circuit.board.getNets) ? circuit.board.getNets().map(n => n.id ?? n) : []} lang={lang} /></div>}
        {showMeter && <div data-meter-module style={{width: 280, flex: '0 0 auto'}}><Multimeter circuit={circuit} wires={wires} parts={parts} placingProbe={placingProbe} onStartPlacing={handleStartPlacing} onStopPlacing={handleStopPlacing} probePlacement={probePlacement} lang={lang} /></div>}
        {showSweep && <div data-sweep-module style={{width: 280, flex: '0 0 auto'}}><SweepPanel board={circuit.board} nets={(circuit.board && circuit.board.getNets) ? circuit.board.getNets().map(n => n.id ?? n) : []} lang={lang} /></div>}
        {/* Orientation input — for accelerometer parts (mpu6050, adxl335, memsic2125) */}
        {parts.filter(p => ['mpu6050', 'adxl335', 'memsic2125'].includes(p.kind)).map(p => (
          <OrientationInput key={p.id} partId={p.id} kind={p.kind} lang={lang}
            onSetParam={(id, key, val) => { if (circuit?.board?.setDeviceParam) circuit.board.setDeviceParam(id, key, val); }} />
        ))}
        {/* Stimulus controls — knock/tap and distance for sensors without fabric controls */}
        <StimulusControls parts={parts} lang={lang}
          onSetParam={(id, key, val) => { if (circuit?.board?.setDeviceParam) circuit.board.setDeviceParam(id, key, val); }} />
        </div>
      </div>
      ) : (
        <button onPointerDownCapture={e => { e.stopPropagation(); setRightOpen(true); }} onMouseDownCapture={e => e.stopPropagation()} onClick={() => setRightOpen(true)} style={{
          position: 'absolute', right: 4, top: 52, zIndex: 70,
          width: 28, height: 28, padding: 0, display: 'grid', placeItems: 'center',
          background: 'rgba(255,255,255,.96)', border: '1px solid #94a3b8',
          boxShadow: '0 2px 8px rgba(15,23,42,.24)', borderRadius: '999px',
          color: '#334155', cursor: 'pointer', fontFamily: 'system-ui, sans-serif', fontSize: 20, lineHeight: 1,
        }} aria-label={/^de/i.test(lang) ? 'Instrumentenpanel ausklappen' : 'Expand instruments panel'} aria-expanded="false" title={/^de/i.test(lang) ? 'Instrumentenpanel ausklappen' : 'Expand instruments panel'}>‹</button>
      )}
    </div>
  );
}
