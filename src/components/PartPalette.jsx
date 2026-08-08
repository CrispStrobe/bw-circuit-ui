/**
 * PartPalette — sidebar of parts. Drag onto the canvas or tap to add.
 *
 * Desktop: drag from palette button, drop on canvas.
 * Tablet: tap to add at a default position (drag from palette is
 * harder on touch since there's no cursor feedback over the canvas).
 *
 * Uses HTML5 drag-and-drop API for desktop, click fallback for touch.
 */

import React from 'react';

const PART_TYPES = [
  { kind: 'vcc', label: 'VCC', params: {}, color: '#e74c3c' },
  { kind: 'gnd', label: 'GND', params: {}, color: '#3498db' },
  { kind: 'resistor', label: 'Resistor 1kΩ', params: { ohms: 1000 }, color: '#e67e22' },
  { kind: 'led', label: 'LED (red)', params: { vf: 2.0, color: 'red' }, color: '#2ecc71' },
  { kind: 'potentiometer', label: 'Pot 10kΩ', params: { ohms: 10000 }, color: '#9b59b6' },
  { kind: 'button', label: 'Button', params: {}, color: '#f39c12' },
  { kind: 'buzzer', label: 'Buzzer', params: {}, color: '#1abc9c' },
  { kind: 'capacitor', label: 'Capacitor', params: { farads: 0.0001 }, color: '#34495e' },
  { kind: 'mcu', label: 'MCU (STC12)', params: { pins: ['P1.0', 'P1.3', 'P1.5', 'P3.2'] }, color: '#7f8c8d' },
];

export function PartPalette({ onAddPart, onDragPart }) {
  return (
    <div style={{
      background: '#1a1a2e',
      border: '1px solid #2c3e50',
      borderRadius: '8px',
      padding: '10px',
      width: '130px',
      fontFamily: 'monospace',
      flexShrink: 0,
      overflowY: 'auto',
    }}>
      <div style={{ color: '#ecf0f1', fontSize: '12px', marginBottom: '8px', fontWeight: 'bold' }}>
        Parts
      </div>
      <div style={{ color: '#7f8c8d', fontSize: '9px', marginBottom: '8px' }}>
        Drag onto board or tap to add
      </div>
      {PART_TYPES.map(({ kind, label, params, color }) => (
        <div
          key={kind}
          draggable
          onClick={() => onAddPart(kind, params)}
          onDragStart={(e) => {
            e.dataTransfer.setData('application/circuit-part', JSON.stringify({ kind, params }));
            e.dataTransfer.effectAllowed = 'copy';
            if (onDragPart) onDragPart(kind, params);
          }}
          style={{
            display: 'block',
            width: '100%',
            padding: '7px 6px',
            marginBottom: '3px',
            background: '#16213e',
            border: `1px solid ${color}`,
            borderRadius: '4px',
            color,
            fontFamily: 'monospace',
            fontSize: '10px',
            cursor: 'grab',
            textAlign: 'left',
            userSelect: 'none',
            touchAction: 'manipulation',
          }}
        >
          {label}
        </div>
      ))}
    </div>
  );
}
