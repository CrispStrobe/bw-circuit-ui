/**
 * ContextMenu — context menu for parts and wires.
 *
 * Triggered by right-click (desktop) or long-press (tablet/touch).
 * Actions: delete, duplicate, rotate (parts), delete (wires).
 */

import React from 'react';

const menuStyle = {
  position: 'fixed',
  background: '#1a1a2e',
  border: '1px solid #3498db',
  borderRadius: '6px',
  padding: '4px 0',
  fontFamily: 'monospace',
  fontSize: '12px',
  zIndex: 200,
  minWidth: '140px',
  boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
};

const itemStyle = {
  padding: '6px 14px',
  color: '#ecf0f1',
  cursor: 'pointer',
  display: 'block',
  width: '100%',
  border: 'none',
  background: 'none',
  textAlign: 'left',
  fontFamily: 'monospace',
  fontSize: '12px',
};

const hoverBg = '#2c3e50';
const dangerColor = '#e74c3c';

function MenuItem({ label, shortcut, onClick, danger }) {
  const [hovered, setHovered] = React.useState(false);
  return (
    <button
      style={{
        ...itemStyle,
        background: hovered ? hoverBg : 'transparent',
        color: danger ? dangerColor : '#ecf0f1',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onClick}
    >
      {label}
      {shortcut && (
        <span style={{ float: 'right', color: '#7f8c8d', fontSize: '10px', marginLeft: '16px' }}>
          {shortcut}
        </span>
      )}
    </button>
  );
}

const WIRE_COLORS = [
  { label: 'Auto (voltage)', value: null },
  { label: 'Red (+)', value: '#e74c3c' },
  { label: 'Black (GND)', value: '#1a1a1a' },
  { label: 'Green', value: '#2ecc71' },
  { label: 'Blue', value: '#3498db' },
  { label: 'Yellow', value: '#f1c40f' },
  { label: 'White', value: '#ecf0f1' },
  { label: 'Orange', value: '#e67e22' },
];

const swatchStyle = {
  display: 'inline-block',
  width: 12,
  height: 12,
  borderRadius: 2,
  border: '1px solid #555',
  marginRight: 8,
  verticalAlign: 'middle',
};

export function ContextMenu({ x, y, type, onClose, onDelete, onDuplicate, onRotate, onFlip, onSetWireColor }) {
  if (!type) return null;

  return (
    <>
      {/* Backdrop to close menu on click-away */}
      <div
        style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 199 }}
        onClick={onClose}
        onContextMenu={(e) => { e.preventDefault(); onClose(); }}
      />
      <div style={{ ...menuStyle, left: x, top: y }}>
        {type === 'part' && (
          <>
            <MenuItem label="Duplicate" shortcut="Ctrl+D" onClick={onDuplicate} />
            <MenuItem label="Rotate" shortcut="R" onClick={onRotate} />
            <MenuItem label="Flip" shortcut="H" onClick={onFlip} />
            <div style={{ height: 1, background: '#2c3e50', margin: '4px 0' }} />
            <MenuItem label="Delete" shortcut="Del" onClick={onDelete} danger />
          </>
        )}
        {type === 'wire' && (
          <>
            <div style={{ padding: '4px 14px', color: '#7f8c8d', fontSize: '10px' }}>Wire color</div>
            {WIRE_COLORS.map(c => (
              <button
                key={c.label}
                style={{ ...itemStyle, display: 'flex', alignItems: 'center' }}
                onClick={() => { if (onSetWireColor) onSetWireColor(c.value); onClose(); }}
                onMouseEnter={(e) => { e.currentTarget.style.background = hoverBg; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
              >
                <span style={{ ...swatchStyle, background: c.value || 'linear-gradient(135deg, #e74c3c, #3498db)' }} />
                {c.label}
              </button>
            ))}
            <div style={{ height: 1, background: '#2c3e50', margin: '4px 0' }} />
            <MenuItem label="Delete wire" shortcut="Del" onClick={onDelete} danger />
          </>
        )}
      </div>
    </>
  );
}
