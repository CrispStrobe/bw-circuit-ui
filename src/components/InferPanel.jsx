/**
 * InferPanel — load a circuit from pin declarations (boundary C).
 *
 * Presets are the real example programs from stc/examples/,
 * each with a pins.json that exercises a specific inferNetlist row.
 * The active-low vs active-high comparison (04-brightness) is the
 * core lesson.
 */

import React, { useState, useCallback } from 'react';
import { inferCircuit, checkWiring } from '../model/inference.js';

// Real example programs from stc/examples/ — these are the actual
// pin declarations from committed, tested programs.
const EXAMPLES = [
  {
    name: '01 Blink',
    desc: 'Two LEDs, active-low',
    stc: {
      device: 'stc12c5a60s2', clock: 11059200,
      pins: [
        { name: 'led1', port: 1, bit: 0, direction: 'output', activeLow: true },
        { name: 'led2', port: 1, bit: 1, direction: 'output', activeLow: true },
      ],
    },
  },
  {
    name: '02 Button',
    desc: 'Two LEDs + button input',
    stc: {
      device: 'stc12c5a60s2', clock: 11059200,
      pins: [
        { name: 'led1', port: 1, bit: 0, direction: 'output', activeLow: true },
        { name: 'led2', port: 1, bit: 1, direction: 'output', activeLow: true },
        { name: 'button', port: 3, bit: 2, direction: 'input', activeLow: true },
      ],
    },
  },
  {
    name: '03 Potentiometer',
    desc: 'LED + pot (ADC)',
    stc: {
      device: 'stc12c5a60s2', clock: 11059200,
      pins: [
        { name: 'led', port: 1, bit: 0, direction: 'output', activeLow: true },
        { name: 'pot', port: 1, bit: 2, direction: 'analog', activeLow: false },
      ],
    },
  },
  {
    name: '05 Scheduler',
    desc: 'Two LEDs at different rates',
    stc: {
      device: 'stc12c5a60s2', clock: 11059200,
      pins: [
        { name: 'slow', port: 1, bit: 0, direction: 'output', activeLow: true },
        { name: 'fast', port: 1, bit: 1, direction: 'output', activeLow: true },
      ],
    },
  },
  {
    name: '06 Dimmer',
    desc: 'PWM LED + pot',
    stc: {
      device: 'stc12c5a60s2', clock: 11059200,
      pins: [
        { name: 'pot', port: 1, bit: 2, direction: 'analog', activeLow: false },
        { name: 'lamp', port: 1, bit: 3, direction: 'pwm', activeLow: true },
      ],
    },
  },
  {
    name: '07 Buzzer',
    desc: 'Button + buzzer (tone)',
    stc: {
      device: 'stc12c5a60s2', clock: 11059200,
      pins: [
        { name: 'button', port: 3, bit: 2, direction: 'input', activeLow: true },
        { name: 'buzzer', port: 3, bit: 5, direction: 'tone', activeLow: false },
      ],
    },
  },
  {
    name: '08 7-Segment',
    desc: 'Whole port → display',
    stc: {
      device: 'stc12c5a60s2', clock: 11059200,
      pins: [],
      ports: [
        { name: 'segments', port: 0, sfr: 'P0', width: 8, direction: 'output', activeLow: false },
      ],
    },
  },
  {
    name: '09 Shift Reg',
    desc: '74HC595 → 8 LEDs',
    stc: {
      device: 'stc12c5a60s2', clock: 11059200,
      pins: [],
      ports: [],
      parts: [
        {
          name: 'leds', kind: '74hc595',
          pins: { data: 'P3.4', clock: 'P3.6', latch: 'P3.5' },
          outputs: 8, activeLow: true,
        },
      ],
    },
  },
];

// Additional circuits from reidemeister.com/blog/category/8051
// covering the HC6800-ES board pin assignments.
const REIDEMEISTER_PRESETS = [
  {
    name: 'R: LED bar P2',
    desc: '8 LEDs on port 2 (active-low)',
    stc: {
      device: 'stc12c5a60s2', clock: 11059200,
      pins: [],
      ports: [
        { name: 'leds', port: 2, sfr: 'P2', width: 8, direction: 'output', activeLow: true },
      ],
    },
  },
  {
    name: 'R: Buttons + LEDs',
    desc: 'P3.0-3 buttons, P2 LEDs',
    stc: {
      device: 'stc12c5a60s2', clock: 11059200,
      pins: [
        { name: 'btn0', port: 3, bit: 0, direction: 'input', activeLow: true },
        { name: 'btn1', port: 3, bit: 1, direction: 'input', activeLow: true },
        { name: 'btn2', port: 3, bit: 2, direction: 'input', activeLow: true },
        { name: 'btn3', port: 3, bit: 3, direction: 'input', activeLow: true },
      ],
      ports: [
        { name: 'leds', port: 2, sfr: 'P2', width: 8, direction: 'output', activeLow: true },
      ],
    },
  },
  {
    name: 'R: Buzzer P1.5',
    desc: 'Piezo buzzer on P1.5',
    stc: {
      device: 'stc12c5a60s2', clock: 11059200,
      pins: [
        { name: 'buzzer', port: 1, bit: 5, direction: 'tone', activeLow: false },
      ],
    },
  },
  {
    name: 'R: UART serial',
    desc: 'TX/RX on P3.0-1',
    stc: {
      device: 'stc12c5a60s2', clock: 11059200,
      pins: [
        { name: 'rxd', port: 3, bit: 0, direction: 'input', activeLow: false },
        { name: 'txd', port: 3, bit: 1, direction: 'output', activeLow: false },
      ],
    },
  },
  {
    name: 'R: Full board',
    desc: 'LEDs + buttons + buzzer + pot',
    stc: {
      device: 'stc12c5a60s2', clock: 11059200,
      pins: [
        { name: 'btn0', port: 3, bit: 0, direction: 'input', activeLow: true },
        { name: 'btn1', port: 3, bit: 1, direction: 'input', activeLow: true },
        { name: 'btn2', port: 3, bit: 2, direction: 'input', activeLow: true },
        { name: 'btn3', port: 3, bit: 3, direction: 'input', activeLow: true },
        { name: 'buzzer', port: 1, bit: 5, direction: 'tone', activeLow: false },
        { name: 'pot', port: 1, bit: 2, direction: 'analog', activeLow: false },
      ],
      ports: [
        { name: 'leds', port: 2, sfr: 'P2', width: 8, direction: 'output', activeLow: true },
      ],
    },
  },
];

