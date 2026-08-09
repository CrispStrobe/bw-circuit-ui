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
 * Every electrical value comes from bw-board. Nothing is fabricated.
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { BoardCanvas } from './BoardCanvas.jsx';
import { PartPalette } from './PartPalette.jsx';
import { ControlPanel } from './ControlPanel.jsx';
import { InferPanel } from './InferPanel.jsx';
import { Multimeter } from './Multimeter.jsx';
import { useCircuit } from '../hooks/useCircuit.js';
import { useBoard } from '../hooks/useBoard.js';
import { inferCircuit } from '../model/inference.js';
import { generatePartName, circuitToDeclarations } from '../model/declarations.js';
import { updateBuzzerAudio, stopBuzzer, stopAllBuzzers } from '../audio/buzzer-audio.js';

const MS = 1_000_000n;
const GRID = 20;

function snapToGrid(v) {
  return Math.round(v / GRID) * GRID;
}

export function CircuitDesigner({ project, stc, board: externalBoard, onDeclarationChange, onBoardReady }) {
  // Accept both `project` and `stc` props (backward compat with lite integration)
  const projectData = project || stc;
  const {
    parts, wires, powered, rev,
    addPart, removePart, movePart, duplicatePart, rotatePart, updateParams,
    addWire, removeWire,
    setControl, setPin, advanceTo, advanceBy, setPower,
    loadInferred, undo, redo, canUndo, canRedo,
    ledBrightness, buzzerTone, nodeVoltage,
    circuit,
  } = useCircuit(5.0);

  // The active board: external (from host/emulator) or internal (from circuit model)
  const activeBoard = externalBoard || circuit.board;

  // Subscribe to board changes for automatic re-rendering
  const { renderState, refresh } = useBoard(activeBoard);

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
  const [rightOpen, setRightOpen] = useState(true);

  const [annotations, setAnnotations] = useState([]);

  // Multimeter
  const [placingProbe, setPlacingProbe] = useState(null);
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
  useEffect(() => {
    return () => stopAllBuzzers();
  }, []);

  useEffect(() => {
    const buzzers = parts.filter(p => p.kind === 'buzzer');
    for (const bz of buzzers) {
      try {
        const tone = buzzerTone(bz.id);
        updateBuzzerAudio(bz.id, tone);
      } catch {}
    }
  }, [rev, parts, buzzerTone]);

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
    if (!mcu) return;

    // Classify pins by what's connected to them
    const outputPins = []; // pins with LEDs or buzzers connected
    const inputPins = [];  // pins with buttons connected
    const analogPins = []; // pins with pots connected

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

    // Initialize pin modes
    // Reset the board to clear stale state (capacitor voltages, LED history, etc.)
    if (circuit.board.reset) circuit.board.reset();

    for (const pin of outputPins) setPin(pin, 'quasi', true);
    for (const pin of inputPins) setPin(pin, 'quasi', true);
    for (const pin of analogPins) setPin(pin, 'input', false);

    advanceTo(0n);
    simStep.current = 0;

    simInterval.current = setInterval(() => {
      simStep.current++;
      const step = simStep.current;

      // Blink all output pins at 2 Hz (500ms period at 20 Hz tick)
      for (const pin of outputPins) {
        const on = (step % 20) < 10;
        setPin(pin, 'quasi', on); // HIGH = LED off (active-low)
      }

      advanceBy(50n * MS);
    }, 50);

    return () => { if (simInterval.current) clearInterval(simInterval.current); };
  }, [mode, parts, wires]);

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

  // Snap-to-grid on move
  const handleMovePart = useCallback((partId, x, y) => {
    movePart(partId, snapToGrid(x), snapToGrid(y));
  }, [movePart]);

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
        try { nodeVoltages[w.netId] = nodeVoltage(w.netId); } catch {}
      }
    }
  }

  const handleControlChange = useCallback((partId, value) => {
    setControl(partId, value);
    advanceBy(1n * MS);
  }, [setControl, advanceBy]);

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
    if (!data || !data.parts || !data.wires) return;
    circuit.parts = data.parts.map(p => ({ ...p }));
    circuit.wires = data.wires.map(w => ({ ...w }));
    circuit._syncNetlist();
    circuit._saveHistory();
    setSelectedParts(new Set());
    setSelectedWire(null);
    setMode('build');
  }, [circuit]);

  // Keyboard shortcuts
  const handleKeyDown = useCallback((e) => {
    // Ctrl+Z / Cmd+Z → undo
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
      e.preventDefault();
      undo();
    }
    // Ctrl+Shift+Z / Ctrl+Y → redo
    if ((e.ctrlKey || e.metaKey) && (e.key === 'Z' || e.key === 'y')) {
      e.preventDefault();
      redo();
    }
    // Ctrl+A → select all parts
    if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
      e.preventDefault();
      setSelectedParts(new Set(parts.map(p => p.id)));
    }
    // R → rotate selected part
    if (e.key === 'r' && !e.ctrlKey && !e.metaKey && selectedPart) {
      rotatePart(selectedPart);
    }
    // Ctrl+D → duplicate selected part
    if ((e.ctrlKey || e.metaKey) && e.key === 'd' && selectedPart) {
      e.preventDefault();
      const dup = duplicatePart(selectedPart);
      if (dup) handleSelectPart(dup.id);
    }
  }, [undo, redo, rotatePart, duplicatePart, selectedPart]);

  let statusText = null;
  if (externalBoard) statusText = 'LIVE — emulator driving pins';
  else if (mode === 'simulate') statusText = 'SIMULATING — scripted MCU demo';
  else if (placingProbe) statusText = `Placing probe ${placingProbe} — click a terminal`;

  return (
    <div
      style={{
        display: 'flex',
        gap: '12px',
        padding: '12px',
        height: '100%',
        minHeight: 0, // allow flex shrinking
        alignItems: 'stretch',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        overflow: 'hidden',
      }}
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      {/* Left sidebar — collapsible */}
      {leftOpen ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', flexShrink: 0, overflowY: 'auto' }}>
          <button onClick={() => setLeftOpen(false)} style={{
            background: 'none', border: 'none', color: '#7f8c8d', cursor: 'pointer',
            fontFamily: 'monospace', fontSize: '10px', textAlign: 'right', padding: 0,
          }}>collapse</button>
          <PartPalette onAddPart={handleAddPart} />
          <InferPanel onLoadCircuit={handleLoadCircuit} />
        </div>
      ) : (
        <button onClick={() => setLeftOpen(true)} style={{
          writingMode: 'vertical-rl', background: '#1a1a2e', border: '1px solid #2c3e50',
          borderRadius: '4px', color: '#7f8c8d', cursor: 'pointer', padding: '8px 4px',
          fontFamily: 'monospace', fontSize: '10px', flexShrink: 0,
        }}>Parts</button>
      )}

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <BoardCanvas
          parts={parts}
          wires={wires}
          ledBrightness={ledBrightness}
          buzzerTones={buzzerTone}
          nodeVoltages={nodeVoltages}
          onAddWire={addWire}
          onRemoveWire={removeWire}
          onRemovePart={removePart}
          onMovePart={handleMovePart}
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
          onTerminalClickForProbe={handleTerminalClickForProbe}
          onDuplicatePart={(id) => { const dup = duplicatePart(id); if (dup) handleSelectPart(dup.id); }}
          onRotatePart={rotatePart}
          onDropPart={(kind, params, x, y) => {
            const declarable = ['led', 'buzzer', 'button', 'potentiometer'];
            const existingNames = parts.filter(p => p.declName).map(p => p.declName);
            const declName = declarable.includes(kind) ? generatePartName(kind, existingNames) : undefined;
            const p = addPart(kind, params, snapToGrid(x), snapToGrid(y), declName);
            if (p) handleSelectPart(p.id);
          }}
          circuit={circuit}
          warnings={warnings}
          annotations={annotations}
        />

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
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', flexShrink: 0, overflowY: 'auto' }}>
        <button onClick={() => setRightOpen(false)} style={{
          background: 'none', border: 'none', color: '#7f8c8d', cursor: 'pointer',
          fontFamily: 'monospace', fontSize: '10px', textAlign: 'left', padding: 0,
        }}>collapse</button>
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
        <Multimeter
          circuit={circuit}
          wires={wires}
          parts={parts}
          placingProbe={placingProbe}
          onStartPlacing={handleStartPlacing}
          onStopPlacing={handleStopPlacing}
          probePlacement={probePlacement}
        />
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
