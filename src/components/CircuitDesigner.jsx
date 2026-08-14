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
 * Every electrical value comes from bw-board. Nothing is fabricated.
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { BoardCanvas } from './BoardCanvas.jsx';
import { PartPalette } from './PartPalette.jsx';
import { ControlPanel } from './ControlPanel.jsx';
import { InferPanel } from './InferPanel.jsx';
import { ExamplesBrowser } from './ExamplesBrowser.jsx';
import { Multimeter } from './Multimeter.jsx';
import { ScopePanel } from './ScopePanel.jsx';
import { SchematicPanel } from './SchematicPanel.jsx';
import { useCircuit } from '../hooks/useCircuit.js';
import { useBoard } from '../hooks/useBoard.js';
import { inferCircuit } from '../model/inference.js';
import { generatePartName, circuitToDeclarations } from '../model/declarations.js';
import { updateBuzzerAudio, stopBuzzer, stopAllBuzzers } from '../audio/buzzer-audio.js';
import { CubeScanAccumulator } from '../model/cube-scan.js';
import { DebugStatus } from './DebugStatus.jsx';
import { PinChooser } from './PinChooser.jsx';
import { getPinFunctionsForPart } from '../model/pin-functions.js';
import { Circuit } from '../model/circuit.js';
import { FOOTPRINTS as BB_FOOTPRINTS, computeLeadMap } from '../model/footprints.js';
import { buildSeatedFromDeclarations } from '../model/infer-seated.js';
import { runDrc } from '../model/drc.js';

const MS = 1_000_000n;
const GRID = 20;

function snapToGrid(v) {
  return Math.round(v / GRID) * GRID;
}

