import React, { useState, useCallback, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { BoardCanvas } from './components/BoardCanvas.jsx';
import { PartPalette } from './components/PartPalette.jsx';
import { ControlPanel } from './components/ControlPanel.jsx';
import { InferPanel } from './components/InferPanel.jsx';
import { Multimeter } from './components/Multimeter.jsx';
import { useCircuit } from './hooks/useCircuit.js';

const MS = 1_000_000n;

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
  const [mode, setMode] = useState('build'); // 'build' or 'simulate'

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

  return (
    <div style={{
      display: 'flex',
      gap: '12px',
      padding: '16px',
      minHeight: '100vh',
      alignItems: 'flex-start',
    }}>
      {/* Left column: palette + infer */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <PartPalette onAddPart={handleAddPart} />
        <InferPanel onLoadCircuit={handleLoadCircuit} />
      </div>

      {/* Center: canvas */}
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
          statusText={mode === 'simulate' ? 'SIMULATING — MCU driving pins' : null}
        />
      </div>

      {/* Right column: controls + multimeter */}
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
        />
      </div>
    </div>
  );
}

const root = createRoot(document.getElementById('root'));
root.render(<App />);
