import React from 'react';
import { createRoot } from 'react-dom/client';
import { BoardCanvas } from './components/BoardCanvas.jsx';
import { demoParts, demoNets, terminalOffsets } from './model/demo-netlist.js';

function App() {
  return (
    <BoardCanvas
      parts={demoParts}
      nets={demoNets}
      terminalOffsets={terminalOffsets}
    />
  );
}

const root = createRoot(document.getElementById('root'));
root.render(<App />);
