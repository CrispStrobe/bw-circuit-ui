/**
 * Dev harness — renders the CircuitDesigner as a standalone page.
 *
 * This file is only used by the Vite dev server. It injects the engine
 * from the local bw-board copy, then renders the component.
 */

import React from 'react';
import { createRoot } from 'react-dom/client';

// Inject engine from local bw-board (dev harness only)
import { setEngine } from './engine.js';
import { BoardImpl } from '../../bw-board/src/board.js';
import { inferNetlist, checkWiring } from '../../bw-board/src/infer-netlist.js';
setEngine({ BoardImpl, inferNetlist, checkWiring });

// Now safe to import CircuitDesigner (which uses getEngine())
import { CircuitDesigner } from './components/CircuitDesigner.jsx';

function App() {
  return (
    <div style={{
      background: '#1a1a2e',
      color: '#e0e0e0',
      minHeight: '100vh',
    }}>
      <CircuitDesigner
        project={{
          device: 'STC12C5A60S2',
          clock: 11059200,
          pins: [
            { name: 'led1', port: 1, bit: 0, direction: 'output', activeLow: true },
          ],
        }}
      />
    </div>
  );
}

const root = createRoot(document.getElementById('root'));
root.render(<App />);
