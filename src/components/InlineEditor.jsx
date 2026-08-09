/**
 * InlineEditor — appears on double-click over a part.
 *
 * Shows the part's editable properties in a compact popup near the
 * part, without needing the side panel. Double-click is the standard
 * interaction in professional circuit tools.
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { SiInput } from './SiInput.jsx';
import { partLabel } from '../model/format.js';

export function InlineEditor({ part, x, y, onUpdateParams, onClose }) {
  const ref = useRef(null);

  // Close on click-outside or Escape
  useEffect(() => {
    const handleKey = (e) => { if (e.key === 'Escape') onClose(); };
    const handleClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    };
    document.addEventListener('keydown', handleKey);
    document.addEventListener('mousedown', handleClick, true);
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.removeEventListener('mousedown', handleClick, true);
    };
  }, [onClose]);

  if (!part) return null;

  const editableParams = Object.entries(part.params || {})
    .filter(([k]) => k !== 'pins');

  return (
    <div ref={ref} style={{
      position: 'fixed',
      left: x + 20,
      top: y - 10,
      background: '#1a1a2e',
      border: '1px solid #3498db',
      borderRadius: '6px',
      padding: '8px 10px',
      fontFamily: 'monospace',
      fontSize: '11px',
      zIndex: 200,
      minWidth: '120px',
      boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
    }}>
      <div style={{ color: '#3498db', fontWeight: 'bold', marginBottom: '6px' }}>
        {partLabel(part)}
      </div>

      {/* Declaration name */}
      {part.declName != null && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '4px' }}>
          <span style={{ color: '#7f8c8d', fontSize: '10px' }}>name:</span>
          <input
            type="text"
            value={part.declName}
            onChange={(e) => {
              part.declName = e.target.value;
              onUpdateParams(part.id, {});
            }}
            style={{
              width: '70px', padding: '2px 4px',
              background: '#0a0a1a', border: '1px solid #3498db',
              borderRadius: '2px', color: '#3498db',
              fontFamily: 'monospace', fontSize: '10px',
            }}
          />
        </div>
      )}

      {editableParams.map(([k, v]) => (
        <div key={k} style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '3px' }}>
          <span style={{ color: '#7f8c8d', fontSize: '10px', minWidth: '35px' }}>{k}:</span>
          {(k === 'ohms' || k === 'farads') ? (
            <SiInput
              value={v}
              onChange={(newVal) => onUpdateParams(part.id, { [k]: newVal })}
              style={{
                background: '#0a0a1a', border: '1px solid #2c3e50',
                borderRadius: '2px', color: '#ecf0f1',
                fontFamily: 'monospace', fontSize: '10px',
              }}
            />
          ) : (
            <input
              type={typeof v === 'number' ? 'number' : 'text'}
              value={v}
              onChange={(e) => {
                const newVal = typeof v === 'number' ? parseFloat(e.target.value) || 0 : e.target.value;
                onUpdateParams(part.id, { [k]: newVal });
              }}
              style={{
                width: '60px', padding: '2px 4px',
                background: '#0a0a1a', border: '1px solid #2c3e50',
                borderRadius: '2px', color: '#ecf0f1',
                fontFamily: 'monospace', fontSize: '10px',
              }}
            />
          )}
        </div>
      ))}
    </div>
  );
}
