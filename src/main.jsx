import React, { useState, useCallback, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { BoardCanvas } from './components/BoardCanvas.jsx';
import { PartPalette } from './components/PartPalette.jsx';
import { ControlPanel } from './components/ControlPanel.jsx';
import { InferPanel } from './components/InferPanel.jsx';
import { Multimeter } from './components/Multimeter.jsx';
import { useCircuit } from './hooks/useCircuit.js';
import { updateBuzzerAudio, stopAllBuzzers } from './audio/buzzer-audio.js';
import { inferCircuit } from './model/inference.js';

const MS = 1_000_000n;

// Default preset: load this on first render so the canvas isn't empty.
const DEFAULT_PRESET = {
  device: 'STC12C5A60S2',
  clock: 11059200,
  pins: [
    { name: 'led1', port: 1, bit: 0, direction: 'output', activeLow: true },
  ],
};

function App() {
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

  // Load default preset on first render
  const defaultLoaded = useRef(false);
  useEffect(() => {
    if (!defaultLoaded.current) {
      defaultLoaded.current = true;
      const { parts: ip, nets: in_ } = inferCircuit(DEFAULT_PRESET);
      loadInferred(ip, in_);
    }
  }, [loadInferred]);

  // Multimeter probe placement state
  const [placingProbe, setPlacingProbe] = useState(null); // 'A'|'B'|null
  const [probePlacement, setProbePlacement] = useState(null);

  const handleStartPlacing = useCallback((which) => setPlacingProbe(which), []);
  const handleStopPlacing = useCallback(() => setPlacingProbe(null), []);

  // When a terminal is clicked while placing a probe, deliver the placement
  const handleTerminalClickForProbe = useCallback((partId, terminal) => {
    if (!placingProbe) return false; // not placing
    // Find which net this terminal is on
    const wire = wires.find(w =>
      (w.from.part === partId && w.from.terminal === terminal) ||
      (w.to.part === partId && w.to.terminal === terminal)
    );
    setProbePlacement({
      netId: wire?.netId || null,
      partId,
      terminal,
    });
    return true; // consumed the click
  }, [placingProbe, wires]);

  // Buzzer audio: update oscillators whenever simulation ticks
  useEffect(() => {
    const buzzers = parts.filter(p => p.kind === 'buzzer');
    for (const bz of buzzers) {
      try {
        const tone = buzzerTone(bz.id);
        updateBuzzerAudio(bz.id, tone);
      } catch {
        // Part might not be wired yet
      }
    }
    return () => {}; // cleanup on unmount handled by stopAllBuzzers
  }, [rev, parts, buzzerTone]);

  // Stop all buzzers when leaving simulate mode
  useEffect(() => {
    if (mode !== 'simulate') stopAllBuzzers();
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

    for (const pin of mcu.terminals) {
      setPin(pin, 'quasi', true);
    }
    advanceTo(0n);
    simStep.current = 0;

    simInterval.current = setInterval(() => {
      simStep.current++;
      const step = simStep.current;

      if (mcu.terminals.includes('P1.0')) {
        const on = (step % 20) < 10;
        setPin('P1.0', 'quasi', on);
      }

      advanceBy(50n * MS);
    }, 50);

    return () => {
      if (simInterval.current) clearInterval(simInterval.current);
    };
  }, [mode]);

  // Place new part near center
  const partCountRef = useRef(0);
  const handleAddPart = useCallback((kind, params) => {
    const offset = partCountRef.current * 30;
    partCountRef.current++;
    addPart(kind, params, 200 + (offset % 300), 150 + Math.floor(offset / 300) * 80);
  }, [addPart]);

  // Node voltages for display
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

  // Status text
  let statusText = null;
  if (mode === 'simulate') {
    statusText = 'SIMULATING — MCU driving pins';
  } else if (placingProbe) {
    statusText = `Placing probe ${placingProbe} — click a terminal`;
  }

  return (
    <div style={{
      display: 'flex',
      gap: '12px',
      padding: '16px',
      minHeight: '100vh',
      alignItems: 'flex-start',
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

const root = createRoot(document.getElementById('root'));
root.render(<App />);