export function CircuitDesigner({ project, stc, board: externalBoard, debugState, simulationOnly, onDeclarationChange, onBoardReady, onCircuitReady, circuitData, examples, onLoadExample }) {
  // Accept both `project` and `stc` props (backward compat with lite integration)
  const projectData = project || stc;
  const {
    parts, wires, powered, rev,
    addPart, removePart, nudgeSeated, movePart, duplicatePart, rotatePart, flipPart, updateParams,
    addWire, removeWire, addHoleWire, addTapWire, updateWire,
    setControl, setPin, advanceTo, advanceBy, setPower,
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
    const decls = circuitToDeclarations(parts, wires);
    const json = JSON.stringify(decls);
    if (json !== lastDeclRef.current) {
      lastDeclRef.current = json;
      onDeclarationChange(decls);
    }
  }, [parts, wires, onDeclarationChange]);

  // ── Expose the Board to the host (for the circuit extension) ──
  useEffect(() => {
    if (onBoardReady && circuit.board) {
      onBoardReady(circuit.board);
    }
  }, [circuit.board, onBoardReady, parts, wires]); // re-fire when netlist changes (board rebuilt)

  const [selectedParts, setSelectedParts] = useState(new Set());
  const [selectedWire, setSelectedWire] = useState(null);

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
  const [leftOpen, setLeftOpen] = useState(true);
  // Examples panel collapse + vertical split between parts palette and examples
  const hasExamples = !!(examples && examples.length && onLoadExample);
  const [examplesOpen, setExamplesOpen] = useState(true);
  const [selectorSplit, setSelectorSplit] = useState(0.65);
  const savedSplitRef = useRef(0.65);
  const [rightOpen, setRightOpen] = useState(true);

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
  const [simPaused, setSimPaused] = useState(false);
  const [simSpeed, setSimSpeed] = useState(1); // 0.25 | 1 | 4 x real time
  const [probePlacement, setProbePlacement] = useState(null);
  const handleStartPlacing = useCallback((which) => setPlacingProbe(which), []);
  const handleStopPlacing = useCallback(() => setPlacingProbe(null), []);

  const handleTerminalClickForProbe = useCallback((partId, terminal) => {
    if (!placingProbe) return false;
    const wire = wires.find(w =>
      (w.from.part === partId && w.from.terminal === terminal) ||
      (w.to.part === partId && w.to.terminal === terminal)
    );
    setProbePlacement({ netId: wire?.netId || null, partId, terminal });
    return true;
  }, [placingProbe, wires]);

  // ── Project prop → infer circuit ────────────────────────────────
  // Re-infer when the project's pins change.
  const prevPinsRef = useRef(null);
  useEffect(() => {
    const pins = projectData?.pins;
    // Shallow compare: skip if same array reference
    if (pins === prevPinsRef.current) return;
    prevPinsRef.current = pins;

    // No declared pins: the last session's autosaved wiring beats the
    // canned demo - losing an evening's circuit to a reload was the bug.
    if (!(pins?.length > 0) && typeof localStorage !== 'undefined') {
      try {
        const saved = localStorage.getItem('bw-circuit-autosave');
        if (saved) {
          const data = JSON.parse(saved);
          if (data && Array.isArray(data.parts) && data.parts.length > 0) {
            handleLoad(data);
            return;
          }
        }
      } catch { /* corrupt autosave: fall through to the demo */ }
    }
    // First-open starter: a COMPLETE no-MCU bench circuit, seated and lit -
    // battery tapped into the rails, jumpers to the columns, resistor + LED
    // in the strips. Declared pins replace it with the inferred circuit.
    if (!(pins?.length > 0)) {
      try {
        const bb = addPart('breadboard', {}, 470, 300);
        const bat = addPart('vsource', { variant: '9v', volts: 5 }, 130, 150);
        const r1 = addPart('resistor', { ohms: 1000 }, 0, 0);
        const led = addPart('led', { color: 'red' }, 0, 0, 'led1');
        circuit.seatPart(r1.id, bb.id, computeLeadMap(BB_FOOTPRINTS.resistor, 'b5'));
        circuit.seatPart(led.id, bb.id, computeLeadMap(BB_FOOTPRINTS.led, 'c9'));
        addTapWire(bat.id, 'pos', bb.id, 't+3', '#e74c3c');
        addTapWire(bat.id, 'neg', bb.id, 't-3', '#2c3e50');
        addHoleWire(bb.id, 't+8', 'a5', '#e74c3c');
        addHoleWire(bb.id, 'a10', 't-8', '#2c3e50');
        setAnnotations([{ x: 470, y: 130, text: 'a complete circuit — the battery feeds the rails, the strips do the wiring', color: '#7f8c8d' }]);
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
    return () => stopAllBuzzers();
  }, []);

  useEffect(() => {
    const buzzers = parts.filter(p => p.kind === 'buzzer');
    for (const bz of buzzers) {
      try {
        const tone = readBuzzerTone(bz.id);
        updateBuzzerAudio(bz.id, tone);
      } catch {}
    }
  }, [rev, parts, readBuzzerTone, renderState]);

  useEffect(() => {
    if (mode !== 'simulate') stopAllBuzzers();
  }, [mode]);

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

    const mcu = parts.find(p => p.kind === 'mcu');
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
          let otherPart = null;
          if (w.from.part === mcu.id && w.from.terminal === pin) {
            otherPart = w.to.part;
          } else if (w.to.part === mcu.id && w.to.terminal === pin) {
            otherPart = w.from.part;
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
    const copiedWires = wires.filter(w => idSet.has(w.from.part) && idSet.has(w.to.part))
      .map(w => ({ ...w, from: { ...w.from }, to: { ...w.to } }));
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
      const fromId = idMap.get(w.from.part);
      const toId = idMap.get(w.to.part);
      if (fromId && toId) {
        addWire(fromId, w.from.terminal, toId, w.to.terminal);
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

  const handleButtonDown = useCallback((partId) => {
    setControl(partId, 1);
    advanceBy(1n * MS);
  }, [setControl, advanceBy]);

  const handleButtonUp = useCallback((partId) => {
    setControl(partId, 0);
    advanceBy(1n * MS);
  }, [setControl, advanceBy]);

  const handleLoadCircuit = useCallback((inferredParts, inferredNets, ann) => {
    loadInferred(inferredParts, inferredNets);
    setAnnotations(ann || []);
    setSelectedParts(new Set());
    setSelectedWire(null);
    setMode('build');
  }, [loadInferred]);

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
    circuit._syncNetlist();
    circuit._saveHistory();
    setSelectedParts(new Set());
    setSelectedWire(null);
    setMode('build');
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
      circuitData.wires.some(w => typeof w.from === 'string');
    const pins = projectData?.pins;
    // fileOnly: the host says this circuit arrived WITHOUT a program — a
    // pure-circuit example. Pins still in the project then belong to
    // whatever was loaded before, and inferring from them would rebuild
    // the PREVIOUS bench over this file (that is exactly what happened:
    // examples 47-53 all showed example 46's 19-part board).
    if (legacy && pins?.length > 0 && !circuitData.fileOnly) {
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
  }, [circuitData, handleLoad, projectData, circuit]);

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
      data-sim-mode={mode}
      style={{
        display: 'flex',
        gap: '12px',
        padding: '12px',
        height: '100%',
        minHeight: 0, // allow flex shrinking
        alignItems: 'stretch',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        overflow: 'clip',
      }}
    >
      {/* Left sidebar — collapsible. Hidden entirely in schematic view:
          a parts palette next to a read-only projection is dead width,
          and the projection needs every pixel this column can spare. */}
      {showSchematic ? null : leftOpen ? (
        <div data-selectors-panel style={{ display: 'flex', flexDirection: 'column', flexShrink: 0, minHeight: 0, maxHeight: 'calc(100dvh - 130px)', width: 190, minWidth: 190 }}>
          <button onClick={() => setLeftOpen(false)} style={{
            background: 'none', border: 'none', color: '#7f8c8d', cursor: 'pointer',
            fontFamily: 'monospace', fontSize: '10px', textAlign: 'right', padding: 0,
          }}>collapse</button>
          {/* Parts palette — takes selectorSplit fraction (or all if no examples) */}
          <div data-parts-selector style={{
            flex: hasExamples ? `${selectorSplit} 1 0` : '1 1 0',
            minHeight: 80, overflowY: 'auto', overscrollBehavior: 'contain',
          }}>
            <PartPalette onAddPart={handleAddPart} onStartPlace={(kind, params) => setPlacingPart({ kind, params })} />
            <InferPanel onLoadCircuit={handleLoadCircuit} />
          </div>
          {/* Examples section — only shown when examples prop is provided */}
          {hasExamples && (<>
            {/* Drag divider */}
            <div data-selector-divider role="separator" style={{
              flex: '0 0 10px', cursor: 'row-resize', display: 'flex',
              alignItems: 'center', justifyContent: 'center',
              borderTop: '1px solid #2c3e50', borderBottom: '1px solid #2c3e50',
              background: '#1a1a2e', userSelect: 'none',
            }} onPointerDown={e => {
              if (!examplesOpen) return;
              e.preventDefault();
              const startY = e.clientY;
              const panel = e.currentTarget.closest('[data-selectors-panel]');
              const total = panel ? panel.offsetHeight : 400;
              const start = selectorSplit;
              const move = ev => {
                const next = Math.max(0.2, Math.min(0.85, start + (ev.clientY - startY) / total));
                setSelectorSplit(next);
                savedSplitRef.current = next;
              };
              const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
              window.addEventListener('pointermove', move);
              window.addEventListener('pointerup', up);
            }}>
              <div style={{ width: 24, height: 3, borderRadius: 1.5, background: '#34495e' }} />
            </div>
            {/* Examples panel — collapsible to just a handle rail */}
            <div data-examples-selector style={{
              flex: examplesOpen ? `${1 - selectorSplit} 1 0` : '0 0 28px',
              minHeight: 28, overflowY: examplesOpen ? 'auto' : 'hidden',
              overscrollBehavior: 'contain', display: 'flex', flexDirection: 'column',
            }}>
              {/* Collapse/expand handle */}
              <button data-examples-toggle onClick={() => {
                if (examplesOpen) {
                  savedSplitRef.current = selectorSplit;
                  setSelectorSplit(0.97);
                  setExamplesOpen(false);
                } else {
                  setSelectorSplit(savedSplitRef.current);
                  setExamplesOpen(true);
                }
              }} style={{
                flex: '0 0 24px', background: '#1a1a2e', border: 'none',
                borderBottom: examplesOpen ? '1px solid #2c3e50' : 'none',
                color: '#7f8c8d', cursor: 'pointer', fontFamily: 'monospace',
                fontSize: '10px', textAlign: 'left', padding: '4px 8px',
                display: 'flex', alignItems: 'center', gap: 6,
              }}>
                <span style={{ fontSize: '8px' }}>{examplesOpen ? '▼' : '▶'}</span>
                Examples
              </button>
              {examplesOpen && (
                <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
                  <ExamplesBrowser examples={examples} onLoadExample={onLoadExample} />
                </div>
              )}
            </div>
          </>)}
        </div>
      ) : (
        <button onClick={() => setLeftOpen(true)} style={{
          writingMode: 'vertical-rl', background: '#1a1a2e', border: '1px solid #2c3e50',
          borderRadius: '4px', color: '#7f8c8d', cursor: 'pointer', padding: '8px 4px',
          fontFamily: 'monospace', fontSize: '10px', flexShrink: 0,
        }}>Parts</button>
      )}

      {/* A snapshot must not LOOK like a live board. Desaturating it is the
          cheapest honest signal: the reading is real but it is of a world that
          has moved on since. A frozen simulation gets no treatment, because
          nothing about it is stale — that is the whole difference `skewNs`
          exists to carry, and rendering both the same would throw it away.
          `setControl` stays live either way: turning the pot is user intent,
          not physics, so nothing here disables interaction. */}
      <div style={{
        flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0,
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
        {/* View mode switch: one view at a time, full width */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
          {['realistic', 'schematic'].map(vm => (
            <button key={vm} onClick={() => setShowSchematic(vm === 'schematic')} style={{
              background: (vm === 'schematic') === showSchematic ? '#3498db' : '#16213e',
              color: (vm === 'schematic') === showSchematic ? '#fff' : '#7f8c8d',
              border: '1px solid #2c3e50', borderRadius: 4,
              padding: '3px 10px', cursor: 'pointer',
              fontFamily: 'monospace', fontSize: 10,
            }}>{vm === 'realistic' ? 'Realistic' : 'Schematic'}</button>
          ))}
        </div>
        <div style={{ flex: 1, minHeight: 0, minWidth: 0, overflow: 'clip', display: 'flex', flexDirection: 'column' }}>
        {!showSchematic ? (<>
        {mode === 'simulate' && (
          <span style={{ display: 'inline-flex', gap: 4, alignSelf: 'flex-end', marginBottom: 4, marginRight: 6 }}>
            <button onClick={() => setSimPaused(v => !v)}
              title={simPaused ? 'Resume simulation' : 'Pause simulation (board time freezes; knobs stay live)'}
              style={{ background: simPaused ? '#e67e22' : '#16213e', border: '1px solid #2c3e50',
                color: simPaused ? '#000' : '#7f8c8d', borderRadius: 4, padding: '3px 10px',
                cursor: 'pointer', fontFamily: 'monospace', fontSize: 10 }}>
              {simPaused ? '▶ resume' : '⏸ pause'}</button>
            <button onClick={handleSimStep} disabled={!simPaused}
              title="Advance one 50 ms tick"
              style={{ background: '#16213e', border: '1px solid #2c3e50',
                color: simPaused ? '#3498db' : '#3a4a5a', borderRadius: 4, padding: '3px 10px',
                cursor: simPaused ? 'pointer' : 'default', fontFamily: 'monospace', fontSize: 10 }}>
              ⏭ step</button>
            <select value={simSpeed} onChange={e => setSimSpeed(Number(e.target.value))}
              title="Simulation speed"
              style={{ background: '#16213e', color: '#7f8c8d', border: '1px solid #2c3e50',
                borderRadius: 4, fontSize: 10, fontFamily: 'monospace' }}>
              <option value={0.25}>0.25x</option>
              <option value={1}>1x</option>
              <option value={4}>4x</option>
            </select>
          </span>
        )}
        <BoardCanvas
          parts={parts}
          wires={wires}
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
            try {
              return circuit.seatPart(partId, boardId, computeLeadMap(BB_FOOTPRINTS[part.kind], hole));
            } catch { return false; }
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
              // Merge bw-board engine warnings (from getWarnings/renderState)
              // so aggregate current-budget warnings reach DrcOverlay too.
              for (const w of warnings) {
                if (w.partIds && w.partIds.length > 0) {
                  // Multi-part warning (e.g. aggregate current): one entry
                  // per contributing part so the overlay highlights each one
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
                  // Single-part or no-part warning: fall back to MCU or first part
                  drc.push({
                    severity: w.severity || 'warning',
                    rule: w.type || 'engine',
                    partId: w.partId || parts.find(p => p.kind === 'mcu')?.id || parts[0]?.id,
                    explanation: w.message,
                  });
                }
              }
              return drc;
            } catch { return []; }
          })()}
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

        {/* Engine warnings — teaching feedback */}
        {warnings.length > 0 && (
          <div style={{
            marginTop: '8px',
            padding: '8px',
            background: '#1a1a0e',
            border: '1px solid #e67e22',
            borderRadius: '4px',
            fontFamily: 'monospace',
            fontSize: '10px',
          }}>
            {warnings.map((w, i) => (
              <div key={i} style={{
                color: w.severity === 'danger' ? '#e74c3c' : '#f39c12',
                marginBottom: '2px',
              }}>
                {w.severity === 'danger' ? '⚠' : '!'} {w.message}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Right sidebar — collapsible */}
      {rightOpen ? (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', flexShrink: 0, overflowY: 'auto', maxHeight: 'calc(100dvh - 130px)', overscrollBehavior: 'contain' }}>
        <button onClick={() => setRightOpen(false)} style={{
          background: 'none', border: 'none', color: '#7f8c8d', cursor: 'pointer',
          fontFamily: 'monospace', fontSize: '10px', textAlign: 'left', padding: 0,
        }}>collapse</button>
        {debugState && (
          <DebugStatus
            debugState={debugState}
            capabilities={debugState.capabilities || null}
          />
        )}
        <ControlPanel
          mode={mode}
          onModeChange={setMode}
          powered={powered}
          onPowerToggle={() => setPower(!powered)}
          selectedPart={selectedPart}
          selectedWire={selectedWire}
          parts={parts}
          onRemovePart={(id) => { removePart(id); setSelectedParts(new Set()); }}
          onRemoveWire={(id) => { removeWire(id); setSelectedWire(null); }}
          onUndo={undo}
          onRedo={redo}
          canUndo={canUndo}
          canRedo={canRedo}
          onUpdateParams={updateParams}
          onSave={handleSave}
          onLoad={handleLoad}
        />
        <ScopePanel
          board={circuit.board}
          nets={(circuit.board && circuit.board.getNets) ? circuit.board.getNets().map(n => n.id ?? n) : []}
        />
        <Multimeter
          circuit={circuit}
          wires={wires}
          parts={parts}
          placingProbe={placingProbe}
          onStartPlacing={handleStartPlacing}
          onStopPlacing={handleStopPlacing}
          probePlacement={probePlacement}
        />
        {/* Pin functions: show when an MCU is selected */}
        {selectedPart && (() => {
          const p = parts.find(pp => pp.id === selectedPart);
          if (!p || p.kind !== 'mcu') return null;
          const pinData = getPinFunctionsForPart(p.kind);
          if (pinData.length === 0) return null;
          return <PinChooser pins={pinData} />;
        })()}
      </div>
      ) : (
        <button onClick={() => setRightOpen(true)} style={{
          writingMode: 'vertical-rl', background: '#1a1a2e', border: '1px solid #2c3e50',
          borderRadius: '4px', color: '#7f8c8d', cursor: 'pointer', padding: '8px 4px',
          fontFamily: 'monospace', fontSize: '10px', flexShrink: 0,
        }}>Controls</button>
      )}
    </div>
  );
}
