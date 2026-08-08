import React, { useState, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { BoardCanvas } from './components/BoardCanvas.jsx';
import { SnapshotPanel } from './components/SnapshotPanel.jsx';
import { demoParts, demoNets, terminalOffsets } from './model/demo-netlist.js';
import { createBoard, runDemoTrace } from './model/simulation.js';

function App() {
  // Run the simulation once on mount.
  // Every value shown comes from bw-board's BoardImpl.
  const { board, snapshots } = useMemo(() => {
    const b = createBoard(demoParts, demoNets);
    const snaps = runDemoTrace(b);
    return { board: b, snapshots: snaps };
  }, []);

  const [activeSnap, setActiveSnap] = useState(1); // default to "LED on" state

  const currentSnap = snapshots[activeSnap];
  const ledBrightness = currentSnap?.readings['brightness(LED1)'] ?? 0;

  // Collect node voltages for display
  const nodeVoltages = {};
  if (currentSnap) {
    for (const [key, val] of Object.entries(currentSnap.readings)) {
      if (key.startsWith('V(')) {
        const netId = key.slice(2, -1);
        nodeVoltages[netId] = val;
      }
    }
  }

  return (
    <div style={{ display: 'flex', gap: '20px', padding: '20px', alignItems: 'flex-start' }}>
      <BoardCanvas
        parts={demoParts}
        nets={demoNets}
        terminalOffsets={terminalOffsets}
        ledBrightness={{ LED1: ledBrightness }}
        nodeVoltages={nodeVoltages}
        activeLabel={currentSnap?.label}
      />
      <SnapshotPanel
        snapshots={snapshots}
        activeIndex={activeSnap}
        onSelect={setActiveSnap}
      />
    </div>
  );
}

const root = createRoot(document.getElementById('root'));
root.render(<App />);