// The comparison that justifies the whole simulator:
// 04-brightness drives both an active-low and active-high LED
// so the sink/source asymmetry is visible, not just asserted.
const COMPARISON = {
  name: '04 Brightness',
  desc: 'Active-low vs active-high — same pin mode, different wiring',
  stc: {
    device: 'stc12c5a60s2', clock: 11059200,
    pins: [
      { name: 'low_side', port: 1, bit: 0, direction: 'output', activeLow: true },
      { name: 'high_side', port: 1, bit: 1, direction: 'output', activeLow: false },
    ],
  },
};

export function InferPanel({ onLoadCircuit }) {
  const [notes, setNotes] = useState([]);
  const [lastLoaded, setLastLoaded] = useState(null);

  const handleLoad = useCallback((preset) => {
    const result = inferCircuit(preset.stc);
    onLoadCircuit(result.parts, result.nets);
    setNotes(result.notes);
    setLastLoaded(preset.name);
  }, [onLoadCircuit]);

  return (
    <div style={{
      background: '#1a1a2e',
      border: '1px solid #2c3e50',
      borderRadius: '8px',
      padding: '10px',
      width: '130px',
      fontFamily: 'monospace',
      fontSize: '11px',
      flexShrink: 0,
    }}>
      <div style={{ color: '#ecf0f1', fontSize: '12px', marginBottom: '6px', fontWeight: 'bold' }}>
        Why active-low?
      </div>
      <p style={{ color: '#f39c12', fontSize: '9px', marginBottom: '8px', lineHeight: '1.4' }}>
        Load "04 Brightness", hit Sim. Two LEDs on the same chip — one bright,
        one barely visible. The simulator shows why.
      </p>

      {/* The comparison preset — visually grouped */}
      <button
        onClick={() => handleLoad(COMPARISON)}
        style={{
          display: 'block', width: '100%', padding: '6px', marginBottom: '8px',
          background: lastLoaded === COMPARISON.name ? '#2c3e50' : '#16213e',
          border: lastLoaded === COMPARISON.name ? '1px solid #f39c12' : '1px solid #f39c12',
          borderRadius: '4px',
          color: lastLoaded === COMPARISON.name ? '#f39c12' : '#e67e22',
          fontFamily: 'monospace', fontSize: '10px', cursor: 'pointer', textAlign: 'left',
        }}
      >
        {COMPARISON.name}
        <div style={{ color: '#7f8c8d', fontSize: '8px' }}>{COMPARISON.desc}</div>
      </button>

      {/* Example programs */}
      <div style={{ color: '#7f8c8d', fontSize: '9px', marginBottom: '4px' }}>
        Examples:
      </div>
      {EXAMPLES.map(preset => (
        <button
          key={preset.name}
          onClick={() => handleLoad(preset)}
          style={{
            display: 'block', width: '100%', padding: '5px', marginBottom: '2px',
            background: lastLoaded === preset.name ? '#2c3e50' : '#16213e',
            border: '1px solid #2c3e50', borderRadius: '4px',
            color: lastLoaded === preset.name ? '#2ecc71' : '#bdc3c7',
            fontFamily: 'monospace', fontSize: '9px', cursor: 'pointer', textAlign: 'left',
          }}
        >
          {preset.name}
          <span style={{ color: '#7f8c8d', fontSize: '8px', marginLeft: '4px' }}>{preset.desc}</span>
        </button>
      ))}

      {/* Reidemeister HC6800-ES board circuits */}
      <div style={{ color: '#7f8c8d', fontSize: '9px', marginTop: '8px', marginBottom: '4px' }}>
        HC6800-ES board:
      </div>
      {REIDEMEISTER_PRESETS.map(preset => (
        <button
          key={preset.name}
          onClick={() => handleLoad(preset)}
          style={{
            display: 'block', width: '100%', padding: '5px', marginBottom: '2px',
            background: lastLoaded === preset.name ? '#2c3e50' : '#16213e',
            border: '1px solid #2c3e50', borderRadius: '4px',
            color: lastLoaded === preset.name ? '#2ecc71' : '#95a5a6',
            fontFamily: 'monospace', fontSize: '9px', cursor: 'pointer', textAlign: 'left',
          }}
        >
          {preset.name}
          <span style={{ color: '#7f8c8d', fontSize: '8px', marginLeft: '4px' }}>{preset.desc}</span>
        </button>
      ))}

      {/* Teaching notes */}
      {notes.length > 0 && (
        <div style={{
          marginTop: '8px', padding: '6px',
          background: '#1a1a0e', border: '1px solid #f39c12', borderRadius: '4px',
        }}>
          {notes.map((note, i) => (
            <div key={i} style={{ color: '#e67e22', fontSize: '9px', marginBottom: '2px' }}>
              {note}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
