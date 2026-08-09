/**
 * PartPalette — sidebar of parts with search filter.
 *
 * Drag onto the canvas or tap to add. Live search narrows by name.
 * Categorized: Power, Passive, Active, I/O.
 */

import React, { useState } from 'react';

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
      { kind: 'capacitor', label: 'Capacitor', params: { farads: 0.0001 }, color: '#34495e' },
    ],
  },
  {
    name: 'Active',
    parts: [
      { kind: 'led', label: 'LED (red)', params: { vf: 2.0, color: 'red' }, color: '#2ecc71' },
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
    name: 'Instruments',
    parts: [
      { kind: 'meter', label: 'Multimeter', params: { mode: 'voltage' }, color: '#f1c40f' },
    ],
  },
  {
    name: 'Display',
    parts: [
      { kind: 'ledcube', label: 'LED Cube 4³', params: {}, color: '#2ecc71' },
    ],
  },
];

// Flat list for search
const ALL_PARTS = CATEGORIES.flatMap(c => c.parts);

export function PartPalette({ onAddPart, onDragPart }) {
  const [filter, setFilter] = useState('');

  const matchingParts = filter
    ? ALL_PARTS.filter(p => p.label.toLowerCase().includes(filter.toLowerCase()) || p.kind.includes(filter.toLowerCase()))
    : null; // null = show categories

  return (
    <div style={{
      background: '#1a1a2e',
      border: '1px solid #2c3e50',
      borderRadius: '8px',
      padding: '8px',
      width: '130px',
      fontFamily: 'monospace',
      flexShrink: 0,
      overflowY: 'auto',
    }}>
      <div style={{ color: '#ecf0f1', fontSize: '11px', marginBottom: '4px', fontWeight: 'bold' }}>
        Parts
      </div>

      {/* Search filter */}
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
        // Search results (flat list)
        matchingParts.length === 0 ? (
          <div style={{ color: '#556', fontSize: '9px', padding: '4px' }}>No matches</div>
        ) : (
          matchingParts.map(p => <PartButton key={p.kind} part={p} onAddPart={onAddPart} onDragPart={onDragPart} />)
        )
      ) : (
        // Categorized view
        CATEGORIES.map(cat => (
          <div key={cat.name}>
            <div style={{ color: '#556', fontSize: '8px', marginTop: '4px', marginBottom: '2px', textTransform: 'uppercase' }}>
              {cat.name}
            </div>
            {cat.parts.map(p => <PartButton key={p.kind} part={p} onAddPart={onAddPart} onDragPart={onDragPart} />)}
          </div>
        ))
      )}
    </div>
  );
}

function PartButton({ part, onAddPart, onDragPart }) {
  const { kind, label, params, color } = part;
  return (
    <div
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
        padding: '5px 6px',
        marginBottom: '2px',
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
        boxSizing: 'border-box',
      }}
    >
      {label}
    </div>
  );
}
