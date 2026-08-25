/**
 * Dev harness — renders the CircuitDesigner as a standalone page.
 *
 * URL params for testing:
 *   ?debug=live      — external board, running
 *   ?debug=paused    — external board, halted, skewNs=0 (frozen sim)
 *   ?debug=snapshot  — external board, halted, skewNs=4.2s (stale)
 *   ?debug=hardware  — simulationOnly=false (live hardware, no sim values)
 *   ?examples=none   — omit the curriculum `examples` prop, so CircuitDesigner
 *                      falls back to InferPanel and its numbered presets
 *                      (01 Blink … 09 Shift Reg, 04 Brightness). Those presets
 *                      are what the browser render tests assert engine values
 *                      against — the active-low LED at ~14.5% beside the
 *                      active-high one at under 1%, which is the comparison
 *                      the simulator exists to make. Adding three curriculum
 *                      examples to this harness displaced that panel, and the
 *                      tests had no way back to it.
 *   (default)        — standalone demo mode
 */

import React from 'react';
import { createRoot } from 'react-dom/client';
import './model/sidecar-loader.js';

import { setEngine } from './engine.js';
import { BoardImpl } from '../../bw-board/src/board.js';
import { inferNetlist, checkWiring } from '../../bw-board/src/infer-netlist.js';
import { registerAllDevices } from '../../bw-board/src/register-all.js';
import { getDevice } from '../../bw-board/src/devices.js';

// The dev app must register devices like production (lite) does, or every
// registered kind (keypad_4x4, at24c02, …) rejects the netlist and the
// board sits empty — found by the A2 Playwright acceptance, 2026-08-18.
registerAllDevices();
// getDevice makes the engine's device model the AUTHORITY for terminal
// names. Without it the catalog invents terminals bw-board does not have
// (addPart('vreg') minted a/b against in/out/gnd) and checkWiring rejects
// the netlist WHOLE — one part, no wires, and the board renders empty.
setEngine({ BoardImpl, inferNetlist, checkWiring, getDevice });

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
  // Test hook: scripts/verify-a2-sim.mjs injects authored example circuit
  // files here so they travel the REAL circuitData load path (legacy/rich
  // detection and all), not a bespoke side door.
  const [circuitData, setCircuitData] = React.useState(null);
  React.useEffect(() => { window.__setCircuitData = setCircuitData; }, []);
  return (
    <div style={{ height: '100%', overflow: 'clip',
      background: '#1a1a2e',
      color: '#e0e0e0',
      minHeight: '100vh',
    }}>
      <CircuitDesigner
        {...(new URLSearchParams(location.search).has('nopins') ? { project: { pins: [] } } : {})}
        onBoardReady={(b) => { window.__board = b; }}
        onCircuitReady={(c) => { window.__circuit = c; }}
        project={{
          device: new URLSearchParams(location.search).get('device') || 'STC12C5A60S2',
          clock: 11059200,
          pins: [
            { name: 'led1', port: 1, bit: 0, direction: 'output', activeLow: true },
          ],
        }}
        {...(new URLSearchParams(location.search).get('examples') === 'none' ? {} : {
          examples: [
            { id: 'ex-blink', title: { en: 'Blink LED' }, category: 'basics', difficulty: 1 },
            { id: 'ex-button', title: { en: 'Button' }, category: 'basics', difficulty: 1 },
            { id: 'ex-pot', title: { en: 'Potentiometer' }, category: 'analog', difficulty: 2 },
          ],
        })}
        onLoadExample={(ex) => { console.log('load example', ex.id); }}
        {...(circuitData ? { circuitData } : {})}
        {...debugProps}
      />
    </div>
  );
}

const root = createRoot(document.getElementById('root'));
root.render(<App />);
