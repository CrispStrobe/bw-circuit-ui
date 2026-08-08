/**
 * Dev harness — renders the CircuitDesigner as a standalone page.
 *
 * This file is only used by the Vite dev server. The component itself
 * is imported from src/index.js by brickwright-lite.
 */

import React from 'react';
import { createRoot } from 'react-dom/client';
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
