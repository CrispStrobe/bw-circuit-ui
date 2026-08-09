/**
 * PartPalette — categorized sidebar with search, drag-to-add.
 *
 * Every part kind that BoardCanvas can render should be here.
 * Parts with minimal electrical models are labeled "(drawable)".
 */

import React, { useState } from 'react';
import { PartThumbnail } from './PartThumbnail.jsx';

const LED_COLORS = ['red', 'green', 'yellow', 'blue', 'white', 'orange'];

const CATEGORIES = [
  {
    name: 'Power',
    parts: [
      { kind: 'vcc', label: 'VCC', params: {}, color: '#e74c3c' },
      { kind: 'gnd', label: 'GND', params: {}, color: '#3498db' },
    ],
  },
  {
    name: 'Passive',
    parts: [
      { kind: 'resistor', label: 'Resistor 1kΩ', params: { ohms: 1000 }, color: '#e67e22' },
      { kind: 'capacitor', label: 'Capacitor 100µF', params: { farads: 0.0001 }, color: '#34495e' },
      { kind: 'diode', label: 'Diode', params: { vf: 0.7 }, color: '#95a5a6' },
      { kind: 'switch', label: 'Switch', params: {}, color: '#bdc3c7' },
    ],
  },
  {
    name: 'Active',
    parts: [
      { kind: 'led', label: 'LED', params: { vf: 2.0, color: 'red' }, color: '#2ecc71', hasColorPicker: true },
      { kind: 'buzzer', label: 'Buzzer', params: {}, color: '#1abc9c' },
    ],
  },
  {
    name: 'I/O',
    parts: [
      { kind: 'potentiometer', label: 'Pot 10kΩ', params: { ohms: 10000 }, color: '#9b59b6' },
      { kind: 'button', label: 'Button', params: {}, color: '#f39c12' },
      { kind: 'mcu', label: 'MCU (STC12)', params: { pins: ['P1.0', 'P1.3', 'P1.5', 'P3.2'] }, color: '#7f8c8d' },
    ],
  },
  {
    name: 'Display',
    parts: [
      { kind: 'seven_segment', label: '7-Segment', params: {}, color: '#e74c3c', tooltip: 'Digit display' },
      { kind: 'char_lcd', label: 'LCD 16×2', params: {}, color: '#2980b9', tooltip: 'drawable — HD44780' },
      { kind: 'led_matrix', label: 'LED Matrix', params: {}, color: '#27ae60', tooltip: 'drawable — 8×8' },
      { kind: 'led_cube', label: 'LED Cube 4³', params: {}, color: '#2ecc71' },
    ],
  },
  {
    name: 'ICs',
    parts: [
      { kind: 'shift_register', label: '74HC595', params: {}, color: '#8e44ad', tooltip: 'Shift register — 8 outputs' },
      { kind: 'ir_receiver', label: 'IR Receiver', params: {}, color: '#c0392b', tooltip: 'drawable — IrDA' },
      { kind: 'temp_sensor', label: 'Temp Sensor', params: {}, color: '#16a085', tooltip: 'drawable — DS18B20' },
      { kind: 'eeprom', label: 'EEPROM', params: {}, color: '#2c3e50', tooltip: 'drawable — I²C' },
    ],
  },
  {
    name: 'Instruments',
    parts: [
      { kind: 'meter', label: 'Multimeter', params: { mode: 'voltage' }, color: '#f1c40f' },
    ],
  },
];

const ALL_PARTS = CATEGORIES.flatMap(c => c.parts);

