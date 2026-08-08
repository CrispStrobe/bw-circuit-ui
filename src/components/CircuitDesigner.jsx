/**
 * CircuitDesigner — the top-level React component for embedding.
 *
 * Props:
 *   project: { device?, clock?, pins: StcPin[] }
 *     Pin declarations from the project. The circuit is inferred
 *     from these on mount. The user can then redraw.
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

const MS = 1_000_000n;

export function CircuitDesigner({ project }) {
  const {
    parts, wires, powered, rev,
    addPart, removePart, movePart,
    addWire, removeWire,
    setControl, setPin, advanceTo, advanceBy, setPower,
    loadInferred,
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

  // Load initial circuit from project props (or default)
  const initialLoaded = useRef(false);
  useEffect(() => {
    if (initialLoaded.current) return;
    initialLoaded.current = true;

    const stc = project?.pins?.length > 0
      ? project
      : {
          device: 'STC12C5A60S2',
          clock: 11059200,
          pins: [{ name: 'led1', port: 1, bit: 0, direction: 'output', activeLow: true }],
        };

    const { parts: ip, nets: in_ } = inferCircuit(stc);
    loadInferred(ip, in_);
  }, [project, loadInferred]);

  // Buzzer audio (browser-only, lazy import to avoid Node issues)
  const buzzerAudioRef = useRef(null);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    // Dynamic import so this works in non-Vite bundlers too
    import('../audio/buzzer-audio.js').then(mod => {
      buzzerAudioRef.current = mod;
    });
    return () => {
      buzzerAudioRef.current?.stopAllBuzzers();
    };
  }, []);

  useEffect(() => {
    const ba = buzzerAudioRef.current;
    if (!ba) return;
    const buzzers = parts.filter(p => p.kind === 'buzzer');
    for (const bz of buzzers) {
      try {
        const tone = buzzerTone(bz.id);
        ba.updateBuzzerAudio(bz.id, tone);
      } catch {}
    }
  }, [rev, parts, buzzerTone]);

  useEffect(() => {
    if (mode !== 'simulate') buzzerAudioRef.current?.stopAllBuzzers();
  }, [mode]);

  // Simulation loop
  const simInterval = useRef(null);
  const simStep = useRef(0);

  useEffect(() => {
    if (mode !== 'simulate') {
      if (simInterval.current) clearInterval(simInterval.current);
      return;
    }

    const mcu = parts.find(p => p.kind === 'mcu');
    if (!mcu) return;

    for (const pin of mcu.terminals) setPin(pin, 'quasi', true);
    advanceTo(0n);
    simStep.current = 0;

    simInterval.current = setInterval(() => {
      simStep.current++;
      if (mcu.terminals.includes('P1.0')) {
        setPin('P1.0', 'quasi', (simStep.current % 20) < 10);
      }
      advanceBy(50n * MS);
    }, 50);

    return () => { if (simInterval.current) clearInterval(simInterval.current); };
  }, [mode]);

  // Part placement
  const partCountRef = useRef(0);
  const handleAddPart = useCallback((kind, params) => {
    const offset = partCountRef.current * 30;
    partCountRef.current++;
    addPart(kind, params, 200 + (offset % 300), 150 + Math.floor(offset / 300) * 80);
  }, [addPart]);

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

  let statusText = null;
  if (mode === 'simulate') statusText = 'SIMULATING — MCU driving pins';
  else if (placingProbe) statusText = `Placing probe ${placingProbe} — click a terminal`;

  return (
    <div style={{
      display: 'flex',
      gap: '12px',
      padding: '16px',
      alignItems: 'flex-start',
      fontFamily: 'system-ui, -apple-system, sans-serif',
    }}>
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
          onMovePart={movePart}
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
