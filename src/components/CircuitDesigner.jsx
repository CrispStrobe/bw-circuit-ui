/**
 * CircuitDesigner — the top-level React component for embedding.
 *
 * Props:
 *   project: { device?, clock?, pins: StcPin[] }
 *     Pin declarations from the project. The circuit is re-inferred
 *     whenever this prop changes (shallow compare on pins array).
 *
 * This component is self-contained: it manages its own board,
 * simulation, and state. No Vite-specific imports.
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
import { inferCircuit } from '../model/inference.js';
import { updateBuzzerAudio, stopBuzzer, stopAllBuzzers } from '../audio/buzzer-audio.js';

const MS = 1_000_000n;
const GRID = 20; // snap-to-grid size

function snapToGrid(v) {
  return Math.round(v / GRID) * GRID;
}

export function CircuitDesigner({ project }) {
  const {
    parts, wires, powered, rev,
    addPart, removePart, movePart, updateParams,
    addWire, removeWire,
    setControl, setPin, advanceTo, advanceBy, setPower,
    loadInferred, undo, redo, canUndo, canRedo,
    ledBrightness, buzzerTone, nodeVoltage,
    circuit,
  } = useCircuit(5.0);

  const [selectedPart, setSelectedPart] = useState(null);
  const [selectedWire, setSelectedWire] = useState(null);
  const [mode, setMode] = useState('build');

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
    const pins = project?.pins;
    // Shallow compare: skip if same array reference
    if (pins === prevPinsRef.current) return;
    prevPinsRef.current = pins;

    const stc = pins?.length > 0
      ? project
      : {
          device: 'STC12C5A60S2',
          clock: 11059200,
          pins: [{ name: 'led1', port: 1, bit: 0, direction: 'output', activeLow: true }],
        };

    const { parts: ip, nets: in_ } = inferCircuit(stc);
    loadInferred(ip, in_);
  }, [project, loadInferred]);

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
  // Drives ALL output pins found on the MCU, not just P1.0.
  // Output pins blink at 2 Hz; input/analog pins are left alone.
  const simInterval = useRef(null);
  const simStep = useRef(0);

  useEffect(() => {
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

  // ── Part placement with snap-to-grid ────────────────────────────
  const partCountRef = useRef(0);
  const handleAddPart = useCallback((kind, params) => {
    const offset = partCountRef.current * 40;
    partCountRef.current++;
    const x = snapToGrid(200 + (offset % 300));
    const y = snapToGrid(150 + Math.floor(offset / 300) * 80);
    addPart(kind, params, x, y);
  }, [addPart]);

  // Snap-to-grid on move
  const handleMovePart = useCallback((partId, x, y) => {
    movePart(partId, snapToGrid(x), snapToGrid(y));
  }, [movePart]);

  // Node voltages
  const nodeVoltages = {};
  if (rev >= 0) {
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

  const handleLoadCircuit = useCallback((inferredParts, inferredNets) => {
    loadInferred(inferredParts, inferredNets);
    setSelectedPart(null);
    setSelectedWire(null);
    setMode('build');
    partCountRef.current = 0;
  }, [loadInferred]);

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
  }, [undo, redo]);

  let statusText = null;
  if (mode === 'simulate') statusText = 'SIMULATING — MCU driving pins';
  else if (placingProbe) statusText = `Placing probe ${placingProbe} — click a terminal`;

  return (
    <div
      style={{
        display: 'flex',
        gap: '12px',
        padding: '16px',
        alignItems: 'flex-start',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <PartPalette onAddPart={handleAddPart} />
        <InferPanel onLoadCircuit={handleLoadCircuit} />
      </div>

      <div style={{ flex: 1 }}>
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
          onSelectPart={setSelectedPart}
          selectedPart={selectedPart}
          onSelectWire={setSelectedWire}
          selectedWire={selectedWire}
          onControlChange={handleControlChange}
          onButtonDown={handleButtonDown}
          onButtonUp={handleButtonUp}
          statusText={statusText}
          placingProbe={placingProbe}
          onTerminalClickForProbe={handleTerminalClickForProbe}
        />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <ControlPanel
          mode={mode}
          onModeChange={setMode}
          powered={powered}
          onPowerToggle={() => setPower(!powered)}
          selectedPart={selectedPart}
          selectedWire={selectedWire}
          parts={parts}
          onRemovePart={(id) => { removePart(id); setSelectedPart(null); }}
          onRemoveWire={(id) => { removeWire(id); setSelectedWire(null); }}
          onUndo={undo}
          onRedo={redo}
          canUndo={canUndo}
          canRedo={canRedo}
          onUpdateParams={updateParams}
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
    </div>
  );
}