export function PartPalette({ onAddPart, onDragPart }) {
  const [filter, setFilter] = useState('');
  const [ledColor, setLedColor] = useState('red');

  const matchingParts = filter
    ? ALL_PARTS.filter(p =>
        p.label.toLowerCase().includes(filter.toLowerCase()) ||
        p.kind.includes(filter.toLowerCase()) ||
        (p.tooltip || '').toLowerCase().includes(filter.toLowerCase()))
    : null;

  return (
    <div style={{
      background: '#1a1a2e',
      border: '1px solid #2c3e50',
      borderRadius: '8px',
      padding: '8px',
      width: '160px',
      fontFamily: 'monospace',
      flexShrink: 0,
      overflowY: 'auto',
    }}>
      <div style={{ color: '#ecf0f1', fontSize: '11px', marginBottom: '4px', fontWeight: 'bold' }}>
        Parts
      </div>

      <input
        type="text"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="search..."
        style={{
          width: '100%', padding: '4px 6px', marginBottom: '6px',
          background: '#0a0a1a', border: '1px solid #2c3e50',
          borderRadius: '4px', color: '#ecf0f1',
          fontFamily: 'monospace', fontSize: '10px',
          boxSizing: 'border-box',
        }}
      />

      {matchingParts ? (
        matchingParts.length === 0 ? (
          <div style={{ color: '#556', fontSize: '9px', padding: '4px' }}>No matches</div>
        ) : (
          matchingParts.map(p => <PartButton key={p.kind} part={p} onAddPart={onAddPart} onDragPart={onDragPart} ledColor={ledColor} onLedColorChange={setLedColor} />)
        )
      ) : (
        CATEGORIES.map(cat => (
          <div key={cat.name}>
            <div style={{ color: '#556', fontSize: '8px', marginTop: '4px', marginBottom: '2px', textTransform: 'uppercase' }}>
              {cat.name}
            </div>
            {cat.parts.map(p => <PartButton key={p.kind} part={p} onAddPart={onAddPart} onDragPart={onDragPart} ledColor={ledColor} onLedColorChange={setLedColor} />)}
          </div>
        ))
      )}
    </div>
  );
}

function PartButton({ part, onAddPart, onDragPart, ledColor, onLedColorChange }) {
  const { kind, label, params, color, tooltip, hasColorPicker } = part;
  const [hovered, setHovered] = useState(false);

  // For LEDs, use the selected color
  const effectiveParams = kind === 'led' ? { ...params, color: ledColor } : params;

  return (
    <div style={{ position: 'relative' }}>
      <div
        draggable
        onClick={() => onAddPart(kind, effectiveParams)}
        onDragStart={(e) => {
          e.dataTransfer.setData('application/circuit-part', JSON.stringify({ kind, params: effectiveParams }));
          e.dataTransfer.effectAllowed = 'copy';
          if (onDragPart) onDragPart(kind, effectiveParams);
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        title={tooltip || label}
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          width: '100%',
          padding: '4px',
          marginBottom: '3px',
          background: hovered ? '#1e2d4a' : '#16213e',
          border: `1px solid ${hovered ? color : '#2c3e50'}`,
          borderRadius: '6px',
          cursor: 'grab',
          userSelect: 'none',
          touchAction: 'manipulation',
          boxSizing: 'border-box',
          transition: 'border-color 80ms, background 80ms',
        }}
      >
        <PartThumbnail kind={kind} color={color} params={effectiveParams} />
        <div style={{
          color: hovered ? '#ecf0f1' : color,
          fontFamily: 'monospace',
          fontSize: '9px',
          textAlign: 'center',
          lineHeight: '1.2',
          marginTop: '2px',
        }}>
          {kind === 'led' ? `LED (${ledColor})` : label}
        </div>
        {tooltip && (
          <div style={{ color: '#556', fontSize: '7px', textAlign: 'center' }}>{tooltip}</div>
        )}
      </div>

      {/* LED color swatch picker */}
      {hasColorPicker && (
        <div style={{ display: 'flex', gap: '2px', padding: '2px 4px', marginBottom: '2px', justifyContent: 'center' }}>
          {LED_COLORS.map(c => (
            <div
              key={c}
              onClick={() => onLedColorChange(c)}
              style={{
                width: '12px', height: '12px', borderRadius: '50%',
                background: c === 'white' ? '#eee' : c,
                border: c === ledColor ? '2px solid #fff' : '1px solid #444',
                cursor: 'pointer',
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
