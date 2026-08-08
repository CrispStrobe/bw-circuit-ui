import React, { useState, useCallback, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { BoardCanvas } from './components/BoardCanvas.jsx';
import { PartPalette } from './components/PartPalette.jsx';
import { ControlPanel } from './components/ControlPanel.jsx';
import { useCircuit } from './hooks/useCircuit.js';

const MS = 1_000_000n;

function App() {
  const {
    parts, wires, powered, rev,
    addPart, removePart, movePart,
    addWire, removeWire,
    setControl, setPin, advanceTo, advanceBy, setPower,
    ledBrightness, buzzerTone, nodeVoltage,
    circuit,
  } = useCircuit(5.0);

  const [selectedPart, setSelectedPart] = useState(null);
  const [selectedWire, setSelectedWire] = useState(null);
  const [mode, setMode] = useState('build'); // 'build' or 'simulate'

  // In simulate mode, run a simple scripted MCU loop
  const simInterval = useRef(null);
  const simStep = useRef(0);

  useEffect(() => {
    if (mode !== 'simulate') {
      if (simInterval.current) clearInterval(simInterval.current);
      return;
    }

    // Find MCU part
    const mcu = parts.find(p => p.kind === 'mcu');
    if (!mcu) return;

    // Initial pin setup: all quasi HIGH
    for (const pin of mcu.terminals) {
      setPin(pin, 'quasi', true);
    }
    advanceTo(0n);
    simStep.current = 0;

    // Run simulation at 20 Hz (50ms steps)
    simInterval.current = setInterval(() => {
      simStep.current++;
      const step = simStep.current;

      // Blink first pin (P1.0 if it exists) at 2 Hz
      if (mcu.terminals.includes('P1.0')) {
        const on = (step % 20) < 10; // 500ms on, 500ms off at 20Hz update
        setPin('P1.0', 'quasi', on); // quasi HIGH = LED off (active-low)
      }

      advanceBy(50n * MS); // advance 50ms per tick
    }, 50);

    return () => {
      if (simInterval.current) clearInterval(simInterval.current);
    };
  }, [mode]);

  // Place new part near center with some offset
  const partCountRef = useRef(0);
  const handleAddPart = useCallback((kind, params) => {
    const offset = partCountRef.current * 30;
    partCountRef.current++;
    const x = 200 + (offset % 300);
    const y = 150 + Math.floor(offset / 300) * 80;
    addPart(kind, params, x, y);
  }, [addPart]);

  // Collect node voltages for display
  const nodeVoltages = {};
  // rev is referenced to ensure re-render
  if (rev >= 0) {
    const seenNets = new Set();
    for (const w of wires) {
      if (!seenNets.has(w.netId)) {
        seenNets.add(w.netId);
        try {
          nodeVoltages[w.netId] = nodeVoltage(w.netId);
        } catch {
          // net might not exist in engine yet
        }
      }
    }
  }

  const handleControlChange = useCallback((partId, value) => {
    setControl(partId, value);
    advanceBy(1n * MS); // nudge time forward so the engine updates
  }, [setControl, advanceBy]);

  const handleButtonDown = useCallback((partId) => {
    setControl(partId, 1);
    advanceBy(1n * MS);
  }, [setControl, advanceBy]);

  const handleButtonUp = useCallback((partId) => {
    setControl(partId, 0);
    advanceBy(1n * MS);
  }, [setControl, advanceBy]);

  return (
    <div style={{
      display: 'flex',
      gap: '12px',
      padding: '16px',
      minHeight: '100vh',
      alignItems: 'flex-start',
    }}>
      <PartPalette onAddPart={handleAddPart} />

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
    </div>
  );
}

const root = createRoot(document.getElementById('root'));
root.render(<App />);
