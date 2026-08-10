/**
 * Dev harness — renders the CircuitDesigner as a standalone page.
 *
 * URL params for testing:
 *   ?debug=live      — external board, running
 *   ?debug=paused    — external board, halted, skewNs=0 (frozen sim)
 *   ?debug=snapshot  — external board, halted, skewNs=4.2s (stale)
 *   ?debug=hardware  — simulationOnly=false (live hardware, no sim values)
 *   (default)        — standalone demo mode
 */

import React from 'react';
import { createRoot } from 'react-dom/client';
import './model/sidecar-loader.js';

import { setEngine } from './engine.js';
import { BoardImpl } from '../../bw-board/src/board.js';
import { inferNetlist, checkWiring } from '../../bw-board/src/infer-netlist.js';
setEngine({ BoardImpl, inferNetlist, checkWiring });

import { CircuitDesigner } from './components/CircuitDesigner.jsx';

const params = new URLSearchParams(window.location.search);
const debugMode = params.get('debug');

function getDebugProps() {
  switch (debugMode) {
    case 'live':
      return { board: new BoardImpl(5.0) };
    case 'paused':
      return { board: new BoardImpl(5.0), debugState: {
        halted: true, skewNs: 0n, haltReason: 'breakpoint', bwMs: 82.3,
        tasks: [
          { name: 'bw_task0', state: 3, blockId: 'control_repeat' },
          { name: 'bw_task1', state: 1, blockId: 'stc12_setpin' },
        ],
      }};
    case 'snapshot':
      return { board: new BoardImpl(5.0), debugState: {
        halted: true, skewNs: 4_200_000_000n, haltReason: 'user', bwMs: 1250.7,
        tasks: [
          { name: 'bw_task0', state: 5, blockId: 'control_wait' },
        ],
        capabilities: { step: false, breakpoint: false, skewNs: 'non-zero' },
      }};
    case 'hardware':
      return { board: new BoardImpl(5.0), simulationOnly: false };
    default:
      return {};
  }
}

function App() {
  const debugProps = getDebugProps();
  return (
    <div style={{ height: '100%', overflow: 'clip',
      background: '#1a1a2e',
      color: '#e0e0e0',
      minHeight: '100vh',
    }}>
      <CircuitDesigner
        onBoardReady={(b) => { window.__board = b; }}
        onCircuitReady={(c) => { window.__circuit = c; }}
        project={{
          device: 'STC12C5A60S2',
          clock: 11059200,
          pins: [
            { name: 'led1', port: 1, bit: 0, direction: 'output', activeLow: true },
          ],
        }}
        {...debugProps}
      />
    </div>
  );
}

const root = createRoot(document.getElementById('root'));
root.render(<App />);
