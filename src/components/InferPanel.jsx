/**
 * InferPanel — load a circuit from pin declarations (boundary C).
 *
 * Shows the inferred circuit notes as teaching feedback:
 * "pin P1.2 is driven but nothing is wired to it"
 */

import React, { useState, useCallback } from 'react';
import { inferCircuit, checkWiring } from '../model/inference.js';

const PRESETS = [
  {
    name: 'LED blink (active-low)',
    pins: [
      { name: 'led1', port: 1, bit: 0, direction: 'output', activeLow: true },
    ],
  },
  {
    name: 'LED + pot + button',
    pins: [
      { name: 'led1', port: 1, bit: 0, direction: 'output', activeLow: true },
      { name: 'pot', port: 1, bit: 3, direction: 'analog', activeLow: false },
      { name: 'button', port: 3, bit: 2, direction: 'input', activeLow: false },
    ],
  },
  {
    name: 'Two LEDs (active-low)',
    pins: [
      { name: 'led1', port: 1, bit: 0, direction: 'output', activeLow: true },
      { name: 'led2', port: 1, bit: 1, direction: 'output', activeLow: true },
    ],
  },
  {
    name: 'LED (active-high, naive)',
    pins: [
      { name: 'led1', port: 1, bit: 0, direction: 'output', activeLow: false },
    ],
  },
];

export function InferPanel({ onLoadCircuit }) {
  const [notes, setNotes] = useState([]);
  const [lastLoaded, setLastLoaded] = useState(null);

  const handleLoad = useCallback((preset) => {
    const stc = {
      device: 'STC12C5A60S2',
      clock: 11059200,
      pins: preset.pins,
    };
    const result = inferCircuit(stc);
    onLoadCircuit(result.parts, result.nets);
    setNotes(result.notes);
    setLastLoaded(preset.name);
  }, [onLoadCircuit]);

  return (
    <div style={{
      background: '#1a1a2e',
      border: '1px solid #2c3e50',
      borderRadius: '8px',
      padding: '12px',
      width: '180px',
      fontFamily: 'monospace',
      fontSize: '11px',
    }}>
      <h3 style={{ color: '#ecf0f1', fontSize: '13px', marginBottom: '10px' }}>
        Load from Pins
      </h3>
      <p style={{ color: '#7f8c8d', fontSize: '10px', marginBottom: '8px' }}>
        Infer circuit from project pin declarations (boundary C)
      </p>

      {PRESETS.map(preset => (
        <button
          key={preset.name}
          onClick={() => handleLoad(preset)}
          style={{
            display: 'block',
            width: '100%',
            padding: '6px',
            marginBottom: '4px',
            background: lastLoaded === preset.name ? '#2c3e50' : '#16213e',
            border: '1px solid #2c3e50',
            borderRadius: '4px',
            color: lastLoaded === preset.name ? '#2ecc71' : '#bdc3c7',
            fontFamily: 'monospace',
            fontSize: '10px',
            cursor: 'pointer',
            textAlign: 'left',
          }}
        >
          {preset.name}
        </button>
      ))}

      {/* Teaching notes */}
      {notes.length > 0 && (
        <div style={{
          marginTop: '10px',
          padding: '8px',
          background: '#1a1a0e',
          border: '1px solid #f39c12',
          borderRadius: '4px',
        }}>
          <div style={{ color: '#f39c12', fontSize: '10px', marginBottom: '4px', fontWeight: 'bold' }}>
            Notes:
          </div>
          {notes.map((note, i) => (
            <div key={i} style={{ color: '#e67e22', fontSize: '10px', marginBottom: '2px' }}>
              {note}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
